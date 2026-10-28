// How far someone got on a rep's public application link, before signing: the stage the rep sees
// on the Applications tab, with what to cover when they call. A stage is the furthest section
// reached with everything before it done: online, the step they moved on to; on the one-page
// form, the first section still missing something. Same meaning on both links, so the A/B test
// compares like with like. Stored on the lead (answers.progress), keyed by a token the browser
// got from /api/application/start. Pure functions and browser helpers only.
import { missing, type Details } from "@/lib/application-details";

export const STAGES = ["contact", "owners", "property", "funding", "statements", "sign"] as const;
export type Stage = (typeof STAGES)[number];
export type Form = "online" | "pdf";

export const isStage = (s: unknown): s is Stage => STAGES.includes(s as Stage);
export const rank = (s: Stage) => STAGES.indexOf(s);

/** Where they stopped, and what to cover on the call. */
export const STAGE_INFO: Record<Stage, { label: string; call: string }> = {
  contact: {
    label: "Gave contact details, stopped on business details",
    call: "Ask what the money is for, how much and how soon. Then help with EIN, start date and monthly revenue (a bank statement has the revenue figure).",
  },
  owners: {
    label: "Stopped on owner details",
    call: "Usually the SSN and date of birth. Explain that funders need them to review the application, and who sees them.",
  },
  property: {
    label: "Stopped on real estate",
    call: "Tell them it's optional upside: owning property can open larger, longer funding. A yes or no is enough.",
  },
  funding: {
    label: "Stopped on amount and current balances",
    call: "Normalize existing advances. Ask what they owe and pay each day or week, and the amount they need.",
  },
  statements: {
    label: "Stopped on bank statements",
    call: "Offer to take the last 4 months by text or email, or walk them through downloading them.",
  },
  sign: {
    label: "Reached signing, didn't sign",
    call: "Walk through the authorization, answer questions about cost and timing, and get it signed while you're on the phone.",
  },
};

/** The one-page form: the first section not done yet, in the online application's order. */
export function paperStage(d: Details): Stage {
  // sorted by missing()'s wording; the two questions under the form count as "property"
  const kind = (m: string) =>
    /^(second )?owner's/.test(m)
      ? "owners"
      : /real estate|bankruptcy/.test(m)
        ? "property"
        : /amount requested/.test(m)
          ? "funding"
          : "business";
  const todo = new Set(missing(d, { propertyDetails: false }).map(kind));
  const first = (["business", "owners", "property", "funding"] as const).find((s) => todo.has(s));
  // business details unfinished means nothing past the contact boxes is done yet
  return first === "business" ? "contact" : (first ?? "sign");
}

const tokenKey = (rep: string) => `lamp.application.progress.${rep}`;

export function saveProgressToken(rep: string, token: string) {
  try {
    window.localStorage.setItem(tokenKey(rep), token);
  } catch {
    /* progress just won't be reported */
  }
}

export function progressToken(rep: string): string | null {
  try {
    return window.localStorage.getItem(tokenKey(rep));
  } catch {
    return null;
  }
}

/** Tells Lamp the stage reached; the server keeps the furthest. Best effort. */
export function reportStage(rep: string, stage: Stage, form: Form) {
  const token = progressToken(rep);
  if (!token) return;
  void fetch("/api/application/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, stage, form }),
    keepalive: true,
  }).catch(() => undefined);
}
