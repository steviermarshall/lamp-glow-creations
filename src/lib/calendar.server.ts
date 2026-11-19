// Calendar, server side: GET /api/calendar (migration 20261115120000_calendar.sql, docs/calendar.md).
// Never import this from browser code: the route file loads it inside its handler.
//
// Each call runs the rules (calendar.ts) for the caller and brings calendar_items in line: a rep's
// call covers the records that are theirs, an admin's covers everyone's. Lamp's server reads the
// records and writes the items with its own key; the items are then read back as the caller, so the
// table's row rules decide what comes back (a person their own, an admin everyone's).

import { caller, json, service, SERVICE_KEY, SUPABASE_URL } from "@/lib/funder-send.server";
import { staff } from "@/lib/brain.server";
import {
  type CalInput,
  type Existing,
  type Rule,
  CALLBACK_WINDOW_DAYS,
  OUTBOX_WINDOW_DAYS,
  nyDay,
  planCalendar,
  reconcile,
  shiftDay,
} from "@/lib/calendar";

const TABLE = "calendar_items" as never;
const ITEM_COLUMNS =
  "id,owner,rule,title,why,link,rep_slug,due_at,all_day,scheduled_at,status,done_at,cleared_at";
const OPEN_FILE = [
  "new",
  "reviewing",
  "docs_needed",
  "submitted",
  "offers_ready",
  "accepted",
  "closing",
];
const SYNC_EVERY_MS = 60_000;
const lastSync = new Map<string, number>();

type Row = Record<string, unknown>;
type Db = ReturnType<typeof service>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /calendar_items/.test(e.message ?? ""));

async function inChunks(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ rows: Row[]; ok: boolean }> {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const r = await run(ids.slice(i, i + 200));
    if (r.error) return { rows, ok: false };
    rows.push(...((r.data ?? []) as Row[]));
  }
  return { rows, ok: true };
}

const funderName = (r: Row) => {
  const f = r["funder"] as { name?: unknown } | null | undefined;
  return f && typeof f.name === "string" ? f.name : null;
};

