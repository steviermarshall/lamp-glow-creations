// The full Lamp Working Capital Application, as the merchant completes and signs it online.
// Stored in application_details (one row per application); shapes kept in jsonb so the paper
// form's boxes map one to one. Pure functions only. The real estate part lives in
// real-estate.ts.
import {
  amount,
  strings,
  cleanRealEstate,
  emptyRealEstate,
  missingRealEstate,
  realEstateFromRow,
  type RealEstate,
} from "@/lib/real-estate";

export type Business = {
  legal_name: string;
  dba: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  start_date: string; // YYYY-MM-DD
  ein: string;
  entity_type: string;
  monthly_revenue: string;
  card_volume: string;
  industry: string;
  bank: string;
  deposit_count: string;
  premises: "" | "own" | "rent";
  rent: string;
  liens: "" | "no" | "yes";
  website: string;
  bankruptcy: "" | "none" | "ch7" | "ch11" | "ch13";
  bankruptcy_year: string;
};

export type Owner = {
  first: string;
  last: string;
  title: string;
  ownership: string;
  credit: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  mobile: string;
  email: string;
  dob: string; // YYYY-MM-DD
  ssn: string;
};

export type Balance = {
  funder: string;
  original: string;
  current: string;
  payment: string;
  frequency: "" | "daily" | "weekly" | "monthly";
  payoff: string;
};

export type Request = {
  amount: string;
  term: "" | "3" | "6" | "9" | "12";
  uses: string[]; // working_capital | inventory | equipment | payroll | other
};

export type Details = {
  business: Business;
  owners: Owner[];
  balances: Balance[];
  request: Request;
  real_estate: RealEstate;
};

export const MAX_BALANCES = 3;

export const ENTITY_TYPES = [
  "LLC",
  "Corporation",
  "S corporation",
  "Sole proprietor",
  "Partnership",
  "Other",
];
/** Stored as the label; "Something else" lets them type their own. */
export const INDUSTRIES = [
  "Auto repair",
  "Auto sales",
  "Beauty, salon or barber",
  "Construction or contracting",
  "Consulting or professional services",
  "E-commerce",
  "Food truck or catering",
  "Gas station or convenience store",
  "Healthcare, medical or dental",
  "Hotel or hospitality",
  "Landscaping",
  "Manufacturing",
  "Real estate",
  "Restaurant or bar",
  "Retail store",
  "Technology",
  "Transportation or trucking",
  "Wholesale or distribution",
];

/** The owner's own guess; stored as the label. */
export const CREDIT_BANDS = [
  "Under 550",
  "550–599",
  "600–649",
  "650–699",
  "700–749",
  "750+",
  "Not sure",
];

export const BANKRUPTCY: { id: Business["bankruptcy"]; label: string }[] = [
  { id: "none", label: "No" },
  { id: "ch7", label: "Yes, Chapter 7" },
  { id: "ch11", label: "Yes, Chapter 11" },
  { id: "ch13", label: "Yes, Chapter 13" },
];

export const US_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "PR",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
];

export const USES: { id: string; label: string }[] = [
  { id: "working_capital", label: "Working capital" },
  { id: "inventory", label: "Inventory" },
  { id: "equipment", label: "Equipment" },
  { id: "payroll", label: "Payroll" },
  { id: "other", label: "Other" },
];

/** Version tag stored with every signature, so a later wording change is traceable. */
export const CONSENT_VERSION = "lamp-application-2026-10-27";

/**
 * The authorization the merchant signs. The paper form's text word for word, plus the property
 * clause (real estate section, 2026-10-27) and an electronic signature line that covers a drawn
 * signature. Have the attorney review before volume.
 */
