// Email review (2026-11-13): the day's outgoing emails wait in the portal until an admin approves
// them. The War Room email engine offers each email to /api/engine/outbox with the shared secret;
// an admin reads them on Staff > Email engine and presses one button; the engine then asks which
// were approved, sends those from each person's own mailbox, and reports what happened.
//
// This file has no server or database in it, so the tests can load it: the checks on what the
// engine posts, and the one place that turns the day's rows into what the review card shows.

/** One call offers at most this many emails, and reports at most this many results. */
export const MAX_ITEMS = 200;
/** The longest email body the portal will hold for review. */
export const MAX_BODY = 8000;

export const STATUSES = ["pending", "approved", "skipped", "sent", "failed", "withdrawn"] as const;
export type Status = (typeof STATUSES)[number];

/** One email as the engine offers it. `id` is the engine's own id for the email. */
export type Offer = {
  engine_id: string;
  batch_date: string;
  sender_email: string;
  sender_name: string;
  to_email: string;
  business: string;
  stage: number;
  list: string;
  subject: string;
  body: string;
  body_hash: string;
};

/** What the engine says happened to an email it was told to send (or one it took back). */
export type Result = {
  engine_id: string;
  status: "sent" | "failed" | "withdrawn";
  at: string | null;
  error: string;
};

export type Rejected = { id: string | null; problem: string };

/** One email as the review screen holds it. */
export type Item = Offer & {
  id: string;
  status: Status;
  decided_name: string;
  decided_at: string | null;
  sent_at: string | null;
  error: string;
};

const ID = /^[A-Za-z0-9_-]{4,80}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[0-9a-f]{64}$/;
const EMAIL = /^[^\s@<>"']{1,100}@[^\s@<>"']{1,100}\.[^\s@<>"']{2,40}$/;
const WHEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

const txt = (v: unknown, max: number): string =>
  typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "";

/**
 * Checks the emails the engine offers for review. An email is refused only when it could not be
 * shown or sent as it stands (no id, no address, no words, a hash that is not a hash); the rest
 * are kept exactly as sent, because what the admin reads must be what goes out.
 */
export function parseOffer(body: unknown): { offers: Offer[]; rejected: Rejected[] } {
  const list = (body as { offer?: unknown } | null)?.offer;
  if (list === undefined || list === null) return { offers: [], rejected: [] };
  if (!Array.isArray(list))
    return { offers: [], rejected: [{ id: null, problem: "Send { offer: [...] }." }] };
  if (list.length > MAX_ITEMS)
    return {
      offers: [],
      rejected: [{ id: null, problem: `At most ${MAX_ITEMS} emails in one call.` }],
    };
  const offers: Offer[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = txt(r["id"], 80);
    const bad = (problem: string) => rejected.push({ id: id || null, problem });
    if (!ID.test(id)) {
      bad("The email has no usable id.");
      continue;
    }
    if (seen.has(id)) {
      bad("The same email is in this call twice.");
      continue;
    }
    seen.add(id);
    const body_ = typeof r["body"] === "string" ? r["body"] : "";
    const subject = typeof r["subject"] === "string" ? r["subject"].trim() : "";
    const o: Offer = {
      engine_id: id,
      batch_date: txt(r["date"], 10),
      sender_email: txt(r["from"], 200).toLowerCase(),
      sender_name: txt(r["from_name"], 120),
      to_email: txt(r["to"], 200).toLowerCase(),
      business: txt(r["business"], 200),
      stage: Number(r["stage"]),
      list: txt(r["list"], 80),
      subject,
      body: body_,
      body_hash: txt(r["hash"], 64).toLowerCase(),
    };
    if (!DAY.test(o.batch_date)) bad("The email has no day (date: YYYY-MM-DD).");
    else if (!EMAIL.test(o.sender_email)) bad("The email has no mailbox to send from.");
    else if (!EMAIL.test(o.to_email)) bad("The email has no address to send to.");
    else if (!Number.isInteger(o.stage) || o.stage < 1 || o.stage > 9)
      bad("The email does not say which email of the run it is (stage 1 to 9).");
    else if (!subject || subject.length > 200) bad("The email has no subject, or one too long.");
    else if (!body_.trim() || body_.length > MAX_BODY)
      bad(`The email has no words, or more than ${MAX_BODY} characters.`);
    else if (!HASH.test(o.body_hash)) bad("The email has no fingerprint of its words (hash).");
    else offers.push(o);
  }
  return { offers, rejected };
}

/** Checks what the engine reports back about emails it sent, could not send, or took back. */
export function parseResults(body: unknown): { results: Result[]; rejected: Rejected[] } {
  const list = (body as { results?: unknown } | null)?.results;
  if (list === undefined || list === null) return { results: [], rejected: [] };
  if (!Array.isArray(list))
    return { results: [], rejected: [{ id: null, problem: "Send { results: [...] }." }] };
  if (list.length > MAX_ITEMS)
    return {
      results: [],
      rejected: [{ id: null, problem: `At most ${MAX_ITEMS} results in one call.` }],
    };
  const results: Result[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = txt(r["id"], 80);
    const status = r["status"];
    const at = txt(r["at"], 40);
    if (!ID.test(id)) rejected.push({ id: id || null, problem: "The result has no usable id." });
    else if (seen.has(id)) rejected.push({ id, problem: "The same email is in this call twice." });
    else if (status !== "sent" && status !== "failed" && status !== "withdrawn")
      rejected.push({ id, problem: "A result is sent, failed or withdrawn." });
    else if (status === "sent" && !WHEN.test(at))
      rejected.push({ id, problem: "A sent email needs the time it went out (at)." });
    else {
      seen.add(id);
      results.push({
        engine_id: id,
        status,
        at: WHEN.test(at) ? at : null,
        error: status === "sent" ? "" : txt(r["error"], 400),
      });
    }
  }
  return { results, rejected };
}

