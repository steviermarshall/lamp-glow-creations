// The real estate part of the full application: what the merchant owns, what's owed on it, and
// how they'd use it. Property-backed funding partners (private second-position funding, equity
// lines, equity share options) size an offer from value minus what's owed, so this asks for
// exactly that, per property, plus the yes/no questions that rule a property in or out early.
// Stored as application_details.real_estate (jsonb). Pure functions only.
//
// Merchant copy: never the word "loan". "Mortgage" is fine: it names their own existing debt.

export type Lien = {
  type: string; // LIEN_TYPES id
  holder: string;
  balance: string;
  limit: string; // equity lines only: the full credit limit, which funders count
  payment: string;
  status: string; // PAYMENT_STATUS id
  late_12m: string; // "0" | "1" | "2+"
  payoff: "" | "yes" | "no"; // pay this off with the new funding?
};

export type Property = {
  address: string;
  city: string;
  state: string;
  zip: string;
  type: string; // PROPERTY_TYPES id
  use: string; // PROPERTY_USES id
  title: string; // TITLE_HOLDERS id
  all_sign: "" | "yes" | "no" | "not_sure";
  purchased: string; // YYYY-MM
  price: string;
  value: string;
  value_source: string; // VALUE_SOURCES id
  rent: string; // monthly, rentals only
  taxes_current: "" | "yes" | "no";
  insured: "" | "yes" | "no";
  hoa: "" | "yes" | "no";
  hoa_dues: string;
  /** For sale now or lately: cash-out funders want it off the market. */
  listed: string; // LISTED id
  condition: string; // CONDITIONS id
  free_clear: boolean;
  liens: Lien[];
};

export type RealEstate = {
  owns: "" | "yes" | "no";
  /** Would they use a property's equity for larger, longer-term funding? */
  interest: "" | "yes" | "maybe" | "no";
  /** How they'd want property-backed funding, if they want it. */
  structure: string; // STRUCTURES id
  /** Who would receive the funds: the business (with the owner guaranteeing) or the owner. */
  borrower: string; // BORROWERS id
  /** In their words, what the money would be used for. */
  purpose_note: string;
  /** Foreclosure, deed-in-lieu or short sale in the last 7 years. */
  foreclosure: "" | "yes" | "no";
  foreclosure_year: string;
  properties: Property[];
};

export const MAX_PROPERTIES = 3;
export const MAX_LIENS = 4;

export type Opt = { id: string; label: string };

export const PROPERTY_TYPES: Opt[] = [
  { id: "single_family", label: "Single-family home" },
  { id: "condo", label: "Condo" },
  { id: "townhome", label: "Townhome" },
  { id: "2_4_units", label: "2–4 units" },
  { id: "5_plus", label: "5+ units" },
  { id: "mixed_use", label: "Mixed-use" },
  { id: "commercial", label: "Commercial building" },
  { id: "manufactured", label: "Manufactured or mobile home" },
  { id: "modular", label: "Modular home" },
  { id: "coop", label: "Co-op" },
  { id: "land", label: "Land" },
  { id: "unconventional", label: "Log cabin, dome, A-frame or barndominium" },
  { id: "other", label: "Something else" },
];

export const PROPERTY_USES: Opt[] = [
  { id: "primary", label: "My home" },
  { id: "second_home", label: "Second or vacation home" },
  { id: "rental", label: "Rental I don't live in" },
  { id: "owner_rental", label: "I live in one unit and rent the others" },
  { id: "business", label: "My business uses it" },
  { id: "vacant", label: "Vacant" },
];

export const TITLE_HOLDERS: Opt[] = [
  { id: "me", label: "Me alone" },
  { id: "me_spouse", label: "Me and my spouse" },
  { id: "me_other", label: "Me and someone else" },
  { id: "business", label: "My business (LLC or corporation)" },
  { id: "living_trust", label: "A living (revocable) trust" },
  { id: "irrevocable_trust", label: "An irrevocable trust" },
  { id: "contract_for_deed", label: "Contract for deed (no deed yet)" },
  { id: "estate", label: "Inherited, estate still open" },
  { id: "life_estate", label: "Life estate" },
  { id: "not_sure", label: "Not sure" },
];

