// The new-file email's safety net: the rules for sending it once, and for trying again.
//
// A signed application emails its rep and NEW_APPLICATION_COPY once (sendNewApplicationNotice in
// application-links.server.ts). The browser that signed asks for it as soon as the uploads finish;
// the finish-reminders job (every 10 minutes) also looks for signed files that never got it, so a
// closed tab, a blocked request or a Google hiccup no longer leaves a file unseen.
//
// Each try first writes a claim on the file's timeline (an events row with payload notice_claim
// and its attempt number). The database lets only one row exist per file and attempt
// (events_notice_claim_once, 20261127100000_unassigned_alerts.sql), so when the browser, a second
// tab and the job all try at once, only one of them sends. The claim row then becomes the result:
// "Emailed ..." (payload notice) or "Couldn't email ..." (payload notice_failed).
//
// No imports, so the deno tests load it directly.

export const NOTICE = "new_application";
/** The job leaves a file to the browser for this long after signing. */
export const RETRY_AFTER_MS = 10 * 60_000;
/** ...and stops looking this long after signing, inside the 48 hour limit below. */
export const RETRY_UNTIL_MS = 47 * 3_600_000;
/** The email is never sent later than this after signing. */
export const NOTICE_LIMIT_MS = 48 * 3_600_000;
/** The job tries again while at most this many tries have failed (three tries in all). */
export const MAX_FAILED = 2;
/** A claim with no result after this long belongs to a try that stopped part way. */
export const STALE_CLAIM_MS = 15 * 60_000;
/** Files the job emails per run, since each email carries the statements. */
export const NOTICE_PER_RUN = 5;
/**
 * The browser asks for the email only after its last statement upload, so the job also leaves a
 * file alone while statements are still landing: no document added in this long.
 */
export const UPLOAD_QUIET_MS = 10 * 60_000;
/** Signed files the job reads per run (only the ones still owed an email are acted on). */
export const SIGNED_READ_LIMIT = 1000;
/** File ids per timeline or documents read, to keep each request short. */
export const READ_CHUNK = 50;

export type NoticeEvent = {
  id: number;
  application_id: string;
  created_at: string;
  payload: Record<string, unknown> | null;
};

export type SignedRow = { application_id: string; signed_at: string };

export type UploadRow = { application_id: string; created_at: string };

export type NoticeState = {
  sent: boolean;
  failed: number;
  /** Claims still waiting for their result. */
  open: NoticeEvent[];
  /** The attempt number the next try claims. */
  next: number;
};

/** Where a file's new-file email stands, from its timeline. */
export function noticeState(events: NoticeEvent[]): NoticeState {
  let sent = false;
  let failed = 0;
  let next = 0;
  const open: NoticeEvent[] = [];
  for (const e of events) {
    const p = e.payload ?? {};
    const done = p["notice"] === NOTICE || p["notice_failed"] === NOTICE;
    if (p["notice"] === NOTICE) sent = true;
    if (p["notice_failed"] === NOTICE) failed++;
    if (p["notice_claim"] === NOTICE) {
      const n = Number(p["attempt"]);
      next = Math.max(next, (Number.isInteger(n) && n >= 0 ? n : 0) + 1);
      if (!done) open.push(e);
    }
  }
  return { sent, failed, open, next };
}

export const sentBody = (to: string[], duplicates: number) =>
  `Emailed the signed application to ${to.join(", ")}${duplicates ? " (tax ID already in Lamp)" : ""}.`;
export const failedBody = (why: string) => `Couldn't email the signed application (${why}).`;
export const CLAIM_BODY = "Sending the signed application email.";
export const STALE_WHY = "the earlier try stopped before it finished";

export type Delivery =
  { ok: true; body: string; payload: Record<string, unknown> } | { ok: false; why: string };

/** What the timeline needs: read, claim, and write the result onto the claim. */
export type NoticeStore = {
  /** The notice rows (sent, failed, claimed) of these files; null when the read failed. */
  events(appIds: string[]): Promise<NoticeEvent[] | null>;
  /** The claim row's id; "taken" when another try holds this attempt; null on any other error. */
  claim(appId: string, attempt: number): Promise<number | "taken" | null>;
  /**
   * Writes the result onto a claim that is still open (its body is still CLAIM_BODY): true when
   * written, false when the claim already has a result (the job wrote it off as stopped), null
   * on an error. Never overwrites a result.
   */
  finish(id: number, body: string, payload: Record<string, unknown>): Promise<boolean | null>;
  /** A result row of its own, for a send that finished after its claim was written off. */
  record(appId: string, body: string, payload: Record<string, unknown>): Promise<boolean>;
};

