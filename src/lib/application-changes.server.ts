// Server side of "Send back for changes" (see application-changes.ts and the migration
// 20261028120000_send_back_for_changes.sql). Staff actions arrive on /api/application-invites;
// the merchant's update page and account page use /api/application/changes. Emails go out from
// Lamp's mailbox (partners@getlamp.app) as the rep, like application links.
//
// Never import this file from browser code: the route files load it inside their handlers.
import { caller, gmailAccessToken, json, service, SITE_URL } from "@/lib/funder-send.server";
import {
  clientIp,
  doNotContact,
  emailOf,
  gmailSend,
  isLampAddress,
  notReady,
  PNG,
  readJson,
  staffEmails,
  tryAgain,
  UUID,
  type Svc,
} from "@/lib/application-links.server";
import {
  CONSENT_TEXT,
  CONSENT_VERSION,
  cleanDetails,
  fromRow,
  maskSsn,
  missing,
  MASKED_DOB,
  signatureMatches,
  type Details,
} from "@/lib/application-details";
import { cleanEmail, EMAIL_RE, hashToken, isToken, newToken } from "@/lib/application-links";
import {
  changesEmail,
  changesUrl,
  MAX_MESSAGE,
  sensitiveText,
  signedAgainEmail,
  validateItems,
  type ChangeItem,
  type ChangesOpenResponse,
  type ChangesSubmitBody,
  type ChangesSubmitResponse,
  type SendBackRequest,
  type SendBackResult,
} from "@/lib/application-changes";
import { diffDetails, matchItems } from "@/lib/application-diff";
import { SITE } from "@/lib/site";

/** Two drawn signatures (400 KB each at most) and the answers. */
const MAX_SUBMIT_BYTES = 2 * 1024 * 1024;
const MAX_STAFF_BYTES = 16 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Who = NonNullable<Awaited<ReturnType<typeof caller>>>;

/** What the database's refusals mean, for staff. */
const STAFF_ERR: Record<string, [number, string]> = {
  not_allowed: [403, "Only an admin or this file's rep can send it back."],
  file_not_found: [404, "That file isn't there anymore."],
  unassigned: [409, "Assign the file to a rep first: the update goes out from their name."],
  file_closed: [409, "This file is funded, withdrawn or closed."],
  "bad_request: items": [422, "Check what you ticked: each item needs a few words and no SSNs."],
  "bad_request: message": [422, "Leave SSNs out of the message (1,000 characters at most)."],
  "bad_request: empty": [422, "Tick what's missing or write a message."],
  not_signed: [409, "The merchant hasn't signed the application yet. Nothing to send back."],
  already_open: [409, "It's already sent back. Email it again or cancel it on the file."],
  too_many: [429, "That's three send-backs on this file today. Call the merchant instead."],
  not_open: [409, "That request is closed."],
  too_many_sends: [429, "It's been emailed five times. Call the merchant instead."],
  too_soon: [429, "It went out less than 10 minutes ago. Give it a few minutes."],
  no_email: [409, "The signed application has no email address to send the update link to."],
  lamp_address: [
    409,
    "The email on the application is a Lamp address, so no update link goes to it.",
  ],
  unreviewed: [409, "Review the merchant's last update first (Mark reviewed), then send it back."],
};

const dbError = (
  e: { message?: string; code?: string } | null,
  map: Record<string, [number, string]>,
) => {
  const known = map[e?.message ?? ""];
  if (known) return json(known[0], { error: known[1], code: e?.message });
  if (e?.code === "42501") return json(403, { error: "You don't have access to this file." });
  return json(500, { error: "Something went wrong. Try again." });
};

type FileRow = {
  id: string;
  user_id: string | null;
  claim_email: string | null;
  phone: string | null;
  status: string;
  rep_slug: string | null;
};

async function fileOf(svc: Svc, id: string): Promise<FileRow | null | undefined> {
  const r = await svc
    .from("applications")
    .select("id,user_id,claim_email,phone,status,rep_slug")
    .eq("id", id)
    .maybeSingle();
  if (r.error) return undefined;
  return (r.data as FileRow | null) ?? null;
}

type Issued = {
  channel: "email" | "account";
  email: string | null;
  invite_id: string | null;
  first_name: string | null;
  business_name: string | null;
  rep_slug: string;
  rep_name: string | null;
  rep_user_id: string | null;
  stage: string;
};