export const LISTED: Opt[] = [
  { id: "no", label: "No" },
  { id: "listed", label: "Listed for sale now" },
  { id: "under_contract", label: "Under contract to sell" },
  { id: "recently", label: "Listed in the last 6 months, not now" },
];

export const CONDITIONS: Opt[] = [
  { id: "good", label: "Good" },
  { id: "minor", label: "Needs minor repairs" },
  { id: "major", label: "Needs major repairs" },
  { id: "renovation", label: "Under renovation" },
  { id: "damage", label: "Storm or fire damage, or an open insurance claim" },
];

export const BORROWERS: Opt[] = [
  { id: "business", label: "My business (I'd guarantee it)" },
  { id: "personal", label: "Me personally" },
  { id: "not_sure", label: "Not sure" },
];

export const VALUE_SOURCES: Opt[] = [
  { id: "appraisal", label: "Appraisal in the last 12 months" },
  { id: "online", label: "Online estimate (Zillow, Redfin…)" },
  { id: "agent", label: "A real estate agent's opinion" },
  { id: "tax", label: "Tax assessment" },
  { id: "estimate", label: "My own estimate" },
];

export const LIEN_TYPES: Opt[] = [
  { id: "first", label: "1st mortgage" },
  { id: "second", label: "2nd mortgage" },
  { id: "heloc", label: "Home equity line" },
  { id: "equity_share", label: "Equity share (Point, Hometap, Unlock…)" },
  { id: "reverse", label: "Reverse mortgage" },
  { id: "private", label: "Private or hard-money" },
  { id: "business", label: "Business-purpose or rental (DSCR)" },
  { id: "seller", label: "Seller financing" },
  { id: "solar", label: "Solar or PACE" },
  { id: "tax_lien", label: "Tax lien" },
  { id: "judgment", label: "Judgment" },
  { id: "other", label: "Other balance" },
];

export const PAYMENT_STATUS: Opt[] = [
  { id: "current", label: "Current" },
  { id: "30", label: "30 days late" },
  { id: "60", label: "60+ days late" },
  { id: "foreclosure", label: "In foreclosure or got a notice" },
];

export const STRUCTURES: Opt[] = [
  { id: "lump_sum", label: "A lump sum" },
  { id: "line", label: "A line I can draw on" },
  { id: "share", label: "Cash now, repay a share of the home's value later" },
  { id: "not_sure", label: "Not sure yet" },
];

export const emptyLien = (type = "first"): Lien => ({
  type,
  holder: "",
  balance: "",
  limit: "",
  payment: "",
  status: "",
  late_12m: "",
  payoff: "",
});

export const emptyProperty = (): Property => ({
  address: "",
  city: "",
  state: "",
  zip: "",
  type: "",
  use: "",
  title: "",
  all_sign: "",
  purchased: "",
  price: "",
  value: "",
  value_source: "",
  rent: "",
  taxes_current: "",
  insured: "",
  hoa: "",
  hoa_dues: "",
  listed: "",
  condition: "",
  free_clear: false,
  liens: [emptyLien()],
});

export const emptyRealEstate = (): RealEstate => ({
  owns: "",
  interest: "",
  structure: "",
  borrower: "",
  purpose_note: "",
  foreclosure: "",
  foreclosure_year: "",
  properties: [],
});

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);

/** A saved real_estate value (possibly partial or from an older version) over empty defaults. */
export function realEstateFromRow(v: unknown): RealEstate {
  const r = obj(v);
  // Rebuilt key by key from the empty shapes: a stored value can come from an anonymous
  // submit, so anything that isn't a string becomes "" and every string is length-capped.
  return {
    ...strings(emptyRealEstate(), r, { purpose_note: 300 }),
    properties: arr(r["properties"])
      .slice(0, MAX_PROPERTIES)
      .map((p) => ({
        ...strings(emptyProperty(), p),
        free_clear: p["free_clear"] === true,
        liens: arr(p["liens"])
          .slice(0, MAX_LIENS)
          .map((l) => strings(emptyLien(), l)),
      })),
  };
}

