// Lamp Brain, slice 1: the "Today" list. The rules find what needs doing; the model (when it's
// switched on) only explains it. Everything here is plain functions with no database or network,
// so the browser, the server route and the tests all run the same rules.
//
//   findToday(input, now, scope)  every open file and sent link, scored, best first
//   factsFor(items)               the only text the model ever sees (allowlisted, PII-checked)
//   checkBrief(brief, refs)       the model's answer, accepted only if it stays inside the facts
//
// What never leaves Lamp for the model: names of people, emails, phones, SSN, DOB, tax IDs, bank
// details, notes, document contents, application answers. Business names, stages, signal kinds,
// day counts and a rounded amount are all it gets, keyed by short refs (F1, L1), never ids.

export type Signal =
  | "offer_expiring"
  | "active_now"
  | "docs_in"
  | "package_ready"
  | "reached_signing"
  | "stalled_offer"
  | "stale"
  | "link_unopened";

/** Base points per signal: the higher, the sooner it matters. */
export const SIGNAL_POINTS: Record<Signal, number> = {
  offer_expiring: 50,
  active_now: 40,
  docs_in: 35,
  package_ready: 30,
  reached_signing: 25,
  stalled_offer: 20,
  link_unopened: 15,
  stale: 10,
};

export const SIGNAL_LABEL: Record<Signal, string> = {
  offer_expiring: "Offer running out",
  active_now: "On their file now",
  docs_in: "Documents came in",
  package_ready: "Ready for funders",
  reached_signing: "Just signed",
  stalled_offer: "Offer waiting",
  link_unopened: "Link not opened",
  stale: "Gone quiet",
};

export const STALE_DAYS = 3; // your own files
export const STALE_DAYS_TEAM = 7; // an admin looking at someone else's file
export const OFFER_SOON_HOURS = 48;
export const ACTIVE_MINUTES = 30;
export const LINK_DAYS = 2;
export const STALLED_OFFER_DAYS = 3;
export const SIGNED_RECENT_HOURS = 48;
export const PACKAGE_DOCS = 3;

const OPEN = new Set([
  "new",
  "reviewing",
  "docs_needed",
  "submitted",
  "offers_ready",
  "accepted",
  "closing",
]);
const BEFORE_FUNDERS = new Set(["new", "reviewing", "docs_needed"]);
const HOUR = 3_600_000;
const DAY = 86_400_000;

export type BrainFile = {
  id: string;
  status: string;
  rep_slug: string | null;
  user_id: string | null;
  business_name: string | null;
  amount_requested: number | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  document_count: number;
  documents_pending_review: number;
  submission_count: number;
};
export type BrainOffer = {
  application_id: string;
  status: string;
  presented_at: string | null;
  expires_at: string | null;
  accepted_at: string | null;
};
export type BrainEvent = {
  application_id: string | null;
  kind: string;
  actor_user_id: string | null;
  occurred_at: string;
};
export type BrainInvite = {
  id: string;
  rep_slug: string;
  business_name: string | null;
  sent_at: string | null;
  opened_at: string | null;
  cancelled_at: string | null;
  expires_at: string;
  application_id: string | null;
};
export type BrainInput = {
  files: BrainFile[];
  offers: BrainOffer[];
  /** events from the last ACTIVE_MINUTES or so; older ones are ignored */
  events: BrainEvent[];
  signed: { application_id: string; signed_at: string | null }[];
  invites: BrainInvite[];
};

/** Whose list this is: an admin sees everyone's (others' files go quiet later), a rep their own. */
export type Scope = { isAdmin: boolean; repSlug: string | null };

export type TodayItem = {
  ref: string; // F1, L1 ... in score order; the model only ever sees these
  kind: "file" | "link";
  id: string;
  business: string;
  stage: string | null;
  rep_slug: string | null;
  signal: Signal;
  /** every signal that fired, strongest first */
  signals: Signal[];
  score: number;
  /** the rules' own next step, used as-is when the model is off */
  next: string;
  /** numbers behind the sentence, for the model and the card */
  facts: { days?: number; hours?: number; docs?: number; amount?: number };
};

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const daysSince = (iso: string | null | undefined, now: number) =>
  Math.max(0, Math.floor((now - ms(iso)) / DAY));

/** Up to 15 points for size: $250k and over gets them all. */
export function sizePoints(amount: number | null): number {
  if (!amount || amount <= 0) return 0;
  return Math.min(15, Math.round((amount / 250_000) * 15));
}

