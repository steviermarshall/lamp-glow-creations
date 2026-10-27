// What changed between two versions of a signed application, in plain words: the staff "What
// changed" card and the merchant's "What you changed" list before they sign an update. Pure
// functions only. SSNs and dates of birth never appear as values: staff get masked data, and the
// database says (secret_changes) whether the hidden numbers changed.
import {
  BANKRUPTCY,
  USES,
  isMaskedDob,
  isMaskedSsn,
  type Balance,
  type Business,
  type Details,
  type Owner,
} from "@/lib/application-details";
import {
  BORROWERS,
  CONDITIONS,
  LIEN_TYPES,
  LISTED,
  PAYMENT_STATUS,
  PROPERTY_TYPES,
  PROPERTY_USES,
  STRUCTURES,
  TITLE_HOLDERS,
  VALUE_SOURCES,
  labelOf,
  type Lien,
  type Opt,
  type Property,
  type RealEstate,
} from "@/lib/real-estate";
import type { ChangeItem, ChangeSection } from "@/lib/application-changes";

export type Change = {
  /** Where it is, e.g. "real_estate.properties.0.liens.1.balance"; matches ChangeItem targets. */
  path: string;
  section: Exclude<ChangeSection, "other">;
  label: string;
  before: string;
  after: string;
  kind: "changed" | "added" | "removed";
  /** An SSN or date of birth: shown only as changed, never as a value. */
  secret?: boolean;
  /** Who the application is about or how to reach them: worth a second look. */
  flag?: "identity" | "contact";
};

/** Per owner in the newer version, from the database: did a hidden number change. */
export type SecretChanges = { ssn: boolean; dob: boolean; added?: boolean }[];

const YES_NO: Opt[] = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
  { id: "not_sure", label: "Not sure" },
  { id: "maybe", label: "Maybe" },
];
const PREMISES: Opt[] = [
  { id: "own", label: "Owns" },
  { id: "rent", label: "Rents" },
];
const FREQUENCY: Opt[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];
const LATE: Opt[] = [
  { id: "0", label: "None" },
  { id: "1", label: "1" },
  { id: "2+", label: "2 or more" },
];

type Field<T> = { key: keyof T & string; label: string; opts?: Opt[]; flag?: Change["flag"] };

const BUSINESS: Field<Business>[] = [
  { key: "legal_name", label: "Legal business name", flag: "identity" },
  { key: "dba", label: "DBA" },
  { key: "address", label: "Business address" },
  { key: "city", label: "Business city" },
  { key: "state", label: "Business state" },
  { key: "zip", label: "Business ZIP" },
  { key: "phone", label: "Business phone", flag: "contact" },
  { key: "email", label: "Business email", flag: "contact" },
  { key: "website", label: "Website" },
  { key: "start_date", label: "Business start date" },
  { key: "ein", label: "EIN", flag: "identity" },
  { key: "entity_type", label: "Entity type" },
  { key: "industry", label: "Industry" },
  { key: "monthly_revenue", label: "Monthly revenue" },
  { key: "card_volume", label: "Monthly card sales" },
  { key: "bank", label: "Bank" },
  { key: "deposit_count", label: "Deposits a month" },
  { key: "premises", label: "Premises", opts: PREMISES },
  { key: "rent", label: "Rent" },
  { key: "liens", label: "Liens or judgments", opts: YES_NO },
  { key: "bankruptcy", label: "Bankruptcy", opts: BANKRUPTCY },
  { key: "bankruptcy_year", label: "Bankruptcy year" },
];

const OWNER: Field<Owner>[] = [
  { key: "first", label: "first name", flag: "identity" },
  { key: "last", label: "last name", flag: "identity" },
  { key: "title", label: "title" },
  { key: "ownership", label: "ownership %" },
  { key: "address", label: "home address" },
  { key: "city", label: "home city" },
  { key: "state", label: "home state" },
  { key: "zip", label: "home ZIP" },
  { key: "mobile", label: "mobile phone", flag: "contact" },
  { key: "email", label: "email", flag: "contact" },
  { key: "credit", label: "credit score (stated)" },
];

const BALANCE: Field<Balance>[] = [
  { key: "funder", label: "funder" },
  { key: "original", label: "original amount" },
  { key: "current", label: "current balance" },
  { key: "payment", label: "payment" },
  { key: "frequency", label: "how often", opts: FREQUENCY },
  { key: "payoff", label: "payoff" },
];

const REAL_ESTATE: Field<RealEstate>[] = [
  { key: "owns", label: "Owns real estate", opts: YES_NO },
  { key: "interest", label: "Would use a property's equity", opts: YES_NO },
  { key: "structure", label: "How they'd want it", opts: STRUCTURES },
  { key: "borrower", label: "Funds would go to", opts: BORROWERS },
  { key: "purpose_note", label: "What it's for" },
  { key: "foreclosure", label: "Foreclosure or short sale in 7 years", opts: YES_NO },
  { key: "foreclosure_year", label: "Foreclosure year" },
];

