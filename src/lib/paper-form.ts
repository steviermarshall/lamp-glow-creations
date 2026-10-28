// The paper application filled in on the page: every box on the one-page form, tied to the same
// Details the online application saves, so a signed paper form lands in the rep's files the same
// way. Box positions come from application-pdf (TEXT_FIELDS, CHECKBOXES); this file only says
// which answer each box holds, its label and how it's typed. Pure functions only.
import { CHECKBOXES, TEXT_FIELDS } from "@/lib/application-pdf";
import {
  CREDIT_BANDS,
  emptyBalance,
  emptyOwner,
  ENTITY_TYPES,
  US_STATES,
  type Balance,
  type Business,
  type Details,
  type Owner,
} from "@/lib/application-details";
import { amount } from "@/lib/real-estate";

/** Page size of the template in points; boxes are placed as a share of it. */
export const PAGE = { w: 612, h: 792 } as const;

export type Box = readonly [number, number, number, number];

export type Input = "text" | "email" | "tel" | "numeric" | "money" | "date" | "state" | "select";

export type PaperField = {
  kind: "field";
  /** The TEXT_FIELDS box it sits in. */
  id: keyof typeof TEXT_FIELDS;
  label: string;
  input: Input;
  options?: readonly string[];
  get: (d: Details) => string;
  set: (d: Details, v: string) => Details;
  /** Filled in and well formed, for the boxes the application can't go without. */
  ok?: (d: Details) => boolean;
};

export type Choice = { box: keyof typeof CHECKBOXES; value: string; label: string };

export type PaperGroup = {
  kind: "group";
  id: string;
  label: string;
  multi: boolean;
  choices: Choice[];
  get: (d: Details) => string[];
  set: (d: Details, values: string[]) => Details;
};

export type PaperItem = PaperField | PaperGroup;

const digits = (s: string) => s.replace(/\D/g, "");

const biz =
  (k: keyof Business) =>
  (d: Details, v: string): Details => ({ ...d, business: { ...d.business, [k]: v } });

/** Owner i, made on first use (a second owner exists once any of their boxes has something). */
const own =
  (i: number, k: keyof Owner) =>
  (d: Details, v: string): Details => {
    const owners = [...d.owners];
    while (owners.length <= i) owners.push(emptyOwner());
    owners[i] = { ...owners[i]!, [k]: v };
    return { ...d, owners };
  };

const bal =
  (i: number, k: keyof Balance) =>
  (d: Details, v: string): Details => {
    const balances = [...d.balances];
    while (balances.length <= i) balances.push(emptyBalance());
    balances[i] = { ...balances[i]!, [k]: v };
    return { ...d, balances };
  };

const ownerBlank = (o: Owner) =>
  !Object.entries(o).some(([, v]) => typeof v === "string" && v.trim());

const field = (f: Omit<PaperField, "kind">): PaperField => ({ kind: "field", ...f });

