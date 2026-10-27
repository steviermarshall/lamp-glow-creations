// Application links: staff send a merchant a personal link to the full application; the merchant
// fills it in, signs on the page and submits without an account; the signed file lands with the
// rep who sent it. Shared by the browser (staff panel, the application page) and the server
// routes (application-links.server.ts). Pure functions and types only.
//
// Merchant copy: never the word "loan".
import { b64 } from "@/lib/funder-send";

export const LINK_TTL_DAYS = 30;
/** Per request, so one click can't send hundreds of emails. */
export const MAX_RECIPIENTS = 50;
export const MAX_NOTE = 1000;
/** Bank statements and other files a merchant may add from the link, before they have an account. */
export const MAX_LINK_UPLOADS = 12;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_SIGNED_PDF_BYTES = 8 * 1024 * 1024;
export const UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic"];

/** Where the browser keeps the claim tokens of applications it submitted, until they're claimed. */
export const CLAIMS_KEY = "lamp.application.claims.v1";

export type Channel = "email" | "link";

/** One person in the staff Send panel: a lead from the list, or someone typed in. */
export type Recipient = {
  lead_id?: number | null;
  first_name?: string;
  last_name?: string;
  business_name?: string;
  email?: string;
  phone?: string;
  channel: Channel;
};

export type SendRequest =
  | { action: "send"; rep_slug?: string; note?: string; recipients: Recipient[] }
  | { action: "resend"; invite_id: string; channel: Channel; note?: string }
  | { action: "cancel"; invite_id: string };

export type SendResult = {
  /** Index into the request's recipients (send) or 0 (resend, cancel). */
  index: number;
  status: "sent" | "link" | "skipped" | "failed" | "cancelled";
  detail: string;
  invite_id?: string;
  /** Only for channel "link": the personal link to copy or text. Never returned for email. */
  url?: string;
};

export type OpenState = "open" | "signed" | "expired" | "cancelled" | "not_found" | "unknown_rep";

export type OpenResponse = {
  state: OpenState;
  /** A personal link's invite id: the browser keys its saved draft by it, so a resent link
   *  (new token, same invite) opens the merchant's progress. Null for a rep's public link. */
  draft?: string | null;
  rep: { slug: string; name: string; title: string | null } | null;
  /** What the rep already knows, so the merchant doesn't type it twice. */
  prefill: {
    first_name: string;
    last_name: string;
    business_name: string;
    email: string;
    phone: string;
  } | null;
};

export type SubmitResponse = {
  application_id: string;
  claim_token: string;
  rep_name: string;
  email: string;
  /** What the database stamped, for the signed PDF's signature record. */
  signed_at: string;
  signer_ip: string | null;
};

/**
 * What the page sends to /api/application/upload as "kind": bank statements (several), or the
 * signed application PDF it builds after submit with the database's signed_at and IP (one).
 */
export type UploadKind = "bank_statement" | "funder_application";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const cleanEmail = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** 32 random bytes as base64url: the secret part of a personal link or a claim. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64(bytes, false).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const isToken = (s: unknown): s is string =>
  typeof s === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(s);

