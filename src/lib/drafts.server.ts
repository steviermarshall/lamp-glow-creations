// Follow-up drafts (Lamp Brain, slice 2): POST /api/brain/draft (migration
// 20261030150000_brain_drafts.sql). Never import this from browser code: the route file loads it
// inside its handler.
//
//   { kind, id }                       a text, an email and call notes for one Today item
//   { kind, id, docs_link }            the same, with a documents link the rep just made
//   { kind: "file", id, sent: channel } log on the file's timeline that the rep sent it or called
//
// Nothing is ever sent from here: the rep copies the draft or opens it in their own Messages or
// mail app. The item is read as the caller, so they only get drafts for files and links they can
// see. When Claude is on (see brain.server.ts) it rewrites Lamp's wording from the allowlisted
// facts, with placeholders where names go; Lamp fills the names in here, after the call.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { caller, env, json, SERVICE_KEY, service, SUPABASE_URL } from "@/lib/funder-send.server";
import { readJson } from "@/lib/application-links.server";
import { briefDay, findToday, safeName, SIGNAL_LABEL, type TodayItem } from "@/lib/brain";
import {
  cap,
  MODEL,
  monthSpend,
  on,
  readInput,
  signedAt,
  staff,
  usageOf,
  why,
} from "@/lib/brain.server";
import {
  canText,
  checkDraft,
  type Draft,
  dialable,
  fillDraft,
  ruleDraft,
  WANTS_DOCS_LINK,
} from "@/lib/drafts";
import { SITE } from "@/lib/site";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAILY_DRAFTS = 40; // Claude-written drafts per person per day; Lamp's own wording after that
const SENT_KIND = { text: "sms", email: "email", call: "call" } as const;
type Channel = keyof typeof SENT_KIND;

// Stable on purpose: no dates or names in here, so it can be cached across calls.
const SYSTEM = `You write follow-up messages for a rep at Lamp, a business-funding brokerage. Lamp's reps help small businesses get revenue-based funding (merchant cash advances) from funders: the merchant applies and signs, sends bank statements, Lamp sends the package to funders, funders make offers, the merchant accepts one, and it closes and funds.

You get JSON: the situation ("signal"), the business name, some numbers, whether a documents link goes in ("docs_link"), and Lamp's standard wording for this situation ("standard"). Improve on the standard wording so it reads like a helpful person wrote it for this business, keeping its purpose.

Signals: offer_expiring (an offer runs out in "hours" hours), active_now (the merchant is on their application right now), docs_in ("docs" documents just came in), package_ready (signed and complete; going to funders), reached_signing (just signed; statements still needed), stalled_offer (offers out "days" days, no answer), link_unopened (the application link went out "days" days ago, never opened), stale (nothing for "days" days).

Write:
- text: a text message from the rep, under 250 characters, starting with a greeting to {first_name} and saying it's {rep_name} at Lamp.
- email_subject: under 70 characters.
- email_body: 2 to 4 short sentences to {first_name}, ending with a sign-off from {rep_name} at Lamp.
- call: 2 to 4 short notes for the rep's phone call about this situation (what to say first, what to ask). These are for the rep, not the merchant.

Placeholders, written exactly like this: {first_name} for the merchant's first name, {rep_name} for the rep. {docs_link} only when docs_link is true, where the link should go. No other placeholders, links, phone numbers or emails.

Rules: never write "loan", "lending" or "lender": it's funding or an advance. Never promise or suggest approval, a guarantee or a yes. No rates, percentages, interest or credit-score claims. Don't invent amounts, dates, deadlines, funder names or anything not in the facts. Don't add an opt-out line; Lamp adds one. Plain, warm, short; no exclamation marks, no emojis.`;

const DraftSchema = z.object({
  text: z.string(),
  email_subject: z.string(),
  email_body: z.string(),
  call: z.array(z.string()),
});

type Body = {
  kind?: string;
  id?: string;
  docs_link?: string;
  sent?: string;
};

type Who = {
  first_name: string | null;
  email: string | null;
  phone: string | null;
  canText: boolean;
};

/** The merchant's contact details for the item, read as the caller. Never sent to Claude. */
async function contact(
  db: NonNullable<Awaited<ReturnType<typeof caller>>>["client"],
  item: TodayItem,
): Promise<Who> {
  if (item.kind === "link") {
    const r = await db
      .from("application_invites")
      .select("first_name,email,phone")
      .eq("id", item.id)
      .maybeSingle();
    const i = r.data as {
      first_name: string | null;
      email: string | null;
      phone: string | null;
    } | null;
    // a link the rep sent has no consent to text on record: email and calls only
    return {
      first_name: i?.first_name ?? null,
      email: i?.email ?? null,
      phone: i?.phone ?? null,
      canText: false,
    };
  }
  const [a, d] = await Promise.all([
    db
      .from("applications")
      .select("first_name,email,phone,phone_consent_at")
      .eq("id", item.id)
      .maybeSingle(),
    // the caller already sees this file (it's on their Today); only the signing time is read
    signedAt([item.id]),
  ]);
  const f = a.data as {
    first_name: string | null;
    email: string | null;
    phone: string | null;
    phone_consent_at: string | null;
  } | null;
  const signed = d[0]?.signed_at ?? null;
  return {
    first_name: f?.first_name ?? null,
    email: f?.email ?? null,
    phone: f?.phone ?? null,
    canText: canText({
      phone: f?.phone ?? null,
      phone_consent_at: f?.phone_consent_at ?? null,
      signed_at: signed,
    }),
  };
}