const PROPERTY: Field<Property>[] = [
  { key: "address", label: "address" },
  { key: "city", label: "city" },
  { key: "state", label: "state" },
  { key: "zip", label: "ZIP" },
  { key: "type", label: "type", opts: PROPERTY_TYPES },
  { key: "use", label: "use", opts: PROPERTY_USES },
  { key: "title", label: "on title", opts: TITLE_HOLDERS },
  { key: "all_sign", label: "everyone on title signs", opts: YES_NO },
  { key: "purchased", label: "bought (month)" },
  { key: "price", label: "price paid" },
  { key: "value", label: "worth today" },
  { key: "value_source", label: "value from", opts: VALUE_SOURCES },
  { key: "rent", label: "rent" },
  { key: "taxes_current", label: "taxes current", opts: YES_NO },
  { key: "insured", label: "insured", opts: YES_NO },
  { key: "hoa", label: "HOA", opts: YES_NO },
  { key: "hoa_dues", label: "HOA dues" },
  { key: "listed", label: "listed for sale", opts: LISTED },
  { key: "condition", label: "condition", opts: CONDITIONS },
];

const LIEN: Field<Lien>[] = [
  { key: "type", label: "type", opts: LIEN_TYPES },
  { key: "holder", label: "held by" },
  { key: "balance", label: "balance" },
  { key: "limit", label: "line limit" },
  { key: "payment", label: "monthly payment" },
  { key: "status", label: "payments", opts: PAYMENT_STATUS },
  { key: "late_12m", label: "late payments in 12 months", opts: LATE },
  { key: "payoff", label: "pay off with new funding", opts: YES_NO },
];

const show = (v: unknown, opts?: Opt[]): string => {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return "";
  return opts ? labelOf(opts, s) || s : s;
};

/** Compare the same record's fields; one Change per field that differs. */
function fields<T extends object>(
  out: Change[],
  section: Change["section"],
  base: string,
  prefix: string,
  a: T,
  b: T,
  list: Field<T>[],
) {
  for (const f of list) {
    const before = show((a as Record<string, unknown>)[f.key], f.opts);
    const after = show((b as Record<string, unknown>)[f.key], f.opts);
    if (before === after) continue;
    out.push({
      path: `${base}.${f.key}`,
      section,
      label: prefix ? `${prefix} ${f.label}` : f.label,
      before,
      after,
      kind: !before ? "added" : !after ? "removed" : "changed",
      ...(f.flag ? { flag: f.flag } : {}),
    });
  }
}

const ownerName = (o: Owner | undefined) => `${o?.first ?? ""} ${o?.last ?? ""}`.trim();
const place = (p: Property | undefined) =>
  [p?.address, p?.city]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(", ");

/** The hidden numbers: changed or not, from secret_changes when staff ask, else by comparing. */
function secrets(out: Change[], i: number, who: string, a: Owner, b: Owner, s?: SecretChanges) {
  const typed = (v: string) => !!v.trim() && !isMaskedSsn(v) && !isMaskedDob(v);
  const ssn = s
    ? !!s[i]?.ssn
    : typed(b.ssn) && b.ssn.replace(/\D/g, "") !== a.ssn.replace(/\D/g, "");
  const dob = s ? !!s[i]?.dob : typed(b.dob) && b.dob !== a.dob;
  for (const [key, changed, label] of [
    ["ssn", ssn, "SSN"],
    ["dob", dob, "date of birth"],
  ] as const) {
    if (!changed) continue;
    out.push({
      path: `owners.${i}.${key}`,
      section: "owners",
      label: `${who} ${label}`,
      before: "on file",
      after: "changed (not shown)",
      kind: "changed",
      secret: true,
      flag: "identity",
    });
  }
}