export const CONSENT_TEXT =
  "Authorization. By signing, each of the listed business and business owner(s)/officer(s) (individually and collectively, “you”) authorizes Lamp Capital Group LLC (“Lamp”) and each of its representatives, successors, assigns and funding partners (collectively, “Recipients”) that may be involved with or provide commercial financing having periodic repayment features or purchases of future receivables, including merchant cash advance transactions (collectively, “Transactions”), to obtain consumer or personal, business and investigative reports and other information about you, including credit card processor statements and bank statements, from one or more consumer reporting agencies such as TransUnion, Experian and Equifax, and from other credit bureaus, banks, creditors and third parties. You authorize Lamp to transmit this application and any information obtained in connection with it to any Recipient for these purposes, and authorize the release by any creditor or financial institution of any information relating to you to Lamp and to each Recipient. You certify that the information provided is true and complete and that this application is for business purposes only, not for personal, family or household use. Property. If you listed real estate, you also authorize Recipients to obtain property, title, lien, tax and valuation reports about it, and to share this application with funding partners that offer funding secured by real estate. Any such funding is a separate agreement secured by your property; if it is not repaid, you could lose the property. You certify that any funding will be used for the business purposes you stated. Broker disclosure. Lamp is a commercial-financing broker, not a lender or funder. Any financing is provided by a third-party funding partner on that partner’s own agreement, which you will review and sign separately. Lamp may be compensated by the funding partner in connection with a funded Transaction. Submitting this application does not guarantee an offer. Notice. If your application for business credit is denied, you have the right to a written statement of the specific reasons for the denial. To obtain the statement, contact Lamp within 60 days from the date you are notified of the decision; the statement will be sent within 30 days of receiving your request. The federal Equal Credit Opportunity Act prohibits creditors from discriminating against credit applicants on the basis of race, color, religion, national origin, sex, marital status, age (provided the applicant has the capacity to enter into a binding contract); because all or part of the applicant’s income derives from any public assistance program; or because the applicant has in good faith exercised any right under the Consumer Credit Protection Act. Contact consent. By providing a phone number you agree that Lamp and its Recipients may call or text you about this application, including with automated technology; consent is not a condition of any Transaction and you may opt out at any time. Electronic signature. You agree to sign electronically. Drawing your signature, typing your name and selecting Sign is your electronic signature on this application and has the same effect as a handwritten signature. You can download a copy of what you signed.";

export const emptyOwner = (): Owner => ({
  first: "",
  last: "",
  title: "",
  ownership: "",
  credit: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  mobile: "",
  email: "",
  dob: "",
  ssn: "",
});

export const emptyBalance = (): Balance => ({
  funder: "",
  original: "",
  current: "",
  payment: "",
  frequency: "",
  payoff: "",
});

export function emptyDetails(): Details {
  return {
    business: {
      legal_name: "",
      dba: "",
      address: "",
      city: "",
      state: "",
      zip: "",
      phone: "",
      email: "",
      start_date: "",
      ein: "",
      entity_type: "",
      monthly_revenue: "",
      card_volume: "",
      industry: "",
      bank: "",
      deposit_count: "",
      premises: "",
      rent: "",
      liens: "",
      website: "",
      bankruptcy: "",
      bankruptcy_year: "",
    },
    owners: [emptyOwner()],
    balances: [],
    request: { amount: "", term: "", uses: [] },
    real_estate: emptyRealEstate(),
  };
}

const PURPOSE_USE: Record<string, string> = {
  "cash-flow": "working_capital",
  payroll: "payroll",
  inventory: "inventory",
  equipment: "equipment",
  expansion: "other",
  other: "other",
};

