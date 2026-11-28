// Quick questions for the website's application (/application). Every choice id doubles as a
// URL param value, so email campaigns can link straight into the flow, e.g.
// /application?amount=50-100k&industry=trucking. Old /apply links are sent on with their quick
// answers and utm_ tags only (see carriedSearch); ref, contact keys and unknown keys drop.

export type Option = { id: string; label: string; hint?: string };

export type ChoiceQuestion = {
  key: ChoiceKey;
  title: string;
  subtitle?: string;
  options: Option[];
};

export type ChoiceKey =
  "amount" | "purpose" | "revenue" | "tib" | "credit" | "industry" | "timeline";

export type ContactKey = "firstName" | "businessName" | "phone" | "email" | "phoneConsent";

export type Answers = Partial<Record<ChoiceKey | ContactKey, string>>;

export const AMOUNT_OPTIONS: Option[] = [
  { id: "lt-25k", label: "Under $25k" },
  { id: "25-50k", label: "$25k – $50k" },
  { id: "50-100k", label: "$50k – $100k" },
  { id: "100-250k", label: "$100k – $250k" },
  { id: "250k-plus", label: "$250k+" },
];

export const QUESTIONS: ChoiceQuestion[] = [
  {
    key: "amount",
    title: "How much are you looking for?",
    subtitle: "A ballpark is fine. You can change it later.",
    options: AMOUNT_OPTIONS,
  },
  {
    key: "purpose",
    title: "What's it for?",
    options: [
      { id: "cash-flow", label: "Cash flow & bills" },
      { id: "payroll", label: "Payroll" },
      { id: "inventory", label: "Inventory & supplies" },
      { id: "equipment", label: "Equipment or trucks" },
      { id: "expansion", label: "Growth or a new location" },
      { id: "other", label: "Something else" },
    ],
  },
  {
    key: "revenue",
    title: "About how much comes in each month?",
    subtitle: "Total deposits into your business account.",
    options: [
      { id: "lt-20k", label: "Under $20k" },
      { id: "20-50k", label: "$20k – $50k" },
      { id: "50-100k", label: "$50k – $100k" },
      { id: "100-250k", label: "$100k – $250k" },
      { id: "250k-plus", label: "$250k+" },
    ],
  },
  {
    key: "tib",
    title: "How long have you been in business?",
    options: [
      { id: "lt-6m", label: "Less than 6 months" },
      { id: "6-12m", label: "6 – 12 months" },
      { id: "1-2y", label: "1 – 2 years" },
      { id: "2-5y", label: "2 – 5 years" },
      { id: "5y-plus", label: "5+ years" },
    ],
  },
  {
    key: "credit",
    title: "Roughly where's your personal credit?",
    subtitle: "Your best guess. Answering this doesn't touch your credit.",
    options: [
      { id: "lt-550", label: "Under 550" },
      { id: "550-649", label: "550 – 649" },
      { id: "650-699", label: "650 – 699" },
      { id: "700-plus", label: "700+" },
      { id: "unsure", label: "Not sure" },
    ],
  },
  {
    key: "industry",
    title: "What kind of business?",
    options: [
      { id: "restaurant", label: "Restaurant or food" },
      { id: "trucking", label: "Trucking & logistics" },
      { id: "construction", label: "Contractor or construction" },
      { id: "retail", label: "Retail or e-commerce" },
      { id: "beauty", label: "Salon, spa, or barber" },
      { id: "auto", label: "Auto shop" },
      { id: "medical", label: "Medical or dental" },
      { id: "other", label: "Something else" },
    ],
  },
  {
    key: "timeline",
    title: "When do you need it?",
    options: [
      { id: "asap", label: "This week" },
      { id: "month", label: "This month" },
      { id: "exploring", label: "Just seeing my options" },
    ],
  },
];

export const CONTACT_KEYS: ContactKey[] = ["firstName", "businessName", "phone", "email"];

/** Shown next to the phone field and stored with a timestamp when they tick the box.
 *  Have the attorney review this wording before calls or texts go out at volume. */
export const PHONE_CONSENT_TEXT =
  "I agree that Lamp may call and text me at this number about my application and funding options, including with automated technology. Agreeing isn't required to get offers. Message and data rates may apply, and frequency varies. Reply STOP to opt out.";

/** URL params read for prefill. Short, email-friendly names. /application keeps only the
 *  question ones (see carriedSearch), so contact details are never carried in a link. */
export const PARAM_MAP: Record<string, ChoiceKey | ContactKey> = {
  amount: "amount",
  purpose: "purpose",
  revenue: "revenue",
  tib: "tib",
  credit: "credit",
  industry: "industry",
  timeline: "timeline",
  name: "firstName",
  first_name: "firstName",
  business: "businessName",
  phone: "phone",
  email: "email",
};

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "ref",
] as const;

export function answersFromParams(params: Record<string, unknown>): Answers {
  const out: Answers = {};
  for (const [param, key] of Object.entries(PARAM_MAP)) {
    const raw = params[param];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const value = raw.trim().slice(0, 120);
    const q = QUESTIONS.find((x) => x.key === key);
    if (q && !q.options.some((o) => o.id === value)) continue;
    out[key] = value;
  }
  return out;
}

export function utmFromParams(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = params[k];
    if (typeof v === "string" && v) out[k] = v.slice(0, 120);
  }
  return out;
}

const QUICK_LABEL: Record<ChoiceKey, string> = {
  amount: "Looking for",
  purpose: "For",
  revenue: "Monthly deposits",
  tib: "In business",
  credit: "Credit (their guess)",
  industry: "Industry",
  timeline: "Needs it",
};

