// The full Lamp Working Capital Application, as the merchant completes and signs it online.
// Stored in application_details (one row per application); shapes kept in jsonb so the paper
// form's boxes map one to one. Pure functions only.

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
};

export const ENTITY_TYPES = [
  "LLC",
  "Corporation",
  "S corporation",
  "Sole proprietor",
  "Partnership",
  "Other",
];
export const USES: { id: string; label: string }[] = [
  { id: "working_capital", label: "Working capital" },
  { id: "inventory", label: "Inventory" },
  { id: "equipment", label: "Equipment" },
  { id: "payroll", label: "Payroll" },
  { id: "other", label: "Other" },
];

/** Version tag stored with every signature, so a later wording change is traceable. */
export const CONSENT_VERSION = "lamp-application-2026-10";

/** The authorization printed on the Lamp Working Capital Application, word for word. */
export const CONSENT_TEXT =
  "Authorization. By signing, each of the listed business and business owner(s)/officer(s) (individually and collectively, “you”) authorizes Lamp Capital Group LLC (“Lamp”) and each of its representatives, successors, assigns and funding partners (collectively, “Recipients”) that may be involved with or provide commercial financing having periodic repayment features or purchases of future receivables, including merchant cash advance transactions (collectively, “Transactions”), to obtain consumer or personal, business and investigative reports and other information about you, including credit card processor statements and bank statements, from one or more consumer reporting agencies such as TransUnion, Experian and Equifax, and from other credit bureaus, banks, creditors and third parties. You authorize Lamp to transmit this application and any information obtained in connection with it to any Recipient for these purposes, and authorize the release by any creditor or financial institution of any information relating to you to Lamp and to each Recipient. You certify that the information provided is true and complete and that this application is for business purposes only, not for personal, family or household use. Broker disclosure. Lamp is a commercial-financing broker, not a lender or funder. Any financing is provided by a third-party funding partner on that partner’s own agreement, which you will review and sign separately. Lamp may be compensated by the funding partner in connection with a funded Transaction. Submitting this application does not guarantee an offer. Notice. If your application for business credit is denied, you have the right to a written statement of the specific reasons for the denial. To obtain the statement, contact Lamp within 60 days from the date you are notified of the decision; the statement will be sent within 30 days of receiving your request. The federal Equal Credit Opportunity Act prohibits creditors from discriminating against credit applicants on the basis of race, color, religion, national origin, sex, marital status, age (provided the applicant has the capacity to enter into a binding contract); because all or part of the applicant’s income derives from any public assistance program; or because the applicant has in good faith exercised any right under the Consumer Credit Protection Act. Contact consent. By providing a phone number you agree that Lamp and its Recipients may call or text you about this application, including with automated technology; consent is not a condition of any Transaction and you may opt out at any time. Electronic signature. Typing your name and selecting Sign is your electronic signature on this application and has the same effect as a handwritten signature.";

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
    },
    owners: [emptyOwner()],
    balances: [],
    request: { amount: "", term: "", uses: [] },
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
}): Details {
  const base = emptyDetails();
  const obj = (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const owners = arr(row.owners).map((o) => ({ ...emptyOwner(), ...o }) as Owner);
  return {
    business: { ...base.business, ...obj(row.business) } as Business,
    owners: owners.length ? owners.slice(0, 2) : base.owners,
    balances: arr(row.balances)
      .map((b) => ({ ...emptyBalance(), ...b }) as Balance)
      .slice(0, 3),
    request: { ...base.request, ...obj(row.request) } as Request,
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
export function missing(d: Details): string[] {
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
  need(!!d.request.amount.trim(), "amount requested");
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
    need(!!o.dob, `${who}'s date of birth`);
    need(digits(o.ssn).length === 9, `${who}'s SSN (nine digits)`);
  });
  return out;
}

/** The typed signature has to be the first owner's name, so the record says who signed. */
export function signatureMatches(typed: string, owner: Owner): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const t = n(typed);
  return (
    t.length >= 3 &&
    !!owner.last &&
    t.includes(n(owner.last)) &&
    t.includes(n(owner.first).slice(0, 1))
  );
}

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

/** The completed application mapped onto the PDF's boxes (see application-pdf.ts). */
export function detailsToPdf(
  d: Details,
  signed: { name: string | null; at: string | null },
  repName: string | null,
): { text: Record<string, string>; checked: Record<string, boolean> } {
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
      [`${p}original`]: x.original,
      [`${p}current`]: x.current,
      [`${p}payment`]: x.payment,
      [`${p}payoff`]: x.payoff,
    });
  });
  if (signed.name && signed.at) {
    const day = usDate(signed.at.slice(0, 10));
    text["owner1_print_name"] = `${d.owners[0]?.first ?? ""} ${d.owners[0]?.last ?? ""}`.trim();
    text["owner1_signature"] = `/s/ ${signed.name} (signed electronically)`;
    text["owner1_sign_date"] = day;
  }
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
  return { text, checked };
}