/** A saved row (possibly partial or from an older version) merged over empty defaults. */
export function fromRow(row: {
  business?: unknown;
  owners?: unknown;
  balances?: unknown;
  request?: unknown;
  real_estate?: unknown;
}): Details {
  const base = emptyDetails();
  const obj = (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
  // Rebuilt key by key (see strings()): a stored row can come from an anonymous submit, so a
  // field that isn't a string falls back to "" instead of breaking the staff screen or the PDF.
  const owners = arr(row.owners).map((o) => strings(emptyOwner(), o, { email: 254 }));
  const req = obj(row.request);
  return {
    business: strings(base.business, obj(row.business), {
      legal_name: 200,
      dba: 200,
      email: 254,
      website: 200,
    }),
    owners: owners.length ? owners.slice(0, 2) : base.owners,
    balances: arr(row.balances)
      .map((b) => strings(emptyBalance(), b))
      .slice(0, MAX_BALANCES),
    request: {
      ...strings(base.request, req),
      uses: Array.isArray(req["uses"])
        ? (req["uses"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 8)
        : [],
    },
    real_estate: realEstateFromRow(row.real_estate),
  };
}

/** What gets saved: empty advance rows and half-added property balances dropped. */
export function cleanDetails(d: Details): Details {
  return {
    ...d,
    balances: d.balances.filter((b) => b.funder.trim() || b.current.trim()),
    real_estate: cleanRealEstate(d.real_estate),
  };
}

/** First draft, filled from what the quick apply flow already asked. */
export function prefill(app: {
  business_name: string | null;
  first_name: string | null;
  phone: string | null;
  email: string | null;
  purpose?: string | null;
}): Details {
  const d = emptyDetails();
  d.business.legal_name = app.business_name ?? "";
  d.business.phone = app.phone ?? "";
  d.business.email = app.email ?? "";
  d.owners[0] = {
    ...d.owners[0]!,
    first: app.first_name ?? "",
    mobile: app.phone ?? "",
    email: app.email ?? "",
  };
  const use = app.purpose ? PURPOSE_USE[app.purpose] : undefined;
  if (use) d.request.uses = [use];
  return d;
}

const digits = (s: string) => s.replace(/\D/g, "");

/** What still has to be filled before the application can be signed, in plain words. */
/**
 * 18 or older on `today` (YYYY-MM-DD dates): a minor can't sign a funding agreement, so an owner
 * under 18 counts as a missing answer.
 */
export function isAdult(dob: string, today = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ty = today.getFullYear();
  const birthdayPassed =
    today.getMonth() + 1 > mo || (today.getMonth() + 1 === mo && today.getDate() >= d);
  return ty - y - (birthdayPassed ? 0 : 1) >= 18;
}

/**
 * What's still needed before signing. The paper form (propertyDetails false) only asks whether
 * they own real estate; the rep gets the property details afterwards.
 */
export function missing(d: Details, { propertyDetails = true } = {}): string[] {
  const out: string[] = [];
  const b = d.business;
  const need = (ok: boolean, what: string) => {
    if (!ok) out.push(what);
  };
  need(!!b.legal_name.trim(), "legal business name");
  need(!!b.address.trim() && !!b.city.trim(), "business address and city");
  need(/^[A-Za-z]{2}$/.test(b.state.trim()), "business state (two letters)");
  need(/^\d{5}$/.test(b.zip.trim()), "business ZIP (five digits)");
  need(digits(b.phone).length >= 10, "business phone");
  need(!!b.start_date, "business start date");
  need(digits(b.ein).length === 9, "federal tax ID (EIN, nine digits)");
  need(!!b.entity_type, "entity type");
  need(!!b.monthly_revenue.trim(), "average monthly revenue");
  need(!!b.bankruptcy, "whether the business or an owner has filed for bankruptcy");
  need((amount(d.request.amount) ?? 0) > 0, "amount requested");
  d.owners.forEach((o, i) => {
    const who = i === 0 ? "owner" : "second owner";
    need(!!o.first.trim() && !!o.last.trim(), `${who}'s first and last name`);
    need(!!o.ownership.trim(), `${who}'s ownership %`);
    need(
      !!o.address.trim() &&
        !!o.city.trim() &&
        /^[A-Za-z]{2}$/.test(o.state.trim()) &&
        /^\d{5}$/.test(o.zip.trim()),
      `${who}'s home address`,
    );
    need(digits(o.mobile).length >= 10, `${who}'s mobile phone`);
    need(/\S+@\S+\.\S+/.test(o.email), `${who}'s email`);
    need(
      !!o.dob && isAdult(o.dob),
      o.dob ? `${who}'s date of birth (they must be 18 or older)` : `${who}'s date of birth`,
    );
    need(digits(o.ssn).length === 9 || isMaskedSsn(o.ssn), `${who}'s SSN (nine digits)`);
  });
  if (propertyDetails) out.push(...missingRealEstate(d.real_estate));
  else if (!d.real_estate.owns) out.push("whether you own any real estate");
  return out;
}

/** The typed signature has to be the first owner's name, so the record says who signed. */
export function signatureMatches(typed: string, owner: Owner): boolean {
  // accents folded, not dropped: "Maria Garcia" signs for García, "Pena" for Peña
  const n = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  const t = n(typed);
  return (
    t.length >= 3 &&
    !!owner.last &&
    t.includes(n(owner.last)) &&
    t.includes(n(owner.first).slice(0, 1))
  );
}

/** What staff are sent instead of an SSN until they reveal it (see staff_application_details). */
export const isMaskedSsn = (s: string) => /^\*{3}-\*{2}-\d{4}$/.test(s);

export const maskSsn = (s: string) => {
  const d = digits(s);
  return d.length >= 4 ? `***-**-${d.slice(-4)}` : "";
};

export const fmtSsn = (s: string) => {
  const d = digits(s);
  return d.length === 9 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : s;
};

export const fmtEin = (s: string) => {
  const d = digits(s);
  return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2)}` : s;
};

const usDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
};

/** How the application was signed, as FullApplication carries it. Only name and at are needed. */
export type PdfSignature = {
  name: string | null;
  at: string | null;
  /** Drawn signatures (PNG data URLs); without one the line reads "/s/ name". */
  image?: string | null;
  name2?: string | null;
  image2?: string | null;
  via?: "link" | "account" | null;
  ip?: string | null;
  agent?: string | null;
  /** The consent version stored with the signature, when the caller has it. */
  consent?: string | null;
};

/** The electronic signature record printed on the application PDF's last page. */
export type PdfAudit = {
  signer: string;
  signer2: string | null;
  /** ISO timestamp. */
  signedAt: string;
  via: "link" | "account" | null;
  ip: string | null;
  agent: string | null;
  consentVersion: string | null;
  /** The authorization wording, only when it's known to be the version they signed. */
  consentText: string | null;
  drawn: boolean;
};

/** What detailsToPdf gives application-pdf.ts (its ApplicationValues). */
type PdfFill = {
  text: Record<string, string>;
  checked: Record<string, boolean>;
  images?: { owner1_signature?: string; owner2_signature?: string };
  realEstate?: RealEstate;
  extra?: { label: string; value: string }[];
  audit?: PdfAudit;
};

/** The signing day as Lamp's office (New Jersey) counts it, so a late-evening signature
 *  doesn't print as tomorrow's UTC date. */
const officeDay = (iso: string) => {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return usDate(iso.slice(0, 10));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(t);
};

/** "50000" prints as "$50,000" and "50k" as "$50k"; anything already marked or worded stays. */
const dollars = (s: string) => {
  const t = s.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return `$${Number(t).toLocaleString("en-US")}`;
  return /^\d/.test(t) ? `$${t}` : t;
};

/** The form's "daily / weekly payment" column: "$350 daily". */
const paymentText = (x: Balance) =>
  x.payment.trim() ? [dollars(x.payment), x.frequency].filter(Boolean).join(" ") : "";

/**
 * The completed application mapped onto the PDF's boxes (see application-pdf.ts), plus what
 * page 2 prints: drawn signatures, the real estate schedule, answers the paper form has no box
 * for (website, bankruptcy, a third balance) and the electronic signature record.
 */
export function detailsToPdf(d: Details, signed: PdfSignature, repName: string | null): PdfFill {
  const b = d.business;
  const text: Record<string, string> = {
    legal_name: b.legal_name,
    dba: b.dba,
    business_address: b.address,
    business_city: b.city,
    business_state: b.state.toUpperCase(),
    business_zip: b.zip,
    business_phone: b.phone,
    business_email: b.email,
    business_start_date: usDate(b.start_date),
    ein: fmtEin(b.ein),
    entity_type: b.entity_type,
    monthly_revenue: b.monthly_revenue.replace(/\$/g, ""),
    monthly_card_volume: b.card_volume.replace(/\$/g, ""),
    industry: b.industry,
    business_bank: b.bank,
    monthly_deposit_count: b.deposit_count,
    monthly_rent: b.premises === "rent" ? b.rent.replace(/\$/g, "") : "",
    amount_requested: d.request.amount,
    lamp_rep: repName ?? "",
  };
  d.owners.slice(0, 2).forEach((o, i) => {
    const p = `owner${i + 1}_`;
    Object.assign(text, {
      [`${p}first_name`]: o.first,
      [`${p}last_name`]: o.last,
      [`${p}title`]: o.title,
      [`${p}ownership`]: o.ownership ? `${o.ownership.replace(/%/g, "")}%` : "",
      [`${p}credit`]: o.credit,
      [`${p}address`]: o.address,
      [`${p}city`]: o.city,
      [`${p}state`]: o.state.toUpperCase(),
      [`${p}zip`]: o.zip,
      [`${p}mobile`]: o.mobile,
      [`${p}email`]: o.email,
      [`${p}ssn`]: fmtSsn(o.ssn),
      [`${p}dob`]: usDate(o.dob),
    });
  });
  d.balances.slice(0, 2).forEach((x, i) => {
    const p = `balance${i + 1}_`;
    Object.assign(text, {
      [`${p}funder`]: x.funder,
      [`${p}original`]: dollars(x.original),
      [`${p}current`]: dollars(x.current),
      [`${p}payment`]: paymentText(x),
      [`${p}payoff`]: x.payoff,
    });
  });
  const images: NonNullable<PdfFill["images"]> = {};
  let audit: PdfAudit | undefined;
  if (signed.name && signed.at) {
    const day = officeDay(signed.at);
    const fullName = (o: Owner | undefined) => `${o?.first ?? ""} ${o?.last ?? ""}`.trim();
    // A drawn signature is placed as an image; the printed name and date stay as text.
    text["owner1_print_name"] = fullName(d.owners[0]) || signed.name;
    text["owner1_sign_date"] = day;
    if (signed.image) images.owner1_signature = signed.image;
    else text["owner1_signature"] = `/s/ ${signed.name} (signed electronically)`;
    if (signed.name2) {
      text["owner2_print_name"] = fullName(d.owners[1]) || signed.name2;
      text["owner2_sign_date"] = day;
      if (signed.image2) images.owner2_signature = signed.image2;
      else text["owner2_signature"] = `/s/ ${signed.name2} (signed electronically)`;
    }
    // Signatures from before signed_via existed have no known consent version.
    const consentVersion = signed.consent ?? (signed.via ? CONSENT_VERSION : null);
    audit = {
      signer: signed.name,
      signer2: signed.name2 ?? null,
      signedAt: signed.at,
      via: signed.via ?? null,
      ip: signed.ip ?? null,
      agent: signed.agent ?? null,
      consentVersion,
      consentText: consentVersion === CONSENT_VERSION ? CONSENT_TEXT : null,
      drawn: !!signed.image,
    };
  }
  const extra: { label: string; value: string }[] = [];
  if (b.website.trim()) extra.push({ label: "Business website", value: b.website.trim() });
  if (b.bankruptcy) {
    const filed = BANKRUPTCY.find((x) => x.id === b.bankruptcy)?.label ?? b.bankruptcy;
    extra.push({
      label: "Bankruptcy, business or owner",
      value:
        b.bankruptcy !== "none" && b.bankruptcy_year.trim()
          ? `${filed}, ${b.bankruptcy_year.trim()}`
          : filed,
    });
  }
  d.balances.slice(2).forEach((x, i) =>
    extra.push({
      label: `Balance ${i + 3} (no room on page 1)`,
      value: [
        x.funder,
        x.original && `original ${dollars(x.original)}`,
        x.current && `current ${dollars(x.current)}`,
        x.payment && `payment ${paymentText(x)}`,
        x.payoff && `est. payoff ${x.payoff}`,
      ]
        .filter(Boolean)
        .join(", "),
    }),
  );
  if (d.real_estate.owns === "no") extra.push({ label: "Owns real estate", value: "No" });
  // the paper form asks only yes or no; the rep gets the property details afterwards
  const noSchedule = d.real_estate.owns === "yes" && d.real_estate.properties.length === 0;
  if (noSchedule)
    extra.push({ label: "Owns real estate", value: "Yes (property details to follow)" });
  const checked: Record<string, boolean> = {
    use_working_capital: d.request.uses.includes("working_capital"),
    use_inventory: d.request.uses.includes("inventory"),
    use_equipment: d.request.uses.includes("equipment"),
    use_payroll: d.request.uses.includes("payroll"),
    use_other: d.request.uses.includes("other"),
    premises_own: b.premises === "own",
    premises_rent: b.premises === "rent",
    liens_no: b.liens === "no",
    liens_yes: b.liens === "yes",
    term_3: d.request.term === "3",
    term_6: d.request.term === "6",
    term_9: d.request.term === "9",
    term_12: d.request.term === "12",
  };
  const out: PdfFill = { text, checked };
  if (images.owner1_signature || images.owner2_signature) out.images = images;
  if (d.real_estate.owns === "yes" && !noSchedule) out.realEstate = d.real_estate;
  if (extra.length) out.extra = extra;
  if (audit) out.audit = audit;
  return out;
}