export type NoticeOutcome =
  | { kind: "sent" }
  | { kind: "failed"; why: string }
  | { kind: "already" }
  | { kind: "busy" }
  | { kind: "error" };

/**
 * Sends the email once: nothing when it already went or another try holds the claim; otherwise
 * claims, sends through `deliver`, and writes what happened, whatever `deliver` does (a throw is
 * written as a failure too, so a file is never left with no record).
 */
export async function sendNoticeOnce(
  store: NoticeStore,
  appId: string,
  deliver: () => Promise<Delivery>,
): Promise<NoticeOutcome> {
  const events = await store.events([appId]);
  if (!events) return { kind: "error" };
  const s = noticeState(events);
  if (s.sent) return { kind: "already" };
  if (s.open.length) return { kind: "busy" };
  const id = await store.claim(appId, s.next);
  if (id === "taken") return { kind: "busy" };
  if (id === null) return { kind: "error" };
  let out: Delivery;
  try {
    out = await deliver();
  } catch {
    out = { ok: false, why: "something went wrong while sending" };
  }
  const claim = { notice_claim: NOTICE, attempt: s.next };
  const [body, payload] = out.ok
    ? [out.body, { ...out.payload, ...claim, notice: NOTICE }]
    : [failedBody(out.why), { ...claim, notice_failed: NOTICE, error: out.why }];
  // once more if the write fails: a claim left open is later read as a try that stopped
  let wrote = await store.finish(id, body, payload);
  if (wrote === null) wrote = await store.finish(id, body, payload);
  // This try ran so long that the job wrote its claim off. The email did go, so say so on a row
  // of its own (no notice_claim, so the claim index doesn't apply): the job then sees it as sent
  // and doesn't send it again. A failure needs nothing, the write-off already counts as one.
  if (wrote === false && out.ok)
    await store.record(appId, body, {
      ...out.payload,
      notice: NOTICE,
      attempt: s.next,
      late: true,
    });
  return out.ok ? { kind: "sent" } : { kind: "failed", why: out.why };
}

/**
 * The Gmail step: a token, then the send. A token fetch that throws, a send that throws and a
 * refused send all come back as a reason, never as a throw.
 */
export async function mailNotice(
  token: () => Promise<{ access: string } | { error: string }>,
  send: (access: string) => Promise<{ ok: boolean; status: number }>,
): Promise<{ ok: true } | { ok: false; why: string }> {
  const t = await token().catch(() => ({ error: "Couldn't reach Google." }));
  if ("error" in t) return { ok: false, why: t.error };
  try {
    const res = await send(t.access);
    return res.ok ? { ok: true } : { ok: false, why: `Gmail ${res.status}` };
  } catch {
    return { ok: false, why: "couldn't reach Gmail" };
  }
}

/**
 * Which signed files the job emails now: signed 10 minutes to 47 hours ago, never emailed, at most
 * two failed tries, nobody sending right now, no statement added in the last 10 minutes; the
 * oldest first, at most `cap`. Claims that never got a result come back as `stale`, to be written
 * off as failed tries.
 */
export function pickForRetry(
  signed: SignedRow[],
  events: NoticeEvent[],
  now: number,
  cap = NOTICE_PER_RUN,
  uploads: UploadRow[] = [],
): { send: string[]; stale: NoticeEvent[] } {
  const uploading = new Set(
    uploads
      .filter((u) => now - Date.parse(u.created_at) < UPLOAD_QUIET_MS)
      .map((u) => u.application_id),
  );
  const byApp = new Map<string, NoticeEvent[]>();
  for (const e of events) {
    const list = byApp.get(e.application_id) ?? [];
    list.push(e);
    byApp.set(e.application_id, list);
  }
  const send: string[] = [];
  const stale: NoticeEvent[] = [];
  const seen = new Set<string>();
  const rows = signed
    .filter((r) => Number.isFinite(Date.parse(r.signed_at)))
    .sort((a, b) => Date.parse(a.signed_at) - Date.parse(b.signed_at));
  for (const r of rows) {
    if (seen.has(r.application_id)) continue;
    seen.add(r.application_id);
    const age = now - Date.parse(r.signed_at);
    if (age < RETRY_AFTER_MS || age > RETRY_UNTIL_MS) continue;
    const s = noticeState(byApp.get(r.application_id) ?? []);
    if (s.sent || s.failed > MAX_FAILED) continue;
    if (s.open.length) {
      stale.push(...s.open.filter((e) => now - Date.parse(e.created_at) > STALE_CLAIM_MS));
      continue;
    }
    if (uploading.has(r.application_id)) continue;
    if (send.length < cap) send.push(r.application_id);
  }
  return { send, stale };
}