const ownerFields = (i: number): PaperField[] => {
  const p = `owner${i + 1}_` as const;
  const o = (d: Details) => d.owners[i];
  // the second owner's boxes only count once they've started on them
  const needed = (d: Details) => i === 0 || (!!o(d) && !ownerBlank(o(d)!));
  const who = i === 0 ? "Owner" : "Second owner";
  return [
    field({
      id: `${p}first_name`,
      label: `${who}: first name`,
      input: "text",
      get: (d) => o(d)?.first ?? "",
      set: own(i, "first"),
      ok: (d) => !needed(d) || !!o(d)?.first.trim(),
    }),
    field({
      id: `${p}last_name`,
      label: `${who}: last name`,
      input: "text",
      get: (d) => o(d)?.last ?? "",
      set: own(i, "last"),
      ok: (d) => !needed(d) || !!o(d)?.last.trim(),
    }),
    field({
      id: `${p}title`,
      label: `${who}: title`,
      input: "text",
      get: (d) => o(d)?.title ?? "",
      set: own(i, "title"),
    }),
    field({
      id: `${p}ownership`,
      label: `${who}: ownership %`,
      input: "numeric",
      get: (d) => o(d)?.ownership ?? "",
      set: own(i, "ownership"),
      ok: (d) => !needed(d) || !!o(d)?.ownership.trim(),
    }),
    field({
      id: `${p}credit`,
      label: `${who}: credit score (estimate)`,
      input: "select",
      options: CREDIT_BANDS,
      get: (d) => o(d)?.credit ?? "",
      set: own(i, "credit"),
    }),
    field({
      id: `${p}address`,
      label: `${who}: home address`,
      input: "text",
      get: (d) => o(d)?.address ?? "",
      set: own(i, "address"),
      ok: (d) => !needed(d) || !!o(d)?.address.trim(),
    }),
    field({
      id: `${p}city`,
      label: `${who}: city`,
      input: "text",
      get: (d) => o(d)?.city ?? "",
      set: own(i, "city"),
      ok: (d) => !needed(d) || !!o(d)?.city.trim(),
    }),
    field({
      id: `${p}state`,
      label: `${who}: state`,
      input: "state",
      get: (d) => o(d)?.state ?? "",
      set: own(i, "state"),
      ok: (d) => !needed(d) || /^[A-Za-z]{2}$/.test(o(d)?.state.trim() ?? ""),
    }),
    field({
      id: `${p}zip`,
      label: `${who}: ZIP`,
      input: "numeric",
      get: (d) => o(d)?.zip ?? "",
      set: own(i, "zip"),
      ok: (d) => !needed(d) || /^\d{5}$/.test(o(d)?.zip.trim() ?? ""),
    }),
    field({
      id: `${p}mobile`,
      label: `${who}: mobile phone`,
      input: "tel",
      get: (d) => o(d)?.mobile ?? "",
      set: own(i, "mobile"),
      ok: (d) => !needed(d) || digits(o(d)?.mobile ?? "").length >= 10,
    }),
    field({
      id: `${p}email`,
      label: `${who}: email`,
      input: "email",
      get: (d) => o(d)?.email ?? "",
      set: own(i, "email"),
      ok: (d) => !needed(d) || /\S+@\S+\.\S+/.test(o(d)?.email ?? ""),
    }),
    field({
      id: `${p}ssn`,
      label: `${who}: SSN`,
      input: "numeric",
      get: (d) => o(d)?.ssn ?? "",
      set: own(i, "ssn"),
      ok: (d) => !needed(d) || digits(o(d)?.ssn ?? "").length === 9,
    }),
    field({
      id: `${p}dob`,
      label: `${who}: date of birth`,
      input: "date",
      get: (d) => o(d)?.dob ?? "",
      set: own(i, "dob"),
      ok: (d) => !needed(d) || !!o(d)?.dob,
    }),
  ];
};

const balanceFields = (i: number): PaperField[] => {
  const p = `balance${i + 1}_` as const;
  const b = (d: Details) => d.balances[i];
  const row = `Current funding ${i + 1}`;
  return [
    field({
      id: `${p}funder`,
      label: `${row}: funding company`,
      input: "text",
      get: (d) => b(d)?.funder ?? "",
      set: bal(i, "funder"),
    }),
    field({
      id: `${p}original`,
      label: `${row}: original amount`,
      input: "money",
      get: (d) => b(d)?.original ?? "",
      set: bal(i, "original"),
    }),
    field({
      id: `${p}current`,
      label: `${row}: current balance`,
      input: "money",
      get: (d) => b(d)?.current ?? "",
      set: bal(i, "current"),
    }),
    field({
      id: `${p}payment`,
      label: `${row}: daily or weekly payment`,
      input: "text",
      get: (d) => b(d)?.payment ?? "",
      set: bal(i, "payment"),
    }),
    field({
      id: `${p}payoff`,
      label: `${row}: estimated payoff date`,
      input: "text",
      get: (d) => b(d)?.payoff ?? "",
      set: bal(i, "payoff"),
    }),
  ];
};