/**
 * Issues (or reissues) the request's link through the database, then emails it. For a file with
 * no account: a new update link (the token goes only into the email). For a file in an account:
 * a note to sign in. Returns what the staff screen shows.
 */
async function deliver(
  svc: Svc,
  who: Who,
  file: { id: string; claimed: boolean },
  requestId: string,
  ask: { items: ChangeItem[]; message: string | null },
): Promise<Response> {
  const claimed = file.claimed;
  // Google first: a mailbox that can't send must not rotate the link or use up a send
  const access = await gmailAccessToken(svc).catch(() => ({ error: "Couldn't reach Google." }));
  if ("error" in access) return json(412, { error: access.error });
  const token = claimed ? null : newToken();
  const issued = await svc.rpc("issue_change_link", {
    _request_id: requestId,
    _token_hash: token ? await hashToken(token) : null,
    _actor: who.userId,
  });
  if (issued.error) return dbError(issued.error, STAFF_ERR);
  const x = issued.data as unknown as Issued;
  const to = cleanEmail(x.email);
  const result = (status: SendBackResult["status"], detail: string) =>
    json(200, { request_id: requestId, status, detail } satisfies SendBackResult);
  if (!to) return result("failed", "There's no email address to send it to. Call the merchant.");

  const repName = x.rep_name ?? "Your Lamp rep";
  const mode = x.channel === "account" ? "account" : "link";
  const url =
    mode === "link" && token ? changesUrl(SITE_URL(), x.rep_slug, token) : `${SITE_URL()}/account`;
  const fail = async (why: string) => {
    if (x.invite_id)
      await svc
        .from("application_invites")
        .update({ last_error: why, cancelled_at: new Date().toISOString() })
        .eq("id", x.invite_id);
    await svc.from("events").insert({
      application_id: file.id,
      actor_user_id: who.userId,
      kind: "system",
      body: `Update email to ${to} failed: ${why}`,
    } as never);
    return result(
      "failed",
      `Email failed: ${why}. The request is still open: press Email again, or cancel it.`,
    );
  };
  const mail = changesEmail({
    firstName: x.first_name ?? "",
    businessName: x.business_name ?? "",
    repName,
    stage: x.stage,
    message: ask.message,
    items: ask.items,
    url,
    mode,
    legalName: SITE.legalName,
    address: SITE.address,
  });
  const replyTo = (await emailOf(svc, x.rep_user_id)) ?? (await emailOf(svc, who.userId));
  const sent = await gmailSend(access.access, {
    to,
    fromName: `${repName} at Lamp`,
    replyTo,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  if ("error" in sent) return fail(sent.error);
  // "Email again" counts its 10 minutes from a sent email, not a failed one
  if (mode === "account") await svc.rpc("change_notice_sent", { _request_id: requestId });
  if (x.invite_id)
    await svc
      .from("application_invites")
      .update({ email_message_id: sent.id })
      .eq("id", x.invite_id);
  await svc.from("events").insert({
    application_id: file.id,
    actor_user_id: who.userId,
    kind: "email",
    body:
      mode === "link"
        ? `Update link emailed to ${to}`
        : `Update request emailed to ${to} (they sign in to update)`,
  } as never);
  return result(mode === "link" ? "sent" : "account", `Emailed ${to}`);
}

/**
 * Staff: send a signed file back for changes, email it again, or cancel it. The database decides
 * who may (an admin or the file's rep), through the caller's own client.
 */
export async function sendBack(
  ctx: { who: Who; svc: Svc },
  body: SendBackRequest,
): Promise<Response> {
  const { who, svc } = ctx;
  if (JSON.stringify(body).length > MAX_STAFF_BYTES)
    return json(413, { error: "That's too long." });

  if (body.action === "cancel_send_back") {
    if (!UUID.test(body.request_id ?? "")) return json(400, { error: "request_id is required." });
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    const r = await who.client.rpc("cancel_change_request", {
      _request_id: body.request_id,
      _reason: reason || null,
    });
    if (r.error) return dbError(r.error, STAFF_ERR);
    return json(200, {
      request_id: body.request_id,
      status: "cancelled",
      detail: "Request cancelled. The application they signed stands.",
    } satisfies SendBackResult);
  }

  if (body.action === "send_back_again") {
    if (!UUID.test(body.request_id ?? "")) return json(400, { error: "request_id is required." });
    // the caller's own client: a rep only finds requests on their own files
    const found = await who.client
      .from("application_change_requests")
      .select("id,application_id,status,items,message")
      .eq("id", body.request_id)
      .maybeSingle();
    const r = found.data as {
      id: string;
      application_id: string;
      status: string;
      items: ChangeItem[];
      message: string | null;
    } | null;
    if (found.error) return tryAgain();
    if (!r) return json(404, { error: "That request isn't on one of your files." });
    if (r.status !== "open") return json(409, { error: STAFF_ERR["not_open"]![1] });
    const file = await fileOf(svc, r.application_id);
    if (file === undefined) return tryAgain();
    if (!file) return json(404, { error: STAFF_ERR["file_not_found"]![1] });
    const to = file.user_id ? await emailOf(svc, file.user_id) : cleanEmail(file.claim_email);
    const dnc = await doNotContact(svc, to ?? "", file.phone ?? "");
    if (dnc === null)
      return json(503, { error: "Couldn't check the do-not-contact list. Try again." });
    if (dnc) return json(409, { error: "Marked do not contact. Call them instead." });
    return deliver(svc, who, { id: file.id, claimed: !!file.user_id }, r.id, {
      items: r.items ?? [],
      message: r.message,
    });
  }

  // send_back
  if (!UUID.test(body.application_id ?? ""))
    return json(400, { error: "application_id is required." });
  const checked = validateItems(body.items ?? []);
  if (!checked.ok) return json(422, { error: checked.error });
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length > MAX_MESSAGE)
    return json(422, { error: "Keep the message under 1,000 characters." });
  if (sensitiveText(message)) return json(422, { error: "Leave SSNs out of the message." });
  if (!checked.items.length && !message)
    return json(422, { error: "Tick what's missing or write a message." });

  // only an admin or the file's rep: asked through the caller's own client, before anything else
  const allowed = await who.client.rpc("can_see_application_details", {
    _application_id: body.application_id,
  });
  if (allowed.error) return tryAgain();
  if (allowed.data !== true) return json(403, { error: STAFF_ERR["not_allowed"]![1] });
  const file = await fileOf(svc, body.application_id);
  if (file === undefined) return tryAgain();
  if (!file) return json(404, { error: STAFF_ERR["file_not_found"]![1] });
  // who it goes to, checked before anything is recorded (the database checks it again)
  const to = file.user_id ? await emailOf(svc, file.user_id) : cleanEmail(file.claim_email);
  if (!to || !EMAIL_RE.test(to)) return json(409, { error: STAFF_ERR["no_email"]![1] });
  if (!file.user_id && isLampAddress(to, await staffEmails(svc)))
    return json(409, { error: STAFF_ERR["lamp_address"]![1] });
  const dnc = await doNotContact(svc, to, file.phone ?? "");
  if (dnc === null)
    return json(503, { error: "Couldn't check the do-not-contact list. Try again." });
  if (dnc) return json(409, { error: "Marked do not contact. Call them instead." });
  const access = await gmailAccessToken(svc).catch(() => ({ error: "Couldn't reach Google." }));
  if ("error" in access) return json(412, { error: access.error });

  const made = await who.client.rpc("request_changes", {
    _application_id: body.application_id,
    _items: checked.items,
    _message: message || null,
  });
  if (made.error) return dbError(made.error, STAFF_ERR);
  const out = made.data as unknown as { request_id: string; claimed: boolean };
  return deliver(svc, who, { id: file.id, claimed: out.claimed }, out.request_id, {
    items: checked.items,
    message: message || null,
  });
}

// ---------- POST /api/application/changes (the merchant) ----------

/** What the database's refusals mean, for the merchant. */
const CHG_ERR: Record<string, [number, string]> = {
  link_not_found: [404, "This link doesn't work. Ask your rep for a new one."],
  link_cancelled: [410, "This link was stopped. Ask your rep for a new one."],
  link_expired: [410, "This link has expired. Ask your rep for a new one."],
  locked: [423, "This link is locked after too many tries. Ask your rep for a new one."],
  request_cancelled: [
    410,
    "Your rep no longer needs this update. Your application stands as you signed it.",
  ],
  already_signed: [409, "You already signed this update. Your rep has it."],
  sign_in: [409, "Your application is in your Lamp account now. Sign in to update it."],
  file_closed: [409, "This application is closed. Call your rep if something needs to change."],
  stale: [
    409,
    "Your application changed since this page opened. Reload it and check your answers.",
  ],
  not_yours: [403, "This application isn't in your account."],
  too_many: [
    429,
    "We're getting a lot of signatures from here right now. Try again in an hour or call your rep.",
  ],
  "bad_request: masked value": [422, "Enter the full SSN and date of birth."],
  "bad_request: signature": [422, "Draw your signature in the box."],
};

/**
 * The update page and the account page. "open" (update links only) checks the link and, with the
 * date of birth, returns the answers to update. "submit" signs the update, from a link (token and
 * date of birth) or from the merchant's account (signed in, with the request id).
 */
export async function changeApplication(request: Request): Promise<Response> {
  const nr = notReady();
  if (nr) return nr;
  const body = await readJson<
    Omit<Partial<ChangesSubmitBody>, "action"> & { action?: unknown; event?: unknown }
  >(request, MAX_SUBMIT_BYTES);
  if (body instanceof Response) return body;
  const svc = service();

  if (body.action === "open") {
    const none = (state: ChangesOpenResponse["state"]) =>
      json(200, { state } satisfies ChangesOpenResponse);
    if (!isToken(body.token)) return none("not_found");
    const dob = typeof body.dob === "string" ? body.dob : null;
    // a malformed date never reaches the database, so it costs no try
    if (dob !== null && (!DATE.test(dob) || Number.isNaN(Date.parse(dob))))
      return json(200, { state: "verify", wrong: true } satisfies ChangesOpenResponse);
    const r = await svc.rpc("open_change_link", {
      _token_hash: await hashToken(body.token),
      _dob: dob,
      _event: body.event === "start" ? "start" : null,
    });
    if (r.error) return tryAgain();
    return json(200, r.data as unknown as ChangesOpenResponse);
  }

  if (body.action !== "submit") return json(400, { error: "Unknown action." });
  if (body.company_fax) return json(400, { error: "Couldn't submit." });
  if (body.consent_version !== CONSENT_VERSION)
    return json(409, { error: "The application was updated. Reload the page and sign again." });

  const d = cleanDetails(fromRow((body.details ?? {}) as Record<string, unknown>));
  const todo = missing(d);
  if (todo.length) return json(422, { error: "Some answers are missing.", missing: todo });
  const owner = d.owners[0]!;
  const sig = body.signature ?? ({} as NonNullable<ChangesSubmitBody["signature"]>);
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
  const baseVersion = Number(body.base_version);
  if (!Number.isInteger(baseVersion) || baseVersion < 1)
    return json(400, { error: "Reload the page." });

  // which way they came: an update link, or their signed-in account
  let token: string | null = null;
  let dob: string | null = null;
  let userId: string | null = null;
  let requestId: string | null = null;
  if (body.token != null) {
    if (!isToken(body.token)) return json(404, { error: CHG_ERR["link_not_found"]![1] });
    token = body.token;
    dob = typeof body.dob === "string" && DATE.test(body.dob) ? body.dob : "";
  } else {
    const who = await caller(request);
    if (!who) return json(401, { error: "Sign in again to sign your update." });
    if (!UUID.test(body.request_id ?? "")) return json(400, { error: "Reload the page." });
    userId = who.userId;
    requestId = body.request_id!;
  }

  const res = await svc.rpc("resubmit_change_request", {
    _token_hash: token ? await hashToken(token) : null,
    _dob: dob,
    _user_id: userId,
    _request_id: requestId,
    _base_version: baseVersion,
    _details: d,
    _signed_name: name,
    _signature_image: image,
    _signed_name_2: name2,
    _signature_image_2: image2,
    _consent_text: CONSENT_TEXT,
    _consent_version: CONSENT_VERSION,
    _signer_agent: (request.headers.get("user-agent") ?? "").slice(0, 300),
    _signer_ip: clientIp(request),
  });
  if (res.error) {
    if (res.error.message === "kept_value") {
      // every on-file value that can't be kept, e.g. "owners.0.ssn,owners.0.dob"
      const fields = (res.error.details ?? "")
        .split(",")
        .filter((f) => /^owners\.[01]\.(ssn|dob)$/.test(f));
      const names = fields.map((f) => {
        const [, i, what] = f.split(".");
        return `${i === "1" ? "the second owner's" : "your"} ${what === "dob" ? "date of birth" : "SSN"}`;
      });
      const list =
        names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
      return json(422, {
        error: `Type ${list ?? "the SSN and date of birth"} again: a name changed, so what's on file can't be used.`,
        code: "kept_value",
        fields,
      });
    }
    const known = CHG_ERR[res.error.message];
    if (known) return json(known[0], { error: known[1], code: res.error.message });
    return json(500, { error: "Couldn't sign the update. Try again, or call your rep." });
  }
  const out = res.data as unknown as
    | { error: "wrong_dob" | "locked"; tries_left?: number }
    | {
        application_id: string;
        request_id: string;
        version: number;
        version_id: string;
        base_version_id: string;
        signed_at: string;
        signer_ip: string | null;
        rep_slug: string;
        merchant_email: string | null;
        secret_changes: { ssn: boolean; dob: boolean; added: boolean }[];
      };
  if ("error" in out) {
    if (out.error === "locked") return json(423, { error: CHG_ERR["locked"]![1], code: "locked" });
    const left = out.tries_left ?? 0;
    return json(403, {
      error: `That date of birth doesn't match your application. ${left} ${left === 1 ? "try" : "tries"} left.`,
      code: "wrong_dob",
      tries_left: left,
    });
  }

  // tell the rep (best effort): counts only, never values
  let repName = "";
  try {
    const [rep, versions, req] = await Promise.all([
      svc.from("reps").select("name,user_id").eq("slug", out.rep_slug).maybeSingle(),
      svc
        .from("application_versions")
        .select("id,business,owners,balances,request,real_estate")
        .in("id", [out.base_version_id, out.version_id]),
      svc
        .from("application_change_requests")
        .select("items")
        .eq("id", out.request_id)
        .maybeSingle(),
    ]);
    const r = rep.data as { name: string; user_id: string | null } | null;
    repName = r?.name ?? "";
    type V = {
      id: string;
      business: unknown;
      owners: unknown;
      balances: unknown;
      request: unknown;
      real_estate: unknown;
    };
    const rows = (versions.data ?? []) as V[];
    const before = rows.find((x) => x.id === out.base_version_id);
    const after = rows.find((x) => x.id === out.version_id);
    const to = await emailOf(svc, r?.user_id ?? null);
    if (r && to && before && after) {
      const changes = diffDetails(
        maskedForStaff(fromRow(before)),
        maskedForStaff(fromRow(after)),
        out.secret_changes,
      );
      const items = ((req.data as { items?: ChangeItem[] } | null)?.items ?? []) as ChangeItem[];
      const m = matchItems(items, changes);
      const access = await gmailAccessToken(svc);
      if (!("error" in access)) {
        const msg = signedAgainEmail({
          repName: r.name,
          signer: name,
          businessName: d.business.legal_name,
          version: out.version,
          // asks that nothing here can check ("something else") aren't counted either way
          asked: m.asked.filter((a) => !a.byHand).length,
          answered: m.asked.filter((a) => a.changes.length > 0).length,
          changed: changes.length,
          identity: changes.some((c) => c.flag || c.secret),
          fileUrl: `${SITE_URL()}/staff?file=${out.application_id}`,
        });
        await gmailSend(access.access, {
          to,
          fromName: "Lamp",
          replyTo: null,
          subject: msg.subject,
          text: msg.text,
        });
      }
    }
  } catch {
    /* the file shows the update either way */
  }

  return json(200, {
    application_id: out.application_id,
    version: out.version,
    signed_at: out.signed_at,
    signer_ip: out.signer_ip,
    rep_name: repName,
    email: out.merchant_email,
  } satisfies ChangesSubmitResponse);
}

/** What staff would see: SSNs cut to the last four, dates of birth hidden. */
function maskedForStaff(d: Details): Details {
  return {
    ...d,
    owners: d.owners.map((o) => ({ ...o, ssn: maskSsn(o.ssn), dob: o.dob ? MASKED_DOB : "" })),
  };
}