/** A rounded amount for the model: $47,350 becomes 50000. Never the exact figure. */
export function roundAmount(amount: number | null): number | undefined {
  if (!amount || amount <= 0) return undefined;
  const step = amount >= 100_000 ? 25_000 : 5_000;
  return Math.round(amount / step) * step || step;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function nextStep(sig: Signal, f: TodayItem["facts"]): string {
  switch (sig) {
    case "offer_expiring":
      return `An offer runs out in ${plural(f.hours ?? 0, "hour")}. Call to get an answer or ask the funder to extend.`;
    case "active_now":
      return "The merchant is working on their file right now. Call while they're there.";
    case "docs_in":
      return `${plural(f.docs ?? 1, "new document")} came in. Review ${f.docs === 1 ? "it" : "them"} so the file can move.`;
    case "package_ready":
      return `Signed with ${plural(f.docs ?? 0, "document")} and not sent to funders yet. Send the package.`;
    case "reached_signing":
      return "Signed recently but statements are missing. Send a documents link for the last 3 months.";
    case "stalled_offer":
      return `Offers have been out ${plural(f.days ?? 0, "day")} with no answer. Check in on which one they like.`;
    case "link_unopened":
      return `The application link went out ${plural(f.days ?? 0, "day")} ago and hasn't been opened. Call or resend it.`;
    case "stale":
      return `Nothing has happened on this file for ${plural(f.days ?? 0, "day")}. Touch base.`;
  }
}

const STAFF_KINDS = new Set([
  "note",
  "call",
  "email",
  "sms",
  "meeting",
  "stage_change",
  "assigned",
  "system",
  "submitted_to_funder",
  "offer_received",
  "offer_presented",
  "document_reviewed",
]);

/** Every open file and sent link that needs something, scored and sorted, best first. */
export function findToday(input: BrainInput, now: Date, scope: Scope, limit = 12): TodayItem[] {
  const t = now.getTime();
  const signedAt = new Map(input.signed.map((s) => [s.application_id, s.signed_at]));
  const offersBy = new Map<string, BrainOffer[]>();
  for (const o of input.offers) {
    const list = offersBy.get(o.application_id) ?? [];
    list.push(o);
    offersBy.set(o.application_id, list);
  }
  const activeFiles = new Set<string>();
  const ownerOf = new Map(input.files.map((f) => [f.id, f.user_id]));
  for (const e of input.events) {
    if (!e.application_id || t - ms(e.occurred_at) > ACTIVE_MINUTES * 60_000) continue;
    const owner = ownerOf.get(e.application_id);
    const byMerchant =
      (owner && e.actor_user_id === owner) || (!e.actor_user_id && !STAFF_KINDS.has(e.kind));
    if (byMerchant) activeFiles.add(e.application_id);
  }

  const out: Omit<TodayItem, "ref">[] = [];
  for (const f of input.files) {
    if (!OPEN.has(f.status)) continue;
    if (!scope.isAdmin && f.rep_slug !== scope.repSlug) continue;
    const mine = f.rep_slug === scope.repSlug;
    const fired: { sig: Signal; since: number; facts: TodayItem["facts"] }[] = [];
    const offers = offersBy.get(f.id) ?? [];
    const accepted = offers.some((o) => o.accepted_at || o.status === "accepted");
    const live = offers.filter(
      (o) => o.status === "presented" && !o.accepted_at && !(ms(o.expires_at) < t),
    );

    const soonest = live
      .map((o) => ms(o.expires_at))
      .filter((x) => !Number.isNaN(x) && x - t <= OFFER_SOON_HOURS * HOUR)
      .sort((a, b) => a - b)[0];
    if (!accepted && soonest !== undefined)
      fired.push({
        sig: "offer_expiring",
        since: t,
        facts: { hours: Math.max(1, Math.ceil((soonest - t) / HOUR)) },
      });

    if (activeFiles.has(f.id)) fired.push({ sig: "active_now", since: t, facts: {} });

    if (f.documents_pending_review > 0)
      fired.push({
        sig: "docs_in",
        since: ms(f.last_activity_at) || t,
        facts: { docs: f.documents_pending_review },
      });

    const signed = signedAt.get(f.id);
    if (signed && BEFORE_FUNDERS.has(f.status) && f.submission_count === 0) {
      if (f.document_count >= PACKAGE_DOCS)
        fired.push({ sig: "package_ready", since: ms(signed), facts: { docs: f.document_count } });
      else if (t - ms(signed) <= SIGNED_RECENT_HOURS * HOUR)
        fired.push({
          sig: "reached_signing",
          since: ms(signed),
          facts: { docs: f.document_count },
        });
    }

    if (!accepted && live.length) {
      const first = Math.min(
        ...live.map((o) => ms(o.presented_at)).filter((x) => !Number.isNaN(x)),
      );
      if (Number.isFinite(first) && t - first >= STALLED_OFFER_DAYS * DAY)
        fired.push({
          sig: "stalled_offer",
          since: first,
          facts: { days: daysSince(new Date(first).toISOString(), t) },
        });
    }

    const quietFrom = f.last_activity_at ?? f.updated_at;
    const quietDays = daysSince(quietFrom, t);
    if (!fired.length && quietDays >= (mine || !scope.isAdmin ? STALE_DAYS : STALE_DAYS_TEAM))
      fired.push({ sig: "stale", since: ms(quietFrom), facts: { days: quietDays } });

    if (!fired.length) continue;
    fired.sort((a, b) => SIGNAL_POINTS[b.sig] - SIGNAL_POINTS[a.sig]);
    const top = fired[0]!;
    const age = Math.min(20, 2 * daysSince(new Date(top.since).toISOString(), t));
    const amount = roundAmount(f.amount_requested);
    const facts: TodayItem["facts"] = amount ? { ...top.facts, amount } : { ...top.facts };
    out.push({
      kind: "file",
      id: f.id,
      business: f.business_name?.trim() || "A business",
      stage: f.status,
      rep_slug: f.rep_slug,
      signal: top.sig,
      signals: fired.map((x) => x.sig),
      score: SIGNAL_POINTS[top.sig] + sizePoints(f.amount_requested) + age,
      next: nextStep(top.sig, top.facts),
      facts,
    });
  }

  for (const i of input.invites) {
    if (!scope.isAdmin && i.rep_slug !== scope.repSlug) continue;
    if (i.opened_at || i.cancelled_at || i.application_id || !i.sent_at) continue;
    if (ms(i.expires_at) < t) continue;
    const days = daysSince(i.sent_at, t);
    if (days < LINK_DAYS) continue;
    out.push({
      kind: "link",
      id: i.id,
      business: i.business_name?.trim() || "A business",
      stage: null,
      rep_slug: i.rep_slug,
      signal: "link_unopened",
      signals: ["link_unopened"],
      score: SIGNAL_POINTS.link_unopened + Math.min(20, 2 * (days - LINK_DAYS)),
      next: nextStep("link_unopened", { days }),
      facts: { days },
    });
  }

  out.sort((a, b) => b.score - a.score || a.business.localeCompare(b.business));
  let fileN = 0;
  let linkN = 0;
  return out.slice(0, limit).map((x) => ({
    ...x,
    ref: x.kind === "file" ? `F${++fileN}` : `L${++linkN}`,
  }));
}

// ---------- what the model may see ----------

const PII = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, // email
  /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, // phone
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b\d{2}-\d{7}\b/, // EIN
  /\d{7,}/, // any long number (accounts, routing, IDs)
];