/** Everything the rules read, for one rep (repSlug) or for everyone (admin). */
export async function loadInput(
  db: Db,
  who: { isAdmin: boolean; repSlug: string | null },
  now: Date,
): Promise<CalInput> {
  const loaded = new Set<Rule>();
  const rep = who.isAdmin ? null : who.repSlug;
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - CALLBACK_WINDOW_DAYS * 86_400_000).toISOString();

  // a rep reads only their own records; an admin reads everyone's
  let callsQ = db
    .from("file_notes")
    .select("id,application_id,lead_id,assigned_to,due_on,body,author_name,created_at")
    .eq("status", "open")
    .not("assigned_to", "is", null);
  let workedQ = db
    .from("engine_leads")
    .select("id,source,name,status,rep_slug,worked_at,pushed_at,signals")
    .in("status", ["callback", "no_answer"])
    .gte("worked_at", since);
  let repliesQ = db
    .from("engine_leads")
    .select("id,source,name,status,rep_slug,worked_at,pushed_at,signals")
    .eq("source", "email-reply")
    .eq("status", "new");
  let invitesQ = db
    .from("application_invites")
    .select(
      "id,rep_slug,business_name,first_name,last_name,sent_at,opened_at,started_at,draft_saved_at,submitted_at,cancelled_at,expires_at,application_id",
    )
    .is("cancelled_at", null)
    .is("application_id", null)
    .is("submitted_at", null)
    .gt("expires_at", nowIso);
  let filesQ = db
    .from("applications")
    .select("id,status,rep_slug,business_name,first_name")
    .in("status", OPEN_FILE);
  if (rep) {
    callsQ = callsQ.eq("assigned_to", rep);
    workedQ = workedQ.eq("rep_slug", rep);
    repliesQ = repliesQ.eq("rep_slug", rep);
    invitesQ = invitesQ.eq("rep_slug", rep);
    filesQ = filesQ.eq("rep_slug", rep);
  }
  const [seats, admins, calls, worked, replies, invites, files] = await Promise.all([
    db.from("reps").select("slug,user_id,active"),
    db.from("user_roles").select("user_id").eq("role", "admin"),
    callsQ,
    workedQ,
    repliesQ,
    invitesQ,
    filesQ,
  ]);

  const fileRows = (files.data ?? []) as Row[];
  const callRows = (calls.data ?? []) as Row[];
  // a call can point at a file this run hasn't read (a closed one): read it so the rule can skip it
  const known = new Set(fileRows.map((f) => String(f["id"])));
  const extra = [
    ...new Set(
      callRows
        .map((c) => str(c["application_id"]))
        .filter((x): x is string => !!x && !known.has(x)),
    ),
  ];
  const more = await inChunks(extra, (ids) =>
    db.from("applications").select("id,status,rep_slug,business_name,first_name").in("id", ids),
  );
  const allFiles = [...fileRows, ...more.rows];
  const openIds = fileRows.map((f) => String(f["id"]));
  const leadIds = [
    ...new Set(
      callRows
        .filter((c) => !c["application_id"])
        .map((c) => str(c["lead_id"]))
        .filter((x): x is string => !!x),
    ),
  ];

  const [offers, subs, reqs, leads, outbox] = await Promise.all([
    inChunks(openIds, (ids) =>
      db
        .from("offers")
        .select("id,application_id,status,presented_at,expires_at,funder:funders(name)")
        .eq("status", "presented")
        .in("application_id", ids),
    ),
    inChunks(openIds, (ids) =>
      db
        .from("submissions")
        .select(
          "id,application_id,status,submitted_at,decided_at,submitted_by,funder:funders(name)",
        )
        .eq("status", "submitted")
        .is("decided_at", null)
        .in("application_id", ids),
    ),
    inChunks(openIds, (ids) =>
      db
        .from("document_requests")
        .select("id,application_id,title,created_at,expires_at,closed_at")
        .is("closed_at", null)
        .gt("expires_at", nowIso)
        .in("application_id", ids),
    ),
    inChunks(leadIds, (ids) =>
      db.from("leads").select("id,first_name,answers,rep_slug").in("id", ids),
    ),
    who.isAdmin
      ? db
          .from("engine_outbox" as never)
          .select("batch_date")
          .eq("status", "pending")
          .gte("batch_date", shiftDay(nyDay(now.getTime()), -OUTBOX_WINDOW_DAYS))
      : Promise.resolve({ data: [], error: { message: "not an admin" } }),
  ]);
  const reqIds = reqs.rows.map((r) => String(r["id"]));
  const docs = await inChunks(reqIds, (ids) =>
    db.from("documents").select("request_id").in("request_id", ids),
  );
  const received = new Map<string, number>();
  for (const d of docs.rows) {
    const k = str(d["request_id"]);
    if (k) received.set(k, (received.get(k) ?? 0) + 1);
  }
  const pending = new Map<string, number>();
  for (const r of ((outbox as { data: unknown }).data ?? []) as Row[]) {
    const k = String(r["batch_date"]);
    pending.set(k, (pending.get(k) ?? 0) + 1);
  }

  const filesOk = !files.error && more.ok;
  if (!calls.error && filesOk && leads.ok) loaded.add("assigned_call");
  if (!worked.error) {
    loaded.add("lead_callback");
    loaded.add("lead_no_answer");
  }
  if (!replies.error) loaded.add("email_reply");
  if (!invites.error) {
    loaded.add("link_unopened");
    loaded.add("link_unstarted");
    loaded.add("link_unfinished");
  }
  if (filesOk && offers.ok) loaded.add("offer_waiting");
  if (filesOk && subs.ok) loaded.add("funder_silent");
  if (filesOk && reqs.ok && docs.ok) loaded.add("docs_missing");
  if (who.isAdmin && !(outbox as { error: unknown }).error) loaded.add("emails_to_approve");

  return {
    seats: ((seats.data ?? []) as Row[]).map((r) => ({
      slug: String(r["slug"]),
      user_id: str(r["user_id"]),
      active: r["active"] !== false,
    })),
    admins: ((admins.data ?? []) as Row[]).map((r) => String(r["user_id"])),
    files: allFiles.map((r) => ({
      id: String(r["id"]),
      status: String(r["status"]),
      rep_slug: str(r["rep_slug"]),
      business_name: str(r["business_name"]),
      first_name: str(r["first_name"]),
    })),
    calls: callRows.map((r) => ({
      id: String(r["id"]),
      application_id: str(r["application_id"]),
      lead_id: str(r["lead_id"]),
      assigned_to: String(r["assigned_to"]),
      due_on: str(r["due_on"]),
      body: String(r["body"] ?? ""),
      author_name: str(r["author_name"]),
      created_at: String(r["created_at"]),
    })),
    leads: leads.rows.map((r) => {
      const last = (r["answers"] as { lastName?: unknown } | null)?.lastName;
      const name = [str(r["first_name"]), typeof last === "string" ? last : null]
        .filter(Boolean)
        .join(" ")
        .trim();
      return { id: String(r["id"]), name: name || null, rep_slug: str(r["rep_slug"]) };
    }),
    engineLeads: [...((worked.data ?? []) as Row[]), ...((replies.data ?? []) as Row[])].map(
      (r) => ({
        id: Number(r["id"]),
        source: String(r["source"]),
        name: str(r["name"]),
        status: String(r["status"]),
        rep_slug: str(r["rep_slug"]),
        worked_at: str(r["worked_at"]),
        pushed_at: str(r["pushed_at"]),
        signals: r["signals"],
      }),
    ),
    invites: ((invites.data ?? []) as Row[]).map((r) => ({
      id: String(r["id"]),
      rep_slug: String(r["rep_slug"]),
      business_name: str(r["business_name"]),
      first_name: str(r["first_name"]),
      last_name: str(r["last_name"]),
      sent_at: str(r["sent_at"]),
      opened_at: str(r["opened_at"]),
      started_at: str(r["started_at"]),
      draft_saved_at: str(r["draft_saved_at"]),
      submitted_at: str(r["submitted_at"]),
      cancelled_at: str(r["cancelled_at"]),
      expires_at: String(r["expires_at"]),
      application_id: str(r["application_id"]),
    })),
    offers: offers.rows.map((r) => ({
      id: String(r["id"]),
      application_id: String(r["application_id"]),
      status: String(r["status"]),
      presented_at: str(r["presented_at"]),
      expires_at: str(r["expires_at"]),
      funder: funderName(r),
    })),
    submissions: subs.rows.map((r) => ({
      id: String(r["id"]),
      application_id: String(r["application_id"]),
      status: String(r["status"]),
      submitted_at: String(r["submitted_at"]),
      decided_at: str(r["decided_at"]),
      submitted_by: str(r["submitted_by"]),
      funder: funderName(r),
    })),
    docRequests: reqs.rows.map((r) => ({
      id: String(r["id"]),
      application_id: String(r["application_id"]),
      title: String(r["title"] ?? "Documents"),
      created_at: String(r["created_at"]),
      expires_at: String(r["expires_at"]),
      closed_at: str(r["closed_at"]),
      received: received.get(String(r["id"])) ?? 0,
    })),
    outbox: [...pending].map(([batch_date, n]) => ({ batch_date, pending: n })),
    loaded: [...loaded],
  };
}