const okLink = (u: string | undefined) =>
  !!u && u.startsWith(`${SITE.url.replace(/\/$/, "")}/upload/`) && u.length < 200 && !/\s/.test(u);

export async function brainDraft(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const me = await staff(who.userId);
  if (!me) return json(403, { error: "Drafts are for Lamp staff." });
  const body = await readJson<Body>(request, 4 * 1024);
  if (body instanceof Response) return body;
  const kind = body.kind === "link" ? "link" : body.kind === "file" ? "file" : null;
  if (!kind || !UUID.test(body.id ?? "")) return json(400, { error: "Which file?" });

  const now = new Date();
  const item = findToday(
    await readInput(who),
    now,
    { isAdmin: true, repSlug: me.repSlug },
    5000,
  ).find((i) => i.kind === kind && i.id === body.id);

  // the rep sent it (or called): a line on the file's timeline, which also tells the rules
  if (body.sent !== undefined) {
    const channel = body.sent as Channel;
    if (!(channel in SENT_KIND)) return json(400, { error: "Sent how?" });
    if (kind !== "file") return json(400, { error: "Only files have a timeline." });
    const label = item ? SIGNAL_LABEL[item.signal].toLowerCase() : "follow-up";
    const ins = await who.client.from("events").insert({
      application_id: body.id,
      actor_user_id: who.userId,
      kind: SENT_KIND[channel],
      body:
        channel === "call"
          ? `Called about: ${label} (from Today).`
          : `Sent a follow-up ${channel} about: ${label} (drafted in Today).`,
      visible_to_merchant: false,
    } as never);
    if (ins.error) return json(403, { error: "Couldn't log it on this file." });
    return json(200, { ok: true });
  }

  if (!item) return json(404, { error: "Nothing to follow up on for this one today." });
  const docs = WANTS_DOCS_LINK.includes(item.signal) && okLink(body.docs_link);
  const facts = {
    signal: item.signal,
    business: safeName(item.business),
    stage: item.stage,
    ...(item.facts.days !== undefined ? { days: item.facts.days } : {}),
    ...(item.facts.hours !== undefined ? { hours: item.facts.hours } : {}),
    ...(item.facts.docs !== undefined ? { docs: item.facts.docs } : {}),
  };
  const rules = ruleDraft(item.signal, { ...facts, docsLink: docs });
  const person = await contact(who.client, item);

  let draft: Draft = rules;
  let written: string[] = [];
  let reason: string | null = on() ? null : "off";
  if (on()) {
    const svc = service();
    const drafts = () => svc.from("brain_drafts" as never);
    const day = briefDay(now);
    const key = { user_id: who.userId, kind, item_id: item.id, signal: item.signal, day, docs };
    const seen = await drafts().select("draft,written").match(key).maybeSingle();
    const hit = seen.data as { draft: Draft | null; written: string[] | null } | null;
    if (hit?.draft) {
      draft = hit.draft;
      written = hit.written ?? [];
    } else {
      const made = await drafts()
        .select("id", { count: "exact", head: true })
        .eq("user_id", who.userId)
        .eq("day", day);
      if ((made.count ?? 0) >= DAILY_DRAFTS) reason = "limit";
      else if ((await monthSpend()) >= cap()) reason = "cap";
      else {
        try {
          const client = new Anthropic({
            apiKey: env("ANTHROPIC_API_KEY"),
            timeout: 45_000,
            maxRetries: 1,
          });
          const res = await client.beta.messages.parse({
            model: MODEL,
            max_tokens: 8000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: "low", format: betaZodOutputFormat(DraftSchema) },
            system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
            messages: [
              {
                role: "user",
                content: JSON.stringify({ ...facts, docs_link: docs, standard: rules }),
              },
            ],
          });
          const { usage, cost } = usageOf(res.usage);
          const ok = res.stop_reason !== "refusal" && res.stop_reason !== "max_tokens";
          const checked = ok
            ? checkDraft(res.parsed_output, rules, docs)
            : { draft: rules, written: [] };
          draft = checked.draft;
          written = checked.written;
          if (!ok) reason = "failed";
          await drafts().insert({
            ...key,
            draft,
            written,
            model: res.model,
            ...usage,
            cost_usd: Number(cost.toFixed(4)),
            error: ok ? null : `stop: ${res.stop_reason}`,
          } as never);
        } catch (e) {
          reason = "failed";
          console.error("brain draft:", why(e));
        }
      }
    }
  }

  const filled = fillDraft(draft, {
    first_name: person.first_name,
    rep_name: me.name ?? "your rep",
    docs_link: docs ? (body.docs_link ?? null) : null,
  });
  return json(200, {
    signal: item.signal,
    label: SIGNAL_LABEL[item.signal],
    business: item.business,
    draft: filled,
    written,
    reason,
    wants_docs_link: kind === "file" && WANTS_DOCS_LINK.includes(item.signal) && !docs,
    to: {
      first_name: person.first_name,
      email: person.email,
      phone: dialable(person.phone),
      text: person.canText && !!dialable(person.phone),
    },
  });
}
