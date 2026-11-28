// The online application's contact screen saves the visitor as a lead at once
// (POST /api/application/start), so a person who stops halfway can still be called. Until
// 2026-11-27 a failed save was dropped silently and nothing tried again (gap 2). The server now
// answers its own failures (start-never-lost): when the save itself fails it still emails the
// team the person's details with a "not saved in Lamp" line, and answers 500 with its own words.
// So this side retries only a request that never got the server's answer: no connection, a
// timeout, or a 5xx the server didn't write (the edge's 502/503/504, a crashed worker). That is
// kept in this tab's sessionStorage and tried again: once straight away, before the rough range
// shows (not after a timeout, when the first may still be running), and once more when the
// visitor moves on to the next step. The server's own 500, a 429 (this network's hourly cap) and
// a 404 (an inactive rep's link) are never retried, so one person never sets off a second
// "not saved" email. Whatever happens, the visitor carries on with the form.
//
// Kept free of React and the "@/" alias so the tests can run it.

export type StartBody = Record<string, unknown>;

/** What the start route answered; status null when the request never got an answer, and
 *  timedOut when that was because it took longer than START_TIMEOUT_MS. */
export type StartReply = { status: number | null; body: unknown; timedOut?: boolean };

export type StartSend = (body: StartBody) => Promise<StartReply>;

export type KeptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StartDeps = {
  send: StartSend;
  /** This tab's sessionStorage, or null where the browser refuses it. */
  storage: KeptStorage | null;
  /** This browser's key for the application: the rep's slug, or "website". */
  store: string;
  /** The pause before the retry; tests pass one that doesn't wait. */
  wait?: (ms: number) => Promise<void>;
};

export type StartResult = {
  /** saved: on the lead list. fix: the server refused the details (show its words).
   *  kept: still not saved, kept for one more try. stopped: not saved, and not retried. */
  outcome: "saved" | "fix" | "kept" | "stopped";
  error?: string;
  /** The lead's progress token, when saved (see application-progress). */
  progress?: string;
};

/** The start route's own answers carry { error: "<its words>" }; an edge's error page doesn't. */
export function fromServer(body: unknown): boolean {
  return field(body, "error") !== undefined;
}

/**
 * What to do with an answer: saved (2xx), fix the details (400), retry (no answer, or a 5xx the
 * start route didn't write), or stop (the route's own 5xx, 429, 404 and every other refusal).
 * The route's own 5xx is final because it has already emailed the team the details.
 */
export function startVerdict(
  status: number | null,
  ownAnswer = false,
): "saved" | "fix" | "retry" | "stop" {
  if (status === null) return "retry";
  if (status >= 500) return ownAnswer ? "stop" : "retry";
  if (status >= 200 && status < 300) return "saved";
  if (status === 400) return "fix";
  return "stop";
}

function field(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const v = (body as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

const verdictOf = (reply: StartReply) => startVerdict(reply.status, fromServer(reply.body));

export const keptStartKey = (store: string) => `lamp.application.start.kept.${store}`;

/** The 1-second pause before the retry, so a blip has time to pass. */
export const RETRY_PAUSE_MS = 1000;

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function keep(deps: StartDeps, body: StartBody) {
  try {
    deps.storage?.setItem(keptStartKey(deps.store), JSON.stringify(body));
  } catch {
    /* storage full or refused: the retry before the range still runs */
  }
}

function drop(deps: StartDeps) {
  try {
    deps.storage?.removeItem(keptStartKey(deps.store));
  } catch {
    /* nothing to drop */
  }
}

function result(verdict: "saved" | "fix" | "stop", reply: StartReply): StartResult {
  if (verdict === "saved") {
    const progress = field(reply.body, "progress");
    return progress ? { outcome: "saved", progress } : { outcome: "saved" };
  }
  if (verdict === "fix") {
    const error = field(reply.body, "error");
    return error ? { outcome: "fix", error } : { outcome: "fix" };
  }
  return { outcome: "stopped" };
}

/**
 * The contact screen's save. A request that got no answer from the route is kept and tried once
 * more, straight away; if that fails the same way it stays kept for retryKeptStart at the next
 * step. A timeout goes straight to the next step's try: the first may still be saving.
 */
export async function sendStart(body: StartBody, deps: StartDeps): Promise<StartResult> {
  const first = await deps.send(body);
  const v = verdictOf(first);
  if (v !== "retry") {
    // an earlier try kept from this tab is settled by this answer
    drop(deps);
    return result(v, first);
  }
  keep(deps, body);
  if (first.timedOut) return { outcome: "kept" };
  await (deps.wait ?? pause)(RETRY_PAUSE_MS);
  const second = await deps.send(body);
  const v2 = verdictOf(second);
  if (v2 === "retry") return { outcome: "kept" };
  drop(deps);
  return result(v2, second);
}

/**
 * The last try, when the visitor moves on to the next step: sends what sendStart kept, once.
 * Null when nothing is kept. Whatever the answer, nothing is kept afterwards.
 */
export async function retryKeptStart(deps: StartDeps): Promise<StartResult | null> {
  let raw: string | null = null;
  try {
    raw = deps.storage?.getItem(keptStartKey(deps.store)) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  drop(deps);
  let body: StartBody;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    body = parsed as StartBody;
  } catch {
    return null;
  }
  const reply = await deps.send(body);
  const v = verdictOf(reply);
  return v === "retry" ? { outcome: "stopped" } : result(v, reply);
}

/**
 * How long the contact screen waits for one answer before treating it as lost. Well above the
 * route's slowest normal answer (the save, then the Gmail token and the heads-up email, then the
 * progress token), so a slow save that works is never cut off and sent again.
 */
export const START_TIMEOUT_MS = 30_000;

/**
 * The browser's own send: POST /api/application/start. Never throws. A request that gets no
 * answer in START_TIMEOUT_MS counts as lost (timedOut), so the visitor is never held on the
 * contact screen for good. Its next try waits for the next step; if the first did save, that try
 * is caught by the server's same-email check and sends no second email. (Its own time limit, so
 * the tests can use a short one.)
 */
export const fetchStartWithin =
  (ms: number): StartSend =>
  async (body) => {
    const ctl = typeof AbortController === "undefined" ? null : new AbortController();
    const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
    try {
      const res = await fetch("/api/application/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...(ctl ? { signal: ctl.signal } : {}),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch {
      return ctl?.signal.aborted
        ? { status: null, body: null, timedOut: true }
        : { status: null, body: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

/** fetchStartWithin at the page's limit. */
export const fetchStart: StartSend = (body) => fetchStartWithin(START_TIMEOUT_MS)(body);

/** This tab's sessionStorage, or null where the browser refuses it (private modes, previews). */
export function tabStorage(): KeptStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