/** Every answer that differs between before and after, in the order the application asks. */
export function diffDetails(
  before: Details,
  after: Details,
  secretChanges?: SecretChanges,
): Change[] {
  const out: Change[] = [];
  fields(out, "business", "business", "", before.business, after.business, BUSINESS);

  const owners = Math.max(before.owners.length, after.owners.length);
  for (let i = 0; i < owners; i++) {
    const a = before.owners[i];
    const b = after.owners[i];
    const who = i === 0 ? "Owner's" : "Second owner's";
    if (!a && b) {
      out.push({
        path: `owners.${i}`,
        section: "owners",
        label: i === 0 ? "Owner" : "Second owner",
        before: "",
        after: ownerName(b) || "added",
        kind: "added",
        flag: "identity",
      });
      continue;
    }
    if (a && !b) {
      out.push({
        path: `owners.${i}`,
        section: "owners",
        label: i === 0 ? "Owner" : "Second owner",
        before: ownerName(a) || "listed",
        after: "",
        kind: "removed",
        flag: "identity",
      });
      continue;
    }
    if (!a || !b) continue;
    fields(out, "owners", `owners.${i}`, who, a, b, OWNER);
    secrets(out, i, who, a, b, secretChanges);
  }

  const balances = Math.max(before.balances.length, after.balances.length);
  for (let i = 0; i < balances; i++) {
    const a = before.balances[i];
    const b = after.balances[i];
    const name = `Balance ${i + 1}`;
    if (!a || !b) {
      const x = (a ?? b)!;
      out.push({
        path: `balances.${i}`,
        section: "funding",
        label: name,
        before: a ? [x.funder, x.current].filter(Boolean).join(", ") || "listed" : "",
        after: b ? [x.funder, x.current].filter(Boolean).join(", ") || "added" : "",
        kind: a ? "removed" : "added",
      });
      continue;
    }
    fields(out, "funding", `balances.${i}`, `${name}:`, a, b, BALANCE);
  }

  const req = (r: Details["request"]) => ({
    amount: r.amount,
    term: r.term ? `${r.term} months` : "",
    uses: r.uses.map((u) => labelOf(USES, u) || u).join(", "),
  });
  fields(out, "funding", "request", "", req(before.request), req(after.request), [
    { key: "amount", label: "Amount requested" },
    { key: "term", label: "Term" },
    { key: "uses", label: "Use of funds" },
  ]);

  const ra = before.real_estate;
  const rb = after.real_estate;
  fields(out, "property", "real_estate", "", ra, rb, REAL_ESTATE);
  const props = Math.max(ra.properties.length, rb.properties.length);
  for (let i = 0; i < props; i++) {
    const a = ra.properties[i];
    const b = rb.properties[i];
    const name = props > 1 || i > 0 ? `Property ${i + 1}` : "Property";
    const base = `real_estate.properties.${i}`;
    if (!a || !b) {
      out.push({
        path: base,
        section: "property",
        label: name,
        before: a ? place(a) || "listed" : "",
        after: b ? place(b) || "added" : "",
        kind: a ? "removed" : "added",
      });
      continue;
    }
    const at = place(b) || place(a);
    const pname = at ? `${at}:` : `${name}:`;
    fields(out, "property", base, pname, a, b, PROPERTY);
    if (a.free_clear !== b.free_clear) {
      out.push({
        path: `${base}.free_clear`,
        section: "property",
        label: `${pname} owned free and clear`,
        before: a.free_clear ? "Yes" : "No",
        after: b.free_clear ? "Yes" : "No",
        kind: "changed",
      });
    }
    const la = a.free_clear ? [] : a.liens.filter((l) => l.type);
    const lb = b.free_clear ? [] : b.liens.filter((l) => l.type);
    const liens = Math.max(la.length, lb.length);
    for (let j = 0; j < liens; j++) {
      const x = la[j];
      const y = lb[j];
      const kind = labelOf(LIEN_TYPES, (y ?? x)!.type) || "Balance";
      const lname = `${pname} ${kind.charAt(0).toLowerCase()}${kind.slice(1)}`;
      if (!x || !y) {
        const l = (x ?? y)!;
        out.push({
          path: `${base}.liens.${j}`,
          section: "property",
          label: lname,
          before: x
            ? [l.holder, l.balance && `balance ${l.balance}`].filter(Boolean).join(", ") || "listed"
            : "",
          after: y
            ? [l.holder, l.balance && `balance ${l.balance}`].filter(Boolean).join(", ") || "added"
            : "",
          kind: x ? "removed" : "added",
        });
        continue;
      }
      fields(out, "property", `${base}.liens.${j}`, lname, x, y, LIEN);
    }
  }
  return out;
}

/** Which changes answer which of the rep's asks, and what changed that nobody asked for. */
export function matchItems(
  items: ChangeItem[],
  changes: Change[],
): { asked: { item: ChangeItem; changes: Change[] }[]; also: Change[] } {
  const used = new Set<Change>();
  const asked = items.map((item) => {
    const hit = changes.filter((c) => covers(item, c));
    hit.forEach((c) => used.add(c));
    return { item, changes: hit };
  });
  return { asked, also: changes.filter((c) => !used.has(c)) };
}

function covers(item: ChangeItem, c: Change): boolean {
  const t = item.target;
  if (t && t !== "other") {
    if (t === "owners.new") return c.path === "owners.1" && c.kind === "added";
    return c.path === t || c.path.startsWith(`${t}.`);
  }
  if (item.section === "other") return false;
  return c.section === item.section;
}
