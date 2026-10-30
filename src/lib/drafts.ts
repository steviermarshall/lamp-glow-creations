// Follow-up drafts for the Today list (Lamp Brain, slice 2): a text, an email and call notes for
// one item, which the rep edits and sends themselves. Nothing here sends anything.
//
//   ruleDraft(signal, facts)   Lamp's own wording for every signal, used when Claude is off
//   checkDraft(raw)            Claude's wording, kept only if it passes the same rules
//   fillDraft(draft, values)   puts the real first name, rep name and links in, after Claude
//
// Claude never sees a person's name, phone or email: drafts are written with the placeholders
// {first_name} and {rep_name} (and {docs_link} when a documents link is asked for), and Lamp
// fills them in on its own server. Merchant-facing words follow Lamp's rules: never "loan" or
// "lending", never a promise of approval, no rates, and every text ends with a way to opt out.

import { looksPrivate, type Signal } from "./brain.ts";

export type Draft = {
  text: string;
  email_subject: string;
  email_body: string;
  call: string[];
};

export type DraftFacts = {
  business: string;
  days?: number;
  hours?: number;
  docs?: number;
  /** a documents link is being added: write {docs_link} where it goes */
  docsLink?: boolean;
};

export const PLACEHOLDERS = ["{first_name}", "{rep_name}", "{docs_link}"] as const;
export const TEXT_MAX = 320;
export const STOP_LINE = "Reply STOP to opt out.";

/** The signals where asking for statements with a documents link is the next step. */
export const WANTS_DOCS_LINK: Signal[] = ["reached_signing"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Lamp's own draft for a signal. Always available, costs nothing. */
export function ruleDraft(sig: Signal, f: DraftFacts): Draft {
  const hi = "Hi {first_name}, it's {rep_name} at Lamp.";
  const sign = "\n\nThanks,\n{rep_name}\nLamp";
  const link = f.docsLink ? " You can drop them in here, no sign-in needed: {docs_link}" : "";
  switch (sig) {
    case "offer_expiring":
      return {
        text: `${hi} Your funding offer for ${f.business} is only open for about ${plural(f.hours ?? 24, "more hour")}. Do you have 5 minutes today to go over it?`,
        email_subject: `Your offer for ${f.business} closes soon`,
        email_body: `Hi {first_name},\n\nThe funding offer for ${f.business} is only open for about ${plural(f.hours ?? 24, "more hour")}. If you'd like it, or want to talk through the numbers first, reply here or call me today and we'll get it done before it closes.${sign}`,
        call: [
          `The offer runs out in about ${plural(f.hours ?? 24, "hour")}: say so first.`,
          "Walk through the payment per day or week, the total payback and what lands in their account.",
          "Ask which way they're leaning. If they need more time, ask the funder to extend.",
          "If they want it, mark it accepted on the file and start closing.",
        ],
      };
    case "active_now":
      return {
        text: `${hi} I see you're working on your application for ${f.business}. Any questions I can answer while you're on it?`,
        email_subject: `Questions on your ${f.business} application?`,
        email_body: `Hi {first_name},\n\nI saw you're working on the application for ${f.business}. If anything is unclear, reply here or call me and I'll walk you through it.${sign}`,
        call: [
          "They're on their file right now: call before they leave.",
          "Ask where they are and whether anything is holding them up (owner details and statements are the usual ones).",
          "Explain why funders need what they need and who sees it.",
        ],
      };
    case "docs_in":
      return {
        text: `${hi} Got your documents for ${f.business}, thank you. I'm going through them now and will be in touch.`,
        email_subject: `We got your documents for ${f.business}`,
        email_body: `Hi {first_name},\n\nThanks for sending your documents for ${f.business}. I'm reviewing them now and will let you know if anything else is needed.${sign}`,
        call: [
          `Review the ${f.docs === 1 ? "new document" : "new documents"} on the file first: accept them, or mark what needs re-sending.`,
          "If something is missing or unreadable, call and say exactly what to send.",
        ],
      };
    case "package_ready":
      return {
        text: `${hi} Your application for ${f.business} is complete. I'm sending it to our funders now and will let you know as soon as offers come back.`,
        email_subject: `Your ${f.business} application is going to funders`,
        email_body: `Hi {first_name},\n\nYour application for ${f.business} is complete, thank you. I'm sending it to our funders now and will let you know as soon as offers come back.${sign}`,
        call: [
          "Send the package from the file first: Send to funders.",
          "Then tell them it's out and when offers usually come back.",
          "Ask if anything has changed since they signed (new advances, a big deposit, a slow month).",
        ],
      };
    case "reached_signing":
      return {
        text: `${hi} Thanks for signing for ${f.business}. To send it to funders I need your last 3 months of business bank statements.${link}`,
        email_subject: `One more step for ${f.business}: bank statements`,
        email_body: `Hi {first_name},\n\nThanks for signing the application for ${f.business}. To send it to our funders I need your last 3 months of business bank statements (PDFs from your bank are best).${link}${sign}`,
        call: [
          "Thank them for signing.",
          "Ask for the last 3 months of business bank statements, as PDFs from the bank.",
          "Offer to text or email a documents link while you're on the phone.",
        ],
      };
    case "stalled_offer":
      return {
        text: `${hi} Have you had a chance to look at the offers for ${f.business}? Happy to go over them with you.`,
        email_subject: `Your offers for ${f.business}`,
        email_body: `Hi {first_name},\n\nYour offers for ${f.business} have been ready for ${plural(f.days ?? 3, "day")}. If you'd like to go over them, or compare two side by side, reply here or call me.${sign}`,
        call: [
          `The offers have been out ${plural(f.days ?? 3, "day")}: ask which one they like.`,
          "If they're unsure, compare the payment and total payback in dollars.",
          "Ask what would make them comfortable: amount, term or payment size.",
        ],
      };
    case "link_unopened":
      return {
        text: `${hi} I sent you an application link for ${f.business} ${plural(f.days ?? 2, "day")} ago. Did it come through? I can send it again.`,
        email_subject: `Your Lamp application for ${f.business}`,
        email_body: `Hi {first_name},\n\nI sent you an application link for ${f.business} ${plural(f.days ?? 2, "day")} ago. In case it got buried: it takes about 10 minutes and doesn't affect your credit. Reply here and I'll send it again.${sign}`,
        call: [
          "Ask if they got the link. Check the email address you have.",
          "Send it again from Applications if needed.",
          "Find out what they need the funding for and how soon.",
        ],
      };
    case "stale":
      return {
        text: `${hi} Checking in on your application for ${f.business}. Is now still a good time to move ahead?`,
        email_subject: `Checking in on ${f.business}`,
        email_body: `Hi {first_name},\n\nI wanted to check in on your application for ${f.business}. Is now still a good time to move ahead, or should I follow up later?${sign}`,
        call: [
          `Nothing has happened in ${plural(f.days ?? 3, "day")}: ask if the timing still works.`,
          "Find out what's holding it up and the next step on each side.",
          "If it's dead, move the file to Withdrawn so the list stays honest.",
        ],
      };
  }
}

// Merchant-facing words Lamp never uses: it's funding or an advance, nothing is promised, and
// rates are explained by a person on the phone, not in a message.
const BANNED =
  /\bloans?\b|\blend(ing|er|ers)?\b|\bguarantee[ds]?\b|\bpre-?approved\b|\bapproved\b|\bapproval\b|\binterest\b|\bAPR\b|\bcredit score\b|\b\d+(\.\d+)?\s?%/i;

const placeholdersOk = (s: string, docs: boolean) =>
  (s.match(/\{[a-z_]+\}/g) ?? []).every(
    (p) => (PLACEHOLDERS as readonly string[]).includes(p) && (docs || p !== "{docs_link}"),
  );

const clean = (s: unknown, max: number) =>
  typeof s === "string"
    ? s
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, max + 1)
    : "";

