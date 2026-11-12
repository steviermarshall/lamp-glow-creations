// The in-app chat (supabase/migrations/20261110120000_chat_staff.sql, 20261110140000_chat_merchant.sql):
// wording and checks, with no imports so the deno tests load this file directly.

/** How often an open conversation looks for new messages. */
export const POLL_MS = 15_000;

/** With live updates on (20261110130000_chat_realtime.sql), a slower look as a backstop. */
export const LIVE_POLL_MS = 60_000;

/** How often Staff > Messages and its unread count look again. */
export const INBOX_POLL_MS = 30_000;

/** Fired on window when a conversation is marked read, so the unread count updates at once. */
export const CHAT_READ_EVENT = "lamp:chat-read";

/** The most messages a conversation loads at once (newest kept). */
export const PAGE = 200;

export const MAX_LENGTH = 4000;

/** One line of Staff > Messages (my_chat_inbox()). */
export type InboxRow = {
  thread_id: string;
  kind: "merchant" | "room" | "direct";
  title: string;
  subtitle: string;
  preview: string | null;
  /** merchant conversations: the file */
  application_id?: string | null;
  last_message_at: string | null;
  unread: boolean;
};

/** How many conversations have something new: the count on the tab and under the bell. */
export const unreadCount = (rows: Pick<InboxRow, "unread">[]) =>
  rows.filter((r) => r.unread).length;

export type ChatMessage = {
  id: number;
  kind: "text" | "document" | "system" | "gif";
  body: string;
  author: string | null;
  author_role: "merchant" | "rep" | "admin" | "system";
  author_name: string | null;
  created_at: string;
  redacted_at: string | null;
};

export const MESSAGE_COLUMNS = "id,kind,body,author,author_role,author_name,created_at,redacted_at";

/** Who is reading: staff (Staff > Messages, the file view) or the merchant (their account page). */
export type Viewer = "staff" | "merchant";

/**
 * The same numbers the database refuses (chat_text_refused): an SSN with dashes or spaces, an EIN,
 * a card number, or 8 or more digits in a row. A phone number written with dashes passes.
 */
const REFUSED = [
  /(^|[^0-9])[0-9]{3}[- ][0-9]{2}[- ][0-9]{4}([^0-9]|$)/,
  /(^|[^0-9])[0-9]{2}-[0-9]{7}([^0-9]|$)/,
  /(^|[^0-9])[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}[ -][0-9]{1,7}([^0-9]|$)/,
  /[0-9]{8,}/,
];

export const REFUSED_TEXT =
  "Please don't send account, card or Social Security numbers in chat; Lamp collects those through the secure application. Phone numbers are fine written like 201-555-0123.";

/** Why a message can't be sent as written, or null when it can. */
export function chatRefusal(body: string): string | null {
  const text = body.trim();
  if (!text) return "Write a message first.";
  if (text.length > MAX_LENGTH)
    return `Keep a message under ${MAX_LENGTH.toLocaleString("en-US")} characters.`;
  if (REFUSED.some((re) => re.test(text))) return REFUSED_TEXT;
  return null;
}

export const firstName = (name: string | null | undefined) =>
  (name ?? "").trim().split(/\s+/)[0] || "";

/** The name over a message, for whoever is reading. */
export function authorLabel(
  m: Pick<ChatMessage, "author" | "author_role" | "author_name">,
  me: string,
  viewer: Viewer = "staff",
): string {
  if (m.author && m.author === me) return "You";
  if (m.author_role === "system") return "Lamp";
  if (viewer === "merchant") {
    if (m.author_role === "merchant") return firstName(m.author_name) || "You";
    return `${firstName(m.author_name) || "Lamp"} at Lamp`;
  }
  if (m.author_role === "merchant") return `${m.author_name || "Merchant"} (merchant)`;
  return m.author_name || "Lamp";
}

/**
 * Words that describe a merchant cash advance as lending. Staff see a warning before sending one to
 * a merchant; a merchant's own words are never checked.
 */
const LENDING = /\b(loans?|lend(?:er|ers|ing)?|borrow(?:er|ers|ing|ed)?|interest rates?|APR)\b/gi;

/** The lending words in a staff message, each once, as typed. */
export function lendingWords(body: string): string[] {
  const seen = new Map<string, string>();
  for (const m of body.matchAll(LENDING)) {
    const k = m[0].toLowerCase();
    if (!seen.has(k)) seen.set(k, m[0]);
  }
  return [...seen.values()];
}

/**
 * Who the merchant is talking to, as the application emails and the signed PDF already name them:
 * the rep's team lead when the rep has one, otherwise the rep. An unassigned file: the Lamp team.
 * The database picks the person (file_contact(), for the merchant's own file only: merchants read
 * no reps rows); this keeps their first name.
 */
export function contactName(name: string | null | undefined): string {
  return firstName(name) || "the Lamp team";
}

/**
 * The email a merchant gets when a Lamp reply has waited unread (/api/chat/nudge): who wrote and a
 * link to their account. Never the message itself: that stays in Lamp.
 */
export function nudgeEmail(n: { firstName: string | null; contact: string; site: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const link = `${n.site.replace(/\/$/, "")}/account#messages`;
  const hi = n.firstName?.trim() ? `Hi ${n.firstName.trim()},` : "Hi,";
  const who = n.contact.trim() || "Your Lamp rep";
  const text = [
    hi,
    `${who} sent you a message about your Lamp file.`,
    `Read it and reply on your account: ${link}`,
    "Replies to this email aren't read; please answer in Lamp.",
  ].join("\n\n");
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#17241d;max-width:520px">`,
    `<p>${esc(hi)}</p>`,
    `<p>${esc(who)} sent you a message about your Lamp file.</p>`,
    `<p><a href="${esc(link)}" style="display:inline-block;background:#1d3a2e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:bold">Read and reply</a></p>`,
    `<p style="color:#56665d;font-size:13px">Replies to this email aren't read; please answer in Lamp.</p>`,
    `</div>`,
  ].join("");
  return { subject: "New message about your Lamp file", text, html };
}

/** A short time for a message: "2:14 PM" today, "Nov 8, 2:14 PM" before. */
export function messageTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === now.toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/** What to show when the database refused a message. Its own words for the refusals it explains. */
export function chatError(err: { code?: string; message?: string } | null | undefined): string {
  if (!err) return "";
  // a row rule said no: someone reading a conversation they aren't in (an admin on a direct message)
  if (err.code === "42501" && /row-level security/i.test(err.message ?? ""))
    return "You can read this conversation but can't write in it.";
  if ((err.code === "22023" || err.code === "42501") && err.message) return err.message;
  return "That didn't send. Check your connection and try again.";
}

/** The chat's tables or functions aren't in this database yet (their SQL hasn't run). */
export const chatMissing = (err: { code?: string } | null | undefined) =>
  !!err && ["PGRST202", "PGRST205", "42P01", "42883"].includes(err.code ?? "");
