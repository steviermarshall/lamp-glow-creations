// The Lamp working capital application as a fillable PDF, prefilled from a file.
//
// The template is the one-page paper form in public/forms. This adds a form field over every
// box on it, fills what the online application already knows, and leaves the rest (EIN,
// addresses, owners, SSN, date of birth, balances, signature) for the merchant or rep to
// complete in any PDF reader. When the merchant has completed and signed the full application
// online (application_details), every box is filled from it, SSN and date of birth included, with
// the typed signature on the signature line. The quick answers alone never carry SSN or date of
// birth. Nothing here uploads or sends: the PDF is built in the browser and downloaded.
import { PDFDocument, StandardFonts, type PDFForm, type PDFPage, type PDFTextField } from "pdf-lib";

type FieldAppearanceOptions = NonNullable<Parameters<PDFTextField["addToPage"]>[1]>;
import { labelFor, type Answers } from "@/lib/apply";

export const APPLICATION_TEMPLATE_URL = "/forms/lamp-working-capital-application.pdf";

const PAGE_HEIGHT = 792;

/** A box on the form in top-left page points: left, top, right, bottom. */
type Box = readonly [number, number, number, number];

/** Text boxes, positioned from the labels on the template (letter size, 612 x 792). */
export const TEXT_FIELDS: Record<string, Box> = {
  legal_name: [45, 121.5, 305, 132],
  dba: [311, 121.5, 569, 132],
  business_address: [45, 143.5, 243, 154],
  business_city: [247, 143.5, 371, 154],
  business_state: [375, 143.5, 434, 154],
  business_zip: [438, 143.5, 569, 154],
  business_phone: [45, 165.5, 174, 175.5],
  business_email: [178, 165.5, 307, 175.5],
  business_start_date: [311, 165.5, 402, 175.5],
  ein: [406, 165.5, 498, 175.5],
  entity_type: [502, 165.5, 569, 175.5],
  monthly_revenue: [52, 186, 174, 196],
  monthly_card_volume: [185, 186, 307, 196],
  industry: [311, 186.5, 440, 204],
  business_bank: [45, 215.5, 174, 226],
  monthly_deposit_count: [178, 215.5, 307, 226],
  monthly_rent: [397, 215, 440, 224.5],

  owner1_first_name: [45, 254.5, 190, 265],
  owner1_last_name: [194, 254.5, 339, 265],
  owner1_title: [343, 254.5, 434, 265],
  owner1_ownership: [438, 254.5, 498, 265],
  owner1_credit: [502, 254.5, 569, 265],
  owner1_address: [45, 276.5, 243, 287],
  owner1_city: [247, 276.5, 371, 287],
  owner1_state: [375, 276.5, 434, 287],
  owner1_zip: [438, 276.5, 569, 287],
  owner1_mobile: [45, 298.5, 190, 309],
  owner1_email: [194, 298.5, 371, 309],
  owner1_ssn: [375, 298.5, 477, 309],
  owner1_dob: [481, 298.5, 569, 309],

  owner2_first_name: [45, 337.5, 190, 347.5],
  owner2_last_name: [194, 337.5, 339, 347.5],
  owner2_title: [343, 337.5, 434, 347.5],
  owner2_ownership: [438, 337.5, 498, 347.5],
  owner2_credit: [502, 337.5, 569, 347.5],
  owner2_address: [45, 358.5, 243, 369],
  owner2_city: [247, 358.5, 371, 369],
  owner2_state: [375, 358.5, 434, 369],
  owner2_zip: [438, 358.5, 569, 369],
  owner2_mobile: [45, 380.5, 190, 391],
  owner2_email: [194, 380.5, 371, 391],
  owner2_ssn: [375, 380.5, 477, 391],
  owner2_dob: [481, 380.5, 569, 391],

  balance1_funder: [45, 434, 222, 449],
  balance1_original: [226, 434, 317, 449],
  balance1_current: [321, 434, 413, 449],
  balance1_payment: [417, 434, 509, 449],
  balance1_payoff: [513, 434, 569, 449],
  balance2_funder: [45, 455, 222, 470],
  balance2_original: [226, 455, 317, 470],
  balance2_current: [321, 455, 413, 470],
  balance2_payment: [417, 455, 509, 470],
  balance2_payoff: [513, 455, 569, 470],

  amount_requested: [131, 486, 222, 496],
  lamp_rep: [491, 486, 565, 496],
  owner1_print_name: [86, 519, 299, 528],
  owner1_signature: [74, 535, 224, 544],
  owner2_signature: [347, 535, 497, 544],
  owner1_sign_date: [247, 535, 299, 544],
  owner2_print_name: [360, 519, 572, 528],
  owner2_sign_date: [520, 535, 572, 544],
};