const uses: Choice[] = [
  { box: "use_working_capital", value: "working_capital", label: "Working capital" },
  { box: "use_inventory", value: "inventory", label: "Inventory" },
  { box: "use_equipment", value: "equipment", label: "Equipment" },
  { box: "use_payroll", value: "payroll", label: "Payroll" },
  { box: "use_other", value: "other", label: "Other" },
];

const one = (v: string[]) => v[v.length - 1] ?? "";

/** Every box in reading order: the order the phone editor's Next button walks. */
export const PAPER_ITEMS: PaperItem[] = [
  field({
    id: "legal_name",
    label: "Company / legal business name",
    input: "text",
    get: (d) => d.business.legal_name,
    set: biz("legal_name"),
    ok: (d) => !!d.business.legal_name.trim(),
  }),
  field({
    id: "dba",
    label: "Doing business as (DBA)",
    input: "text",
    get: (d) => d.business.dba,
    set: biz("dba"),
  }),
  field({
    id: "business_address",
    label: "Business address (no PO boxes)",
    input: "text",
    get: (d) => d.business.address,
    set: biz("address"),
    ok: (d) => !!d.business.address.trim(),
  }),
  field({
    id: "business_city",
    label: "Business city",
    input: "text",
    get: (d) => d.business.city,
    set: biz("city"),
    ok: (d) => !!d.business.city.trim(),
  }),
  field({
    id: "business_state",
    label: "Business state",
    input: "state",
    get: (d) => d.business.state,
    set: biz("state"),
    ok: (d) => /^[A-Za-z]{2}$/.test(d.business.state.trim()),
  }),
  field({
    id: "business_zip",
    label: "Business ZIP",
    input: "numeric",
    get: (d) => d.business.zip,
    set: biz("zip"),
    ok: (d) => /^\d{5}$/.test(d.business.zip.trim()),
  }),
  field({
    id: "business_phone",
    label: "Business phone",
    input: "tel",
    get: (d) => d.business.phone,
    set: biz("phone"),
    ok: (d) => digits(d.business.phone).length >= 10,
  }),
  field({
    id: "business_email",
    label: "Business email",
    input: "email",
    get: (d) => d.business.email,
    set: biz("email"),
  }),
  field({
    id: "business_start_date",
    label: "Business start date",
    input: "date",
    get: (d) => d.business.start_date,
    set: biz("start_date"),
    ok: (d) => !!d.business.start_date,
  }),
  field({
    id: "ein",
    label: "Federal tax ID (EIN)",
    input: "numeric",
    get: (d) => d.business.ein,
    set: biz("ein"),
    ok: (d) => digits(d.business.ein).length === 9,
  }),
  field({
    id: "entity_type",
    label: "Entity type",
    input: "select",
    options: ENTITY_TYPES,
    get: (d) => d.business.entity_type,
    set: biz("entity_type"),
    ok: (d) => !!d.business.entity_type,
  }),
  field({
    id: "monthly_revenue",
    label: "Average monthly revenue",
    input: "money",
    get: (d) => d.business.monthly_revenue,
    set: biz("monthly_revenue"),
    ok: (d) => !!d.business.monthly_revenue.trim(),
  }),
  field({
    id: "monthly_card_volume",
    label: "Monthly card volume",
    input: "money",
    get: (d) => d.business.card_volume,
    set: biz("card_volume"),
  }),
  field({
    id: "industry",
    label: "Industry type",
    input: "text",
    get: (d) => d.business.industry,
    set: biz("industry"),
  }),
  {
    kind: "group",
    id: "uses",
    label: "Use of funds",
    multi: true,
    choices: uses,
    get: (d) => d.request.uses,
    set: (d, v) => ({ ...d, request: { ...d.request, uses: v } }),
  },
  field({
    id: "business_bank",
    label: "Business bank",
    input: "text",
    get: (d) => d.business.bank,
    set: biz("bank"),
  }),
  field({
    id: "monthly_deposit_count",
    label: "Monthly deposits (count)",
    input: "numeric",
    get: (d) => d.business.deposit_count,
    set: biz("deposit_count"),
  }),
  {
    kind: "group",
    id: "premises",
    label: "Own or rent the premises",
    multi: false,
    choices: [
      { box: "premises_own", value: "own", label: "Own" },
      { box: "premises_rent", value: "rent", label: "Rent" },
    ],
    get: (d) => (d.business.premises ? [d.business.premises] : []),
    set: (d, v) => biz("premises")(d, one(v)),
  },
  field({
    id: "monthly_rent",
    label: "Monthly rent",
    input: "money",
    get: (d) => d.business.rent,
    set: biz("rent"),
  }),
  {
    kind: "group",
    id: "liens",
    label: "Existing liens or judgments",
    multi: false,
    choices: [
      { box: "liens_no", value: "no", label: "No" },
      { box: "liens_yes", value: "yes", label: "Yes" },
    ],
    get: (d) => (d.business.liens ? [d.business.liens] : []),
    set: (d, v) => biz("liens")(d, one(v)),
  },
  ...ownerFields(0),
  ...ownerFields(1),
  ...balanceFields(0),
  ...balanceFields(1),
  field({
    id: "amount_requested",
    label: "Amount requested",
    input: "money",
    get: (d) => d.request.amount,
    set: (d, v) => ({ ...d, request: { ...d.request, amount: v } }),
    ok: (d) => (amount(d.request.amount) ?? 0) > 0,
  }),
  {
    kind: "group",
    id: "term",
    label: "Preferred term",
    multi: false,
    choices: [
      { box: "term_3", value: "3", label: "3 months" },
      { box: "term_6", value: "6", label: "6 months" },
      { box: "term_9", value: "9", label: "9 months" },
      { box: "term_12", value: "12", label: "12 months or more" },
    ],
    get: (d) => (d.request.term ? [d.request.term] : []),
    set: (d, v) => ({
      ...d,
      request: { ...d.request, term: one(v) as Details["request"]["term"] },
    }),
  },
];

