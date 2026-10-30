// Lamp Brain, slice 1: GET /api/brain/brief (migration 20261030120000_brain_briefs.sql).
// Never import this from browser code: the route file loads it inside its handler.
//
//   GET /api/brain/brief            the caller's Today list: rules first, Claude's words on top
//   GET /api/brain/brief?file=<id>  one file's next step, for the file view
//
// Everything is read as the caller, so the database's rules decide which files they see. The
// model is called at most once per person per day, only when ANTHROPIC_API_KEY is set (and
// LAMP_BRAIN isn't "off"), only while the month's spend is under BRAIN_MONTHLY_CAP_USD (50 by
// default), and only with the allowlisted facts from brain.ts. Whatever it writes is checked
// (checkBrief) before anyone sees it; anything that fails falls back to the rules' own words.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { caller, env, json, service, SERVICE_KEY, SUPABASE_URL } from "@/lib/funder-send.server";
import {
  type BrainInput,
  briefDay,
  checkBrief,
  factsFor,
  findToday,
  SIGNAL_LABEL,
  type TodayItem,
} from "@/lib/brain";

export const MODEL = "claude-opus-5-5";
// $ per million tokens on claude-opus-5-5. A refusal rescued by the fallback model bills at that
// model's rates; this log uses Opus 5.5's, which is close enough for a monthly cap.
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN = [
  "new",
  "reviewing",
  "docs_needed",
  "submitted",
  "offers_ready",
  "accepted",
  "closing",
];
const PENDING_MS = 2 * 60_000;
const RETRY_FAILED_MS = 60 * 60_000;

export const on = () => !!env("ANTHROPIC_API_KEY") && env("LAMP_BRAIN").toLowerCase() !== "off";
export const cap = () => {
  const v = Number(env("BRAIN_MONTHLY_CAP_USD"));
  return Number.isFinite(v) && v >= 0 && env("BRAIN_MONTHLY_CAP_USD") !== "" ? v : 50;
};

// Stable on purpose: no dates or names in here, so it can be cached across calls.
const SYSTEM = `You write the morning brief for a staff member at Lamp, a business-funding brokerage. Lamp's reps help small businesses get revenue-based funding (merchant cash advances) from funders: the merchant applies and signs, sends bank statements, Lamp sends the package to funders, funders make offers, the merchant accepts one, and the deal closes and funds.

You get JSON: who is reading ("rep" or "admin"), and the files and links Lamp's rules picked for today, best first. Each item has a ref (F1, F2 for files; L1, L2 for application links that went out), the business name, the stage, the signals that fired, and some numbers.

Signals:
- offer_expiring: a presented offer runs out within "hours" hours.
- active_now: the merchant did something on their file in the last half hour.
- docs_in: "docs" new documents are waiting to be reviewed.
- package_ready: signed, "docs" documents on file, not sent to any funder yet.
- reached_signing: signed in the last two days but fewer than three documents; statements are likely missing.
- stalled_offer: offers have been out "days" days with no answer.
- stale: nothing has happened on the file for "days" days.
- link_unopened: the application link went out "days" days ago and hasn't been opened.
"amount" is the rounded amount the merchant asked for, in dollars. "rep" (admins only) is whose file it is.

Write:
- headline: one plain sentence on what matters most today, naming the business when one item clearly leads.
- items: for each item, in the order given, its ref and one next step the reader can do today, in under 25 words, naming the business. Add something the rules didn't say only when the facts support it (two signals at once, a large amount, a long wait).

Rules: use only the facts given; never invent numbers, names, dates, funders or promises. Never use the word "loan" or "lending"; this is funding or an advance. Never write a phone number, email or any ID. Don't mention another item's ref inside an item's line. Plain words, no jargon, no exclamation marks.`;

const BriefSchema = z.object({
  headline: z.string(),
  items: z.array(z.object({ ref: z.string(), next: z.string() })),
});

// each line keeps the signal it was written for: if the file has moved on since, the rules' words show
type Stored = {
  headline: string;
  items: { id: string; kind: string; signal: string; next: string }[];
};

