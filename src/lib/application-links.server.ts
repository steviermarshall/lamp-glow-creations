// Server side of application links (see application-links.ts and the migration
// 20261027120000_application_links.sql). Runs in the site's own server routes with the service
// role, like funder sending, and sends email through the same Gmail mailbox (partners@getlamp.app),
// with the rep's name on it and replies going to the rep.
//
// Never import this file from browser code: the route files load it inside their handlers.
import { ownRow } from "@/lib/team-lead";
import {
  caller,
  gmailAccessToken,
  GMAIL_SEND_URL,
  json,
  MAILBOX,
  SERVICE_KEY,
  service,
  SITE_URL,
  SUPABASE_URL,
  mayWork,
} from "@/lib/funder-send.server";
import {
  b64url,
  buildMime,
  MAX_ATTACHMENT_BYTES,
  sameSecret,
  type Attachment,
} from "@/lib/funder-send";
import {
  CONSENT_TEXT,
  CONSENT_VERSION,
  fromRow,
  cleanDetails,
  prefill,
  missing,
  signatureMatches,
} from "@/lib/application-details";
import { paperLink } from "@/lib/spoken-notes";
import { inviteIdOf, REMIND_TOKEN, remindToken, sameText } from "@/lib/finish-reminders";
import { remindSecret } from "@/lib/remind-secret.server";
import {
  applicationUrl,
  isEmailKind,
  linkDays,
  type EmailKind,
  buildAltMime,
  cleanEmail,
  EMAIL_RE,
  fromName,
  hashToken,
  inviteEmail,
  finishEmail,
  isToken,
  MAX_LINK_UPLOADS,
  MAX_NOTE,
  MAX_RECIPIENTS,
  MAX_SIGNED_PDF_BYTES,
  MAX_UPLOAD_BYTES,
  newToken,
  UPLOAD_TYPES,
  type Channel,
  type OpenResponse,
  type Recipient,
  type SendRequest,
  type SendResult,
  type SubmitResponse,
} from "@/lib/application-links";
import { NEW_APPLICATION_COPY, SITE } from "@/lib/site";
import { safeDraft } from "@/lib/application-draft";
import { deviceOf, isScanner } from "@/lib/open-signal";
import { copyMissingNote } from "@/lib/signed-copy";
import type { Json } from "@/integrations/supabase/types";
import { recordSigned } from "@/lib/tracking.server";
import {
  CLAIM_BODY,
  mailNotice,
  NOTICE,
  NOTICE_LIMIT_MS,
  sendNoticeOnce,
  sentBody,
  SIGNED_READ_LIMIT,
  type Delivery,
  type NoticeEvent,
  type NoticeOutcome,
  type SignedRow,
  type SweepStore,
  type UploadRow,
} from "@/lib/notice-retry";
import {
  einVariants,
  newApplicationEmail,
  recipients,
  type Duplicate,
} from "@/lib/new-application-email";
import {
  dailyEmailLimit,
  emailedToday,
  limitReached,
  newYorkDayStart,
  ONCE_A_DAY,
  roomLeft,
} from "@/lib/invite-limit";

/** The kind of email a link went with; "apply" for links sent before kinds existed, or before
 *  the email_kind column was added (20261119150000_invite_email_kind.sql). */
async function storedKind(svc: ReturnType<typeof service>, id: string): Promise<EmailKind> {
  const r = await svc.from("application_invites").select("email_kind").eq("id", id).maybeSingle();
  const k = (r.data as { email_kind?: unknown } | null)?.email_kind;
  return !r.error && isEmailKind(k) ? k : "apply";
}

/**
 * The column isn't there yet (PostgREST's unknown-column codes), or its allowed list predates this
 * kind (23514, a check refused the row: 20261120150000_invite_email_kind_thanks.sql not run yet).
 * Either way the link still goes out with the chosen words, and a resend falls back to "apply".
 */
const noKindColumn = (e: { code?: string } | null) =>
  !!e && (e.code === "PGRST204" || e.code === "42703" || e.code === "23514");

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
const MAX_OPEN_BYTES = 16 * 1024;
/** Two drawn signatures (400 KB each at most) and the answers; the signed PDF comes by upload. */
const MAX_SUBMIT_BYTES = 2 * 1024 * 1024;
const SIGNED = "That application is already signed; open the file instead.";

type Svc = ReturnType<typeof service>;

const notReady = () =>
  !SUPABASE_URL() || !SERVICE_KEY()
    ? json(500, { error: "The server is missing its database settings." })
    : null;

/** A lookup failed (not "there's none"): the caller can try again. */
const tryAgain = () => json(503, { error: "Try again in a moment." });

/**
 * Application emails this person has sent since midnight in New York (invite-limit.ts). A send
 * that failed outright (an error and no Gmail message) doesn't count; a resend does, because it
 * is another email. Null when the count itself failed.
 */
async function emailsSentToday(svc: Svc, userId: string): Promise<number | null> {
  const r = await svc
    .from("application_invites")
    .select("id", { count: "exact", head: true })
    .eq("sent_by", userId)
    .eq("channel", "email")
    .gte("sent_at", newYorkDayStart(new Date()).toISOString())
    .or("email_message_id.not.is.null,last_error.is.null");
  return r.error ? null : (r.count ?? 0);
}

/**
 * When this address last got an application email (any link, any sender), or null for never.
 * Undefined when the lookup failed. A send that failed outright doesn't count.
 */
async function lastEmailedAt(svc: Svc, email: string): Promise<string | null | undefined> {
  const r = await svc
    .from("application_invites")
    .select("sent_at")
    .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
    .eq("channel", "email")
    .or("email_message_id.not.is.null,last_error.is.null")
    .order("sent_at", { ascending: false })
    .limit(1);
  if (r.error) return undefined;
  return ((r.data ?? [])[0] as { sent_at: string } | undefined)?.sent_at ?? null;
}

/**
 * The request body, read up to max bytes; null when it's larger. Content-Length is only a hint (a
 * chunked or HTTP/2 request can leave it out), so the stream itself is counted.
 */
export async function readCapped(
  request: Request,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const len = request.headers.get("content-length");
  if (len !== null && Number(len) > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** A JSON object body of at most max bytes, or the 413/400 response to send back. */
export async function readJson<T extends object>(
  request: Request,
  max: number,
): Promise<T | Response> {
  let buf: Uint8Array | null;
  try {
    buf = await readCapped(request, max);
  } catch {
    return json(400, { error: "Send JSON." });
  }
  if (!buf) return json(413, { error: "That's too large to send." });
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(buf));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as T;
  } catch {
    /* not JSON */
  }
  return json(400, { error: "Send JSON." });
}

/**
 * Storage key for a file added from the link. Only letters, digits, "_", "." and "-" survive: '#'
 * or '?' would cut the key short in Storage's URL, and '%', '[', ']' or '~' fail its key check.
 * The documents row keeps the real name for display.
 */
export const linkUploadPath = (appId: string, name: string, now = Date.now()) =>
  `link/${appId}/${now}-${name.replace(/[^\w.-]+/g, "_").slice(-80) || "file"}`;

/**
 * An upload's type: what the browser said, or by the name when it said nothing useful (a File
 * with no type arrives in a form as application/octet-stream).
 */
export function uploadType(file: { type: string; name: string }): string {
  const said = file.type === "application/octet-stream" ? "" : file.type.toLowerCase();
  if (said) return said;
  if (/\.pdf$/i.test(file.name)) return "application/pdf";
  if (/\.heic$/i.test(file.name)) return "image/heic";
  return "";
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** A PDF's header, which readers accept anywhere in the first 1 KB. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const last = Math.min(bytes.length, 1024) - PDF_MAGIC.length;
  for (let i = 0; i <= last; i++) {
    if (PDF_MAGIC.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}

/** Storage's "that key already exists" (older servers send it as statusCode "409" in a 400). */
const isDuplicate = (e: unknown) => {
  const x = e as { status?: number; statusCode?: string } | null;
  return x?.status === 409 || x?.statusCode === "409";
};

/** The visitor's address as the edge saw it. */
export function clientIp(request: Request): string | null {
  const h = request.headers;
  const ip =
    h.get("cf-connecting-ip") ||
    (h.get("x-forwarded-for") ?? "").split(",")[0] ||
    h.get("x-real-ip") ||
    "";
  return ip.trim().slice(0, 64) || null;
}

/** Never throws: a failure comes back as { error } for the caller to record, and a batch goes on. */
export async function gmailSend(
  access: string,
  msg: {
    to: string;
    fromName: string;
    replyTo: string | null;
    /** Copied in (the person the sending rep reports to). */
    cc?: string | null;
    subject: string;
    text: string;
    html?: string;
  },
): Promise<{ id: string } | { error: string }> {
  let raw: string;
  try {
    raw = buildAltMime({
      from: `${fromName(msg.fromName)} <${MAILBOX()}>`,
      to: msg.to,
      replyTo: msg.replyTo,
      cc: msg.cc ?? null,
      subject: msg.subject,
      text: msg.text,
      html: msg.html ?? null,
    });
  } catch {
    return { error: "bad address" };
  }
  let res: Response;
  try {
    res = await fetch(GMAIL_SEND_URL(), {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: b64url(raw) }),
    });
  } catch {
    return { error: "Couldn't reach Gmail" };
  }
  if (!res.ok) return { error: `Gmail ${res.status}` };
  const out = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: out.id ?? "" };
}

