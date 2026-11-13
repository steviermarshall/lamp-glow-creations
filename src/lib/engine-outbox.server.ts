// Server side of /api/engine/outbox and /api/engine/review (see engine-outbox.ts). Reads from the
// server environment:
//   ENGINE_PUSH_SECRET   the same shared secret the War Room engine sends for leads, replies and status
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (Lovable Cloud provides)
// The engine_outbox table is closed to everyone but this server (service role), like engine_status.
//
// The approval is here and nowhere else: decide() is the only code that turns a waiting email into
// an approved one, it runs only for a signed-in admin, and the engine sends only approved emails.
//
// Never import this file from browser code: the route files load it inside their handlers.
import { caller, env, json, service, SERVICE_KEY, SUPABASE_URL } from "@/lib/funder-send.server";
import { sameSecret } from "@/lib/funder-send";
import { staff } from "@/lib/brain.server";
import {
  DECISIONS,
  MAX_BODY,
  MAX_ITEMS,
  parseDecision,
  parseOffer,
  parseResults,
  type Item,
  type Rejected,
  type Status,
} from "@/lib/engine-outbox";

const TABLE = "engine_outbox" as never;
const COLUMNS =
  "id,engine_id,batch_date,sender_email,sender_name,to_email,business,stage,list,subject,body,body_hash,status,decided_name,decided_at,sent_at,error";
const OPEN: Status[] = ["pending", "approved", "failed"];

function engineAllowed(request: Request): Response | null {
  if (!env("ENGINE_PUSH_SECRET")) return json(503, { error: "Engine push is not set up." });
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  if (!sameSecret(request.headers.get("x-engine-push-secret") ?? "", env("ENGINE_PUSH_SECRET")))
    return json(401, { error: "Not allowed." });
  return null;
}

/**
 * POST /api/engine/outbox from the engine, with the shared secret:
 *   { offer: [...] }    emails to show for approval. A new one starts waiting. One still waiting is
 *                       replaced by the newer words. One already decided is left exactly as it is.
 *   { results: [...] }  what happened to emails: sent or failed (only an approved email can be
 *                       either), or withdrawn (the engine took it back before it was sent).
 * Both may come in one call. The answer names every email by the engine's id.
 */
export async function engineOutboxPost(request: Request): Promise<Response> {
  const no = engineAllowed(request);
  if (no) return no;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_ITEMS * (MAX_BODY + 2000))
    return json(413, { error: "Too much in one call." });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Send JSON." });
  }
  const offered = parseOffer(body);
  const reported = parseResults(body);
  const rejected: Rejected[] = [...offered.rejected, ...reported.rejected];
  if (!offered.offers.length && !reported.results.length && !rejected.length)
    return json(400, { error: "Send { offer: [...] } or { results: [...] }." });
  const svc = service();
  const out = { offered: [] as string[], kept: [] as string[], recorded: [] as string[], rejected };

  if (offered.offers.length) {
    const ids = offered.offers.map((o) => o.engine_id);
    const have = await svc.from(TABLE).select("engine_id,status").in("engine_id", ids);
    if (have.error) return json(500, { error: have.error.message, ...out });
    const decided = new Set(
      ((have.data ?? []) as unknown as { engine_id: string; status: Status }[])
        .filter((r) => r.status !== "pending")
        .map((r) => r.engine_id),
    );
    const fresh = offered.offers.filter((o) => !decided.has(o.engine_id));
    out.kept = offered.offers.filter((o) => decided.has(o.engine_id)).map((o) => o.engine_id);
    if (fresh.length) {
      // status is left out on purpose: a new row starts 'pending' by the table's default, and a row
      // that is already there keeps the status it has
      const up = await svc.from(TABLE).upsert(fresh as never, { onConflict: "engine_id" });
      if (up.error) return json(500, { error: up.error.message, ...out });
      out.offered = fresh.map((o) => o.engine_id);
    }
  }

  for (const r of reported.results) {
    const from: Status[] =
      r.status === "withdrawn" ? ["pending", "approved", "failed", "skipped"] : ["approved"];
    const patch =
      r.status === "sent"
        ? { status: "sent", sent_at: r.at, error: "" }
        : { status: r.status, error: r.error };
    const up = await svc
      .from(TABLE)
      .update(patch as never)
      .eq("engine_id", r.engine_id)
      .in("status", from)
      .select("engine_id");
    if (up.error) {
      rejected.push({ id: r.engine_id, problem: up.error.message.slice(0, 200) });
      continue;
    }
    if ((up.data ?? []).length) {
      out.recorded.push(r.engine_id);
      continue;
    }
    const now = await svc.from(TABLE).select("status").eq("engine_id", r.engine_id).maybeSingle();
    const status = (now.data as unknown as { status: Status } | null)?.status;
    if (status === r.status) out.recorded.push(r.engine_id);
    else
      rejected.push({
        id: r.engine_id,
        problem: status
          ? `This email is ${status}, so it cannot be marked ${r.status}.`
          : "The portal has no email with this id.",
      });
  }
  return json(200, out);
}

