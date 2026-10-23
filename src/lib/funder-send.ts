// Pure pieces of sending a file to funders: which funders to send to, the email text, and the
// MIME message Gmail sends. No network and no database here, so all of it is unit-tested in
// tests/funder-send.test.ts. The server routes import it through funder-send.server.ts.

export type Match = {
  funder_id: string;
  funder_name: string;
  submission_email: string | null;
  auto_send: boolean;
  already_sent: boolean;
  eligible: boolean;
  blockers: string[] | null;
  checks: string[] | null;
};

export type Pick = { match: Match; send: boolean; reason: string };

/**
 * Which matched funders get the file. Manual: the funders the staff member ticked, but only if
 * the database still calls them eligible and they haven't had it. Auto: every eligible funder
 * with auto_send on that hasn't had it. A funder that's blocked or already sent is reported, not
 * sent, whatever was asked.
 */
export function pickFunders(
  matches: Match[],
  mode: "manual" | "auto",
  requested: string[] | null,
): Pick[] {
  const wanted = mode === "manual" ? new Set(requested ?? []) : null;
  const out: Pick[] = [];
  for (const m of matches) {
    if (wanted && !wanted.has(m.funder_id)) continue;
    if (mode === "auto" && !m.auto_send) continue;
    if (m.already_sent) {
      out.push({ match: m, send: false, reason: "already sent this file" });
    } else if (!m.eligible) {
      out.push({ match: m, send: false, reason: (m.blockers ?? []).join("; ") || "not a match" });
    } else if (!m.submission_email) {
      out.push({ match: m, send: false, reason: "no submission email on the funder" });
    } else {
      out.push({ match: m, send: true, reason: "" });
    }
  }
  if (wanted) {
    for (const id of wanted) {
      if (!matches.some((m) => m.funder_id === id)) {
        out.push({
          match: {
            funder_id: id,
            funder_name: "Unknown funder",
            submission_email: null,
            auto_send: false,
            already_sent: false,
            eligible: false,
            blockers: null,
            checks: null,
          },
          send: false,
          reason: "not an active funder",
        });
      }
    }
  }
  return out;
}

export type FileSummary = {
  fileId: string;
  legalName: string;
  dba: string;
  state: string;
  industry: string;
  startDate: string;
  monthlyDeposits: number | null;
  requested: number | null;
  openPositions: number | null;
  repName: string | null;
};

const money = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "not stated" : `$${Math.round(n).toLocaleString("en-US")}`;

export const shortId = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

/** Subject and plain-text body. Never names the product a loan: it is a purchase of receivables. */
export function emailText(
  s: FileSummary,
  funderContact: string | null,
  attachmentNames: string[],
  mailbox: string,
): { subject: string; body: string } {
  const name = s.legalName || "Unnamed business";
  const subject = `New submission: ${name} – ${money(s.requested)} – Lamp`;
  const lines = [
    `Hi ${funderContact?.trim() || "team"},`,
    "",
    "Please find a new working capital submission from Lamp attached.",
    "",
    `Business: ${name}${s.dba ? ` (DBA ${s.dba})` : ""}`,
    `State: ${s.state || "not stated"}`,
    `Industry: ${s.industry || "not stated"}`,
    `In business since: ${s.startDate || "not stated"}`,
    `Monthly deposits (stated): ${money(s.monthlyDeposits)}`,
    `Amount requested: ${money(s.requested)}`,
    `Open positions: ${s.openPositions === null ? "not stated" : String(s.openPositions)}`,
    "",
    "Attached:",
    ...attachmentNames.map((n) => `- ${n}`),
    "",
    `Lamp file ${shortId(s.fileId)}${s.repName ? ` · Rep: ${s.repName}` : ""}`,
    "Reply to this email with offers, stips or questions.",
    "",
    "Lamp",
    mailbox,
  ];
  return { subject, body: lines.join("\r\n") };
}

export type Attachment = { name: string; mime: string; bytes: Uint8Array };

/** Base64 of raw bytes, wrapped at 76 columns as MIME requires. */
export function b64(bytes: Uint8Array, wrap = true): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const s = btoa(bin);
  return wrap ? (s.match(/.{1,76}/g) ?? [""]).join("\r\n") : s;
}

export const b64url = (s: string) =>
  b64(new TextEncoder().encode(s), false)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** RFC 2047 for a header that may carry non-ASCII (the subject, a business name). */
const encodeHeader = (s: string) =>
  /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(new TextEncoder().encode(s), false)}?=`;

/** A filename safe for a MIME header: ASCII, no quotes, no path. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const ascii = base
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\r\n]/g, "");
  return ascii.trim() || "file";
}

/** A multipart/mixed message: one text part, then each attachment. */
export function buildMime(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments: Attachment[];
  boundary?: string;
}): string {
  if (/[\r\n]/.test(opts.to) || /[\r\n]/.test(opts.from)) throw new Error("bad address");
  const boundary = opts.boundary ?? `lamp-${crypto.randomUUID()}`;
  const head = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeader(opts.subject.replace(/[\r\n]+/g, " "))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(new TextEncoder().encode(opts.body)),
    ].join("\r\n"),
    ...opts.attachments.map((a) =>
      [
        `--${boundary}`,
        `Content-Type: ${a.mime}; name="${safeFilename(a.name)}"`,
        `Content-Disposition: attachment; filename="${safeFilename(a.name)}"`,
        "Content-Transfer-Encoding: base64",
        "",
        b64(a.bytes),
      ].join("\r\n"),
    ),
  ];
  return `${head.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--\r\n`;
}

/** Constant-time string compare for the shared secret. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Gmail's limit is 25 MB per message after base64 grows it by a third. */
export const MAX_ATTACHMENT_BYTES = 17 * 1024 * 1024;

export const num = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return String(v ?? "").replace(/[^0-9.]/g, "") === "" || !Number.isFinite(n) ? null : n;
};