/** The answers as short lines, for an email: "Looking for: $50k – $100k". */
export function quickLines(a: Partial<Record<ChoiceKey, string>>): string[] {
  return QUESTIONS.flatMap((q) => {
    const label = labelFor(q.key, a[q.key]);
    return label ? [`${QUICK_LABEL[q.key]}: ${label}`] : [];
  });
}

/** Only the known questions and their known choices; anything else is dropped. */
export function cleanChoices(v: unknown): Partial<Record<ChoiceKey, string>> {
  const out: Partial<Record<ChoiceKey, string>> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  const r = v as Record<string, unknown>;
  for (const q of QUESTIONS) {
    const id = r[q.key];
    if (typeof id === "string" && q.options.some((o) => o.id === id)) out[q.key] = id;
  }
  return out;
}

export function labelFor(key: ChoiceKey, id: string | undefined): string | undefined {
  return QUESTIONS.find((q) => q.key === key)?.options.find((o) => o.id === id)?.label;
}

// ---------- Rough estimate (clearly labelled as not an offer) ----------

const REVENUE_MID: Record<string, number> = {
  "lt-20k": 15_000,
  "20-50k": 35_000,
  "50-100k": 75_000,
  "100-250k": 175_000,
  "250k-plus": 300_000,
};

const AMOUNT_MAX: Record<string, number> = {
  "lt-25k": 25_000,
  "25-50k": 50_000,
  "50-100k": 100_000,
  "100-250k": 250_000,
  "250k-plus": 500_000,
};

export type Fit = "strong" | "good" | "limited";

export function estimate(a: Answers): { low: number; high: number; fit: Fit } | null {
  const mid = a.revenue ? REVENUE_MID[a.revenue] : undefined;
  if (!mid) return null;
  const cap = (a.amount && AMOUNT_MAX[a.amount]) || Infinity;
  const high = Math.min(Math.round((mid * 1.25) / 5000) * 5000, cap);
  const low = Math.max(5000, Math.min(Math.round((mid * 0.5) / 5000) * 5000, high));

  let fit: Fit = "good";
  if (a.tib === "lt-6m" || a.revenue === "lt-20k") fit = "limited";
  else if (
    (a.tib === "2-5y" || a.tib === "5y-plus") &&
    (a.credit === "650-699" || a.credit === "700-plus")
  )
    fit = "strong";
  return { low, high, fit };
}

export const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`;

// ---------- Local persistence (answers survive the OAuth / magic-link round trip) ----------

const STORAGE_KEY = "lamp.apply.v1";

export type Draft = { answers: Answers; utm: Record<string, string>; savedAt: number };

export function loadDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function saveDraft(d: Omit<Draft, "savedAt">) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
  } catch {
    /* storage unavailable — flow still works in-memory */
  }
}

export function clearDraft() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- The application's drop-off, for the staff dashboard ----------

/** The six parts of the full application, in order (link-application.tsx STEPS). */
export const APPLICATION_PARTS = [
  ["business", "Application: business"],
  ["owners", "Application: owners"],
  ["property", "Application: real estate"],
  ["funding", "Application: funding"],
  ["statements", "Application: statements"],
  ["sign", "Application: review and sign"],
] as const;

/**
 * Where a visitor on a public application (the website's or a rep's public link) is, as the
 * numbered step the dashboard's drop-off counts: the quick questions, the contact screen, the
 * range ("result", as the old /apply flow called it), the parts of the application, then signed.
 */
export function funnelStep(s: {
  quickStep: number;
  contactDone: boolean;
  showRange: boolean;
  part: number;
  signed: boolean;
}): { step: number; question: string } {
  const q = QUESTIONS.length;
  if (!s.contactDone)
    return s.quickStep < q
      ? { step: Math.max(0, s.quickStep), question: QUESTIONS[Math.max(0, s.quickStep)]!.key }
      : { step: q, question: "contact" };
  if (s.showRange) return { step: q + 1, question: "result" };
  if (s.signed) return { step: q + 2 + APPLICATION_PARTS.length, question: "signed" };
  const i = Math.min(Math.max(0, s.part), APPLICATION_PARTS.length - 1);
  return { step: q + 2 + i, question: `app_${APPLICATION_PARTS[i]![0]}` };
}

/** The dashboard's name for a drop-off step. */
export function funnelLabel(key: string): string {
  if (key === "contact") return "Contact details";
  if (key === "result") return "Saw their options";
  if (key === "signed") return "Signed";
  const part = APPLICATION_PARTS.find(([id]) => `app_${id}` === key);
  if (part) return part[1];
  const q = QUESTIONS.find((x) => x.key === key);
  return q ? q.title : key;
}

/** Quick answers a link carries (?amount=50-100k&industry=trucking), questions only. */
export function quickFromParams(
  params: Record<string, unknown>,
): Partial<Record<ChoiceKey, string>> {
  const all = answersFromParams(params);
  const out: Partial<Record<ChoiceKey, string>> = {};
  for (const q of QUESTIONS) {
    const v = all[q.key];
    if (v) out[q.key] = v;
  }
  return out;
}

/**
 * The search params an application link keeps (and /apply passes on when it sends people to
 * /application): the quick answers and the utm_ tags. Anything else is dropped.
 */
export function carriedSearch(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = { ...quickFromParams(params) };
  for (const [k, v] of Object.entries(utmFromParams(params))) if (k !== "ref") out[k] = v;
  return out;
}