export type Rep = {
  slug: string;
  name: string;
  title: string | null;
  user_id: string | null;
  active: boolean;
  admin_slug: string | null;
  /** The rep's own number for an email's sign-off; null until one is on their row. */
  phone: string | null;
  /** Who this rep reports to, when active: copied on the rep's application emails. */
  lead: { name: string; title: string | null; user_id: string | null } | null;
};

/** The rep, or null when there's none. Throws when the lookup itself failed. */
export async function repBySlug(svc: Svc, slug: string): Promise<Rep | null> {
  const cols = "slug,name,title,user_id,active,admin_slug";
  let r = await svc.from("reps").select(`${cols},phone`).eq("slug", slug).maybeSingle();
  // before 20261123210000_rep_phone.sql is run there is no phone column: read the row without it
  if (r.error && (r.error.code === "42703" || r.error.code === "PGRST204"))
    r = (await svc.from("reps").select(cols).eq("slug", slug).maybeSingle()) as typeof r;
  if (r.error) throw r.error;
  const row0 = r.data as (Omit<Rep, "lead" | "phone"> & { phone?: string | null }) | null;
  const rep = row0 ? { ...row0, phone: row0.phone ?? null } : null;
  if (!rep) return null;
  let lead: Rep["lead"] = null;
  if (rep.admin_slug) {
    const a = await svc
      .from("reps")
      .select("name,title,user_id,active")
      .eq("slug", rep.admin_slug)
      .maybeSingle();
    const row = a.data as (Rep["lead"] & { active: boolean }) | null;
    if (row?.active) lead = { name: row.name, title: row.title, user_id: row.user_id };
  }
  return { ...rep, lead };
}

/**
 * Who merchants see: always the rep who sent it (Asad, 2026-11-19: "their rep is the person that
 * sent the application"). Application emails, the application page and the signed PDF's "Lamp
 * rep" box use this name. The person the rep reports to is copied on the emails (ccFor), not shown.
 */
const facing = (r: Rep) => ({ name: r.name, title: r.title, user_id: r.user_id });

/** The address the rep's application emails are copied to: whoever the rep reports to. */
export async function ccFor(svc: Svc, rep: Rep | null): Promise<string | null> {
  if (!rep?.lead) return null;
  const lead = await emailOf(svc, rep.lead.user_id);
  const own = await emailOf(svc, rep.user_id);
  return lead && lead !== own ? lead : null;
}

/** Replies go to the admin and the rep, so either can answer; else to whoever sent it. */
export async function replyToFor(svc: Svc, rep: Rep, senderId: string): Promise<string | null> {
  const emails = [
    rep.lead ? await emailOf(svc, rep.lead.user_id) : null,
    await emailOf(svc, rep.user_id),
  ].filter((e, i, all): e is string => !!e && all.indexOf(e) === i);
  return emails.length ? emails.join(", ") : await emailOf(svc, senderId);
}

async function emailOf(svc: Svc, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const r = await svc.from("profiles").select("email").eq("id", userId).maybeSingle();
  return ((r.data as { email?: string | null } | null)?.email ?? "").toLowerCase() || null;
}