/**
 * The string fields of `base`, each taken from `raw` when it is a string (capped at 120
 * characters, or `caps[key]`), else left at the default. Non-string fields keep the default.
 */
export function strings<T extends object>(
  base: T,
  raw: Record<string, unknown>,
  caps: Partial<Record<keyof T, number>> = {},
): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, d] of Object.entries(base)) {
    const v = raw[k];
    if (typeof d === "string" && typeof v === "string") {
      out[k] = v.slice(0, (caps as Record<string, number>)[k] ?? 120);
    }
  }
  return out as T;
}

/** "$450,000", "450k", "450000.00" → 450000. Empty or nonsense → null. */
export function amount(s: unknown): number | null {
  if (typeof s !== "string" || !s) return null;
  const t = s.toLowerCase().replace(/[$,\s]/g, "");
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1);
  return Number.isFinite(n) ? n : null;
}

/** What a funder counts as owed on one balance at worst: an equity line at its full limit. */
export function lienOwed(l: Lien): number {
  const bal = amount(l.balance) ?? 0;
  if (l.type === "heloc") return Math.max(bal, amount(l.limit) ?? 0);
  return bal;
}

export type Equity = {
  value: number | null;
  /** Balances owed today (equity lines at what's drawn). */
  owed: number;
  /** The same with every equity line at its full limit. */
  owedAtLimits: number;
  equity: number | null;
  /** Everything owed ÷ value, 0–1+ (CLTV). */
  cltv: number | null;
  /** The same with equity lines at their full limits (HCLTV): what most funders size from. */
  hcltv: number | null;
  /** How much a funder capped at `cap` of value could add on top of what's owed (at limits). */
  roomAt: (cap: number) => number | null;
};

export function equityOf(p: Property): Equity {
  const value = amount(p.value);
  const liens = p.free_clear ? [] : p.liens;
  const owed = liens.reduce((s, l) => s + (amount(l.balance) ?? 0), 0);
  const owedAtLimits = liens.reduce((s, l) => s + lienOwed(l), 0);
  return {
    value,
    owed,
    owedAtLimits,
    equity: value != null ? value - owed : null,
    cltv: value ? owed / value : null,
    hcltv: value ? owedAtLimits / value : null,
    roomAt: (cap) => (value ? Math.max(0, Math.round(cap * value - owedAtLimits)) : null),
  };
}

export const usd0 = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);

export const labelOf = (opts: Opt[], id: string) => opts.find((o) => o.id === id)?.label ?? "";

/**
 * What a property-backed funding partner would stop on, in plain words, for staff. Not shown
 * to merchants and never a verdict: each is a reason to look closer before sending the file.
 */
export function flags(p: Property): string[] {
  const out: string[] = [];
  const e = equityOf(p);
  if (e.hcltv != null && e.hcltv >= 0.8)
    out.push(
      e.owedAtLimits > e.owed
        ? `HCLTV ${pct(e.hcltv)} with equity lines at their full limit`
        : `owes ${pct(e.hcltv)} of value already`,
    );
  if (p.state.toUpperCase() === "TX" && (p.use === "primary" || p.use === "owner_rental"))
    out.push("Texas homestead: only a state home-equity product can use it");
  if (p.title === "business" || p.title === "irrevocable_trust")
    out.push("titled to a business or irrevocable trust: equity share options won't take it");
  if (["coop", "manufactured", "land", "unconventional", "commercial"].includes(p.type))
    out.push(`${labelOf(PROPERTY_TYPES, p.type).toLowerCase()}: most partners won't take it`);
  if (["contract_for_deed", "estate", "life_estate"].includes(p.title))
    out.push(`${labelOf(TITLE_HOLDERS, p.title).toLowerCase()}: title may not be clear`);
  if (p.all_sign === "no") out.push("not every owner on title will sign");
  if (p.listed && p.listed !== "no") out.push(labelOf(LISTED, p.listed).toLowerCase());
  if (["major", "renovation", "damage"].includes(p.condition))
    out.push(labelOf(CONDITIONS, p.condition).toLowerCase());
  if (p.taxes_current === "no") out.push("property taxes behind");
  if (p.insured === "no") out.push("no homeowners insurance");
  if (!p.free_clear && p.liens.some((l) => l.status && l.status !== "current"))
    out.push("a payment on it is late");
  if (!p.free_clear && p.liens.some((l) => l.late_12m === "2+"))
    out.push("2+ late payments in the last year");
  if (!p.free_clear && p.liens.some((l) => l.type === "reverse")) out.push("reverse mortgage");
  if (!p.free_clear && p.liens.some((l) => l.type === "equity_share"))
    out.push("has an equity share agreement: that company must be told before a new lien");
  if (!p.free_clear && p.liens.some((l) => l.type === "business"))
    out.push("a business-purpose or DSCR 1st often bars a 2nd behind it");
  if (p.purchased) {
    const [y, m] = p.purchased.split("-").map(Number);
    if (y && m) {
      const months = (new Date().getFullYear() - y) * 12 + (new Date().getMonth() + 1 - m);
      if (months < 6) out.push("bought under 6 months ago: value capped near the price paid");
    }
  }
  return out;
}