/** Today's written line for an item, only while it still describes the same signal. */
const writtenFor = (brief: Stored | null | undefined, i: TodayItem) => {
  const w = brief?.items.find((x) => x.id === i.id && x.kind === i.kind);
  return w && w.signal === i.signal ? w.next : undefined;
};
type Row = {
  id: string;
  state: "pending" | "ai" | "failed";
  brief: Stored | null;
  error: string | null;
  updated_at: string;
};

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Who's asking, as staff: admin or a rep seat, else null. */
export async function staff(userId: string) {
  const svc = service();
  const [roles, seat] = await Promise.all([
    svc.from("user_roles").select("role").eq("user_id", userId).in("role", ["admin", "rep"]),
    svc.from("reps").select("slug,name").eq("user_id", userId).limit(1).maybeSingle(),
  ]);
  const r = (roles.data ?? []) as { role: string }[];
  if (!r.length) return null;
  const s = seat.data as { slug: string; name: string } | null;
  // an admin without a rep seat signs messages with their profile name
  const prof = s
    ? null
    : ((await svc.from("profiles").select("full_name").eq("id", userId).maybeSingle()).data as {
        full_name: string | null;
      } | null);
  return {
    isAdmin: r.some((x) => x.role === "admin"),
    repSlug: s?.slug ?? null,
    name: s?.name ?? prof?.full_name ?? null,
  };
}

/**
 * When each file was signed. Staff can't read the signed application itself from their own client
 * (it holds SSNs; /api/application-details logs every look), so Lamp's server reads only the
 * signing time, and only for files the caller's own rules already showed them.
 */
export async function signedAt(fileIds: string[]) {
  const out: { application_id: string; signed_at: string | null }[] = [];
  for (let i = 0; i < fileIds.length; i += 200) {
    const r = await service()
      .from("application_details")
      .select("application_id,signed_at")
      .in("application_id", fileIds.slice(i, i + 200))
      .not("signed_at", "is", null);
    out.push(
      ...((r.data ?? []) as { application_id: string; signed_at: string | null }[]).map((x) => ({
        application_id: String(x.application_id),
        signed_at: str(x.signed_at),
      })),
    );
  }
  return out;
}

/** The rules' input, read with the caller's own client so their access rules apply. */
export async function readInput(
  client: Awaited<ReturnType<typeof caller>> & object,
): Promise<BrainInput> {
  const db = client.client;
  const since = new Date(Date.now() - 35 * 60_000).toISOString();
  const [files, offers, events, invites] = await Promise.all([
    db
      .from("pipeline_board")
      .select(
        "id,status,rep_slug,user_id,business_name,amount_requested,created_at,updated_at,last_activity_at,document_count,documents_pending_review,submission_count",
      )
      .in("status", OPEN as never)
      .limit(2000),
    db
      .from("offers")
      .select("application_id,status,presented_at,expires_at,accepted_at")
      .in("status", ["presented", "accepted"] as never)
      .limit(5000),
    db
      .from("events")
      .select("application_id,kind,actor_user_id,occurred_at")
      .gte("occurred_at", since)
      .limit(2000),
    db
      .from("application_invites")
      .select("id,rep_slug,business_name,sent_at,opened_at,cancelled_at,expires_at,application_id")
      .is("opened_at", null)
      .is("cancelled_at", null)
      .is("application_id", null)
      .limit(2000),
  ]);
  const rows = (r: { data: unknown }) => (r.data ?? []) as Record<string, unknown>[];
  const signed = await signedAt(rows(files).map((r) => String(r["id"])));
  return {
    files: rows(files).map((r) => ({
      id: String(r["id"]),
      status: String(r["status"]),
      rep_slug: str(r["rep_slug"]),
      user_id: str(r["user_id"]),
      business_name: str(r["business_name"]),
      amount_requested: r["amount_requested"] == null ? null : num(r["amount_requested"]),
      created_at: String(r["created_at"]),
      updated_at: String(r["updated_at"]),
      last_activity_at: str(r["last_activity_at"]),
      document_count: num(r["document_count"]),
      documents_pending_review: num(r["documents_pending_review"]),
      submission_count: num(r["submission_count"]),
    })),
    offers: rows(offers).map((r) => ({
      application_id: String(r["application_id"]),
      status: String(r["status"]),
      presented_at: str(r["presented_at"]),
      expires_at: str(r["expires_at"]),
      accepted_at: str(r["accepted_at"]),
    })),
    events: rows(events).map((r) => ({
      application_id: str(r["application_id"]),
      kind: String(r["kind"]),
      actor_user_id: str(r["actor_user_id"]),
      occurred_at: String(r["occurred_at"]),
    })),
    signed,
    invites: rows(invites).map((r) => ({
      id: String(r["id"]),
      rep_slug: String(r["rep_slug"]),
      business_name: str(r["business_name"]),
      sent_at: str(r["sent_at"]),
      opened_at: str(r["opened_at"]),
      cancelled_at: str(r["cancelled_at"]),
      expires_at: String(r["expires_at"]),
      application_id: str(r["application_id"]),
    })),
  };
}

