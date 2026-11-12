// Server side of /api/engine/outcomes (see engine-outcomes.ts). Reads from the server environment:
//   ENGINE_PUSH_SECRET   the same shared secret the War Room engine sends for the lead push
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (Lovable Cloud provides)
// Read only: it changes nothing in the database.
//
// Never import this file from browser code: the route file loads it inside its handlers.
import { env, json, SERVICE_KEY, service, SUPABASE_URL } from "@/lib/funder-send.server";
import {
  changedSince,
  gate,
  INVITE_COLUMNS,
  type InviteRow,
  LEAD_COLUMNS,
  type LeadRow,
  MAX_ROWS,
  outcome,
} from "@/lib/engine-outcomes";

/** The database hands back at most this many rows per request, so longer reads go page by page. */
const PAGE = 1000;
/** Ids per `in (...)` filter, so the request URL stays short. */
const IDS = 200;

type Db = ReturnType<typeof service>;

/** Engine leads changed since `since`, oldest id first, at most MAX_ROWS + 1 (the extra one says "there's more"). */
async function changedLeads(db: Db, since: Date): Promise<LeadRow[]> {
  const out: LeadRow[] = [];
  for (let from = 0; out.length <= MAX_ROWS; from += PAGE) {
    const r = await db
      .from("engine_leads")
      .select(LEAD_COLUMNS)
      .or(changedSince(since))
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (r.error) throw new Error(r.error.message);
    const rows = (r.data ?? []) as unknown as LeadRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out.slice(0, MAX_ROWS + 1);
}

/** Leads whose application link was sent or signed since `since`, even if the lead row itself didn't change. */
async function leadIdsWithNewLinks(db: Db, since: Date): Promise<number[]> {
  const r = await db
    .from("application_invites")
    .select("engine_lead_id")
    .not("engine_lead_id", "is", null)
    .gte("updated_at", since.toISOString())
    .limit(MAX_ROWS);
  if (r.error) throw new Error(r.error.message);
  return ((r.data ?? []) as { engine_lead_id: number | null }[])
    .map((x) => x.engine_lead_id)
    .filter((x): x is number => typeof x === "number");
}

async function leadsById(db: Db, ids: number[]): Promise<LeadRow[]> {
  const out: LeadRow[] = [];
  for (let i = 0; i < ids.length; i += IDS) {
    const r = await db
      .from("engine_leads")
      .select(LEAD_COLUMNS)
      .in("id", ids.slice(i, i + IDS));
    if (r.error) throw new Error(r.error.message);
    out.push(...((r.data ?? []) as unknown as LeadRow[]));
  }
  return out;
}

async function invitesFor(db: Db, ids: number[]): Promise<InviteRow[]> {
  const out: InviteRow[] = [];
  for (let i = 0; i < ids.length; i += IDS) {
    const r = await db
      .from("application_invites")
      .select(INVITE_COLUMNS)
      .in("engine_lead_id", ids.slice(i, i + IDS));
    if (r.error) throw new Error(r.error.message);
    out.push(...((r.data ?? []) as unknown as InviteRow[]));
  }
  return out;
}

/**
 * GET /api/engine/outcomes?since=ISO (shared secret, like the push). For every engine lead pushed,
 * worked or sent a link since then (default 8 days, at most MAX_ROWS): the engine's key, the status,
 * the rep's slug, touch times, and the file it became. See engine-outcomes.ts for each field.
 */
export async function readOutcomes(request: Request): Promise<Response> {
  const now = new Date();
  const g = gate(request, env("ENGINE_PUSH_SECRET"), !!(SUPABASE_URL() && SERVICE_KEY()), now);
  if ("error" in g) return json(g.status, { error: g.error });
  const { since } = g;
  try {
    const db = service();
    const changed = await changedLeads(db, since);
    const truncated = changed.length > MAX_ROWS;
    const leads = changed.slice(0, MAX_ROWS);
    if (!truncated) {
      const have = new Set(leads.map((l) => l.id));
      const extra = [...new Set(await leadIdsWithNewLinks(db, since))].filter(
        (id) => !have.has(id),
      );
      leads.push(...(await leadsById(db, extra)).slice(0, MAX_ROWS - leads.length));
    }
    const invites = await invitesFor(
      db,
      leads.map((l) => l.id),
    );
    return json(200, {
      since: since.toISOString(),
      until: now.toISOString(),
      count: leads.length,
      truncated,
      outcomes: leads.map((l) => outcome(l, invites)),
    });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
}