/** True when the text looks like it carries personal or account details. */
export const looksPrivate = (s: string) => PII.some((re) => re.test(s));

/** A business name the model may see, or a stand-in when it looks like it hides a detail. */
export function safeName(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
  return clean && !looksPrivate(clean) ? clean : "A business";
}

export type Fact = {
  ref: string;
  business: string;
  stage: string | null;
  signals: Signal[];
  days?: number;
  hours?: number;
  docs?: number;
  amount?: number;
  rep?: string;
};

/** The allowlist: exactly these fields, nothing else from the file. */
export function factsFor(
  items: TodayItem[],
  repName?: (slug: string | null) => string | undefined,
): Fact[] {
  return items.map((i) => {
    const f: Fact = {
      ref: i.ref,
      business: safeName(i.business),
      stage: i.stage,
      signals: i.signals,
    };
    if (i.facts.days !== undefined) f.days = i.facts.days;
    if (i.facts.hours !== undefined) f.hours = i.facts.hours;
    if (i.facts.docs !== undefined) f.docs = i.facts.docs;
    if (i.facts.amount !== undefined) f.amount = i.facts.amount;
    const rep = repName?.(i.rep_slug);
    if (rep && !looksPrivate(rep)) f.rep = rep.slice(0, 40);
    return f;
  });
}

// ---------- what the model may say ----------

export type Brief = { headline: string; items: { ref: string; next: string }[] };

const BANNED = /\bloans?\b|\blend(ing)?\b/i;

/**
 * The model's answer, kept only where it stays inside the facts: known refs, no private-looking
 * text, no "loan", sensible lengths. Returns null when the headline fails; drops bad lines.
 */
export function checkBrief(raw: unknown, refs: Set<string>): Brief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { headline?: unknown; items?: unknown };
  if (typeof r.headline !== "string") return null;
  const headline = r.headline.replace(/\s+/g, " ").trim();
  if (!headline || headline.length > 240 || BANNED.test(headline) || looksPrivate(headline))
    return null;
  const items: Brief["items"] = [];
  const seen = new Set<string>();
  for (const it of Array.isArray(r.items) ? r.items : []) {
    if (!it || typeof it !== "object") continue;
    const { ref, next } = it as { ref?: unknown; next?: unknown };
    if (typeof ref !== "string" || !refs.has(ref) || seen.has(ref)) continue;
    if (typeof next !== "string") continue;
    const line = next.replace(/\s+/g, " ").trim();
    if (!line || line.length > 280 || BANNED.test(line) || looksPrivate(line)) continue;
    // a sentence naming another file's ref would point the reader at the wrong file
    const named = line.match(/\b[FL]\d+\b/g) ?? [];
    if (named.some((n) => n !== ref)) continue;
    seen.add(ref);
    items.push({ ref, next: line });
  }
  return { headline, items };
}

/** Today's date in New York, the day a brief belongs to. */
export const briefDay = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