/**
 * GET /api/engine/outbox for the engine, with the shared secret: the emails an admin approved and
 * that are not sent yet (with the fingerprint of the words that were approved), the ones an admin
 * left out in the last week, and every email still open. Changes nothing.
 */
export async function engineOutboxGet(request: Request): Promise<Response> {
  const no = engineAllowed(request);
  if (no) return no;
  const svc = service();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [open, skipped] = await Promise.all([
    svc.from(TABLE).select("engine_id,status,body_hash").in("status", OPEN).limit(2000),
    svc
      .from(TABLE)
      .select("engine_id")
      .eq("status", "skipped")
      .gte("updated_at", weekAgo)
      .limit(2000),
  ]);
  if (open.error || skipped.error)
    return json(500, { error: (open.error ?? skipped.error)!.message });
  const rows = (open.data ?? []) as unknown as {
    engine_id: string;
    status: Status;
    body_hash: string;
  }[];
  return json(200, {
    approved: rows
      .filter((r) => r.status === "approved")
      .map((r) => ({ id: r.engine_id, hash: r.body_hash })),
    skipped: ((skipped.data ?? []) as unknown as { engine_id: string }[]).map((r) => r.engine_id),
    open: rows.map((r) => ({ id: r.engine_id, status: r.status })),
  });
}

async function admin(request: Request) {
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return { no: json(500, { error: "The server is missing its database settings." }) };
  const who = await caller(request);
  if (!who) return { no: json(401, { error: "Sign in first." }) };
  const me = await staff(who.userId);
  if (!me?.isAdmin) return { no: json(403, { error: "Approving emails is for Lamp's admins." }) };
  return { userId: who.userId, name: me.name ?? "An admin" };
}

async function reviewItems(): Promise<{ items: Item[] } | { error: string }> {
  const svc = service();
  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const [open, recent] = await Promise.all([
    svc.from(TABLE).select(COLUMNS).in("status", OPEN).limit(1000),
    svc
      .from(TABLE)
      .select(COLUMNS)
      .in("status", ["sent", "skipped"])
      .gte("updated_at", since)
      .limit(1000),
  ]);
  const err = open.error ?? recent.error;
  // before the table exists (the SQL file not run yet) the card simply has nothing waiting
  if (err && (err.code === "42P01" || err.code === "PGRST205")) return { items: [] };
  if (err) return { error: err.message };
  const items = [...(open.data ?? []), ...(recent.data ?? [])] as unknown as Item[];
  items.sort(
    (a, b) =>
      a.sender_email.localeCompare(b.sender_email) ||
      a.stage - b.stage ||
      a.business.localeCompare(b.business) ||
      a.engine_id.localeCompare(b.engine_id),
  );
  return { items };
}

/** GET /api/engine/review (admins only, signed in): the emails waiting, going out, and settled lately. */
export async function reviewGet(request: Request): Promise<Response> {
  const a = await admin(request);
  if ("no" in a) return a.no;
  const r = await reviewItems();
  if ("error" in r) return json(500, { error: r.error });
  return json(200, r);
}

/**
 * POST /api/engine/review { action, ids } (admins only, signed in). send approves waiting emails;
 * skip leaves waiting ones out; restore puts a left-out one back; retry approves a failed one again.
 * Each applies only to emails still in the state it starts from, so two admins pressing at once
 * approve each email once, and the second is told how many were already handled.
 */
export async function reviewPost(request: Request): Promise<Response> {
  const a = await admin(request);
  if ("no" in a) return a.no;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Send JSON." });
  }
  const d = parseDecision(body);
  if ("problem" in d) return json(400, { error: d.problem });
  const rule = DECISIONS[d.action];
  const patch: Record<string, unknown> = { status: rule.to };
  if (d.action === "restore")
    Object.assign(patch, { decided_by: null, decided_name: "", decided_at: null });
  else
    Object.assign(patch, {
      decided_by: a.userId,
      decided_name: a.name.slice(0, 120),
      decided_at: new Date().toISOString(),
      error: "",
    });
  const up = await service()
    .from(TABLE)
    .update(patch as never)
    .in("id", d.ids)
    .in("status", [...rule.from])
    .select("id");
  if (up.error) return json(500, { error: up.error.message });
  const r = await reviewItems();
  if ("error" in r) return json(500, { error: r.error });
  return json(200, { changed: (up.data ?? []).length, asked: d.ids.length, items: r.items });
}