export type SweepStore = NoticeStore & {
  /** Files signed between these two times, at most SIGNED_READ_LIMIT; null when the read failed. */
  signed(fromIso: string, toIso: string): Promise<SignedRow[] | null>;
  /** Documents added to these files since `sinceIso`; null when the read failed. */
  uploads(appIds: string[], sinceIso: string): Promise<UploadRow[] | null>;
};

/** Reads in chunks of READ_CHUNK ids; null when any chunk's read failed. */
async function chunked<T>(
  ids: string[],
  read: (chunk: string[]) => Promise<T[] | null>,
): Promise<T[] | null> {
  const all: T[] = [];
  for (let i = 0; i < ids.length; i += READ_CHUNK) {
    const part = await read(ids.slice(i, i + READ_CHUNK));
    if (!part) return null;
    all.push(...part);
  }
  return all;
}

export type SweepResult = {
  checked: number;
  sent: number;
  failed: number;
  stale: number;
  error?: string;
};

/** One run of the job's look for signed files that never got their email. */
export async function noticeSweep(
  store: SweepStore,
  now: number,
  send: (appId: string) => Promise<NoticeOutcome>,
  cap = NOTICE_PER_RUN,
): Promise<SweepResult> {
  const out: SweepResult = { checked: 0, sent: 0, failed: 0, stale: 0 };
  const rows = await store.signed(
    new Date(now - RETRY_UNTIL_MS).toISOString(),
    new Date(now - RETRY_AFTER_MS).toISOString(),
  );
  if (!rows) return { ...out, error: "Couldn't read signed files." };
  out.checked = rows.length;
  if (!rows.length) return out;
  const ids = [...new Set(rows.map((r) => r.application_id))];
  const events = await chunked(ids, (c) => store.events(c));
  if (!events) return { ...out, error: "Couldn't read the timeline." };
  // Only files still owed an email need the documents check. If that read fails, go on without
  // it: an email that may miss a late statement beats no email at all.
  const owed = ids.filter((id) => !noticeState(events.filter((e) => e.application_id === id)).sent);
  const since = new Date(now - UPLOAD_QUIET_MS).toISOString();
  const uploads = (await chunked(owed, (c) => store.uploads(c, since))) ?? [];
  const pick = pickForRetry(rows, events, now, cap, uploads);
  for (const e of pick.stale) {
    // true only when the claim was still open: a try that finished meanwhile keeps its result
    if (
      (await store.finish(e.id, failedBody(STALE_WHY), {
        ...(e.payload ?? {}),
        notice_failed: NOTICE,
        error: STALE_WHY,
      })) === true
    )
      out.stale++;
  }
  for (const id of pick.send) {
    const r = await send(id).catch((): NoticeOutcome => ({ kind: "error" }));
    if (r.kind === "sent") out.sent++;
    else if (r.kind === "failed" || r.kind === "error") out.failed++;
  }
  return out;
}

/**
 * The order of the finish-reminders run: the mailbox first, then the new-file sweep, then the
 * reminders. The sweep runs on every run with a mailbox, even when no reminder is due.
 */
export async function reminderRun<R>(steps: {
  access: () => Promise<{ access: string } | { error: string }>;
  sweep: (access: string) => Promise<SweepResult>;
  due: number;
  remind: (access: string) => Promise<R>;
}): Promise<
  { mailbox: false; skipped: string } | { mailbox: true; notices: SweepResult; reminders: R | null }
> {
  const a = await steps.access().catch(() => ({ error: "Couldn't reach Google." }));
  if ("error" in a) return { mailbox: false, skipped: a.error };
  const notices = await steps.sweep(a.access).catch((): SweepResult => ({
    checked: 0,
    sent: 0,
    failed: 0,
    stale: 0,
    error: "The sweep failed.",
  }));
  const reminders = steps.due ? await steps.remind(a.access) : null;
  return { mailbox: true, notices, reminders };
}