const view = (i: TodayItem, written?: string) => ({
  id: i.id,
  kind: i.kind,
  business: i.business,
  stage: i.stage,
  rep_slug: i.rep_slug,
  signal: i.signal,
  label: SIGNAL_LABEL[i.signal],
  next: written ?? i.next,
  written: !!written,
});

/** This month's Claude spend across everything Lamp Brain writes (briefs and drafts). */
export async function monthSpend(): Promise<number> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const rows = await Promise.all(
    ["brain_briefs", "brain_drafts"].map((t) =>
      service()
        .from(t as never)
        .select("cost_usd")
        .gte("created_at", start),
    ),
  );
  return rows
    .flatMap((r) => (r.data ?? []) as { cost_usd: unknown }[])
    .reduce((s, x) => s + num(x.cost_usd), 0);
}

/** Token counts and dollars for one response, for the spend log. */
export function usageOf(u: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}) {
  const usage = {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_read_tokens: u.cache_read_input_tokens ?? 0,
    cache_write_tokens: u.cache_creation_input_tokens ?? 0,
  };
  const cost =
    (usage.input_tokens * PRICE.input +
      usage.output_tokens * PRICE.output +
      usage.cache_read_tokens * PRICE.cacheRead +
      usage.cache_write_tokens * PRICE.cacheWrite) /
    1_000_000;
  return { usage, cost };
}

/** One call to Claude for today's brief. Returns the checked brief and what it cost. */
async function write(
  items: TodayItem[],
  reader: "rep" | "admin",
  repName: (slug: string | null) => string | undefined,
) {
  const client = new Anthropic({
    apiKey: env("ANTHROPIC_API_KEY"),
    timeout: 60_000,
    maxRetries: 1,
  });
  const facts = factsFor(items, reader === "admin" ? repName : undefined);
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(BriefSchema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify({ reader, items: facts }) }],
  });
  const { usage, cost } = usageOf(res.usage);
  if (res.stop_reason === "refusal")
    return { brief: null, usage, cost, model: res.model, error: "The model declined." };
  if (res.stop_reason === "max_tokens")
    return { brief: null, usage, cost, model: res.model, error: "The answer ran too long." };
  const brief = checkBrief(res.parsed_output, new Set(items.map((i) => i.ref)));
  if (!brief)
    return {
      brief: null,
      usage,
      cost,
      model: res.model,
      error: "The answer didn't pass the checks.",
    };
  const byRef = new Map(items.map((i) => [i.ref, i]));
  const stored: Stored = {
    headline: brief.headline,
    items: brief.items.map((b) => {
      const i = byRef.get(b.ref)!;
      return { id: i.id, kind: i.kind, signal: i.signal, next: b.next };
    }),
  };
  return { brief: stored, usage, cost, model: res.model, error: null };
}

export const why = (e: unknown) => {
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic key was refused.";
  if (e instanceof Anthropic.RateLimitError) return "Anthropic is busy; try again later.";
  if (e instanceof Anthropic.APIError) return `Anthropic error ${e.status ?? ""}`.trim();
  return "Couldn't reach Anthropic.";
};