/** What an admin may ask for, and the status an email must be in for it to apply. */
export const DECISIONS = {
  send: { from: ["pending"], to: "approved" },
  skip: { from: ["pending"], to: "skipped" },
  restore: { from: ["skipped"], to: "pending" },
  retry: { from: ["failed"], to: "approved" },
} as const satisfies Record<string, { from: readonly Status[]; to: Status }>;
export type Decision = keyof typeof DECISIONS;

/** Checks an admin's request: one of the four actions, on a list of the portal's own row ids. */
export function parseDecision(
  body: unknown,
): { action: Decision; ids: string[] } | { problem: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const action = b["action"];
  if (typeof action !== "string" || !(action in DECISIONS))
    return { problem: "Say what to do: send, skip, restore or retry." };
  const ids = b["ids"];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_ITEMS)
    return { problem: `Name the emails (1 to ${MAX_ITEMS}).` };
  if (!ids.every((x) => typeof x === "string" && UUID.test(x)))
    return { problem: "One of the emails named is not an email on this page." };
  return { action: action as Decision, ids: [...new Set(ids as string[])] };
}

// ---------- the review card ----------

export type Tone = "working" | "attention" | "ready" | "done" | "failed";
export type StepState = "done" | "active" | "attention" | "pending" | "failed";
export type Step = { key: string; state: StepState; title: string; detail: string };
export type Card = {
  tone: Tone;
  title: string;
  subtitle: string;
  pill: string;
  steps: Step[];
  next: string;
  /** The one main button for this state, or none when there is nothing to press. */
  primary: { action: Decision; ids: string[]; label: string } | null;
  counts: Record<Status, number>;
};

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** "Asad Matsumoto" when the engine gave a name, else the mailbox itself. */
export const senderLabel = (i: Pick<Item, "sender_name" | "sender_email">) =>
  i.sender_name || i.sender_email;

/** Which email of the run this is, in words. */
export const stageLabel = (stage: number) =>
  stage === 1
    ? "First email"
    : stage === 2
      ? "Second email"
      : stage === 3
        ? "Last email"
        : `Email ${stage}`;

/**
 * The one place that decides what the review card says. Rows in: the emails still open (waiting,
 * approved, failed) plus the ones settled today. Everything the card shows is counted from them;
 * nothing is assumed. A mailbox is one step, in the order the engine offered them.
 */
export function reviewCard(items: Item[]): Card {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const i of items) counts[i.status] += 1;
  const live = items.filter((i) => i.status !== "withdrawn");
  const boxes = new Map<string, Item[]>();
  for (const i of live) boxes.set(i.sender_email, [...(boxes.get(i.sender_email) ?? []), i]);

  const steps: Step[] = [...boxes.entries()].map(([mailbox, rows]) => {
    const n = (s: Status) => rows.filter((r) => r.status === s).length;
    const parts = [
      n("pending") ? `${n("pending")} waiting for you` : "",
      n("approved") ? `${n("approved")} approved, going out` : "",
      n("sent") ? `${n("sent")} sent` : "",
      n("failed") ? `${n("failed")} not sent` : "",
      n("skipped") ? `${n("skipped")} left out` : "",
    ].filter(Boolean);
    const state: StepState = n("failed")
      ? "failed"
      : n("approved")
        ? "active"
        : n("pending")
          ? "pending"
          : "done";
    return {
      key: mailbox,
      state,
      title: `${senderLabel(rows[0]!)} · ${mailbox}`,
      detail: parts.join(", "),
    };
  });

  const pending = live.filter((i) => i.status === "pending");
  const failed = live.filter((i) => i.status === "failed");
  const title = "Emails waiting for your approval";
  const subtitle = live.length
    ? `${plural(live.length, "email")} from ${plural(boxes.size, "mailbox", "mailboxes")}`
    : "";

  if (!live.length)
    return {
      tone: "done",
      title,
      subtitle,
      pill: "Nothing waiting",
      steps,
      next: "No emails are waiting. The engine offers the day's emails here on weekday mornings.",
      primary: null,
      counts,
    };
  if (pending.length)
    return {
      tone: "ready",
      title,
      subtitle,
      pill: `${pending.length} to approve`,
      steps,
      next: "Read them below and leave out any you don't want. Nothing is sent until you press Send. The engine then sends them within a few minutes, during sending hours, from each person's own mailbox.",
      primary: {
        action: "send",
        ids: pending.map((i) => i.id),
        label: `Send ${plural(pending.length, "email")}`,
      },
      counts,
    };
  if (counts.approved)
    return {
      tone: "working",
      title,
      subtitle,
      pill: "Approved, going out",
      steps,
      next: `${plural(counts.approved, "email")} approved and waiting for the engine. ${counts.sent} sent so far. This page checks again every few seconds.`,
      primary: null,
      counts,
    };
  if (failed.length)
    return {
      tone: "failed",
      title,
      subtitle,
      pill: `${failed.length} not sent`,
      steps,
      next: `${plural(failed.length, "email")} could not be sent. The reason is on each one below. ${counts.sent} sent.`,
      primary: {
        action: "retry",
        ids: failed.map((i) => i.id),
        label: `Try ${plural(failed.length, "email")} again`,
      },
      counts,
    };
  return {
    tone: "done",
    title,
    subtitle,
    pill: counts.sent ? `Sent ${counts.sent}` : "Nothing sent",
    steps,
    next: counts.sent
      ? `${plural(counts.sent, "email")} sent${counts.skipped ? `, ${counts.skipped} left out` : ""}. Replies show under Email replies.`
      : `${plural(counts.skipped, "email")} left out. Nothing was sent.`,
    primary: null,
    counts,
  };
}
