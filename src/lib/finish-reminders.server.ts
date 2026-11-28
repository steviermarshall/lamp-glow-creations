// "Finish your application" reminders: the sending, and the two ways to stop them.
//
//   POST /api/application/remind      every 10 minutes from the database (finish_remind_tick()
//                                     through pg_cron, 20261120090100_finish_reminders_schedule.sql)
//                                     with the x-finish-remind-secret header. Sends what is due,
//                                     and first emails any signed file whose new-file email never
//                                     went (notice-retry.ts).
//   POST /api/application/reminders   { action: "unsubscribe", token } from the stop link in an
//                                     email, or { action: "stop", kind, id } from a rep or admin.
//
// Who: anyone who started in the last 3 days and hasn't signed, on a rep's public link or the
// website's application (a lead) or on a personal link a rep sent (an invite with started_at).
// When: finish-reminders.ts. From partners@ in the rep's name with the person they report to
// copied (the same as every application email), or as Lamp for the website. Never to Lamp's own
// team, to anyone marked do not contact, or to an email that has signed an application since.
// Nothing is sent until the Lamp mailbox is connected. Never import this from browser code.
import {
  caller,
  gmailAccessToken,
  json,
  SERVICE_KEY,
  service,
  SITE_URL,
  SUPABASE_URL,
} from "@/lib/funder-send.server";
import { applicationUrl, reminderEmail } from "@/lib/application-links";
import { SITE } from "@/lib/site";
import {
  ccFor,
  doNotContact,
  gmailSend,
  isLampAddress,
  noticeStore,
  repBySlug,
  replyToFor,
  sendNewApplicationNotice,
  staffEmails,
  type Rep,
} from "@/lib/application-links.server";
import { noticeSweep, reminderRun } from "@/lib/notice-retry";
import { ownRow } from "@/lib/team-lead";
import {
  inviteLeftAt,
  leadLeftAt,
  parseStopToken,
  reminderPlan,
  remindToken,
  sameText,
  sign,
  stopToken,
} from "@/lib/finish-reminders";
import { remindSecret } from "@/lib/remind-secret.server";

type Svc = ReturnType<typeof service>;

/** Started within this long ago; anyone older never gets a reminder. */
const WINDOW_MS = 3 * 86_400_000;
/** Emails per tick, so one run stays short (the rest go 10 minutes later). */
const PER_RUN = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEAD_COLS =
  "id,created_at,email,first_name,phone,rep_slug,answers,reminders_sent,reminded_at,reminders_stopped_at";
const INVITE_COLS =
  "id,rep_slug,email,phone,first_name,business_name,started_at,draft_saved_at,token_hash,reminders_sent,reminded_at,reminders_stopped_at";

type LeadRow = {
  id: string;
  created_at: string;
  email: string;
  first_name: string | null;
  phone: string | null;
  rep_slug: string | null;
  answers: Record<string, unknown> | null;
  reminders_sent: number;
  reminded_at: string | null;
  reminders_stopped_at: string | null;
};
type InviteRow = {
  id: string;
  rep_slug: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  business_name: string | null;
  started_at: string;
  draft_saved_at: string | null;
  token_hash: string;
  reminders_sent: number;
  reminded_at: string | null;
  reminders_stopped_at: string | null;
};

/** One person due a reminder now. */
type Due = {
  kind: "lead" | "invite";
  table: "leads" | "application_invites";
  id: string;
  n: 1 | 2;
  email: string;
  phone: string;
  firstName: string;
  business: string;
  repSlug: string | null;
  startedAt: string;
  lastAt: string | null;
  /** The application to send them back to (built once the secret is known). */
  link: (secret: string) => Promise<string>;
};

const date = (s: string | null) => (s ? new Date(s) : null);

/** Who is due a reminder at `now`, from the rows the database gave back. */
function dueNow(leads: LeadRow[], invites: InviteRow[], now: Date, site: string): Due[] {
  const out: Due[] = [];
  for (const l of leads) {
    const plan = reminderPlan(
      {
        leftAt: leadLeftAt(l.created_at, l.answers),
        sent: l.reminders_sent,
        lastAt: date(l.reminded_at),
        stoppedAt: date(l.reminders_stopped_at),
      },
      now,
    );
    if (plan.kind !== "next" || !plan.due) continue;
    const a = l.answers ?? {};
    const pdf = (a["progress"] as { form?: unknown } | undefined)?.form === "pdf";
    const url = l.rep_slug
      ? applicationUrl(site, l.rep_slug) + (pdf ? "/pdf" : "")
      : `${site.replace(/\/$/, "")}/application`;
    out.push({
      kind: "lead",
      table: "leads",
      id: l.id,
      n: plan.n,
      email: l.email,
      phone: l.phone ?? "",
      firstName: l.first_name ?? "",
      business: typeof a["businessName"] === "string" ? a["businessName"] : "",
      repSlug: l.rep_slug,
      startedAt: l.created_at,
      lastAt: l.reminded_at,
      link: async () => url,
    });
  }
  for (const i of invites) {
    if (!i.email) continue;
    const plan = reminderPlan(
      {
        leftAt: inviteLeftAt(i.started_at, i.draft_saved_at),
        sent: i.reminders_sent,
        lastAt: date(i.reminded_at),
        stoppedAt: date(i.reminders_stopped_at),
      },
      now,
    );
    if (plan.kind !== "next" || !plan.due) continue;
    out.push({
      kind: "invite",
      table: "application_invites",
      id: i.id,
      n: plan.n,
      email: i.email,
      phone: i.phone ?? "",
      firstName: i.first_name ?? "",
      business: i.business_name ?? "",
      repSlug: i.rep_slug,
      startedAt: i.started_at,
      lastAt: i.reminded_at,
      link: async (secret) =>
        applicationUrl(site, i.rep_slug, await remindToken(secret, i.id, i.token_hash)),
    });
  }
  // a personal link first: when the same person has both, the rep's own link is the one to finish
  out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "invite" ? -1 : 1));
  return out;
}