/** Run the rules for this caller and write what changed. Returns how many items were added, changed, cleared. */
export async function syncFor(
  who: { userId: string; isAdmin: boolean; repSlug: string | null },
  now = new Date(),
) {
  // a rep role with no rep seat owns no records: nothing to schedule
  if (!who.isAdmin && !who.repSlug) return { added: 0, changed: 0, cleared: 0 };
  const db = service();
  const input = await loadInput(db, who, now);
  const desired = planCalendar(input, now);
  const keys = desired.map((d) => d.source_key);
  const cols = "id,source_key,rule,owner,status,title,why,link,rep_slug";
  const openQ = db.from(TABLE).select(cols).eq("status", "open");
  const [open, keyed] = await Promise.all([
    who.isAdmin ? openQ : openQ.eq("owner", who.userId),
    inChunks(keys, (ids) => db.from(TABLE).select(cols).in("source_key", ids)),
  ]);
  if (open.error) throw open.error;
  if (!keyed.ok) throw new Error("Couldn't read the calendar.");
  const existing = new Map<string, Existing>();
  for (const r of [...((open.data ?? []) as Row[]), ...keyed.rows])
    existing.set(String(r["source_key"]), r as unknown as Existing);
  const plan = reconcile(
    [...existing.values()],
    desired,
    { isAdmin: who.isAdmin, userId: who.userId },
    input.loaded,
    now,
  );
  if (plan.insert.length) {
    // two people opening the calendar at once may both add an item: the key keeps one
    const r = await db
      .from(TABLE)
      .upsert(plan.insert as never, { onConflict: "source_key", ignoreDuplicates: true });
    if (r.error) throw r.error;
  }
  for (const u of plan.update) {
    const r = await db
      .from(TABLE)
      .update(u.patch as never)
      .eq("id" as never, u.id as never);
    if (r.error) throw r.error;
  }
  return {
    added: plan.insert.length,
    changed: plan.update.filter((u) => u.patch["status"] !== "cleared").length,
    cleared: plan.update.filter((u) => u.patch["status"] === "cleared").length,
  };
}