/** What still has to be filled in the real estate part, in plain words. */
export function missingRealEstate(r: RealEstate): string[] {
  const out: string[] = [];
  if (!r.owns) return ["whether you own any real estate"];
  if (r.owns === "no") return out;
  if (r.properties.length === 0) return ["at least one property you own"];
  r.properties.forEach((p, i) => {
    const which = r.properties.length > 1 ? `property ${i + 1}` : "your property";
    if (!p.address.trim() || !p.city.trim()) out.push(`${which}'s address`);
    if (!/^[A-Za-z]{2}$/.test(p.state.trim())) out.push(`${which}'s state`);
    if (!/^\d{5}$/.test(p.zip.trim())) out.push(`${which}'s ZIP`);
    if (!p.type) out.push(`what kind of property ${which} is`);
    if (!p.use) out.push(`how you use ${which}`);
    if (!p.title) out.push(`whose name is on ${which}'s title`);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.purchased)) out.push(`when you bought ${which}`);
    if (amount(p.value) == null) out.push(`what ${which} is worth today`);
    if (!p.listed) out.push(`whether ${which} is listed for sale`);
    if (!p.condition) out.push(`${which}'s condition`);
    if (!p.free_clear) {
      const real = p.liens.filter((l) => l.type);
      if (real.length === 0) out.push(`what's owed on ${which} (or tick "owned free and clear")`);
      real.forEach((l) => {
        const name = labelOf(LIEN_TYPES, l.type).toLowerCase() || "balance";
        if (amount(l.balance) == null) out.push(`the ${name} balance on ${which}`);
        if (!l.status) out.push(`whether the ${name} on ${which} is current`);
      });
    }
  });
  if (!r.foreclosure) out.push("whether you've had a foreclosure or short sale in 7 years");
  if (!r.interest) out.push("whether you'd use your property for funding");
  if ((r.interest === "yes" || r.interest === "maybe") && !r.borrower)
    out.push("who would receive property-backed funding");
  return out;
}

/** Drop empty balance rows before saving, so a half-added row doesn't count as a lien. */
export function cleanRealEstate(r: RealEstate): RealEstate {
  if (r.owns !== "yes") return { ...emptyRealEstate(), owns: r.owns };
  // answers the page hid after a change (interest switched to No, a rental that became the
  // home, an equity line that became a 2nd) are dropped, so they never reach staff or the PDF
  const want = r.interest === "yes" || r.interest === "maybe";
  return {
    ...r,
    structure: want ? r.structure : "",
    borrower: want ? r.borrower : "",
    purpose_note: want ? r.purpose_note : "",
    foreclosure_year: r.foreclosure === "yes" ? r.foreclosure_year : "",
    properties: r.properties.map((p) => ({
      ...p,
      rent: p.use === "rental" || p.use === "owner_rental" ? p.rent : "",
      hoa_dues: p.hoa === "yes" ? p.hoa_dues : "",
      liens: p.free_clear
        ? []
        : p.liens
            .filter((l) => l.type && (l.holder.trim() || l.balance.trim() || l.payment.trim()))
            .map((l) => ({ ...l, limit: l.type === "heloc" ? l.limit : "" })),
    })),
  };
}