/** Checkboxes, placed over the empty squares printed on the template. */
export const CHECKBOXES: Record<string, Box> = {
  use_working_capital: [443.9, 188.6, 449.1, 193.8],
  use_inventory: [500.6, 188.6, 505.8, 193.8],
  use_equipment: [443.9, 196.4, 449.1, 201.6],
  use_payroll: [486.6, 196.4, 491.8, 201.6],
  use_other: [518, 196.4, 523.2, 201.6],
  premises_own: [310.9, 217.4, 316.1, 222.6],
  premises_rent: [336.1, 217.4, 341.3, 222.6],
  liens_no: [443.9, 217.4, 449.1, 222.6],
  liens_yes: [464.2, 217.4, 469.4, 222.6],
  term_3: [313.4, 488.7, 318.6, 493.9],
  term_6: [339.8, 488.7, 345, 493.9],
  term_9: [366.3, 488.7, 371.5, 493.9],
  term_12: [392.8, 488.7, 398, 493.9],
};

export type ApplicationValues = {
  text: Partial<Record<keyof typeof TEXT_FIELDS, string>>;
  checked: Partial<Record<keyof typeof CHECKBOXES, boolean>>;
};

export type ApplicationSource = {
  answers: Answers | null;
  first_name: string | null;
  business_name: string | null;
  phone: string | null;
  email: string | null;
  amount_requested: number | null;
  repName: string | null;
};

const PURPOSE_BOX: Record<string, keyof typeof CHECKBOXES> = {
  "cash-flow": "use_working_capital",
  payroll: "use_payroll",
  inventory: "use_inventory",
  equipment: "use_equipment",
  expansion: "use_other",
  other: "use_other",
};

/** "$50k – $100k" printed after the form's own "$" reads "50k – 100k". */
const dropDollar = (s: string | undefined) => (s ? s.replace(/\$/g, "") : undefined);

/** What the online application already knows, mapped onto the paper form's boxes. */
export function applicationValues(src: ApplicationSource): ApplicationValues {
  const a = src.answers ?? {};
  const label = (key: Parameters<typeof labelFor>[0]) => {
    const v = labelFor(key, a[key]);
    return v && v !== "—" ? v : undefined;
  };
  const credit = label("credit");
  const text: ApplicationValues["text"] = {
    legal_name: src.business_name ?? undefined,
    business_phone: src.phone ?? undefined,
    business_email: src.email ?? undefined,
    business_start_date: label("tib"),
    monthly_revenue: dropDollar(label("revenue")),
    industry: label("industry"),
    owner1_first_name: src.first_name ?? undefined,
    owner1_mobile: src.phone ?? undefined,
    owner1_email: src.email ?? undefined,
    owner1_credit: credit === "Not sure" ? undefined : credit,
    amount_requested:
      src.amount_requested !== null && src.amount_requested !== undefined
        ? `$${src.amount_requested.toLocaleString("en-US")}`
        : label("amount"),
    lamp_rep: src.repName ?? undefined,
  };
  const checked: ApplicationValues["checked"] = {};
  const box = a.purpose ? PURPOSE_BOX[a.purpose] : undefined;
  if (box) checked[box] = true;
  return { text, checked };
}

const toPdfRect = ([l, t, r, b]: Box) => ({
  x: l,
  y: PAGE_HEIGHT - b,
  width: r - l,
  height: b - t,
});

/** No border and no fill, so the template's own boxes, squares and green panels show through.
 *  pdf-lib paints white unless the key is present and empty, which its types don't allow. */
const clear = (box: Box) =>
  ({
    ...toPdfRect(box),
    borderWidth: 0,
    backgroundColor: undefined,
  }) as unknown as FieldAppearanceOptions;

function addText(form: PDFForm, page: PDFPage, name: string, box: Box, value: string | undefined) {
  const field = form.createTextField(name);
  if (value) field.setText(value);
  field.addToPage(page, clear(box));
  field.setFontSize(box[3] - box[1] >= 14 ? 9 : 8);
}

/** Builds the fillable, prefilled application from the template's bytes. */
export async function buildApplicationPdf(
  template: ArrayBuffer | Uint8Array,
  values: ApplicationValues,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(template);
  const page = doc.getPage(0);
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const [name, box] of Object.entries(TEXT_FIELDS)) {
    addText(form, page, name, box, values.text[name as keyof typeof TEXT_FIELDS]);
  }
  for (const [name, box] of Object.entries(CHECKBOXES)) {
    const cb = form.createCheckBox(name);
    cb.addToPage(page, clear(box));
    if (values.checked[name as keyof typeof CHECKBOXES]) cb.check();
  }
  form.updateFieldAppearances(font);
  doc.setTitle("Lamp Working Capital Application");
  doc.setCreator("Lamp");
  return doc.save();
}

/** Fetches the template, builds the PDF and starts the download. Browser only. */
export async function downloadApplicationPdf(
  src: ApplicationSource,
  full?: ApplicationValues,
): Promise<void> {
  const res = await fetch(APPLICATION_TEMPLATE_URL);
  if (!res.ok) throw new Error("Couldn't load the application form.");
  const bytes = await buildApplicationPdf(await res.arrayBuffer(), full ?? applicationValues(src));
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const name = (src.business_name || "merchant").replace(/[^\w .-]+/g, "").trim() || "merchant";
  a.href = url;
  a.download = `Lamp application - ${name}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
