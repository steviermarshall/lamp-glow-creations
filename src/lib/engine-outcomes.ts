// What reps did with the engine's leads (2026-11-12): the War Room engine reads this every night
// from /api/engine/outcomes with the same shared secret as the daily push, so it can tell which of
// its lead sources lead to calls, conversations and files. This file is the part with no server or
// database in it, so the tests can load it.
//
// What goes back is only what the engine sent (its source and source_key) plus how the lead was
// worked: the status, the rep's slug, when it was touched, and the id of the file it became. No
// names, phone numbers, emails or notes text leave Lamp through here.
import { sameSecret } from "./funder-send.ts";

/** One call returns at most this many leads; `truncated` says when there were more. */
export const MAX_ROWS = 5000;

/** With no ?since, the reply covers the last 8 days, so a nightly run that misses a night or two still catches up. */
export const DEFAULT_DAYS = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

/** ?since=ISO date or time, default 8 days back. Null when it is there but isn't a date. */
export function parseSince(url: URL, now: Date = new Date()): Date | null {
  const raw = (url.searchParams.get("since") ?? "").trim();
  if (!raw) return new Date(now.getTime() - DEFAULT_DAYS * DAY_MS);
  if (!/^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(raw)) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime()) return null;
  return d;
}

/** The engine_leads columns the reply reads. Nothing that identifies the merchant beyond the engine's own key. */
export const LEAD_COLUMNS =
  "id,source,source_key,status,rep_slug,pushed_at,worked_at,contact_updated_at,notes";

export type LeadRow = {
  id: number;
  source: string;
  source_key: string;
  status: string;
  rep_slug: string | null;
  pushed_at: string;
  worked_at: string | null;
  contact_updated_at: string | null;
  notes: string | null;
};

export const INVITE_COLUMNS = "engine_lead_id,sent_at,submitted_at,cancelled_at,application_id";

/** An application link a rep sent for an engine lead. */
export type InviteRow = {
  engine_lead_id: number | null;
  sent_at: string | null;
  submitted_at: string | null;
  cancelled_at: string | null;
  application_id: string | null;
};

export type Outcome = {
  source: string;
  source_key: string;
  status: string;
  rep_slug: string | null;
  pushed_at: string;
  /** The earliest touch Lamp still has a time for (see firstTouch). Null while the lead is untouched. */
  first_touched_at: string | null;
  /** The latest of: status change, contact details saved, link sent or signed. Null while untouched. */
  last_activity_at: string | null;
  /** The last status change, as Lamp stamps it. */
  status_changed_at: string | null;
  /** The rep wrote notes (their words stay in Lamp). */
  has_notes: boolean;
  /** The rep saved who they spoke to or where to send the application. */
  has_contact: boolean;
  /** When the rep first sent an application link for this lead (cancelled links count: one was sent). */
  link_sent_at: string | null;
  /** The file the lead became, once the merchant signed through the link. */
  application_id: string | null;
  application_submitted_at: string | null;
};

const ms = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN);
const earliest = (xs: (string | null | undefined)[]) => pickBy(xs, (a, b) => a < b);
const latest = (xs: (string | null | undefined)[]) => pickBy(xs, (a, b) => a > b);

function pickBy(
  xs: (string | null | undefined)[],
  better: (a: number, b: number) => boolean,
): string | null {
  let out: string | null = null;
  for (const x of xs) {
    if (!x || Number.isNaN(ms(x))) continue;
    if (out === null || better(ms(x), ms(out))) out = new Date(x).toISOString();
  }
  return out;
}

/**
 * Lamp keeps the last status change, not the first, so the first touch is the earliest of: the
 * status change (once the lead is no longer new), the contact details being saved, and the first
 * link sent. The engine keeps the earliest it has seen across its nightly reads.
 */
export function outcome(lead: LeadRow, invites: InviteRow[]): Outcome {
  const mine = invites.filter((i) => i.engine_lead_id === lead.id);
  const signed = mine
    .filter((i) => i.submitted_at && i.application_id)
    .sort((a, b) => ms(a.submitted_at) - ms(b.submitted_at))[0];
  const linkSent = earliest(mine.map((i) => i.sent_at));
  const worked = lead.status !== "new" ? lead.worked_at : null;
  return {
    source: lead.source,
    source_key: lead.source_key,
    status: lead.status,
    rep_slug: lead.rep_slug,
    pushed_at: new Date(lead.pushed_at).toISOString(),
    first_touched_at: earliest([worked, lead.contact_updated_at, linkSent]),
    last_activity_at: latest([
      worked,
      lead.contact_updated_at,
      ...mine.flatMap((i) => [i.sent_at, i.submitted_at]),
    ]),
    status_changed_at: earliest([lead.worked_at]),
    has_notes: (lead.notes ?? "").trim().length > 0,
    has_contact: lead.contact_updated_at !== null,
    link_sent_at: linkSent,
    application_id: signed?.application_id ?? null,
    application_submitted_at: signed ? earliest([signed.submitted_at]) : null,
  };
}

/**
 * The checks before any read, in the push's order: the secret is set up, the database settings are
 * there, the caller sent the same secret, and ?since is a date. Either the error reply or the date.
 */
export function gate(
  request: Request,
  secret: string,
  hasDb: boolean,
  now: Date = new Date(),
): { status: number; error: string } | { since: Date } {
  if (!secret) return { status: 503, error: "Engine push is not set up." };
  if (!hasDb) return { status: 500, error: "The server is missing its database settings." };
  if (!sameSecret(request.headers.get("x-engine-push-secret") ?? "", secret))
    return { status: 401, error: "Not allowed." };
  const since = parseSince(new URL(request.url), now);
  if (!since)
    return { status: 400, error: "since should be a date or time in the past, like 2026-11-04." };
  return { since };
}

/** The PostgREST filter for "changed since": pushed, status changed or contact saved on or after `since`. */
export function changedSince(since: Date): string {
  const s = `"${since.toISOString()}"`;
  return `pushed_at.gte.${s},worked_at.gte.${s},contact_updated_at.gte.${s}`;
}
