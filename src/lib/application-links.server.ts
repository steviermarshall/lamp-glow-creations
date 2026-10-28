// Server side of application links (see application-links.ts and the migration
// 20261027120000_application_links.sql). Runs in the site's own server routes with the service
// role, like funder sending, and sends email through the same Gmail mailbox (partners@getlamp.app),
// with the rep's name on it and replies going to the rep.
//
// Never import this file from browser code: the route files load it inside their handlers.
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
  missing,
  signatureMatches,
} from "@/lib/application-details";
import {
  applicationUrl,
  buildAltMime,
  cleanEmail,
  EMAIL_RE,
  fromName,
  hashToken,
  inviteEmail,
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
import { recordSigned } from "@/lib/tracking.server";
import {
  einVariants,
  newApplicationEmail,
  recipients,
  type Duplicate,
} from "@/lib/new-application-email";

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

type Rep = {
  slug: string;
  name: string;
  title: string | null;
  user_id: string | null;
  active: boolean;
  admin_slug: string | null;
  /** The admin this rep reports to, when that admin is active: the name merchants see. */
  lead: { name: string; title: string | null; user_id: string | null } | null;
};

/** The rep, or null when there's none. Throws when the lookup itself failed. */
async function repBySlug(svc: Svc, slug: string): Promise<Rep | null> {
  const r = await svc
    .from("reps")
    .select("slug,name,title,user_id,active,admin_slug")
    .eq("slug", slug)
    .maybeSingle();
  if (r.error) throw r.error;
  const rep = r.data as Omit<Rep, "lead"> | null;
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
 * Who merchants see: the admin a rep reports to, or the rep themselves. Application emails,
 * the application page and the signed PDF's "Lamp rep" box use this name; the file itself
 * still lands with the rep who sent it.
 */
const facing = (r: Rep) => r.lead ?? { name: r.name, title: r.title, user_id: r.user_id };

/** Replies go to the admin and the rep, so either can answer; else to whoever sent it. */
async function replyToFor(svc: Svc, rep: Rep, senderId: string): Promise<string | null> {
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
async function staffEmails(svc: Svc): Promise<Set<string>> {
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

const isLampAddress = (email: string, staff: Set<string>) =>
  staff.has(email) || email.endsWith("@getlamp.app");

/**
 * Whether a lead with this email or phone is marked do not contact, on any rep's list. Null when
 * the list couldn't be read: callers refuse rather than guess.
 */
async function doNotContact(svc: Svc, email: string, phone: string): Promise<boolean | null> {
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
    if (!inv) return json(404, { error: "That link isn't one of yours." });
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
    const rep = await repBySlug(svc, inv.rep_slug).catch(() => undefined);
    if (rep === undefined) return tryAgain();
    if (!rep) return json(409, { error: "That rep is gone." });
    const token = newToken();
    const note = typeof body.note === "string" ? body.note.slice(0, MAX_NOTE) : (inv.note ?? "");
    const upd = await svc
      .from("application_invites")
      .update({
        token_hash: await hashToken(token),
        channel,
        note: note || null,
        sent_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        cancelled_at: null,
        last_error: null,
        sent_by: who.userId,
      })
      .eq("id", inv.id)
      .is("submitted_at", null)
      .select("id");
    if (upd.error) return json(500, { error: "Couldn't make a new link." });
    if (!upd.data?.length) return json(409, { error: SIGNED });
    const url = applicationUrl(SITE_URL(), rep.slug, token);
    if (channel === "link") {
      return json(200, {
        results: [
          {
            index: 0,
            status: "link",
            detail: "New link made; the old one stopped working.",
            invite_id: inv.id,
            url,
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
      note,
      url,
      legalName: SITE.legalName,
      address: SITE.address,
    });
    const sent = await gmailSend(access.access, {
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
      .select("id,name,phone,email,status")
      .in("id", leadIds);
    for (const l of (r.data ?? []) as {
      id: number;
      name: string | null;
      phone: string | null;
      email: string | null;
      status: string;
    }[])
      leads.set(l.id, l);
  }

  const note = typeof body.note === "string" ? body.note.slice(0, MAX_NOTE) : "";
  const staff = await staffEmails(svc);
  const replyTo = await replyToFor(svc, rep, who.userId);
  let access: { access: string } | { error: string } | null = null;
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const results: SendResult[] = [];

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

    const token = newToken();
    const ins = await svc
      .from("application_invites")
      .insert({
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
      })
      .select("id")
      .single();
    if (ins.error || !ins.data) {
      results.push({ index, status: "failed", detail: "Couldn't record the link." });
      continue;
    }
    const inviteId = (ins.data as { id: string }).id;
    const url = applicationUrl(SITE_URL(), rep.slug, token);

    if (channel === "link") {
      results.push({
        index,
        status: "link",
        detail: "Link ready to copy.",
        invite_id: inviteId,
        url,
      });
      continue;
    }

    access ??= await gmailAccessToken(svc).catch(() => ({ error: "Couldn't reach Google." }));
    if ("error" in access) {
      await svc
        .from("application_invites")
        .update({ last_error: access.error, cancelled_at: new Date().toISOString() })
        .eq("id", inviteId);
      results.push({ index, status: "failed", detail: access.error, invite_id: inviteId });
      continue;
    }
    const mail = inviteEmail({
      firstName,
      businessName: business,
      repName: facing(rep).name,
      note,
      url,
      legalName: SITE.legalName,
      address: SITE.address,
    });
    const sent = await gmailSend(access.access, {
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
        .update({ last_error: sent.error, cancelled_at: new Date().toISOString() })
        .eq("id", inviteId);
      results.push({ index, status: "failed", detail: sent.error, invite_id: inviteId });
      continue;
    }
    await svc.from("application_invites").update({ email_message_id: sent.id }).eq("id", inviteId);
    // keep the address on the lead for next time (the engine's own columns: service role only)
    if (lead && !lead.email) await svc.from("engine_leads").update({ email }).eq("id", lead.id);
    results.push({ index, status: "sent", detail: `Emailed ${email}`, invite_id: inviteId });
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
};

/** The invite, or null when the token matches none. Throws when the lookup itself failed. */
async function inviteByToken(svc: Svc, token: string): Promise<InviteRow | null> {
  const r = await svc
    .from("application_invites")
    .select(
      "id,rep_slug,first_name,last_name,business_name,email,phone,opened_at,started_at,submitted_at,cancelled_at,expires_at",
    )
    .eq("token_hash", await hashToken(token))
    .maybeSingle();
  if (r.error) throw r.error;
  return (r.data as InviteRow | null) ?? null;
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
    if (body.event === "start" && !inv.started_at) {
      await svc
        .from("application_invites")
        .update({ started_at: now, opened_at: inv.opened_at ?? now })
        .eq("id", inv.id);
    } else if (!inv.opened_at) {
      await svc.from("application_invites").update({ opened_at: now }).eq("id", inv.id);
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
    } satisfies OpenResponse);
  }

  const slug = typeof body.rep === "string" ? body.rep.toLowerCase() : "";
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

// ---------- POST /api/application/submit (anyone with the link) ----------

type SubmitBody = {
  token?: unknown;
  rep?: unknown;
  details?: unknown;
  signature?: { name?: unknown; image?: unknown; name2?: unknown; image2?: unknown };
  consent_version?: unknown;
  /** "pdf": signed on the one-page paper form, which asks only whether they own real estate */
  form?: unknown;
  /** honeypot: a field people never see */
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
  if (body.company_fax) return json(400, { error: "Couldn't submit." });
  if (body.consent_version !== CONSENT_VERSION)
    return json(409, { error: "The application was updated. Refresh the page and sign again." });

  const token = body.token == null ? null : body.token;
  if (token !== null && !isToken(token)) return json(404, { error: ERR["link_not_found"]![1] });
  const rep = typeof body.rep === "string" ? body.rep.toLowerCase() : "";
  if (token === null && !SLUG.test(rep)) return json(404, { error: ERR["unknown_rep"]![1] });

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
  const res = await svc.rpc("submit_link_application", {
    _token_hash: token ? await hashToken(token) : null,
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
  if (a.user_id) return json(409, { error: "Sign in to your account to add more documents." });
  if (Date.now() - Date.parse(a.created_at) > 48 * 3_600_000)
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

const NOTICE = "new_application";
/** "docs_needed" reads "Docs needed". */
const stageText = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " ");

/**
 * The email every signed application sends, Tip Top style: to the rep whose link it came in on,
 * with NEW_APPLICATION_COPY (Asad and Stevie) copied, the details on top, a warning when the tax
 * ID is already in Lamp, and the signed application and bank statements attached. Asked for by
 * the browser that signed (claim token) or the signed-in merchant who owns the file, within two
 * days of signing, and sent once per file.
 */
export async function notifyNewApplication(request: Request): Promise<Response> {
  const nr = notReady();
  if (nr) return nr;
  let body: { application_id?: unknown; claim_token?: unknown };
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
    .select("id,user_id,claim_token_hash,rep_slug,business_name")
    .eq("id", appId)
    .maybeSingle();
  const a = app.data as {
    user_id: string | null;
    claim_token_hash: string | null;
    rep_slug: string | null;
    business_name: string | null;
  } | null;
  if (!a) return json(404, { error: "We couldn't find that application." });
  let allowed =
    isToken(claim) &&
    !!a.claim_token_hash &&
    sameSecret(await hashToken(claim), a.claim_token_hash);
  if (!allowed && a.user_id) allowed = (await caller(request))?.userId === a.user_id;
  if (!allowed) return json(404, { error: "We couldn't find that application." });

  const det = await svc
    .from("application_details")
    .select("business,owners,request,balances,real_estate,signed_name,signed_at")
    .eq("application_id", appId)
    .maybeSingle();
  const d = det.data as {
    business: Record<string, string> | null;
    owners: Record<string, string>[] | null;
    request: { amount?: string } | null;
    balances: { current?: string; payment?: string }[] | null;
    real_estate: { owns?: string } | null;
    signed_name: string | null;
    signed_at: string | null;
  } | null;
  if (!d?.signed_at) return json(409, { error: "Not signed yet." });
  if (Date.now() - Date.parse(d.signed_at) > 48 * 3_600_000)
    return json(410, { error: "Too late." });

  const already = await svc
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("application_id", appId)
    .contains("payload", { notice: NOTICE });
  if ((already.count ?? 0) > 0) return json(200, { ok: true, already: true });

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
  if (!to) return json(200, { ok: true, sent: false });
  const balances = d.balances ?? [];
  const m = newApplicationEmail({
    repName: rep?.name ?? null,
    via: a.user_id && !claim ? "their Lamp account" : "an application link",
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

  const access = await gmailAccessToken(svc);
  let sentOk = false;
  let why = "";
  if ("error" in access) why = access.error;
  else {
    try {
      const raw = buildMime({
        from: `${fromName("Lamp")} <${MAILBOX()}>`,
        to: to.to,
        cc: to.cc,
        subject: m.subject,
        body: m.text,
        attachments,
      });
      const res = await fetch(GMAIL_SEND_URL(), {
        method: "POST",
        headers: { Authorization: `Bearer ${access.access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: b64url(raw) }),
      });
      sentOk = res.ok;
      if (!res.ok) why = `Gmail ${res.status}`;
    } catch {
      why = "couldn't reach Gmail";
    }
  }
  await svc.from("events").insert({
    application_id: appId,
    kind: "system",
    body: sentOk
      ? `Emailed the signed application to ${[to.to, ...to.cc].join(", ")}${duplicates.length ? " (tax ID already in Lamp)" : ""}.`
      : `Couldn't email the signed application (${why}).`,
    payload: sentOk
      ? {
          notice: NOTICE,
          to: to.to,
          cc: to.cc,
          attachments: attachments.length,
          duplicates: duplicates.length,
        }
      : { notice_failed: NOTICE, error: why },
    visible_to_merchant: false,
  });
  return json(200, { ok: true, sent: sentOk });
}