/** Has this email signed an application since they started? */
async function signedSince(svc: Svc, email: string, since: string): Promise<boolean | null> {
  const r = await svc
    .from("applications")
    .select("id", { count: "exact", head: true })
    .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
    .gte("created_at", since);
  if (r.error) return null;
  return (r.count ?? 0) > 0;
}

export async function finishReminders(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY()) return json(500, { error: "No database settings." });
  const svc = service();
  const secret = await remindSecret(svc);
  if (!secret || !sameText(request.headers.get("x-finish-remind-secret") ?? "", secret))
    return json(401, { error: "Not the database." });

  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const [leads, invites] = await Promise.all([
    svc
      .from("leads")
      .select(LEAD_COLS)
      .eq("answers->>source", "application_link")
      .is("converted_application_id", null)
      .is("reminders_stopped_at", null)
      .lt("reminders_sent", 2)
      .gte("created_at", since)
      .limit(500),
    svc
      .from("application_invites")
      .select(INVITE_COLS)
      .not("started_at", "is", null)
      .is("submitted_at", null)
      .is("cancelled_at", null)
      .is("reminders_stopped_at", null)
      .lt("reminders_sent", 2)
      .gt("expires_at", now.toISOString())
      .gte("started_at", since)
      .limit(500),
  ]);
  // a failed read sends no reminders this time, but the new-file sweep below still runs
  const readFailed = !!(leads.error || invites.error);

  const site = SITE_URL();
  const due = readFailed
    ? []
    : dueNow(
        (leads.data ?? []) as unknown as LeadRow[],
        (invites.data ?? []) as unknown as InviteRow[],
        now,
        site,
      );

  // the mailbox first, then signed files whose new-file email never went (notice-retry.ts), then
  // the reminders: the sweep runs on every run with a mailbox, even when no reminder is due
  const run = await reminderRun({
    access: () => gmailAccessToken(svc),
    sweep: (access) =>
      noticeSweep(noticeStore(svc), now.getTime(), (appId) =>
        sendNewApplicationNotice(svc, appId, { access }).then((r) => r.outcome),
      ),
    due: due.length,
    remind: (access) => sendReminders(svc, due, access, secret, site, now),
  });
  if (readFailed)
    return json(503, {
      error: "Couldn't read who started.",
      ...(run.mailbox ? { notices: run.notices } : {}),
    });
  if (!run.mailbox) return json(200, { due: due.length, sent: 0, skipped: run.skipped });
  if (!run.reminders) return json(200, { due: 0, sent: 0, notices: run.notices });
  return json(200, { due: due.length, ...run.reminders, notices: run.notices });
}