/**
 * GET /api/calendar[?sync=1]
 * The caller's items: every open one and the done or cleared ones of the last 60 days. The rules
 * run first, at most once a minute per person unless ?sync=1. Admins also get the people to filter by.
 */
export async function calendarGet(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY())
    return json(500, { error: "The server is missing its database settings." });
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in again." });
  const me = await staff(who.userId);
  if (!me) return json(403, { error: "The calendar is for Lamp staff." });

  const probe = await who.client.from(TABLE).select("id").limit(1);
  if (probe.error) {
    if (missingTable(probe.error)) return json(200, { ready: false, items: [] });
    return json(500, { error: probe.error.message });
  }

  const force = new URL(request.url).searchParams.get("sync") === "1";
  const last = lastSync.get(who.userId) ?? 0;
  let sync: Awaited<ReturnType<typeof syncFor>> | null = null;
  let syncError: string | null = null;
  if (force || Date.now() - last > SYNC_EVERY_MS) {
    try {
      sync = await syncFor({ userId: who.userId, isAdmin: me.isAdmin, repSlug: me.repSlug });
      lastSync.set(who.userId, Date.now());
    } catch (e) {
      // the items already there still show; the page says the rules didn't run
      syncError = e instanceof Error ? e.message : "The rules didn't run.";
    }
  }

  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const items = await who.client
    .from(TABLE)
    .select(ITEM_COLUMNS)
    .or(`status.eq.open,updated_at.gte.${since}`)
    .order("due_at")
    .limit(2000);
  if (items.error) return json(500, { error: items.error.message });

  let people: { id: string; name: string }[] = [];
  if (me.isAdmin) {
    const db = service();
    const [reps, admins] = await Promise.all([
      db.from("reps").select("user_id,name").not("user_id", "is", null),
      db.from("user_roles").select("user_id").eq("role", "admin"),
    ]);
    const named = new Map<string, string>();
    for (const r of (reps.data ?? []) as Row[]) named.set(String(r["user_id"]), String(r["name"]));
    const missing = ((admins.data ?? []) as Row[])
      .map((r) => String(r["user_id"]))
      .filter((id) => !named.has(id));
    if (missing.length) {
      const profs = await db.from("profiles").select("id,full_name,email").in("id", missing);
      for (const p of (profs.data ?? []) as Row[])
        named.set(String(p["id"]), str(p["full_name"]) || str(p["email"]) || "Admin");
    }
    people = [...named]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return json(200, {
    ready: true,
    me: who.userId,
    isAdmin: me.isAdmin,
    items: items.data ?? [],
    people,
    sync,
    syncError,
  });
}