/** The signing boxes: shown on the page, filled from the signing step below it. */
export const SIGN_BOXES = {
  lamp_rep: TEXT_FIELDS["lamp_rep"]!,
  owner1_print_name: TEXT_FIELDS["owner1_print_name"]!,
  owner1_signature: TEXT_FIELDS["owner1_signature"]!,
  owner1_sign_date: TEXT_FIELDS["owner1_sign_date"]!,
  owner2_print_name: TEXT_FIELDS["owner2_print_name"]!,
  owner2_signature: TEXT_FIELDS["owner2_signature"]!,
  owner2_sign_date: TEXT_FIELDS["owner2_sign_date"]!,
} as const;

export const boxOf = (item: PaperItem): Box =>
  item.kind === "field"
    ? TEXT_FIELDS[item.id]!
    : unionBox(item.choices.map((c) => CHECKBOXES[c.box]!));

function unionBox(boxes: Box[]): Box {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/** A box as CSS percentages of the page. */
export const place = ([x0, y0, x1, y1]: Box) => ({
  left: `${(x0 / PAGE.w) * 100}%`,
  top: `${(y0 / PAGE.h) * 100}%`,
  width: `${((x1 - x0) / PAGE.w) * 100}%`,
  height: `${((y1 - y0) / PAGE.h) * 100}%`,
});

/** Required boxes not yet right, for marking them on the page. */
export const wrongBoxes = (d: Details): Set<string> =>
  new Set(
    PAPER_ITEMS.filter((x): x is PaperField => x.kind === "field" && !!x.ok && !x.ok(d)).map(
      (x) => x.id,
    ),
  );

/** Before saving: a second owner nobody filled in, and empty funding rows, dropped. */
export function tidyPaper(d: Details): Details {
  const owners = d.owners.filter((o, i) => i === 0 || !ownerBlank(o));
  return {
    ...d,
    owners: owners.length ? owners : [emptyOwner()],
    balances: d.balances.filter((b) => Object.values(b).some((v) => v.trim())),
  };
}

/** What a box shows: dates as MM/DD/YYYY, the way the paper form prints them. */
export function shown(item: PaperField, d: Details): string {
  const v = item.get(d);
  if (item.input === "date") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
  }
  return v;
}

export { US_STATES };