/** Sends the reminders that are due, at most PER_RUN. */
async function sendReminders(
  svc: Svc,
  due: Due[],
  token: string,
  secret: string,
  site: string,
  now: Date,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const staff = await staffEmails(svc);
  const reps = new Map<string, Rep | null>();
  const seen = new Set<string>();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const d of due) {
    if (sent + failed >= PER_RUN) break;
    const email = d.email.trim().toLowerCase();
    if (!email || seen.has(email) || isLampAddress(email, staff)) {
      skipped++;
      continue;
    }
    seen.add(email);
    const [signed, dnc] = await Promise.all([
      signedSince(svc, email, d.startedAt),
      doNotContact(svc, email, d.phone),
    ]);
    // a check that couldn't run is a no for now: the next tick tries again
    if (signed !== false || dnc !== false) {
      skipped++;
      continue;
    }
    let rep: Rep | null = null;
    if (d.repSlug) {
      if (!reps.has(d.repSlug))
        reps.set(d.repSlug, await repBySlug(svc, d.repSlug).catch(() => null));
      rep = reps.get(d.repSlug) ?? null;
      if (!rep) {
        skipped++;
        continue;
      }
    }

    // claim it first, so two ticks running at once never send the same reminder twice
    const claim = await svc
      .from(d.table)
      .update({ reminders_sent: d.n, reminded_at: now.toISOString() } as never)
      .eq("id", d.id)
      .eq("reminders_sent", d.n - 1)
      .is("reminders_stopped_at", null)
      .select("id");
    if (claim.error || !claim.data?.length) {
      skipped++;
      continue;
    }

    const mail = reminderEmail({
      n: d.n,
      firstName: d.firstName,
      businessName: d.business,
      repName: rep?.name ?? null,
      url: await d.link(secret),
      stopUrl: `${site.replace(/\/$/, "")}/reminders/stop?t=${await stopToken(secret, d.kind, d.id)}`,
      legalName: SITE.legalName,
      address: SITE.address,
    });
    const out = await gmailSend(token, {
      to: email,
      fromName: rep ? `${rep.name} at Lamp` : "Lamp",
      replyTo: rep ? await replyToFor(svc, rep, rep.user_id ?? "") : null,
      cc: rep ? await ccFor(svc, rep) : null,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if ("error" in out) {
      // give the claim back so the next tick can try again
      await svc
        .from(d.table)
        .update({ reminders_sent: d.n - 1, reminded_at: d.lastAt } as never)
        .eq("id", d.id)
        .eq("reminders_sent", d.n);
      failed++;
      continue;
    }
    sent++;
  }
  return { sent, failed, skipped };
}

/** Stops reminders for every lead and personal link with this email. */
async function stopAllFor(svc: Svc, email: string): Promise<boolean> {
  const at = new Date().toISOString();
  const pattern = email.replace(/[\\%_]/g, "\\$&");
  const [a, b] = await Promise.all([
    svc
      .from("leads")
      .update({ reminders_stopped_at: at } as never)
      .ilike("email", pattern)
      .is("reminders_stopped_at", null),
    svc
      .from("application_invites")
      .update({ reminders_stopped_at: at } as never)
      .ilike("email", pattern)
      .is("reminders_stopped_at", null),
  ]);
  return !a.error && !b.error;
}

/**
 * POST /api/application/reminders
 *   { action: "unsubscribe", token }   the stop link in a reminder: stops every reminder to that
 *                                      email, whoever's link it was
 *   { action: "stop", kind, id }       a rep (their own) or an admin (any) stops one person's
 */
export async function remindersAction(request: Request): Promise<Response> {
  if (!SUPABASE_URL() || !SERVICE_KEY()) return json(500, { error: "No database settings." });
  let body: { action?: unknown; token?: unknown; kind?: unknown; id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "Send JSON." });
  }
  const svc = service();

  if (body.action === "unsubscribe") {
    const t = parseStopToken(body.token);
    if (!t) return json(400, { error: "That stop link isn't right." });
    const secret = await remindSecret(svc);
    if (!secret || !sameText(t.sig, await sign(secret, `stop:${t.kind}:${t.id}`)))
      return json(400, { error: "That stop link isn't right." });
    const row = await svc
      .from(t.kind === "lead" ? "leads" : "application_invites")
      .select("email")
      .eq("id", t.id)
      .maybeSingle();
    const email = ((row.data as { email?: string | null } | null)?.email ?? "").toLowerCase();
    if (row.error) return json(503, { error: "Try again in a moment." });
    if (!email) return json(200, { ok: true });
    if (!(await stopAllFor(svc, email))) return json(503, { error: "Try again in a moment." });
    return json(200, { ok: true });
  }

  if (body.action !== "stop") return json(400, { error: "Unknown action." });
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const kind = body.kind === "invite" ? "invite" : body.kind === "lead" ? "lead" : null;
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!kind || !id) return json(400, { error: "kind and id are required." });
  const [roles, mine] = await Promise.all([
    who.client.from("user_roles").select("role").eq("user_id", who.userId),
    who.client.rpc("current_rep_slug"),
  ]);
  const held = new Set(((roles.data ?? []) as { role: string }[]).map((r) => r.role));
  const isAdmin = held.has("admin");
  if (!isAdmin && !held.has("rep")) return json(403, { error: "Staff only." });
  const ownSlug = (mine.data as string | null) ?? null;
  // the caller's own client: a rep only finds their own people
  const table = kind === "lead" ? "leads" : "application_invites";
  const found = await who.client.from(table).select("id,rep_slug").eq("id", id).maybeSingle();
  const row = found.data as { id: string; rep_slug: string | null } | null;
  // a website lead has no rep: an admin's to stop
  if (!row || !ownRow(isAdmin, ownSlug, row.rep_slug))
    return json(404, { error: "That person isn't one of yours." });
  const at = new Date().toISOString();
  const up = await svc
    .from(table)
    .update({ reminders_stopped_at: at } as never)
    .eq("id", id)
    .is("reminders_stopped_at", null);
  if (up.error) return json(500, { error: "Couldn't stop the reminders." });
  return json(200, { ok: true, stopped_at: at });
}
