// The online application's first paint and how it picks up where a visitor left off
// (gap 4, 2026-11-27). The website's own /application used to render a spinner until the
// script loaded and /api/application/open answered, although for the website that answer never
// changes. Now the server renders the first question, a tap works before the script arrives,
// and this browser's saved answers are merged in after the first render, so the server's HTML
// and the browser's first render are the same.
//
// Kept free of React and the "@/" alias so the tests can run it.
import { QUESTIONS, type ChoiceKey } from "./apply.ts";
import type { OpenResponse } from "./application-links.ts";
import { REQUIRED_DOCUMENTS } from "./documents.ts";

export type Quick = Partial<Record<ChoiceKey, string>>;

/**
 * What /api/application/open answers for the website's own application (no token, no rep:
 * application-links.server.ts, the `slug === ""` case). It does no database read and records
 * nothing, so the page starts with it instead of asking.
 */
export const WEBSITE_OPEN: OpenResponse = {
  state: "open",
  draft: null,
  rep: null,
  prefill: null,
};

/** The website's own application: no personal link and no rep. */
export const isWebsite = (token: string | null, repSlug: string) => !token && repSlug === "";

/**
 * The body of the open call, or null when there is nothing to ask (the website). A personal link
 * still asks, so the merchant's visit is counted; a rep's public link still asks for the rep's
 * name and whether the rep is active.
 */
export function openRequest(
  token: string | null,
  repSlug: string,
): { token: string } | { rep: string } | null {
  if (token) return { token };
  if (repSlug === "") return null;
  return { rep: repSlug };
}

/** The first question not answered yet; QUESTIONS.length once they're all done. */
export function firstUnanswered(quick: Quick): number {
  const i = QUESTIONS.findIndex((q) => !quick[q.key]);
  return i === -1 ? QUESTIONS.length : i;
}

export type QuickState = { quick: Quick; quickStep: number; contactDone: boolean };

/**
 * The first render, the same on the server and in the browser: only what the link itself says.
 * Nothing here reads this browser's storage; withThisBrowser does that after mount.
 */
export function firstPaint(token: string | null, prefill: Quick): QuickState {
  const quick = { ...prefill };
  return { quick, quickStep: firstUnanswered(quick), contactDone: Boolean(token) };
}

/**
 * After mount: this browser's earlier quick answers (the link's answers win) and whether this
 * browser already gave its name and number.
 */
export function withThisBrowser(
  first: QuickState,
  prefill: Quick,
  stored: Quick,
  started: boolean,
): QuickState {
  const quick = { ...stored, ...prefill };
  return { quick, quickStep: firstUnanswered(quick), contactDone: first.contactDone || started };
}

export type Saved<D> = { d: D; step: number; savedAt: number };

/**
 * Which saved answers to reopen: answers a rep filled in on the phone when they're newer than
 * this browser's own, otherwise this browser's.
 */
export function pickSaved<D>(local: Saved<D> | null, server: Saved<D> | null): Saved<D> | null {
  if (server && server.savedAt > (local?.savedAt ?? 0)) return server;
  return local;
}

/**
 * Where a returning visitor lands: the first step with something missing (the SSN and date of
 * birth are never saved), never past the furthest step they reached, which stays reachable.
 * firstGap is -1 when nothing is missing.
 */
export function resumeAt(savedStep: number, firstGap: number): { step: number; visited: number } {
  return { step: firstGap >= 0 ? Math.min(firstGap, savedStep) : savedStep, visited: savedStep };
}

/**
 * Whether the drop-off count (apply_step) may log the current step: a public link that is open,
 * and only once this browser's saved place is back. Before that, a returning visitor would be
 * logged at the first question on the way to their own step.
 */
export function stepTracked(
  token: string | null,
  restored: boolean,
  open: OpenResponse | "error" | null,
): boolean {
  return !token && restored && !!open && open !== "error" && open.state === "open";
}

/**
 * A quick-question answer as a link to the same page with that answer in the address, the way
 * the home page's amount tiles work. Before the script has loaded, a tap is a plain page load
 * that skips the question (quickFromParams); after, the page handles the tap itself. Only the
 * quick answers and utm_ tags ride in the link, never anything personal.
 */
export function quickOptionHref(
  path: string,
  carried: Record<string, string>,
  quick: Quick,
  key: ChoiceKey,
  id: string,
): string {
  const answers: Quick = { ...quick, [key]: id };
  const params = new URLSearchParams();
  for (const q of QUESTIONS) {
    const v = answers[q.key] ?? carried[q.key];
    if (v) params.set(q.key, v);
  }
  for (const [k, v] of Object.entries(carried)) if (k.startsWith("utm_")) params.set(k, v);
  return `${path}?${params.toString()}`;
}

/** The page's own address: the website's /application, or a rep's public link. */
export const applicationPath = (repSlug: string) =>
  repSlug === "" ? "/application" : `/application/${repSlug}`;

/** How many months of bank statements the account checklist asks for (documents.ts). */
export const STATEMENT_MONTHS =
  REQUIRED_DOCUMENTS.find((r) => r.kind === "bank_statement")?.required ?? 3;

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** 3 → "three", for copy; numbers past nine stay as digits. */
export const countWord = (n: number) => WORDS[n] ?? String(n);