/** sha256 hex of the token's UTF-8 bytes; the database stores only this. */
export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** The rep's public link, or a personal one when there's a token. */
export function applicationUrl(site: string, repSlug: string, token?: string | null): string {
  const base = `${site.replace(/\/$/, "")}/application/${encodeURIComponent(repSlug)}`;
  return token ? `${base}?i=${token}` : base;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Lamp's branded email body, shared by every email a merchant gets: the greeting, the paragraphs,
 * one button, the rep's sign-off and the footer, with every string escaped.
 */
export function brandedHtml(o: {
  hi: string;
  paragraphs: string[];
  button: string;
  url: string;
  repName: string;
  footer: string[];
}): string {
  const p = (s: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#1f2a24">${esc(s)}</p>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef2ee">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ee;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<tr><td style="background:#0f1f17;padding:22px 28px">
<span style="display:inline-block;width:14px;height:14px;border-radius:7px;background:#4a985e;box-shadow:0 0 12px 3px rgba(74,152,94,.7);vertical-align:middle"></span>
<span style="font-size:20px;font-weight:700;color:#f3f6f2;vertical-align:middle;margin-left:10px;letter-spacing:-.3px">Lamp<span style="color:#4a985e">.</span></span>
</td></tr>
<tr><td style="padding:30px 28px 8px">
${p(o.hi)}
${o.paragraphs.map(p).join("\n")}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:999px;background:#4a985e">
<a href="${esc(o.url)}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:700;color:#0f1f17;text-decoration:none;border-radius:999px">${esc(o.button)}</a>
</td></tr></table>
${p("Any questions, just reply to this email.")}
<p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#1f2a24">${esc(o.repName)}</p>
<p style="margin:0 0 28px;font-size:14px;color:#5b6b61">Lamp · getlamp.app</p>
</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #e3e9e4">
${o.footer.map((f) => `<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#7a887f">${esc(f)}</p>`).join("\n")}
<p style="margin:0;font-size:12px;line-height:1.5;color:#7a887f">If the button doesn't work, paste this into your browser: ${esc(o.url)}</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** The email a merchant gets. Plain text and a simple branded HTML version of the same words. */
export function inviteEmail(opts: {
  firstName: string;
  businessName: string;
  repName: string;
  note: string;
  url: string;
  legalName: string;
  address: string;
}): { subject: string; text: string; html: string } {
  const hi = opts.firstName.trim() ? `Hi ${opts.firstName.trim()},` : "Hi,";
  const forBiz = opts.businessName.trim() ? ` for ${opts.businessName.trim()}` : "";
  const subject = `Your Lamp application${forBiz}`;
  const note = opts.note.trim();
  const body = [
    note || `Here's your funding application${forBiz}, as we discussed.`,
    "It takes about ten minutes. You sign it right on the page, on your phone or computer, and it comes straight to me.",
    "If you have your last four months of business bank statements handy, you can add them at the end. If not, you can send them later.",
  ];
  const footer = [
    `You're getting this because you spoke with ${opts.repName} at Lamp. Not interested? Reply "stop" and we won't email you again.`,
    [opts.legalName, opts.address].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const text = [
    hi,
    "",
    ...body.flatMap((p) => [p, ""]),
    `Open your application: ${opts.url}`,
    "",
    "Any questions, just reply to this email.",
    "",
    opts.repName,
    "Lamp · getlamp.app",
    "",
    ...footer,
  ].join("\r\n");

  const html = brandedHtml({
    hi,
    paragraphs: body,
    button: "Open my application",
    url: opts.url,
    repName: opts.repName,
    footer,
  });
  return { subject, text, html };
}

/** The text a rep pastes into a text message. */
export function inviteSms(firstName: string, repName: string, url: string): string {
  const hi = firstName.trim() ? `Hi ${firstName.trim()}, ` : "";
  return `${hi}it's ${repName} at Lamp. Here's your application. It takes about 10 minutes and you sign right on the page: ${url}`;
}

/** A multipart/alternative message (text and HTML) with an optional Reply-To. */
export function buildAltMime(opts: {
  from: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  html?: string | null;
  boundary?: string;
}): string {
  for (const v of [opts.from, opts.to, opts.replyTo ?? ""]) {
    if (/[\r\n]/.test(v)) throw new Error("bad address");
  }
  const boundary = opts.boundary ?? `lamp-${crypto.randomUUID()}`;
  const subject = opts.subject.replace(/[\r\n]+/g, " ");
  const head = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
    `Subject: ${/^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${b64(new TextEncoder().encode(subject), false)}?=`}`,
    "MIME-Version: 1.0",
  ];
  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset="UTF-8"`,
      "Content-Transfer-Encoding: base64",
      "",
      b64(new TextEncoder().encode(body)),
    ].join("\r\n");
  if (!opts.html) {
    return [
      ...head,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(new TextEncoder().encode(opts.text)),
      "",
    ].join("\r\n");
  }
  return `${head.join("\r\n")}\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n${part("text/plain", opts.text)}\r\n${part("text/html", opts.html)}\r\n--${boundary}--\r\n`;
}

/**
 * Display name for a From header. Drops only what could break the header (quotes, backslashes,
 * control characters, CR/LF among them); plain ASCII is quoted, anything else (José, O’Neil) is
 * RFC 2047 encoded, like the Subject.
 */
export const fromName = (s: string) => {
  const n = s.replace(/["\\\p{Cc}]/gu, "").trim() || "Lamp";
  return /^[\x20-\x7e]*$/.test(n)
    ? `"${n}"`
    : `=?UTF-8?B?${b64(new TextEncoder().encode(n), false)}?=`;
};

// ---------- Browser: claim tokens kept after submitting ----------

export function loadClaims(): string[] {
  try {
    const raw = window.localStorage.getItem(CLAIMS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter(isToken).slice(-20) : [];
  } catch {
    return [];
  }
}

export function saveClaim(token: string) {
  try {
    const next = [...loadClaims().filter((t) => t !== token), token].slice(-20);
    window.localStorage.setItem(CLAIMS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the emailed-link rule can still match them */
  }
}

export function clearClaims() {
  try {
    window.localStorage.removeItem(CLAIMS_KEY);
  } catch {
    /* ignore */
  }
}