/** Why a piece of merchant-facing text fails Lamp's rules, or null when it's fine. */
export function draftProblem(s: string, docs: boolean): string | null {
  if (!s) return "empty";
  if (BANNED.test(s)) return "wording";
  if (looksPrivate(s.replace(/\{[a-z_]+\}/g, ""))) return "private";
  if (!placeholdersOk(s, docs)) return "placeholder";
  return null;
}

/**
 * Claude's draft, kept field by field: a field that fails falls back to Lamp's own wording for
 * it. Returns the merged draft and which fields Claude wrote.
 */
export function checkDraft(
  raw: unknown,
  fallback: Draft,
  docs: boolean,
): { draft: Draft; written: (keyof Draft)[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Draft = { ...fallback, call: [...fallback.call] };
  const written: (keyof Draft)[] = [];
  const text = clean(r["text"], TEXT_MAX);
  if (
    text.length <= TEXT_MAX - STOP_LINE.length - 1 &&
    !draftProblem(text, docs) &&
    text.includes("{rep_name}")
  ) {
    out.text = text;
    written.push("text");
  }
  const subject = clean(r["email_subject"], 90);
  if (subject.length <= 90 && !subject.includes("\n") && !draftProblem(subject, false)) {
    out.email_subject = subject;
    written.push("email_subject");
  }
  const body = clean(r["email_body"], 1500);
  if (body.length <= 1500 && !draftProblem(body, docs) && body.includes("{rep_name}")) {
    out.email_body = body;
    written.push("email_body");
  }
  const call = Array.isArray(r["call"])
    ? r["call"].map((c) => clean(c, 200)).filter((c) => c && c.length <= 200)
    : [];
  // call notes are for the rep, but they still mustn't carry anything private or made up
  if (
    call.length >= 1 &&
    call.length <= 6 &&
    call.every((c) => !looksPrivate(c) && !/\{[a-z_]+\}/.test(c))
  ) {
    out.call = call;
    written.push("call");
  }
  return { draft: out, written };
}

export type FillValues = { first_name: string | null; rep_name: string; docs_link?: string | null };

/** The draft as the rep sees it: real names in, a STOP line on the text. */
export function fillDraft(d: Draft, v: FillValues): Draft {
  const first = (v.first_name ?? "").trim().split(/\s+/)[0] || "there";
  const put = (s: string) =>
    s
      .replaceAll("{first_name}", first)
      .replaceAll("{rep_name}", v.rep_name)
      .replaceAll("{docs_link}", v.docs_link ?? "[documents link]");
  const text = put(d.text).replace(/\s*Reply STOP to opt out\.?\s*$/i, "");
  return {
    text: `${text} ${STOP_LINE}`,
    email_subject: put(d.email_subject),
    email_body: put(d.email_body),
    call: d.call.map(put),
  };
}

/** Texting needs the merchant's consent on record: the lead form's phone consent, or signing. */
export const canText = (f: {
  phone: string | null;
  phone_consent_at: string | null;
  signed_at: string | null;
}) => !!f.phone && !!(f.phone_consent_at || f.signed_at);

/** A phone number as a tel:/sms: target, US numbers only. */
export function dialable(phone: string | null): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}