/** Addresses that belong to Lamp's own team: they never get a merchant link. */
export async function staffEmails(svc: Svc): Promise<Set<string>> {
  const roles = await svc.from("user_roles").select("user_id").in("role", ["admin", "rep"]);
  const ids = [...new Set(((roles.data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
  if (!ids.length) return new Set();
  const people = await svc.from("profiles").select("email").in("id", ids);
  return new Set(
    ((people.data ?? []) as { email: string | null }[])
      .map((p) => (p.email ?? "").toLowerCase())
      .filter(Boolean),
  );
}

export const isLampAddress = (email: string, staff: Set<string>) =>
  staff.has(email) || email.endsWith("@getlamp.app");

/**
 * Whether a lead with this email or phone is marked do not contact, on any rep's list. Null when
 * the list couldn't be read: callers refuse rather than guess.
 */
export async function doNotContact(
  svc: Svc,
  email: string,
  phone: string,
): Promise<boolean | null> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  const [byEmail, byPhone] = await Promise.all([
    email
      ? svc
          .from("engine_leads")
          .select("id")
          .eq("status", "do_not_call")
          .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
          .limit(1)
      : null,
    // stored phones come in any format: narrow by the last four digits, then compare ten
    digits.length >= 10
      ? svc
          .from("engine_leads")
          .select("phone")
          .eq("status", "do_not_call")
          .like("phone", `%${digits.slice(-4)}`)
          .limit(500)
      : null,
  ]);
  if (byEmail?.error || byPhone?.error) return null;
  if ((byEmail?.data ?? []).length) return true;
  return ((byPhone?.data ?? []) as { phone: string | null }[]).some(
    (l) => (l.phone ?? "").replace(/\D/g, "").slice(-10) === digits,
  );
}

// ---------- POST /api/application-invites (staff) ----------

/**
 * Send: one personal link per person, emailed from Lamp's mailbox as the rep, or handed back to
 * copy into a text. Reps send as themselves; an admin may send for any active rep. Resend makes a
 * new link (the old one stops working). Cancel stops a link. The database rules decide which
 * leads and links a caller may touch: everything is looked up through the caller's own client.
 */
/**
 * The link an application already has, to send again. The database keeps only the hash of the
 * token a rep's link went out with, so the same application is reached through a link signed
 * against that hash (the way a reminder's is): the earlier emails keep working and nothing the
 * merchant or the rep filled in is lost. Null when the reminders' secret isn't set up; the caller
 * then falls back to a new link.
 */
async function sameLink(
  svc: Svc,
  repSlug: string,
  invite: { id: string; token_hash: string },
): Promise<string | null> {
  const secret = await remindSecret(svc).catch(() => "");
  if (!secret) return null;
  return applicationUrl(
    SITE_URL(),
    repSlug,
    await remindToken(secret, invite.id, invite.token_hash),
  );
}

type OpenInvite = { id: string; token_hash: string; draft_saved_at: string | null };

/**
 * The application this merchant already has open with this rep: for the lead when there is one,
 * else for the email address. One a rep filled in comes first, then the newest. Asad, 2026-11-23:
 * "we're always sending a link to a prefilled or partially filled out application if we're
 * resending"; a merchant had been sent a blank second application beside the filled-in one.
 * Throws when the lookup itself fails.
 */
async function openInvite(
  svc: Svc,
  repSlug: string,
  leadId: number | null,
  email: string,
): Promise<OpenInvite | null> {
  const find = async (col: "engine_lead_id" | "email", value: number | string) => {
    const r = await svc
      .from("application_invites")
      .select("id,token_hash,draft_saved_at")
      .eq("rep_slug", repSlug)
      .eq(col, value)
      .is("submitted_at", null)
      .is("cancelled_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("draft_saved_at", { ascending: false, nullsFirst: false })
      .order("sent_at", { ascending: false })
      .limit(1);
    if (r.error) throw r.error;
    return ((r.data ?? [])[0] as OpenInvite | undefined) ?? null;
  };
  return (
    (leadId ? await find("engine_lead_id", leadId) : null) ?? (email ? find("email", email) : null)
  );
}

export async function applicationInvites(request: Request): Promise<Response> {
  const nr = notReady();
  if (nr) return nr;
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  const [roles, mine] = await Promise.all([
    who.client.from("user_roles").select("role").eq("user_id", who.userId),
    who.client.rpc("current_rep_slug"),
  ]);
  const held = new Set(((roles.data ?? []) as { role: string }[]).map((r) => r.role));
  const isAdmin = held.has("admin");
  if (!isAdmin && !held.has("rep")) return json(403, { error: "Staff only." });
  const ownSlug = (mine.data as string | null) ?? null;

  let body: SendRequest;
  try {
    body = (await request.json()) as SendRequest;
  } catch {
    return json(400, { error: "Send JSON." });
  }
  const svc = service();

  if (body.action === "cancel" || body.action === "resend") {
    if (!UUID.test(body.invite_id ?? "")) return json(400, { error: "invite_id is required." });
    // the caller's own client: a rep only finds links sent for them
    const found = await who.client
      .from("application_invites" as never)
      .select("id,rep_slug,email,phone,first_name,business_name,submitted_at,note,engine_lead_id")
      .eq("id", body.invite_id)
      .maybeSingle();
    const inv = found.data as {
      id: string;
      rep_slug: string;
      email: string | null;
      phone: string | null;
      first_name: string | null;
      business_name: string | null;
      submitted_at: string | null;
      note: string | null;
      engine_lead_id: number | null;
    } | null;
    // a team lead reads the links their team sent; stopping or resending one is its sender's
    if (!inv || !ownRow(isAdmin, ownSlug, inv.rep_slug))
      return json(404, { error: "That link isn't one of yours." });
    if (inv.submitted_at) return json(409, { error: SIGNED });

    // both writes skip a link signed since the read above (Postgres re-checks the condition
    // after waiting on submit's row lock), so a signed invite never changes channel or address
    if (body.action === "cancel") {
      const stop = await svc
        .from("application_invites")
        .update({ cancelled_at: new Date().toISOString() })
        .eq("id", inv.id)
        .is("submitted_at", null)
        .select("id");
      if (stop.error) return json(500, { error: "Couldn't stop the link." });
      if (!stop.data?.length) return json(409, { error: SIGNED });
      const out: SendResult = { index: 0, status: "cancelled", detail: "Link stopped." };
      return json(200, { results: [out] });
    }

    const channel: Channel = body.channel === "email" ? "email" : "link";
    if (channel === "email" && !inv.email)
      return json(400, { error: "That link has no email address; copy it instead." });
    // do not contact: the lead this went to, or anyone on a lead list with the same email or phone
    const [lead, dnc] = await Promise.all([
      inv.engine_lead_id
        ? svc.from("engine_leads").select("status").eq("id", inv.engine_lead_id).maybeSingle()
        : null,
      doNotContact(svc, inv.email ?? "", inv.phone ?? ""),
    ]);
    if (lead?.error || dnc === null)
      return json(503, { error: "Couldn't check the do-not-contact list. Try again." });
    if (dnc || (lead?.data as { status: string } | null)?.status === "do_not_call")
      return json(409, { error: "Marked do not contact." });
    if (channel === "email") {
      const limit = dailyEmailLimit(isAdmin);
      const sentToday = await emailsSentToday(svc, who.userId);
      if (sentToday === null) return tryAgain();
      if (roomLeft(limit, sentToday) === 0) return json(429, { error: limitReached(limit) });
    }
    const rep = await repBySlug(svc, inv.rep_slug).catch(() => undefined);
    if (rep === undefined) return tryAgain();
    if (!rep) return json(409, { error: "That rep is gone." });
    const note = typeof body.note === "string" ? body.note.slice(0, MAX_NOTE) : (inv.note ?? "");
    // a resend keeps the words the link first went out with
    const kind = await storedKind(svc, inv.id);
    // and the link itself: the same application, so the earlier emails still open it
    const kept = await svc
      .from("application_invites")
      .select("token_hash,draft_saved_at")
      .eq("id", inv.id)
      .maybeSingle();
    if (kept.error) return tryAgain();
    const had = kept.data as { token_hash: string; draft_saved_at: string | null } | null;
    const same = had
      ? await sameLink(svc, rep.slug, { id: inv.id, token_hash: had.token_hash })
      : null;
    // only without the reminders' secret: a new link, and the old one stops
    const token = same ? null : newToken();
    const filled = kind === "apply" && !!had?.draft_saved_at;
    const upd = await svc
      .from("application_invites")
      .update({
        ...(token ? { token_hash: await hashToken(token) } : {}),
        channel,
        note: note || null,
        sent_at: new Date().toISOString(),
        expires_at: days(linkDays(kind)),
        cancelled_at: null,
        last_error: null,
        sent_by: who.userId,
      })
      .eq("id", inv.id)
      .is("submitted_at", null)
      .select("id");
    if (upd.error) return json(500, { error: "Couldn't make a new link." });
    if (!upd.data?.length) return json(409, { error: SIGNED });
    const url = same ?? applicationUrl(SITE_URL(), rep.slug, token);
    if (channel === "link") {
      return json(200, {
        results: [
          {
            index: 0,
            status: "link",
            detail: same
              ? "Same application, link ready to copy."
              : "New link made; the old one stopped working.",
            invite_id: inv.id,
            url,
            kind,
          },
        ],
      });
    }
    const access = await gmailAccessToken(svc).catch(() => ({ error: "Couldn't reach Google." }));
    if ("error" in access) {
      await svc
        .from("application_invites")
        .update({ last_error: access.error, cancelled_at: new Date().toISOString() })
        .eq("id", inv.id);
      return json(412, { error: access.error });
    }
    const replyTo = await replyToFor(svc, rep, who.userId);
    const mail = inviteEmail({
      firstName: inv.first_name ?? "",
      businessName: inv.business_name ?? "",
      repName: facing(rep).name,
      repPhone: rep.phone,
      note,
      url,
      legalName: SITE.legalName,
      address: SITE.address,
      kind,
      ...(filled ? { filled: true } : {}),
    });
    const sent = await gmailSend(access.access, {
      cc: await ccFor(svc, rep),
      to: inv.email!,
      fromName: `${facing(rep).name} at Lamp`,
      replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if ("error" in sent) {
      await svc
        .from("application_invites")
        .update({ last_error: sent.error, cancelled_at: new Date().toISOString() })
        .eq("id", inv.id);
      return json(200, {
        results: [{ index: 0, status: "failed", detail: sent.error, invite_id: inv.id }],
      });
    }
    await svc.from("application_invites").update({ email_message_id: sent.id }).eq("id", inv.id);
    return json(200, {
      results: [{ index: 0, status: "sent", detail: `Emailed ${inv.email}`, invite_id: inv.id }],
    });
  }

  if (body.action !== "send") return json(400, { error: "Unknown action." });
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  if (recipients.length === 0) return json(400, { error: "Pick at least one person." });
  if (body.kind !== undefined && !isEmailKind(body.kind))
    return json(400, { error: "Unknown kind of email." });
  const kind: EmailKind = body.kind ?? "apply";
  if (recipients.length > MAX_RECIPIENTS)
    return json(400, { error: `At most ${MAX_RECIPIENTS} at a time.` });

  // whose links these are: a rep sends as themselves; an admin may pick any active rep
  let repSlug = ownSlug;
  if (isAdmin && typeof body.rep_slug === "string" && body.rep_slug) {
    if (!SLUG.test(body.rep_slug)) return json(400, { error: "Unknown rep." });
    repSlug = body.rep_slug;
  }
  if (!repSlug)
    return json(400, { error: "Your account has no rep link yet. Ask an admin to link one." });
  const rep = await repBySlug(svc, repSlug).catch(() => undefined);
  if (rep === undefined) return tryAgain();
  if (!rep || !rep.active) return json(400, { error: "That rep isn't active." });

  // the caller's own client, so a rep only reaches leads assigned to them
  const leadIds = [
    ...new Set(
      recipients
        .map((r) => r.lead_id)
        .filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x > 0),
    ),
  ];
  const leads = new Map<
    number,
    { id: number; name: string | null; phone: string | null; email: string | null; status: string }
  >();
  if (leadIds.length) {
    const r = await who.client
      .from("engine_leads")
      .select("id,name,phone,email,status,rep_slug")
      .in("id", leadIds);
    for (const l of (r.data ?? []) as {
      id: number;
      name: string | null;
      phone: string | null;
      email: string | null;
      status: string;
      rep_slug: string | null;
    }[])
      // a team lead reads the team's leads; a link goes only to a lead that is the sender's own
      if (ownRow(isAdmin, ownSlug, l.rep_slug)) leads.set(l.id, l);
  }

  const note = typeof body.note === "string" ? body.note.slice(0, MAX_NOTE) : "";
  const staff = await staffEmails(svc);
  const replyTo = await replyToFor(svc, rep, who.userId);
  let access: { access: string } | { error: string } | null = null;
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const results: SendResult[] = [];
  // the day's email ceiling for the person pressing Send; links to copy are never limited
  const emailLimit = dailyEmailLimit(isAdmin);
  let emailRoom = Number.POSITIVE_INFINITY;
  if (recipients.some((r) => r.channel === "email")) {
    const sentToday = await emailsSentToday(svc, who.userId);
    if (sentToday === null) return tryAgain();
    emailRoom = roomLeft(emailLimit, sentToday);
  }

  for (let index = 0; index < recipients.length; index++) {
    const r: Recipient = recipients[index]!;
    const lead = r.lead_id ? leads.get(r.lead_id) : undefined;
    if (r.lead_id && !lead) {
      results.push({ index, status: "skipped", detail: "Not on your lead list." });
      continue;
    }
    if (lead?.status === "do_not_call") {
      results.push({ index, status: "skipped", detail: "Marked do not contact." });
      continue;
    }
    const channel: Channel = r.channel === "email" ? "email" : "link";
    const email = cleanEmail(r.email || lead?.email);
    const phone = (r.phone || lead?.phone || "").trim().slice(0, 40);
    const firstName = (r.first_name ?? "").trim().slice(0, 80);
    const lastName = (r.last_name ?? "").trim().slice(0, 80);
    const business = (r.business_name || lead?.name || "").trim().slice(0, 160);
    if (email && !EMAIL_RE.test(email)) {
      results.push({ index, status: "skipped", detail: "That email address doesn't look right." });
      continue;
    }
    if (channel === "email" && !email) {
      results.push({
        index,
        status: "skipped",
        detail: "No email address; copy the link instead.",
      });
      continue;
    }
    if (email && isLampAddress(email, staff)) {
      results.push({ index, status: "skipped", detail: "That's a Lamp team address." });
      continue;
    }
    const dnc = await doNotContact(svc, email, phone);
    if (dnc !== false) {
      results.push({
        index,
        status: "skipped",
        detail: dnc ? "Marked do not contact." : "Couldn't check the do-not-contact list.",
      });
      continue;
    }
    if (channel === "email") {
      const dup = await svc
        .from("application_invites")
        .select("id")
        .eq("email", email)
        .eq("rep_slug", rep.slug)
        .eq("channel", "email")
        .is("submitted_at", null)
        .is("cancelled_at", null)
        .gte("sent_at", since)
        .limit(1);
      if ((dup.data ?? []).length) {
        results.push({
          index,
          status: "skipped",
          detail: "Already emailed in the last few minutes.",
        });
        continue;
      }
    }

    if (channel === "email") {
      if (emailRoom <= 0) {
        results.push({ index, status: "skipped", detail: limitReached(emailLimit) });
        continue;
      }
      // counted before the send, so a failure part-way through never lets the batch run over
      emailRoom--;
    }

    // the application this merchant already has open goes out again; never a blank second one
    let again: OpenInvite | null;
    try {
      again = await openInvite(svc, rep.slug, lead?.id ?? null, email);
    } catch {
      results.push({ index, status: "failed", detail: "Couldn't check for an open application." });
      continue;
    }
    const againUrl = again ? await sameLink(svc, rep.slug, again) : null;
    const token = newToken();
    const row = {
      token_hash: await hashToken(token),
      rep_slug: rep.slug,
      sent_by: who.userId,
      engine_lead_id: lead?.id ?? null,
      first_name: firstName || null,
      last_name: lastName || null,
      business_name: business || null,
      email: email || null,
      phone: phone || null,
      channel,
      note: note || null,
      expires_at: days(linkDays(kind)),
    };
    let inviteId: string;
    let url: string;
    if (again && againUrl) {
      // same row, same link: stamped as sent now, with the address and channel it goes out on
      const upd = await svc
        .from("application_invites")
        .update({
          channel,
          sent_at: new Date().toISOString(),
          sent_by: who.userId,
          last_error: null,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(note ? { note } : {}),
          ...(lead ? { engine_lead_id: lead.id } : {}),
        })
        .eq("id", again.id)
        .is("submitted_at", null)
        .select("id");
      if (upd.error || !upd.data?.length) {
        results.push({ index, status: "failed", detail: "Couldn't record the link." });
        continue;
      }
      inviteId = again.id;
      url = againUrl;
    } else {
      let ins = await svc
        .from("application_invites")
        .insert((kind === "apply" ? row : { ...row, email_kind: kind }) as never)
        .select("id")
        .single();
      // before the email_kind column exists the link still goes out; a resend then uses "apply"
      if (kind !== "apply" && noKindColumn(ins.error))
        ins = await svc.from("application_invites").insert(row).select("id").single();
      if (ins.error || !ins.data) {
        results.push({ index, status: "failed", detail: "Couldn't record the link." });
        continue;
      }
      inviteId = (ins.data as { id: string }).id;
      url = applicationUrl(SITE_URL(), rep.slug, token);
    }
    const reused = !!(again && againUrl);
    // "we filled it in together": only when a rep really did, and only on the application email
    const filled = reused && kind === "apply" && !!again?.draft_saved_at;

    if (channel === "link") {
      results.push({
        index,
        status: "link",
        detail: reused ? "Their open application, link ready to copy." : "Link ready to copy.",
        invite_id: inviteId,
        url,
        kind,
      });
      continue;
    }

    access ??= await gmailAccessToken(svc).catch(() => ({ error: "Couldn't reach Google." }));
    if ("error" in access) {
      await svc
        .from("application_invites")
        // an application that was already open stays open: only a link made just now is stopped
        .update({
          last_error: access.error,
          ...(reused ? {} : { cancelled_at: new Date().toISOString() }),
        })
        .eq("id", inviteId);
      results.push({ index, status: "failed", detail: access.error, invite_id: inviteId });
      continue;
    }
    const mail = inviteEmail({
      firstName,
      businessName: business,
      repName: facing(rep).name,
      repPhone: rep.phone,
      note,
      url,
      legalName: SITE.legalName,
      address: SITE.address,
      kind,
      ...(filled ? { filled: true } : {}),
    });
    const sent = await gmailSend(access.access, {
      cc: await ccFor(svc, rep),
      to: email,
      fromName: `${facing(rep).name} at Lamp`,
      replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if ("error" in sent) {
      await svc
        .from("application_invites")
        .update({
          last_error: sent.error,
          ...(reused ? {} : { cancelled_at: new Date().toISOString() }),
        })
        .eq("id", inviteId);
      results.push({ index, status: "failed", detail: sent.error, invite_id: inviteId });
      continue;
    }
    await svc.from("application_invites").update({ email_message_id: sent.id }).eq("id", inviteId);
    // keep the address on the lead for next time (the engine's own columns: service role only)
    if (lead && !lead.email) await svc.from("engine_leads").update({ email }).eq("id", lead.id);
    results.push({
      index,
      status: "sent",
      detail: reused ? `Emailed ${email} their open application` : `Emailed ${email}`,
      invite_id: inviteId,
    });
  }

  return json(200, { results });
}

// ---------- POST /api/application/open (anyone with the link) ----------

type InviteRow = {
  id: string;
  rep_slug: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  opened_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  cancelled_at: string | null;
  expires_at: string;
  draft: Record<string, unknown> | null;
  draft_step: number | null;
  draft_saved_at: string | null;
};

const INVITE_COLUMNS =
  "id,rep_slug,first_name,last_name,business_name,email,phone,opened_at,started_at,submitted_at,cancelled_at,expires_at,draft,draft_step,draft_saved_at";

/**
 * The invite, or null when the token matches none. Throws when the lookup itself failed. A
 * reminder's link (finish-reminders.ts, REMIND_TOKEN) names the invite and is signed against the
 * link's current token, so it opens the same application as the link the rep sent until a resend.
 */
async function inviteByToken(svc: Svc, token: string): Promise<InviteRow | null> {
  const found = await inviteAndHash(svc, token);
  return found ? found.invite : null;
}

/** The invite and the token hash the database knows it by (for signing through a reminder link). */
async function inviteAndHash(
  svc: Svc,
  token: string,
): Promise<{ invite: InviteRow; tokenHash: string } | null> {
  const id = REMIND_TOKEN.test(token) ? inviteIdOf(token) : null;
  const r = await svc
    .from("application_invites")
    .select(`${INVITE_COLUMNS},token_hash`)
    .eq(id ? "id" : "token_hash", id ?? (await hashToken(token)))
    .maybeSingle();
  if (r.error) throw r.error;
  const row = r.data as (InviteRow & { token_hash: string }) | null;
  if (!row) return null;
  if (id) {
    const secret = await remindSecret(svc);
    if (!secret || !sameText(token, await remindToken(secret, row.id, row.token_hash))) return null;
  }
  const { token_hash, ...invite } = row;
  return { invite, tokenHash: token_hash };
}

/**
 * True when the visit carries a signed-in Lamp staff member's session (a rep or an admin). The
 * application pages send the session along when this browser has one.
 */
async function isStaffVisit(request: Request, svc: ReturnType<typeof service>): Promise<boolean> {
  if (!request.headers.get("Authorization")?.startsWith("Bearer ")) return false;
  const who = await caller(request).catch(() => null);
  if (!who) return false;
  const r = await svc.from("user_roles").select("role").eq("user_id", who.userId);
  return ((r.data ?? []) as { role: string }[]).some((x) => x.role === "rep" || x.role === "admin");
}

/**
 * What the application page needs before the merchant starts: who sent it and what they already
 * know. A personal link also records that it was opened (and, with event "start", started). A
 * lookup that fails is a 503, so the page offers a retry instead of calling a good link dead.
 */
export async function openApplication(request: Request): Promise<Response> {
  const nr = notReady();
  if (nr) return nr;
  const body = await readJson<{ token?: unknown; rep?: unknown; event?: unknown }>(
    request,
    MAX_OPEN_BYTES,
  );
  if (body instanceof Response) return body;
  const svc = service();
  const none = (state: OpenResponse["state"]): Response =>
    json(200, { state, draft: null, rep: null, prefill: null } satisfies OpenResponse);
  // merchants see the admin's name when the rep reports to one (see facing)
  const repOut = (r: Rep) => ({ slug: r.slug, name: facing(r).name, title: facing(r).title });

  if (body.token != null) {
    if (!isToken(body.token)) return none("not_found");
    const inv = await inviteByToken(svc, body.token).catch(() => undefined);
    if (inv === undefined) return tryAgain();
    if (!inv) return none("not_found");
    const rep = await repBySlug(svc, inv.rep_slug).catch(() => undefined);
    if (rep === undefined) return tryAgain();
    // the invite id, not the token, keys the page's saved draft: a resent link keeps progress
    const base = { draft: inv.id, rep: rep ? repOut(rep) : null };
    if (inv.submitted_at) return json(200, { ...base, state: "signed", prefill: null });
    if (inv.cancelled_at) return json(200, { ...base, state: "cancelled", prefill: null });
    if (Date.parse(inv.expires_at) < Date.now())
      return json(200, { ...base, state: "expired", prefill: null });
    const now = new Date().toISOString();
    // Only the merchant's own visits count (Asad, 2026-11-25). A signed-in staff member checking
    // the link, or filling it in on the call, and link scanners don't mark it opened or started.
    const agent = request.headers.get("user-agent");
    const merchant = !isScanner(agent) && !(await isStaffVisit(request, svc));
    if (merchant) {
      const started = body.event === "start";
      if (started && !inv.started_at) {
        await svc
          .from("application_invites")
          .update({ started_at: now, opened_at: inv.opened_at ?? now })
          .eq("id", inv.id);
      } else if (!inv.opened_at) {
        await svc.from("application_invites").update({ opened_at: now }).eq("id", inv.id);
      }
      // every visit, kept apart from the rep's (does nothing until the 20261125130000 SQL runs)
      await svc
        .rpc(
          "note_merchant_open" as never,
          {
            _invite: inv.id,
            _device: deviceOf(agent),
            _started: started,
          } as never,
        )
        .then(
          () => undefined,
          () => undefined,
        );
    }
    return json(200, {
      ...base,
      state: "open",
      prefill: {
        first_name: inv.first_name ?? "",
        last_name: inv.last_name ?? "",
        business_name: inv.business_name ?? "",
        email: inv.email ?? "",
        phone: inv.phone ?? "",
      },
      answers: inv.draft ?? null,
      answers_step: inv.draft_step ?? null,
      answers_saved_at: inv.draft_saved_at ?? null,
    } satisfies OpenResponse);
  }

  const slug = typeof body.rep === "string" ? body.rep.toLowerCase() : "";
  // "" is the website's own application: open, with no rep (the file lands unassigned)
  if (slug === "")
    return json(200, {
      state: "open",
      draft: null,
      rep: null,
      prefill: null,
    } satisfies OpenResponse);
  if (!SLUG.test(slug)) return none("unknown_rep");
  const rep = await repBySlug(svc, slug).catch(() => undefined);
  if (rep === undefined) return tryAgain();
  if (!rep || !rep.active) return none("unknown_rep");
  return json(200, {
    state: "open",
    draft: null,
    rep: repOut(rep),
    prefill: null,
  } satisfies OpenResponse);
}

// ---------- POST /api/application/draft (staff, on the phone with the merchant) ----------

const MAX_DRAFT_BYTES = 150 * 1024;

/**
 * Start application: the rep fills in the merchant's personal link with them on the phone. "save"
 * keeps the answers on the invite (never an SSN or date of birth), so the merchant's own browser
 * opens them; "email" sends that same link to the merchant to check, add the private numbers and
 * sign. Only the rep the link belongs to, or an admin, and only while it is open.
 */
export async function applicationDraft(request: Request): Promise<Response> {
  const nr = notReady();
  if (nr) return nr;
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in to Lamp in this browser first." });
  const [roles, mine] = await Promise.all([
    who.client.from("user_roles").select("role").eq("user_id", who.userId),
    who.client.rpc("current_rep_slug"),
  ]);
  const held = new Set(((roles.data ?? []) as { role: string }[]).map((r) => r.role));
  const isAdmin = held.has("admin");
  if (!isAdmin && !held.has("rep")) return json(403, { error: "Staff only." });
  const ownSlug = (mine.data as string | null) ?? null;

  const body = await readJson<{
    action?: unknown;
    token?: unknown;
    draft?: unknown;
    step?: unknown;
    to?: unknown;
    form?: unknown;
  }>(request, MAX_DRAFT_BYTES + 4096);
  if (body instanceof Response) return body;
  if (!isToken(body.token)) return json(400, { error: "That isn't an application link." });
  const svc = service();
  const inv = await inviteByToken(svc, body.token).catch(() => undefined);
  if (inv === undefined) return tryAgain();
  if (!inv) return json(404, { error: "That link doesn't work any more." });
  if (!isAdmin && inv.rep_slug !== ownSlug)
    return json(403, { error: "That application belongs to another rep." });
  if (inv.submitted_at) return json(409, { error: SIGNED });
  if (inv.cancelled_at) return json(410, { error: "That link was replaced or stopped." });
  if (Date.parse(inv.expires_at) < Date.now()) return json(410, { error: "That link expired." });

  if (body.action === "save") {
    const draft = safeDraft(body.draft);
    if (!draft) return json(400, { error: "No answers to save." });
    if (JSON.stringify(draft).length > MAX_DRAFT_BYTES)
      return json(413, { error: "That's more than an application holds." });
    const step =
      typeof body.step === "number" && Number.isInteger(body.step)
        ? Math.min(Math.max(body.step, 0), 10)
        : 0;
    const now = new Date().toISOString();
    const upd = await svc
      .from("application_invites")
      .update({
        draft: draft as Json,
        draft_step: step,
        draft_saved_at: now,
        draft_by: who.userId,
        started_at: inv.started_at ?? now,
        opened_at: inv.opened_at ?? now,
      })
      .eq("id", inv.id)
      .is("submitted_at", null)
      .select("id");
    if (upd.error) return json(500, { error: "Couldn't save. Try again." });
    if (!upd.data?.length) return json(409, { error: SIGNED });
    return json(200, { saved_at: now });
  }

  if (body.action === "email") {
    // the owner's email as typed on the call, else the one the link was made with
    const typed = typeof body.to === "string" ? cleanEmail(body.to) : "";
    const to = EMAIL_RE.test(typed) ? typed : cleanEmail(inv.email);
    if (!to || !EMAIL_RE.test(to))
      return json(400, {
        error:
          "This link has no email address. Add it on the lead and start again, or copy the link.",
      });
    const dnc = await doNotContact(svc, to, inv.phone ?? "");
    if (dnc === null)
      return json(503, { error: "Couldn't check the do-not-contact list. Try again." });
    if (dnc) return json(409, { error: "Marked do not contact." });
    // once a day per address: this button takes any typed address, so it gets a ceiling
    const last = await lastEmailedAt(svc, to);
    if (last === undefined) return tryAgain();
    if (emailedToday(last, new Date())) return json(429, { error: ONCE_A_DAY });
    const rep = await repBySlug(svc, inv.rep_slug).catch(() => undefined);
    if (rep === undefined) return tryAgain();
    if (!rep) return json(409, { error: "That rep is gone." });
    const access = await gmailAccessToken(svc).catch(() => ({ error: "Couldn't reach Google." }));
    if ("error" in access) return json(412, { error: access.error });
    const mail = inviteEmail({
      firstName: inv.first_name ?? "",
      businessName: inv.business_name ?? "",
      repName: facing(rep).name,
      repPhone: rep.phone,
      note: "",
      // Start application opens the paper form, so the merchant gets the same paper form
      url:
        body.form === "pdf"
          ? paperLink(applicationUrl(SITE_URL(), rep.slug, body.token))
          : applicationUrl(SITE_URL(), rep.slug, body.token),
      legalName: SITE.legalName,
      address: SITE.address,
      filled: true,
    });
    const sent = await gmailSend(access.access, {
      cc: await ccFor(svc, rep),
      to,
      fromName: `${facing(rep).name} at Lamp`,
      replyTo: await replyToFor(svc, rep, who.userId),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if ("error" in sent) {
      await svc.from("application_invites").update({ last_error: sent.error }).eq("id", inv.id);
      return json(502, { error: `Couldn't send: ${sent.error}` });
    }
    await svc
      .from("application_invites")
      // stamped like any send, so the once-a-day check and the sender's daily count see it
      .update({
        channel: "email",
        email: to,
        email_message_id: sent.id,
        last_error: null,
        sent_at: new Date().toISOString(),
        sent_by: who.userId,
      })
      .eq("id", inv.id);
    return json(200, { sent_to: to });
  }

  return json(400, { error: "Say save or email." });
}

// ---------- POST /api/application/submit (anyone with the link) ----------

type SubmitBody = {
  token?: unknown;
  rep?: unknown;
  details?: unknown;
  signature?: { name?: unknown; image?: unknown; name2?: unknown; image2?: unknown };
  consent_version?: unknown;
  /** "pdf": signed on the one-page paper form, which asks only whether they own real estate */
  form?: unknown;
  /** an older page's hidden box; read by nothing now (see submitApplication) */
  company_fax?: unknown;
};

const ERR: Record<string, [number, string]> = {
  link_not_found: [404, "This link doesn't work. Ask your rep for a new one."],
  already_signed: [409, "This application is already signed. Your rep has it."],
  link_cancelled: [410, "This link was replaced. Use the newest one your rep sent."],
  link_expired: [410, "This link has expired. Ask your rep for a new one."],
  unknown_rep: [404, "We couldn't find that rep's page."],
  too_many: [
    429,
    "We're getting a lot of applications from here right now. Try again in an hour or call your rep.",
  ],
};

/**
 * The merchant signs and submits. Everything is checked again here (the page's checks are for
 * the merchant's convenience), the file is created in one transaction by
 * submit_link_application, and the rep gets an email. The response carries the claim token the
 * browser keeps for the account step, and the time and address the database recorded: the page
 * builds the signed PDF from those and uploads it (kind funder_application).
 */
export async function submitApplication(request: Request): Promise<Response> {
  const nr = notReady();
  if (nr) return nr;
  const body = await readJson<SubmitBody>(request, MAX_SUBMIT_BYTES);
  if (body instanceof Response) return body;
  // No hidden-box trap. The page used to carry a box people never see, and anything in it meant a
  // refusal with only "Couldn't submit." But a browser's autofill fills hidden boxes too, so a
  // merchant with every answer in and both signatures drawn was turned away (2026-11-23, on a call
  // with Asad). A signed application is never refused for that; a page still open from before
  // may send the field, and it is ignored. The limits per network and per link stay.
  if (body.consent_version !== CONSENT_VERSION)
    return json(409, { error: "The application was updated. Refresh the page and sign again." });

  const token = body.token == null ? null : body.token;
  if (token !== null && !isToken(token)) return json(404, { error: ERR["link_not_found"]![1] });
  const rep = typeof body.rep === "string" ? body.rep.toLowerCase() : "";
  // with no token, "" is the website's own application (no rep); anything else must be a rep
  if (token === null && rep !== "" && !SLUG.test(rep))
    return json(404, { error: ERR["unknown_rep"]![1] });

  const d = cleanDetails(fromRow((body.details ?? {}) as Record<string, unknown>));
  const paper = body.form === "pdf";
  const todo = missing(d, { propertyDetails: !paper });
  if (todo.length) return json(422, { error: "Some answers are missing.", missing: todo });
  const owner = d.owners[0]!;
  const sig = body.signature ?? {};
  const name = typeof sig.name === "string" ? sig.name.trim().slice(0, 120) : "";
  const image = typeof sig.image === "string" ? sig.image : "";
  if (!signatureMatches(name, owner))
    return json(422, { error: `Type your full name, ${owner.first} ${owner.last}, to sign.` });
  if (!PNG.test(image) || image.length < 200 || image.length > 400_000)
    return json(422, { error: "Draw your signature in the box." });
  let name2: string | null = null;
  let image2: string | null = null;
  if (d.owners[1] && typeof sig.name2 === "string" && sig.name2.trim()) {
    name2 = sig.name2.trim().slice(0, 120);
    image2 = typeof sig.image2 === "string" ? sig.image2 : "";
    if (!signatureMatches(name2, d.owners[1]))
      return json(422, {
        error: `The second owner types their full name, ${d.owners[1].first} ${d.owners[1].last}, to sign.`,
      });
    if (!PNG.test(image2) || image2.length < 200 || image2.length > 400_000)
      return json(422, { error: "The second owner draws their signature in the box." });
  }

  const claimEmail = cleanEmail(owner.email);
  const claimToken = newToken();
  const svc = service();
  // a reminder's link signs the same invite: the database knows it by the rep's link's hash
  let tokenHash: string | null = null;
  if (token && REMIND_TOKEN.test(token)) {
    const found = await inviteAndHash(svc, token).catch(() => undefined);
    if (found === undefined) return tryAgain();
    if (!found) return json(404, { error: ERR["link_not_found"]![1] });
    tokenHash = found.tokenHash;
  } else if (token) {
    tokenHash = await hashToken(token);
  }
  const res = await svc.rpc("submit_link_application", {
    _token_hash: tokenHash,
    _rep_slug: token ? null : rep,
    _details: d,
    _signed_name: name,
    _signature_image: image,
    _signed_name_2: name2,
    _signature_image_2: image2,
    _consent_text: CONSENT_TEXT,
    _consent_version: CONSENT_VERSION,
    _signer_agent: (request.headers.get("user-agent") ?? "").slice(0, 300),
    _signer_ip: clientIp(request),
    _claim_email: claimEmail,
    _claim_token_hash: await hashToken(claimToken),
  });
  if (res.error) {
    const known = ERR[res.error.message];
    if (known) return json(known[0], { error: known[1], code: res.error.message });
    return json(500, { error: "Couldn't submit. Try again, or call your rep." });
  }
  const out = res.data as {
    application_id: string;
    rep_slug: string;
    rep_name: string | null;
    signed_at?: string | null;
    signer_ip?: string | null;
  };

  // what the database stamped, for the signed PDF's signature record (read back if not returned)
  let signedAt = out.signed_at ?? null;
  let signerIp = out.signer_ip ?? null;
  if (!signedAt) {
    const row = await svc
      .from("application_details")
      .select("signed_at,signer_ip")
      .eq("application_id", out.application_id)
      .maybeSingle();
    const r = row.data as { signed_at: string | null; signer_ip: string | null } | null;
    signedAt = r?.signed_at ?? null;
    signerIp = r?.signer_ip ?? signerIp;
  }

  // the rep's email waits for the signed PDF and the statements: see notifyNewApplication

  // for the online-or-paper A/B test: a signed file counts as a page view of .../signed
  await recordSigned(request, out.rep_slug, paper);
  // and the file says which form it came in on, for the "How it came in" line staff see
  if (paper) {
    const row = await svc
      .from("applications")
      .select("utm")
      .eq("id", out.application_id)
      .maybeSingle();
    const utm = ((row.data as { utm: Record<string, unknown> | null } | null)?.utm ?? {}) as Record<
      string,
      unknown
    >;
    await svc
      .from("applications")
      .update({ utm: { ...utm, form: "pdf" } } as never)
      .eq("id", out.application_id);
  }

  return json(200, {
    application_id: out.application_id,
    claim_token: claimToken,
    rep_name: out.rep_name ?? "",
    email: claimEmail,
    signed_at: signedAt ?? new Date().toISOString(),
    signer_ip: signerIp,
  } satisfies SubmitResponse);
}

// ---------- POST /api/application/upload (the browser that submitted) ----------

/**
 * Files added on the page right after signing, before the merchant has an account: bank
 * statements (kind bank_statement, several), and the signed application PDF the page builds from
 * what submit returned (kind funder_application, one per file). Proven by the claim token that
 * browser got back from submit; only while the file has no account yet (afterwards they upload
 * from their account page) and for two days.
 */
export async function uploadToApplication(request: Request): Promise<Response> {
  const nr = notReady();
  if (nr) return nr;
  let buf: Uint8Array<ArrayBuffer> | null;
  try {
    buf = await readCapped(request, MAX_UPLOAD_BYTES + 64 * 1024);
  } catch {
    return json(400, { error: "Send the file as a form." });
  }
  if (!buf) return json(413, { error: "That file is over 20 MB." });
  let form: FormData;
  try {
    form = await new Response(buf, {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    return json(400, { error: "Send the file as a form." });
  }
  const appId = String(form.get("application_id") ?? "");
  const claim = String(form.get("claim_token") ?? "");
  const kind = form.get("kind");
  const file = form.get("file");
  if (
    !UUID.test(appId) ||
    !isToken(claim) ||
    !(file instanceof File) ||
    (kind !== "bank_statement" && kind !== "funder_application")
  )
    return json(400, { error: "Missing the file or the application." });
  const signedPdf = kind === "funder_application";
  if (file.size > (signedPdf ? MAX_SIGNED_PDF_BYTES : MAX_UPLOAD_BYTES))
    return json(413, { error: signedPdf ? "That PDF is too large." : "That file is over 20 MB." });
  const type = uploadType(file);
  if (signedPdf ? type !== "application/pdf" : !UPLOAD_TYPES.includes(type))
    return json(415, { error: "Send a PDF or a photo (JPG, PNG or HEIC)." });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (type === "application/pdf" && !looksLikePdf(bytes))
    return json(415, { error: "That file isn't a PDF we can open. Send a PDF or a photo." });

  const svc = service();
  const app = await svc
    .from("applications")
    .select("id,user_id,claim_token_hash,created_at")
    .eq("id", appId)
    .maybeSingle();
  const a = app.data as {
    id: string;
    user_id: string | null;
    claim_token_hash: string | null;
    created_at: string;
  } | null;
  if (!a || !a.claim_token_hash || !sameSecret(await hashToken(claim), a.claim_token_hash))
    return json(404, { error: "We couldn't find that application." });
  // signed just now from a link made on this file ("Email them to finish it"): the file may be
  // older than two days and already have an account, and the page still adds its statements
  const fromFile = await svc
    .from("application_invites")
    .select("submitted_at")
    .eq("file_id" as never, a.id)
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(1);
  const signedAt = ((fromFile.data ?? [])[0] as { submitted_at: string } | undefined)?.submitted_at;
  const viaFile = !!signedAt && Date.now() - Date.parse(signedAt) <= 48 * 3_600_000;
  if (a.user_id && !viaFile)
    return json(409, { error: "Sign in to your account to add more documents." });
  if (!viaFile && Date.now() - Date.parse(a.created_at) > 48 * 3_600_000)
    return json(410, { error: "Sign in to your account to add documents." });
  const already = "The signed application is already saved.";
  // the signed copy: one per file, however it got there; statements: up to MAX_LINK_UPLOADS
  const count = signedPdf
    ? await svc
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("application_id", appId)
        .eq("kind", "funder_application")
    : await svc
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("application_id", appId)
        .like("storage_path", "link/%")
        .neq("kind", "funder_application");
  if (count.error) return json(500, { error: "Couldn't store the file. Try again." });
  if (signedPdf && (count.count ?? 0) > 0) return json(409, { error: already });
  if (!signedPdf && (count.count ?? 0) >= MAX_LINK_UPLOADS)
    return json(429, {
      error: "That's the most files we take here. Add the rest from your account.",
    });

  // the signed copy's fixed key also stops two copies sent at once (upsert is off)
  const path = signedPdf
    ? `link/${appId}/signed-application.pdf`
    : linkUploadPath(appId, file.name);
  const up = await svc.storage
    .from("documents")
    .upload(path, bytes, { contentType: type, upsert: false });
  if (up.error)
    return signedPdf && isDuplicate(up.error)
      ? json(409, { error: already })
      : json(500, { error: "Couldn't store the file. Try again." });
  const idx = await svc.from("documents").insert({
    application_id: appId,
    user_id: null,
    bucket: "documents",
    storage_path: path,
    kind,
    original_name: signedPdf ? "Signed application.pdf" : file.name.slice(0, 200),
    size_bytes: bytes.length,
    mime_type: type,
  });
  if (idx.error) {
    await svc.storage.from("documents").remove([path]);
    return json(500, { error: "Couldn't store the file. Try again." });
  }
  if (!signedPdf)
    await svc.from("events").insert({
      application_id: appId,
      kind: "document_uploaded",
      body: `Bank statement added from the application link: ${file.name.slice(0, 120)}`,
      visible_to_merchant: true,
    });
  return json(200, { ok: true });
}

// ---------- POST /api/application/notify (once the signed copy and statements are in) ----------

/** "docs_needed" reads "Docs needed". */
const stageText = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " ");

/**
 * The email every signed application sends, Tip Top style: to the rep whose link it came in on,
 * with NEW_APPLICATION_COPY (Asad and Stevie) copied, the details on top, a warning when the tax
 * ID is already in Lamp, and the signed application and bank statements attached. Asked for by
 * the browser that signed (claim token) or the signed-in merchant who owns the file, within two
 * days of signing. The sending is sendNewApplicationNotice, which the finish-reminders job also
 * runs for signed files the browser never asked for.
 */
export async function notifyNewApplication(request: Request): Promise<Response> {
  const nr = notReady();
  if (nr) return nr;
  let body: { application_id?: unknown; claim_token?: unknown; copy_error?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "Missing the application." });
  }
  const appId = String(body.application_id ?? "");
  const claim = typeof body.claim_token === "string" ? body.claim_token : "";
  if (!UUID.test(appId)) return json(400, { error: "Missing the application." });

  const svc = service();
  const app = await svc
    .from("applications")
    .select("id,user_id,claim_token_hash")
    .eq("id", appId)
    .maybeSingle();
  const a = app.data as { user_id: string | null; claim_token_hash: string | null } | null;
  if (!a) return json(404, { error: "We couldn't find that application." });
  let allowed =
    isToken(claim) &&
    !!a.claim_token_hash &&
    sameSecret(await hashToken(claim), a.claim_token_hash);
  if (!allowed && a.user_id) allowed = (await caller(request))?.userId === a.user_id;
  if (!allowed) return json(404, { error: "We couldn't find that application." });

  const r = await sendNewApplicationNotice(svc, appId, {
    signedIn: !!a.user_id && !claim,
    copyError: typeof body.copy_error === "string" ? body.copy_error : "",
  });
  return json(r.status, r.body);
}

/**
 * Sends a signed file's new-file email once, with no check of who asked: the caller has done that
 * (notifyNewApplication) or is the database's own job (finishReminders). Refused before signing
 * and after 48 hours; nothing when it already went or another try is sending it right now
 * (notice-retry.ts). Every try that sends leaves "Emailed ..." or "Couldn't email ..." on the
 * file's timeline, a Google token failure included.
 */
export async function sendNewApplicationNotice(
  svc: Svc,
  appId: string,
  opts: { signedIn?: boolean; copyError?: string; access?: string } = {},
): Promise<{ status: number; body: Record<string, unknown>; outcome: NoticeOutcome }> {
  const [app, det] = await Promise.all([
    svc
      .from("applications")
      .select("id,user_id,claim_token_hash,rep_slug,business_name,utm")
      .eq("id", appId)
      .maybeSingle(),
    svc
      .from("application_details")
      .select("business,owners,request,balances,real_estate,signed_name,signed_at")
      .eq("application_id", appId)
      .maybeSingle(),
  ]);
  const a = app.data as {
    user_id: string | null;
    claim_token_hash: string | null;
    rep_slug: string | null;
    business_name: string | null;
    utm: { source?: string } | null;
  } | null;
  if (!a)
    return {
      status: 404,
      body: { error: "We couldn't find that application." },
      outcome: { kind: "error" },
    };
  const d = det.data as {
    business: Record<string, string> | null;
    owners: Record<string, string>[] | null;
    request: { amount?: string } | null;
    balances: { current?: string; payment?: string }[] | null;
    real_estate: { owns?: string } | null;
    signed_name: string | null;
    signed_at: string | null;
  } | null;
  if (!d?.signed_at)
    return { status: 409, body: { error: "Not signed yet." }, outcome: { kind: "error" } };
  if (Date.now() - Date.parse(d.signed_at) > NOTICE_LIMIT_MS)
    return { status: 410, body: { error: "Too late." }, outcome: { kind: "error" } };

  // The page could not save the signed PDF copy: say so on the timeline, with why, so nobody
  // finds a signed file without its copy and has to guess. Only while the copy really is missing.
  if (opts.copyError?.trim()) {
    const copy = await svc
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("application_id", appId)
      .eq("kind", "funder_application");
    if (!copy.error && (copy.count ?? 0) === 0)
      await svc.from("events").insert({
        application_id: appId,
        kind: "system",
        body: copyMissingNote(opts.copyError.trim()),
      } as never);
  }

  const outcome = await sendNoticeOnce(noticeStore(svc), appId, () =>
    deliverNewApplication(svc, appId, a, d, opts),
  );
  const body: Record<string, unknown> =
    outcome.kind === "sent"
      ? { ok: true, sent: true }
      : outcome.kind === "failed"
        ? { ok: true, sent: false }
        : outcome.kind === "already"
          ? { ok: true, already: true }
          : outcome.kind === "busy"
            ? { ok: true, sending: true }
            : { error: "Try again in a moment." };
  return { status: outcome.kind === "error" ? 503 : 200, body, outcome };
}

/** The file's timeline, as notice-retry.ts reads and claims it. */
export function noticeStore(svc: Svc): SweepStore {
  return {
    async events(appIds) {
      if (!appIds.length) return [];
      const r = await svc
        .from("events")
        .select("id,application_id,created_at,payload")
        .in("application_id", appIds)
        .eq("kind", "system")
        .order("id", { ascending: true })
        .limit(5000);
      if (r.error) return null;
      return ((r.data ?? []) as unknown as NoticeEvent[]).filter((e) => {
        const p = e.payload ?? {};
        return (
          p["notice"] === NOTICE || p["notice_failed"] === NOTICE || p["notice_claim"] === NOTICE
        );
      });
    },
    async claim(appId, attempt) {
      const r = await svc
        .from("events")
        .insert({
          application_id: appId,
          kind: "system",
          body: CLAIM_BODY,
          payload: { notice_claim: NOTICE, attempt },
          visible_to_merchant: false,
        } as never)
        .select("id")
        .single();
      // events_notice_claim_once: another try holds this attempt
      if (r.error?.code === "23505") return "taken";
      const id = (r.data as { id: number } | null)?.id;
      return r.error || typeof id !== "number" ? null : id;
    },
    async finish(id, body, payload) {
      // only while the claim is still open: a claim keeps CLAIM_BODY until its result is written,
      // so a late try and the job's write-off can't overwrite each other's result
      const r = await svc
        .from("events")
        .update({ body, payload: payload as Json } as never)
        .eq("id", id)
        .eq("body", CLAIM_BODY)
        .select("id");
      if (r.error) return null;
      return ((r.data ?? []) as unknown[]).length > 0;
    },
    async record(appId, body, payload) {
      const r = await svc.from("events").insert({
        application_id: appId,
        kind: "system",
        body,
        payload: payload as Json,
        visible_to_merchant: false,
      } as never);
      return !r.error;
    },
    async signed(fromIso, toIso) {
      // newest first, so a busy two days can only push the oldest files (the ones nearest their
      // 48 hour limit) past the read, never one signed an hour ago
      const r = await svc
        .from("application_details")
        .select("application_id,signed_at")
        .gte("signed_at", fromIso)
        .lte("signed_at", toIso)
        .order("signed_at", { ascending: false })
        .limit(SIGNED_READ_LIMIT);
      if (r.error) return null;
      return (r.data ?? []) as unknown as SignedRow[];
    },
    async uploads(appIds, sinceIso) {
      if (!appIds.length) return [];
      const r = await svc
        .from("documents")
        .select("application_id,created_at")
        .in("application_id", appIds)
        .gte("created_at", sinceIso)
        .limit(1000);
      if (r.error) return null;
      return (r.data ?? []) as unknown as UploadRow[];
    },
  };
}

/** Builds the new-file email with its attachments and sends it from the Lamp mailbox. */
async function deliverNewApplication(
  svc: Svc,
  appId: string,
  a: {
    user_id: string | null;
    claim_token_hash: string | null;
    rep_slug: string | null;
    business_name: string | null;
    utm: { source?: string } | null;
  },
  d: {
    business: Record<string, string> | null;
    owners: Record<string, string>[] | null;
    request: { amount?: string } | null;
    balances: { current?: string; payment?: string }[] | null;
    real_estate: { owns?: string } | null;
    signed_name: string | null;
  },
  opts: { signedIn?: boolean; access?: string },
): Promise<Delivery> {
  const business = d.business ?? {};
  const owner = d.owners?.[0] ?? {};

  // the same tax ID on another file
  const duplicates: Duplicate[] = [];
  const variants = einVariants(business["ein"]);
  if (variants.length) {
    const others = await svc
      .from("application_details")
      .select("application_id,signed_at")
      .in("business->>ein", variants)
      .neq("application_id", appId)
      .limit(10);
    const rows = (others.data ?? []) as { application_id: string; signed_at: string | null }[];
    if (rows.length) {
      const files = await svc
        .from("applications")
        .select("id,status,rep_slug,business_name")
        .in(
          "id",
          rows.map((r) => r.application_id),
        );
      const reps = await svc.from("reps").select("slug,name");
      const repName = new Map(
        ((reps.data ?? []) as { slug: string; name: string }[]).map((r) => [r.slug, r.name]),
      );
      for (const f of (files.data ?? []) as {
        id: string;
        status: string;
        rep_slug: string | null;
        business_name: string | null;
      }[]) {
        duplicates.push({
          business: f.business_name ?? "",
          stage: stageText(f.status),
          rep: f.rep_slug ? (repName.get(f.rep_slug) ?? f.rep_slug) : null,
          signedAt: rows.find((r) => r.application_id === f.id)?.signed_at ?? null,
        });
      }
    }
  }

  // the signed copy first, then every statement while they fit in one email
  const docs = await svc
    .from("documents")
    .select("bucket,storage_path,kind,original_name,mime_type,created_at")
    .eq("application_id", appId)
    .in("kind", ["funder_application", "bank_statement"])
    .in("status", ["received", "accepted"])
    .order("created_at", { ascending: true });
  type Doc = {
    bucket: string;
    storage_path: string;
    kind: string;
    original_name: string | null;
    mime_type: string | null;
  };
  const all = (docs.data ?? []) as Doc[];
  const label = (business["legal_name"] || a.business_name || "merchant")
    .replace(/[^\w .&-]+/g, "")
    .trim();
  const attachments: Attachment[] = [];
  let size = 0;
  let statements = 0;
  let leftOff = 0;
  const read = async (x: Doc): Promise<Uint8Array | null> => {
    const r = await svc.storage.from(x.bucket || "documents").download(x.storage_path);
    return r.error || !r.data ? null : new Uint8Array(await r.data.arrayBuffer());
  };
  const signedCopy = [...all].reverse().find((x) => x.kind === "funder_application");
  const pdf = signedCopy ? await read(signedCopy) : null;
  if (pdf) {
    attachments.push({
      name: `Lamp application - ${label || "merchant"}.pdf`,
      mime: "application/pdf",
      bytes: pdf,
    });
    size += pdf.length;
  }
  for (const x of all.filter((y) => y.kind === "bank_statement")) {
    const bytes = await read(x);
    if (!bytes) {
      leftOff++;
      continue;
    }
    if (size + bytes.length > MAX_ATTACHMENT_BYTES) {
      leftOff++;
      continue;
    }
    statements++;
    size += bytes.length;
    attachments.push({
      name: `Bank statement ${statements} - ${x.original_name || "statement"}`,
      mime: x.mime_type || "application/octet-stream",
      bytes,
    });
  }

  const rep = a.rep_slug ? await repBySlug(svc, a.rep_slug).catch(() => null) : null;
  const to = recipients(await emailOf(svc, rep?.user_id ?? null), NEW_APPLICATION_COPY);
  if (!to) return { ok: false, why: "no one to email" };
  const balances = d.balances ?? [];
  // the job has no request to read: a file with an account and no claim token was signed signed in
  const signedIn = opts.signedIn ?? (!!a.user_id && !a.claim_token_hash);
  const m = newApplicationEmail({
    repName: rep?.name ?? null,
    via: signedIn
      ? "their Lamp account"
      : a.utm?.source === "website_application"
        ? "the website's application"
        : "an application link",
    signer: d.signed_name ?? "",
    business,
    owner,
    amount: d.request?.amount ?? null,
    openPositions: balances.filter((x) => x.current?.trim() || x.payment?.trim()).length,
    ownsRealEstate: d.real_estate?.owns === "yes",
    fileUrl: `${SITE_URL()}/staff?file=${appId}`,
    duplicates,
    attached: { application: !!pdf, statements, leftOff },
  });

  const given = opts.access;
  const mailed = await mailNotice(
    () => (given ? Promise.resolve({ access: given }) : gmailAccessToken(svc)),
    (access) =>
      fetch(GMAIL_SEND_URL(), {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          raw: b64url(
            buildMime({
              from: `${fromName("Lamp")} <${MAILBOX()}>`,
              to: to.to,
              cc: to.cc,
              subject: m.subject,
              body: m.text,
              attachments,
            }),
          ),
        }),
      }),
  );
  if (!mailed.ok) return mailed;
  return {
    ok: true,
    body: sentBody([to.to, ...to.cc], duplicates.length),
    payload: {
      to: to.to,
      cc: to.cc,
      attachments: attachments.length,
      duplicates: duplicates.length,
    },
  };
}

// ---------- POST /api/application/finish (the file's rep or an admin) ----------

/**
 * A file that came in through the website's quick questions has no full application. This emails
 * the merchant (from partners@, in the sender's name) their application with what the file
 * already knows filled in; signing it puts the full application on this same file
 * (20261123180000_finish_on_the_file.sql). A link already made from the file goes out again
 * rather than a second one. Asad, 2026-11-23: "make the finish email on a file send the prefilled
 * application". Before that database step is run, or for a file with no rep to send from, it
 * falls back to the earlier email that asks them to finish on their account.
 * Refused when the file already has the full application, has no email, is marked do not
 * contact, or was sent this email in the last day.
 */
export async function finishApplicationNudge(request: Request): Promise<Response> {
  const nr = notReady();
  if (nr) return nr;
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  let body: { application_id?: unknown };
  try {
    body = (await request.json()) as { application_id?: unknown };
  } catch {
    return json(400, { error: "Send JSON." });
  }
  const appId = typeof body.application_id === "string" ? body.application_id : "";
  if (!UUID.test(appId)) return json(400, { error: "application_id is required." });
  if (!(await mayWork(who, appId)))
    return json(403, { error: "Only the file's rep or an admin can send this." });

  const svc = service();
  const [appRow, details, recent] = await Promise.all([
    svc
      .from("applications")
      .select("id,user_id,rep_slug,first_name,business_name,email,phone")
      .eq("id", appId)
      .maybeSingle(),
    svc
      .from("application_details")
      .select("application_id")
      .eq("application_id", appId)
      .maybeSingle(),
    svc
      .from("events")
      .select("id")
      .eq("application_id", appId)
      .eq("kind", "email")
      .like("body", "Asked to finish the full application%")
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString())
      .limit(1),
  ]);
  if (appRow.error || details.error || recent.error) return tryAgain();
  const app = appRow.data as {
    id: string;
    user_id: string | null;
    rep_slug: string | null;
    first_name: string | null;
    business_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  if (!app) return json(404, { error: "We couldn't find that file." });
  if (details.data) return json(409, { error: "This file already has the full application." });
  if ((recent.data ?? []).length) return json(429, { error: "Already sent in the last day." });
  const to = cleanEmail(app.email) || (await emailOf(svc, app.user_id)) || "";
  if (!EMAIL_RE.test(to)) return json(409, { error: "This file has no email address." });
  const dnc = await doNotContact(svc, to, app.phone ?? "");
  if (dnc === null) return tryAgain();
  if (dnc) return json(409, { error: "Marked do not contact." });

  // who it's from: the file's rep (in their admin's name when they report to one), else the sender
  const mine = await who.client.rpc("current_rep_slug");
  const slug = app.rep_slug ?? ((mine.data as string | null) || null);
  const rep = slug ? await repBySlug(svc, slug).catch(() => undefined) : null;
  if (rep === undefined) return tryAgain();
  const name = rep ? facing(rep).name : "The Lamp team";
  // the application for this file: the link already made from it, else a new one filled in from
  // the file. Null when it can't be made (no rep to send from, or the database step isn't run).
  const link = rep ? await fileApplicationLink(svc, rep, app, to, who.userId) : null;
  if (!link && !app.user_id)
    return json(409, {
      error:
        "This merchant has no account yet, so send the application from Staff > Applications instead.",
    });
  const access = await gmailAccessToken(svc).catch(() => ({ error: "Couldn't reach Google." }));
  if ("error" in access) return json(412, { error: access.error });
  const mail = link
    ? inviteEmail({
        firstName: app.first_name ?? "",
        businessName: app.business_name ?? "",
        repName: name,
        repPhone: rep?.phone ?? null,
        note: "",
        url: link.url,
        legalName: SITE.legalName,
        address: SITE.address,
      })
    : finishEmail({
        firstName: app.first_name ?? "",
        businessName: app.business_name ?? "",
        repName: name,
        repPhone: rep?.phone ?? null,
        site: SITE_URL(),
        legalName: SITE.legalName,
        address: SITE.address,
      });
  const sent = await gmailSend(access.access, {
    cc: await ccFor(svc, rep),
    to,
    fromName: `${name} at Lamp`,
    replyTo: rep ? await replyToFor(svc, rep, who.userId) : await emailOf(svc, who.userId),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  if ("error" in sent) return json(502, { error: `Didn't send: ${sent.error}` });
  await svc.from("events").insert({
    application_id: app.id,
    actor_user_id: who.userId,
    kind: "email",
    body: `Asked to finish the full application (emailed ${to})`,
    payload: { message_id: sent.id, ...(link ? { invite_id: link.id } : {}) },
  } as never);
  if (link)
    await svc
      .from("application_invites")
      .update({ email_message_id: sent.id, sent_at: new Date().toISOString(), channel: "email" })
      .eq("id", link.id);
  return json(200, { ok: true, to });
}

/**
 * The application link for a file: the open one already made from it, else a new one that opens
 * with what the file knows (business name, first name, phone, email, what the money is for).
 * Null when it can't be made: the reminders' secret or the file_id column isn't there yet.
 */
async function fileApplicationLink(
  svc: Svc,
  rep: Rep,
  app: {
    id: string;
    first_name: string | null;
    business_name: string | null;
    email: string | null;
    phone: string | null;
  },
  to: string,
  senderId: string,
): Promise<{ id: string; url: string } | null> {
  const open = await svc
    .from("application_invites")
    .select("id,token_hash")
    .eq("file_id" as never, app.id)
    .is("submitted_at", null)
    .is("cancelled_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("sent_at", { ascending: false })
    .limit(1);
  if (open.error) return null; // the column isn't there yet
  const had = (open.data ?? [])[0] as { id: string; token_hash: string } | undefined;
  if (had) {
    const url = await sameLink(svc, rep.slug, had);
    return url ? { id: had.id, url } : null;
  }
  const answers = await svc.from("applications").select("answers").eq("id", app.id).maybeSingle();
  const purpose = (answers.data as { answers: { purpose?: string } | null } | null)?.answers
    ?.purpose;
  const draft = safeDraft(
    prefill({
      business_name: app.business_name,
      first_name: app.first_name,
      phone: app.phone,
      email: to,
      purpose: purpose ?? null,
    }),
  );
  const token = newToken();
  const now = new Date().toISOString();
  const ins = await svc
    .from("application_invites")
    .insert({
      token_hash: await hashToken(token),
      rep_slug: rep.slug,
      sent_by: senderId,
      first_name: app.first_name?.trim().slice(0, 80) || null,
      business_name: app.business_name?.trim().slice(0, 160) || null,
      email: to,
      phone: app.phone?.trim().slice(0, 40) || null,
      channel: "email",
      expires_at: days(linkDays("apply")),
      draft: draft as Json,
      draft_step: 0,
      draft_saved_at: now,
      file_id: app.id,
    } as never)
    .select("id")
    .single();
  if (ins.error || !ins.data) return null;
  return {
    id: (ins.data as { id: string }).id,
    url: applicationUrl(SITE_URL(), rep.slug, token),
  };
}