export async function brainBrief(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const me = await staff(who.userId);
  if (!me) return json(403, { error: "Today is for Lamp staff." });

  const now = new Date();
  const day = briefDay(now);
  const input = await readInput(who);
  const scope = { isAdmin: me.isAdmin, repSlug: me.repSlug };
  const svc = service();
  const briefs = () => svc.from("brain_briefs" as never);
  const today = async () => {
    const r = await briefs()
      .select("id,state,brief,error,updated_at")
      .eq("user_id", who.userId)
      .eq("day", day)
      .maybeSingle();
    return r.data as Row | null;
  };

  // one file, for the file view: the rules' step, or today's written one if the brief has it
  const fileId = new URL(request.url).searchParams.get("file");
  if (fileId !== null) {
    if (!UUID.test(fileId)) return json(400, { error: "Which file?" });
    const item = findToday(input, now, { isAdmin: true, repSlug: me.repSlug }, 5000).find(
      (i) => i.kind === "file" && i.id === fileId,
    );
    if (!item) return json(200, { next: null });
    const row = await today();
    return json(200, {
      next: view(item, row?.state === "ai" ? writtenFor(row.brief, item) : undefined),
    });
  }

  const items = findToday(input, now, scope);
  const rules = (reason: string | null, headline: string | null = null) =>
    json(200, {
      day,
      mode: "rules",
      reason,
      headline,
      items: items.map((i) => view(i)),
      ...(me.isAdmin ? { switch: on() ? "on" : "off" } : {}),
    });

  if (!on()) return rules("off");
  if (!items.length) return rules(null);

  let row = await today();
  if (row?.state === "ai" && row.brief) {
    const brief = row.brief;
    return json(200, {
      day,
      mode: "ai",
      reason: null,
      headline: brief.headline,
      items: items.map((i) => view(i, writtenFor(brief, i))),
      ...(me.isAdmin ? { switch: "on", spend: await monthSpend(), cap: cap() } : {}),
    });
  }
  const age = row ? now.getTime() - Date.parse(row.updated_at) : Infinity;
  if (row?.state === "pending" && age < PENDING_MS) return rules("busy");
  if (row?.state === "failed" && age < RETRY_FAILED_MS) return rules("failed", null);
  if ((await monthSpend()) >= cap()) return rules("cap");

  // take the day's slot: the unique (user, day) makes a second tab wait instead of paying twice
  if (!row) {
    const ins = await briefs()
      .insert({ user_id: who.userId, day, state: "pending" } as never)
      .select("id,state,brief,error,updated_at")
      .single();
    if (ins.error) return rules("busy");
    row = ins.data as Row;
  } else {
    const upd = await briefs()
      .update({ state: "pending", updated_at: now.toISOString() } as never)
      .eq("id", row.id)
      .eq("updated_at", row.updated_at)
      .select("id")
      .maybeSingle();
    if (!upd.data) return rules("busy");
  }

  const reps = await svc.from("reps").select("slug,name");
  const names = new Map(
    ((reps.data ?? []) as { slug: string; name: string }[]).map((r) => [r.slug, r.name]),
  );
  let out: Awaited<ReturnType<typeof write>>;
  try {
    out = await write(items, me.isAdmin ? "admin" : "rep", (s) => (s ? names.get(s) : undefined));
  } catch (e) {
    await briefs()
      .update({ state: "failed", error: why(e), updated_at: new Date().toISOString() } as never)
      .eq("id", row.id);
    return rules("failed");
  }
  await briefs()
    .update({
      state: out.brief ? "ai" : "failed",
      brief: out.brief,
      model: out.model,
      ...out.usage,
      cost_usd: Number(out.cost.toFixed(4)),
      error: out.error,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", row.id);
  if (!out.brief) return rules("failed");
  const brief = out.brief;
  return json(200, {
    day,
    mode: "ai",
    reason: null,
    headline: brief.headline,
    items: items.map((i) => view(i, writtenFor(brief, i))),
    ...(me.isAdmin ? { switch: "on", spend: await monthSpend(), cap: cap() } : {}),
  });
}
