// The Lamp working capital application as a fillable PDF, prefilled from a file.
//
// The template is the one-page paper form in public/forms. This adds a form field over every
// box on it, fills what the online application already knows, and leaves the rest (EIN,
// addresses, owners, SSN, date of birth, balances, signature) for the merchant or rep to
// complete in any PDF reader. When the merchant has completed and signed the full application
// online (application_details), every box is filled from it, SSN and date of birth included, with
// the drawn signature on the signature line (the typed /s/ name for signatures from before
// drawing existed). What the paper form has no box for goes on a second page: the real estate
// schedule, the other answers and the electronic signature record. The quick answers alone never
// carry SSN or date of birth. Nothing here uploads or sends: the PDF is built in the browser.
import {
  BlendMode,
  PDFDocument,
  StandardFonts,
  rgb,
  setCharacterSpacing,
  type Color,
  type PDFFont,
  type PDFForm,
  type PDFImage,
  type PDFPage,
  type PDFTextField,
} from "pdf-lib";

type FieldAppearanceOptions = NonNullable<Parameters<PDFTextField["addToPage"]>[1]>;
import { labelFor, type Answers } from "@/lib/apply";
import type { PdfAudit } from "@/lib/application-details";
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
  amount,
  equityOf,
  labelOf,
  pct,
  usd0,
  type Lien,
  type Property,
  type RealEstate,
} from "@/lib/real-estate";

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

/** The signature lines a drawn signature can sit on. */
export type SignatureLine = "owner1_signature" | "owner2_signature";

export type ApplicationValues = {
  text: Partial<Record<keyof typeof TEXT_FIELDS, string>>;
  checked: Partial<Record<keyof typeof CHECKBOXES, boolean>>;
  /** Drawn signatures (PNG data URLs), placed on their signature lines. */
  images?: Partial<Record<SignatureLine, string>>;
  /** The real estate schedule for page 2, only when they own property. */
  realEstate?: RealEstate;
  /** Answers the paper form has no box for, printed on page 2. */
  extra?: { label: string; value: string }[];
  /** How the application was signed, printed as the electronic signature record. */
  audit?: PdfAudit;
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

function addText(form: PDFForm, page: PDFPage, name: string, box: Box, value: string) {
  const field = form.createTextField(name);
  if (value) field.setText(value);
  field.addToPage(page, clear(box));
  field.setFontSize(box[3] - box[1] >= 14 ? 9 : 8);
  return field;
}

// ---------- Text the standard fonts can encode ----------

/** Stand-ins for characters outside WinAnsi, the only encoding Helvetica has here. */
const SWAPS: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": ",",
  "\u201b": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u201e": '"',
  "\u2032": "'",
  "\u2033": '"',
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2015": "-",
  "\u2212": "-",
  "\u2026": "...",
  "\u2022": "-",
  "\u2190": "<-",
  "\u2192": "->",
  "\u2248": "~",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u0110": "D",
  "\u0111": "d",
  "\u0131": "i",
  "\u0141": "L",
  "\u0142": "l",
};

/**
 * pdf-lib throws on any character the font can't encode (an emoji in a business name, the
 * narrow space Intl puts before "AM"). Keeps what the font has, swaps the usual typographic
 * characters, strips accents it lacks and drops the rest, so drawing never throws.
 */
function winAnsi(font: PDFFont): (s: string) => string {
  const ok = new Set(font.getCharacterSet());
  return (s) => {
    let out = "";
    for (const ch of s.replace(/[\r\n\t\u00a0\u2000-\u200a\u202f\u205f\u3000]+/g, " ")) {
      const swap = SWAPS[ch];
      if (ok.has(ch.codePointAt(0) ?? 0)) out += ch;
      else if (swap !== undefined) out += swap;
      else {
        const plain = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
        if (plain && [...plain].every((c) => ok.has(c.codePointAt(0) ?? 0))) out += plain;
      }
    }
    return out.replace(/ {2,}/g, " "); // a dropped emoji leaves two spaces
  };
}

// ---------- Drawn signatures ----------

/**
 * How far a drawn signature may rise above its box, and dip below its line, like ink on paper.
 * The print-name line is only 7pt above the signature box, so a taller rise (24pt was tried)
 * writes the signature over the printed name.
 */
const SIGNATURE_RISE = 11;
const SIGNATURE_DROP = 3;
/** Signatures print in a dark pen color whatever the pad drew with (the site is dark green). */
const PEN = [22, 34, 64] as const;

function dataUrlBytes(url: string): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(url.trim());
  if (!m?.[1]) return null;
  try {
    const bin = atob(m[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function through(
  parts: Uint8Array[],
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const piped = new Blob(parts as BlobPart[]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

type Raster = { width: number; height: number; rgba: Uint8Array };

/** Decodes an 8-bit, non-interlaced PNG (what canvas.toDataURL makes). Null for anything else. */
async function decodePng(png: Uint8Array): Promise<Raster | null> {
  if (typeof DecompressionStream === "undefined" || png.length < 45) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (view.getUint32(0) !== 0x89504e47) return null;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = -1;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  for (let pos = 8; pos + 12 <= png.length;) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(png[pos + 4]!, png[pos + 5]!, png[pos + 6]!, png[pos + 7]!);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      depth = data[8] ?? 0;
      color = data[9] ?? -1;
      interlace = data[12] ?? 0;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const channels = color === 6 ? 4 : color === 2 ? 3 : color === 4 ? 2 : color === 0 ? 1 : 0;
  if (!channels || depth !== 8 || interlace || !width || !height) return null;
  if (width * height > 4_000_000) return null;
  const raw = await through(idat, new DecompressionStream("deflate"));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return null;
  const rgba = new Uint8Array(width * height * 4);
  let prev: Uint8Array = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i]! + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const o = (y * width + x) * 4;
      const first = line[s]!; // red, or gray for the grayscale types
      rgba[o] = first;
      rgba[o + 1] = channels >= 3 ? line[s + 1]! : first;
      rgba[o + 2] = channels >= 3 ? line[s + 2]! : first;
      rgba[o + 3] = channels === 4 ? line[s + 3]! : channels === 2 ? line[s + 1]! : 255;
    }
    prev = line;
  }
  return { width, height, rgba };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of out.subarray(4, 8 + data.length)) {
    crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8);
  }
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return out;
}

/**
 * The signature cropped to its ink and redrawn in dark pen on a clear background, so a pad's
 * empty margins don't shrink it and light ink drawn on the dark site still shows on paper.
 * Ink is what's opaque on a clear pad, or what differs from the corners on a filled one.
 * "blank" when there's no ink at all. Null when this PNG type can't be read here; the drawing is
 * then placed as it came. Throws on a corrupt PNG.
 */
async function penSignature(png: Uint8Array): Promise<Uint8Array | "blank" | null> {
  if (typeof CompressionStream === "undefined") return null;
  const img = await decodePng(png);
  if (!img) return null;
  const { width, height, rgba } = img;
  const px = width * height;
  let clearPx = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! < 16) clearPx++;
  const clearPad = clearPx > px / 4;
  const lum = (p: number) =>
    (rgba[p * 4]! * 299 + rgba[p * 4 + 1]! * 587 + rgba[p * 4 + 2]! * 114) / 1000;
  const corners = [0, width - 1, px - width, px - 1].map(lum).sort((a, b) => a - b);
  const paper = (corners[1]! + corners[2]!) / 2;
  const ink = new Uint8Array(px);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let p = 0; p < px; p++) {
    const v = clearPad
      ? rgba[p * 4 + 3]!
      : Math.max(0, Math.min(255, (Math.abs(lum(p) - paper) - 24) * 2.2));
    ink[p] = v;
    if (v > 48) {
      const x = p % width;
      const y = (p - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return "blank";
  const x0 = Math.max(0, minX - 2);
  const y0 = Math.max(0, minY - 2);
  const w = Math.min(width, maxX + 3) - x0;
  const h = Math.min(height, maxY + 3) - y0;
  const rows = new Uint8Array(h * (w * 4 + 1)); // each row starts with filter 0 (none)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      rows[o] = PEN[0];
      rows[o + 1] = PEN[1];
      rows[o + 2] = PEN[2];
      rows[o + 3] = ink[(y0 + y) * width + x0 + x]!;
    }
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", await through([rows], new CompressionStream("deflate"))),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Puts a drawn signature on its line: as wide as the box allows, rising above it like a real
 * signature, aspect ratio kept. False when the image is corrupt or blank, so the caller can
 * print the typed /s/ line instead of an empty signature.
 */
async function drawSignature(doc: PDFDocument, page: PDFPage, box: Box, dataUrl: string) {
  const raw = dataUrlBytes(dataUrl);
  if (!raw) return false;
  let pen: Uint8Array | "blank" | null;
  try {
    pen = await penSignature(raw);
  } catch {
    return false;
  }
  if (pen === "blank") return false;
  const asDrawn = !pen;
  let image: PDFImage;
  try {
    image = await doc.embedPng(pen ?? raw);
  } catch {
    return false;
  }
  const [l, t, r, b] = box;
  const scale = Math.min(
    (r - l - 2) / image.width,
    (b - t + SIGNATURE_RISE + SIGNATURE_DROP) / image.height,
    1,
  );
  page.drawImage(image, {
    x: l + 1,
    y: PAGE_HEIGHT - b - SIGNATURE_DROP,
    width: image.width * scale,
    height: image.height * scale,
    // as drawn, a white pad would hide the printed name above; multiply keeps only the ink
    ...(asDrawn ? { blendMode: BlendMode.Multiply } : {}),
  });
  return true;
}

// ---------- Page 2 on: real estate schedule, other answers, signature record ----------

const FOREST = rgb(14 / 255, 59 / 255, 44 / 255);
const GREEN = rgb(28 / 255, 154 / 255, 88 / 255);
const PANEL = rgb(238 / 255, 247 / 255, 241 / 255);
const LINE = rgb(213 / 255, 230 / 255, 220 / 255);
const INK = rgb(26 / 255, 26 / 255, 26 / 255);
const LABEL = rgb(70 / 255, 70 / 255, 70 / 255);
const MUTED = rgb(125 / 255, 125 / 255, 125 / 255);
const WHITE = rgb(1, 1, 1);

/** Page 1's outer box edges, so page 2 lines up with it. */
const LEFT = 45;
const RIGHT = 569;
const WIDTH = RIGHT - LEFT;
const CONTENT_TOP = 102;
const CONTENT_BOTTOM = 742;

type Sheet = {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  clean: (s: string) => string;
  title: string;
  business: string;
  pages: PDFPage[];
  page: PDFPage;
  /** Where the next block starts, in points from the top of the page. */
  y: number;
};

type TextStyle = { bold?: boolean; color?: Color; spacing?: number; align?: "left" | "right" };

function widthOf(s: Sheet, text: string, size: number, o: TextStyle = {}) {
  const t = s.clean(text);
  const font = o.bold ? s.bold : s.regular;
  return font.widthOfTextAtSize(t, size) + (o.spacing ?? 0) * Math.max(0, t.length - 1);
}

/** One line of text with its top at `top` (points from the top of the page). */
function put(s: Sheet, text: string, x: number, top: number, size: number, o: TextStyle = {}) {
  const t = s.clean(text);
  if (!t) return;
  const left = o.align === "right" ? x - widthOf(s, t, size, o) : x;
  if (o.spacing) s.page.pushOperators(setCharacterSpacing(o.spacing));
  s.page.drawText(t, {
    x: left,
    y: PAGE_HEIGHT - top - size * 0.76,
    size,
    font: o.bold ? s.bold : s.regular,
    color: o.color ?? INK,
  });
  if (o.spacing) s.page.pushOperators(setCharacterSpacing(0));
}

/** Text broken into lines that fit `width`; a word longer than a line is cut. */
function wrap(s: Sheet, text: string, size: number, width: number, bold = false): string[] {
  const font = bold ? s.bold : s.regular;
  const fits = (t: string) => font.widthOfTextAtSize(t, size) <= width;
  const lines: string[] = [];
  let line = "";
  for (const word of s.clean(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (!fits(rest) && rest.length > 1) {
      let n = rest.length - 1;
      while (n > 1 && !fits(rest.slice(0, n))) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** One line, cut with "..." when it doesn't fit. */
function fit(s: Sheet, text: string, size: number, width: number, o: TextStyle = {}) {
  let t = s.clean(text);
  if (widthOf(s, t, size, o) <= width) return t;
  while (t.length > 1 && widthOf(s, `${t}...`, size, o) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}

function startPage(s: Sheet) {
  s.page = s.doc.addPage([612, PAGE_HEIGHT]);
  s.pages.push(s.page);
  const n = s.pages.length + 1;
  put(s, "Lamp", LEFT, 33, 21, { bold: true, color: FOREST });
  put(s, ".", LEFT + widthOf(s, "Lamp", 21, { bold: true }), 33, 21, {
    bold: true,
    color: GREEN,
  });
  put(s, "WORKING CAPITAL FOR REAL BUSINESSES", LEFT, 58, 5.4, {
    bold: true,
    color: GREEN,
    spacing: 1.3,
  });
  put(s, "Lamp Capital Group LLC", RIGHT, 35, 6.8, { bold: true, color: FOREST, align: "right" });
  put(s, "Working capital application", RIGHT, 45, 6.8, { color: LABEL, align: "right" });
  if (s.business) {
    put(s, fit(s, s.business, 6.8, 260), RIGHT, 55, 6.8, { color: LABEL, align: "right" });
  }
  // the template's rule: dark forest fading to light green
  const steps = 64;
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    s.page.drawRectangle({
      x: LEFT + (WIDTH / steps) * i,
      y: PAGE_HEIGHT - 69,
      width: WIDTH / steps + 0.4,
      height: 1.8,
      color: rgb((14 + 136 * k) / 255, (59 + 146 * k) / 255, (44 + 128 * k) / 255),
    });
  }
  put(s, `Page ${n}: ${s.title}${n > 2 ? ", continued" : ""}`, LEFT, 79, 11.5, {
    bold: true,
    color: FOREST,
  });
  s.y = CONTENT_TOP;
}

/** Starts a new page when the next `h` points won't fit on this one. */
function ensure(s: Sheet, h: number) {
  if (s.y + h > CONTENT_BOTTOM) startPage(s);
}

/** A dark tab heading like page 1's ("COMPANY INFORMATION"), kept with its first block. */
function section(s: Sheet, label: string, firstBlock: number) {
  if (s.y > CONTENT_TOP) s.y += 14;
  ensure(s, 13 + firstBlock);
  const text = label.toUpperCase();
  const w = widthOf(s, text, 6.8, { bold: true, spacing: 1 }) + 16;
  s.page.drawSvgPath(`M0 13 L0 2.5 Q0 0 2.5 0 L${w - 2.5} 0 Q${w} 0 ${w} 2.5 L${w} 13 Z`, {
    x: LEFT,
    y: PAGE_HEIGHT - s.y,
    color: FOREST,
  });
  put(s, text, LEFT + 8, s.y + 3.6, 6.8, { bold: true, color: WHITE, spacing: 1 });
  s.y += 13;
}

type Cell = { label: string; value: string; span?: number };

const GRID_COLUMNS = 4;
const VALUE_SIZE = 8.3;
const VALUE_LEAD = 10;

const cellWidth = (c: Cell) => (WIDTH / GRID_COLUMNS) * (c.span ?? 1);
const cellLines = (s: Sheet, c: Cell) =>
  wrap(s, c.value.trim() || "—", VALUE_SIZE, cellWidth(c) - 10);
const rowHeight = (s: Sheet, row: Cell[]) =>
  17 + Math.max(...row.map((c) => cellLines(s, c).length)) * VALUE_LEAD;
const gridHeight = (s: Sheet, rows: Cell[][]) => rows.reduce((n, r) => n + rowHeight(s, r), 0);

/** Label-over-value cells in page 1's bordered style. */
function grid(s: Sheet, rows: Cell[][]) {
  for (const row of rows) {
    const h = rowHeight(s, row);
    let x = LEFT;
    for (const c of row) {
      const w = cellWidth(c);
      s.page.drawRectangle({
        x,
        y: PAGE_HEIGHT - s.y - h,
        width: w,
        height: h,
        borderColor: LINE,
        borderWidth: 0.6,
      });
      const label = fit(s, c.label.toUpperCase(), 5.5, w - 10, { spacing: 0.5 });
      put(s, label, x + 5, s.y + 5.5, 5.5, { color: LABEL, spacing: 0.5 });
      const empty = !c.value.trim();
      cellLines(s, c).forEach((ln, i) =>
        put(s, ln, x + 5, s.y + 14.5 + i * VALUE_LEAD, VALUE_SIZE, {
          color: empty ? MUTED : INK,
        }),
      );
      x += w;
    }
    s.y += h;
  }
}

type Column<T> = { label: string; width: number; value: (row: T) => string; right?: boolean };

const TABLE_SIZE = 7.8;
const TABLE_LEAD = 9.2;
const TABLE_HEAD = 13;

const tableLines = <T>(s: Sheet, cols: Column<T>[], row: T) =>
  cols.map((c) => wrap(s, c.value(row) || "", TABLE_SIZE, c.width - 9));
const tableRowHeight = <T>(s: Sheet, cols: Column<T>[], row: T) =>
  8 + Math.max(...tableLines(s, cols, row).map((l) => l.length)) * TABLE_LEAD;
const tableHeight = <T>(s: Sheet, cols: Column<T>[], rows: T[]) =>
  TABLE_HEAD + (rows.length ? rows.reduce((n, r) => n + tableRowHeight(s, cols, r), 0) : 17);

/** A ruled table with a light green header; `empty` stands in for no rows. */
function table<T>(s: Sheet, cols: Column<T>[], rows: T[], empty: string) {
  const top = s.y;
  const total = tableHeight(s, cols, rows);
  s.page.drawRectangle({
    x: LEFT,
    y: PAGE_HEIGHT - top - TABLE_HEAD,
    width: WIDTH,
    height: TABLE_HEAD,
    color: PANEL,
  });
  let x = LEFT;
  for (const c of cols) {
    const label = fit(s, c.label.toUpperCase(), 5.3, c.width - 9, { bold: true, spacing: 0.4 });
    const at = c.right ? x + c.width - 4.5 : x + 4.5;
    put(s, label, at, top + 4.3, 5.3, {
      bold: true,
      color: FOREST,
      spacing: 0.4,
      align: c.right ? "right" : "left",
    });
    x += c.width;
  }
  s.y += TABLE_HEAD;
  if (!rows.length) put(s, empty, LEFT + 4.5, s.y + 5, TABLE_SIZE, { color: MUTED });
  rows.forEach((row, i) => {
    const h = tableRowHeight(s, cols, row);
    if (i) {
      s.page.drawLine({
        start: { x: LEFT, y: PAGE_HEIGHT - s.y },
        end: { x: RIGHT, y: PAGE_HEIGHT - s.y },
        thickness: 0.5,
        color: LINE,
      });
    }
    let cx = LEFT;
    tableLines(s, cols, row).forEach((lines, ci) => {
      const c = cols[ci]!;
      lines.forEach((ln, li) =>
        put(
          s,
          ln,
          c.right ? cx + c.width - 4.5 : cx + 4.5,
          s.y + 4.5 + li * TABLE_LEAD,
          TABLE_SIZE,
          {
            align: c.right ? "right" : "left",
          },
        ),
      );
      cx += c.width;
    });
    s.y += h;
  });
  if (!rows.length) s.y += 17;
  s.page.drawRectangle({
    x: LEFT,
    y: PAGE_HEIGHT - top - total,
    width: WIDTH,
    height: total,
    borderColor: LINE,
    borderWidth: 0.6,
  });
}

type Stat = { label: string; value: string };
const STATS_HEIGHT = 27;

/** A strip of figures, label over value, on the light green panel. */
function stats(s: Sheet, items: Stat[]) {
  const w = WIDTH / items.length;
  s.page.drawRectangle({
    x: LEFT,
    y: PAGE_HEIGHT - s.y - STATS_HEIGHT,
    width: WIDTH,
    height: STATS_HEIGHT,
    color: PANEL,
    borderColor: LINE,
    borderWidth: 0.6,
  });
  items.forEach((it, i) => {
    const x = LEFT + i * w;
    if (i) {
      s.page.drawLine({
        start: { x, y: PAGE_HEIGHT - s.y - 5 },
        end: { x, y: PAGE_HEIGHT - s.y - STATS_HEIGHT + 5 },
        thickness: 0.5,
        color: LINE,
      });
    }
    put(s, fit(s, it.label.toUpperCase(), 5.3, w - 12, { spacing: 0.5 }), x + 6, s.y + 5.5, 5.3, {
      color: LABEL,
      spacing: 0.5,
    });
    put(s, fit(s, it.value, 9.5, w - 12, { bold: true }), x + 6, s.y + 14, 9.5, {
      bold: true,
      color: FOREST,
    });
  });
  s.y += STATS_HEIGHT;
}

const answer = (v: string) =>
  ({ yes: "Yes", no: "No", not_sure: "Not sure", maybe: "Maybe" })[v] ?? v;

/** "450000", "$450k" print as "$450,000"; anything else as typed. */
const money = (v: string) => {
  const t = v.trim();
  if (!t) return "";
  const n = amount(t);
  return n == null ? t : usd0(n);
};

const signedMoney = (n: number | null) => (n != null && n < 0 ? `-${usd0(-n)}` : usd0(n));

const monthYear = (v: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(v);
  return m ? `${m[2]}/${m[1]}` : v;
};

const LIEN_COLUMNS: Column<Lien>[] = [
  { label: "Type", width: 80, value: (l) => labelOf(LIEN_TYPES, l.type) || l.type },
  { label: "Held by", width: 94, value: (l) => l.holder },
  { label: "Balance", width: 60, value: (l) => money(l.balance), right: true },
  { label: "Line limit", width: 56, value: (l) => money(l.limit), right: true },
  { label: "Monthly pmt", width: 58, value: (l) => money(l.payment), right: true },
  { label: "Status", width: 74, value: (l) => labelOf(PAYMENT_STATUS, l.status) },
  { label: "Late 12 mo", width: 48, value: (l) => l.late_12m },
  { label: "Pay off", width: 54, value: (l) => answer(l.payoff) },
];

function propertyGrid(p: Property): Cell[][] {
  const rows: Cell[][] = [
    [
      { label: "Property type", value: labelOf(PROPERTY_TYPES, p.type) },
      { label: "How it's used", value: labelOf(PROPERTY_USES, p.use) },
      { label: "Title held by", value: labelOf(TITLE_HOLDERS, p.title) },
      { label: "Everyone on title signs", value: answer(p.all_sign) },
    ],
    [
      { label: "Bought", value: monthYear(p.purchased) },
      { label: "Price paid", value: money(p.price) },
      { label: "Value today", value: money(p.value) },
      { label: "Value from", value: labelOf(VALUE_SOURCES, p.value_source) },
    ],
    [
      { label: "Property taxes current", value: answer(p.taxes_current) },
      { label: "Insured", value: answer(p.insured) },
      {
        label: "HOA",
        value:
          p.hoa === "yes" && p.hoa_dues.trim()
            ? `Yes, ${money(p.hoa_dues)} a month`
            : answer(p.hoa),
      },
      { label: "Monthly rent", value: money(p.rent) },
    ],
  ];
  if (p.listed || p.condition) {
    rows.push([
      { label: "Listed for sale", value: labelOf(LISTED, p.listed), span: 2 },
      { label: "Condition", value: labelOf(CONDITIONS, p.condition), span: 2 },
    ]);
  }
  return rows;
}

const propertyLiens = (p: Property) => (p.free_clear ? [] : p.liens.filter((l) => l.type));

function propertyStats(p: Property): Stat[] {
  const e = equityOf(p);
  return [
    { label: "Value", value: usd0(e.value) },
    { label: "Owed today", value: usd0(e.owed) },
    { label: "Owed, lines at limit", value: usd0(e.owedAtLimits) },
    { label: "Equity", value: signedMoney(e.equity) },
    { label: "CLTV / HCLTV", value: `${pct(e.cltv)} / ${pct(e.hcltv)}` },
  ];
}

function propertyBlock(s: Sheet, p: Property, i: number) {
  const rows = propertyGrid(p);
  const liens = propertyLiens(p);
  const h =
    20 + gridHeight(s, rows) + 6 + tableHeight(s, LIEN_COLUMNS, liens) + 6 + STATS_HEIGHT + 14;
  ensure(s, h);
  s.page.drawRectangle({
    x: LEFT,
    y: PAGE_HEIGHT - s.y - 20,
    width: WIDTH,
    height: 20,
    color: PANEL,
    borderColor: LINE,
    borderWidth: 0.6,
  });
  const tag = `PROPERTY ${i + 1}`;
  put(s, tag, LEFT + 7, s.y + 7.2, 6.3, { bold: true, color: GREEN, spacing: 1 });
  const tagW = widthOf(s, tag, 6.3, { bold: true, spacing: 1 }) + 14;
  const where = [p.address, p.city, [p.state.toUpperCase(), p.zip].filter(Boolean).join(" ")]
    .map((x) => x.trim())
    .filter(Boolean)
    .join(", ");
  put(
    s,
    fit(s, where || "Address not given", 9.5, WIDTH - tagW - 14, { bold: true }),
    LEFT + 7 + tagW,
    s.y + 5.6,
    9.5,
    {
      bold: true,
      color: FOREST,
    },
  );
  s.y += 20;
  grid(s, rows);
  s.y += 6;
  table(
    s,
    LIEN_COLUMNS,
    liens,
    p.free_clear ? "Owned free and clear: nothing owed on it." : "No balances listed.",
  );
  s.y += 6;
  stats(s, propertyStats(p));
  s.y += 14;
}

function realEstatePart(s: Sheet, r: RealEstate) {
  const n = r.properties.length;
  const summary: Cell[][] = [
    [
      {
        label: "Owns real estate",
        value: n ? `Yes, ${n} ${n === 1 ? "property" : "properties"}` : "Yes",
      },
      { label: "Would use its equity", value: answer(r.interest) },
      { label: "Preferred structure", value: labelOf(STRUCTURES, r.structure) },
      { label: "Funds would go to", value: labelOf(BORROWERS, r.borrower) },
    ],
    [
      {
        label: "Foreclosure, deed-in-lieu or short sale, 7 years",
        value:
          r.foreclosure === "yes" && r.foreclosure_year.trim()
            ? `Yes, ${r.foreclosure_year.trim()}`
            : answer(r.foreclosure),
        span: 2,
      },
      { label: "What the funds are for", value: r.purpose_note, span: 2 },
    ],
  ];
  section(s, "Real estate schedule", gridHeight(s, summary));
  grid(s, summary);
  s.y += 12;
  r.properties.forEach((p, i) => propertyBlock(s, p, i));
  if (n > 1) {
    const all = r.properties.map(equityOf);
    const value = all.every((e) => e.value != null)
      ? all.reduce((t, e) => t + (e.value ?? 0), 0)
      : null;
    const owed = all.reduce((t, e) => t + e.owed, 0);
    const atLimits = all.reduce((t, e) => t + e.owedAtLimits, 0);
    ensure(s, 14 + STATS_HEIGHT);
    put(s, "ALL PROPERTIES", LEFT, s.y, 5.5, { bold: true, color: GREEN, spacing: 1 });
    s.y += 10;
    stats(s, [
      { label: "Value", value: usd0(value) },
      { label: "Owed today", value: usd0(owed) },
      { label: "Owed, lines at limit", value: usd0(atLimits) },
      { label: "Equity", value: signedMoney(value != null ? value - owed : null) },
      {
        label: "CLTV / HCLTV",
        value: value ? `${pct(owed / value)} / ${pct(atLimits / value)}` : "—",
      },
    ]);
  }
}

function extraPart(s: Sheet, extra: { label: string; value: string }[]) {
  // two to a row; an odd one out takes the full width
  const rows: Cell[][] = [];
  for (let i = 0; i < extra.length; i += 2) {
    const pair = extra.slice(i, i + 2);
    rows.push(pair.map((e) => ({ ...e, span: pair.length === 1 ? 4 : 2 })));
  }
  section(s, "Other answers", gridHeight(s, rows.slice(0, 1)));
  for (const row of rows) {
    ensure(s, rowHeight(s, row));
    grid(s, [row]);
  }
}

/** "Safari on iPhone" from a user agent; empty when it's not one we know. */
function deviceOf(ua: string): string {
  // first match wins, so the more specific names come first (Edge and Chrome both say Safari)
  const pick = (known: [RegExp, string][]) => known.find(([re]) => re.test(ua))?.[1] ?? "";
  const os = pick([
    [/iPhone/, "iPhone"],
    [/iPad/, "iPad"],
    [/Android/, "Android"],
    [/CrOS/, "Chromebook"],
    [/Windows/, "Windows"],
    [/Mac OS X|Macintosh/, "Mac"],
    [/Linux/, "Linux"],
  ]);
  const browser = pick([
    [/Edg(e|A|iOS)?\//, "Edge"],
    [/OPR\//, "Opera"],
    [/SamsungBrowser/, "Samsung Internet"],
    [/CriOS|Chrome\//, "Chrome"],
    [/FxiOS|Firefox\//, "Firefox"],
    [/Safari\//, "Safari"],
  ]);
  return browser && os ? `${browser} on ${os}` : browser || os;
}

/** "October 27, 2026 at 10:03:22 AM EDT (2026-10-27 14:03:22 UTC)": Lamp's office time and UTC. */
function signedAtText(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const office = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "long",
    timeStyle: "long",
  }).format(t);
  return `${office} (${t.toISOString().slice(0, 19).replace("T", " ")} UTC)`;
}

const RECORD_LABEL = 120;

function signatureRecord(s: Sheet, a: PdfAudit) {
  const agent = a.agent?.trim() ?? "";
  const rows: { label: string; value: string; note?: string }[] = [
    { label: "Signed by", value: `${a.signer}, principal owner #1` },
    {
      label: "Second signer",
      value: a.signer2 ? `${a.signer2}, principal owner #2` : "None",
    },
    { label: "Signed at", value: signedAtText(a.signedAt) },
    {
      label: "Signed via",
      value:
        a.via === "link"
          ? "Application link (no login needed)"
          : a.via === "account"
            ? "Lamp account"
            : "Not recorded",
    },
    {
      label: "Signature",
      value: a.drawn
        ? "Drawn by hand on screen, with the full name typed"
        : "Full name typed (/s/)",
    },
    { label: "IP address", value: a.ip?.trim() || "Not recorded" },
    {
      label: "Device",
      value: (agent && deviceOf(agent)) || (agent ? "Browser" : "Not recorded"),
      ...(agent ? { note: agent } : {}),
    },
    { label: "Consent version", value: a.consentVersion || "Not recorded" },
  ];
  const valueW = WIDTH - RECORD_LABEL - 20;
  const measured = rows.map((r) => ({
    ...r,
    lines: wrap(s, r.value, 8.3, valueW),
    noteLines: r.note ? wrap(s, r.note, 6, valueW) : [],
  }));
  const rowH = (m: (typeof measured)[number]) => 8 + m.lines.length * 10 + m.noteLines.length * 7.6;
  const intro = wrap(
    s,
    a.drawn
      ? "Signed electronically. Each signer drew their signature, typed their full name and selected Sign after the authorization below was shown. Lamp recorded these details at that moment."
      : "Signed electronically. The signer typed their full name and selected Sign after the authorization was shown. Lamp recorded these details at that moment.",
    7,
    WIDTH - 20,
  );
  const boxH = 10 + intro.length * 9 + 6 + measured.reduce((n, m) => n + rowH(m), 0) + 4;
  section(s, "Electronic signature record", boxH);
  const top = s.y;
  s.page.drawRectangle({
    x: LEFT,
    y: PAGE_HEIGHT - top - boxH,
    width: WIDTH,
    height: boxH,
    color: PANEL,
    borderColor: LINE,
    borderWidth: 0.6,
  });
  s.y += 10;
  intro.forEach((ln) => {
    put(s, ln, LEFT + 10, s.y, 7, { color: LABEL });
    s.y += 9;
  });
  s.y += 6;
  measured.forEach((m, i) => {
    if (i) {
      s.page.drawLine({
        start: { x: LEFT + 10, y: PAGE_HEIGHT - s.y },
        end: { x: RIGHT - 10, y: PAGE_HEIGHT - s.y },
        thickness: 0.5,
        color: LINE,
      });
    }
    put(s, m.label.toUpperCase(), LEFT + 10, s.y + 6.2, 5.5, { color: LABEL, spacing: 0.5 });
    m.lines.forEach((ln, li) =>
      put(s, ln, LEFT + 10 + RECORD_LABEL, s.y + 4.6 + li * 10, 8.3, {
        bold: li === 0 && i === 0,
        color: INK,
      }),
    );
    m.noteLines.forEach((ln, li) =>
      put(s, ln, LEFT + 10 + RECORD_LABEL, s.y + 4.6 + m.lines.length * 10 + li * 7.6, 6, {
        color: MUTED,
      }),
    );
    s.y += rowH(m);
  });
  s.y = top + boxH;

  if (a.consentText) {
    const lines = wrap(s, a.consentText, 5.9, WIDTH);
    s.y += 12;
    ensure(s, 12 + 7.4 * 3);
    put(s, `AUTHORIZATION AS SIGNED (${a.consentVersion ?? ""})`, LEFT, s.y, 5.5, {
      bold: true,
      color: GREEN,
      spacing: 1,
    });
    s.y += 11;
    for (const ln of lines) {
      ensure(s, 7.4);
      put(s, ln, LEFT, s.y, 5.9, { color: LABEL });
      s.y += 7.4;
    }
  }
}

function pageTitle(v: ApplicationValues) {
  const extra = !!v.extra?.length;
  if (v.realEstate)
    return v.audit ? "Real estate schedule and signature record" : "Real estate schedule";
  if (v.audit) return extra ? "Other answers and signature record" : "Signature record";
  return "Other answers";
}

/** Page 2 (and 3 if it runs long): what the paper form has no room for. */
function addSchedulePages(
  doc: PDFDocument,
  fonts: { regular: PDFFont; bold: PDFFont },
  clean: (s: string) => string,
  v: ApplicationValues,
) {
  const s: Sheet = {
    doc,
    ...fonts,
    clean,
    title: pageTitle(v),
    business: v.text["legal_name"]?.trim() ?? "",
    pages: [],
    page: doc.getPage(0),
    y: CONTENT_TOP,
  };
  startPage(s);
  if (v.realEstate) realEstatePart(s, v.realEstate);
  if (v.extra?.length) extraPart(s, v.extra);
  if (v.audit) signatureRecord(s, v.audit);
  const total = s.pages.length + 1;
  s.pages.forEach((page, i) => {
    s.page = page;
    put(s, "LAMP CAPITAL GROUP LLC · WORKING CAPITAL APPLICATION", LEFT, 760, 5.4, {
      color: MUTED,
      spacing: 0.9,
    });
    put(s, `CONFIDENTIAL · PAGE ${i + 2} OF ${total}`, RIGHT, 760, 5.4, {
      color: MUTED,
      spacing: 0.9,
      align: "right",
    });
  });
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
  const clean = winAnsi(font);
  const text = { ...values.text };

  // Drawn signatures go on the page under the (then read-only) signature fields. One that
  // can't be read falls back to the typed /s/ line, so the form never looks unsigned.
  const drawn = new Set<string>();
  const signers: [SignatureLine, string | null | undefined][] = [
    ["owner1_signature", values.audit?.signer],
    ["owner2_signature", values.audit?.signer2],
  ];
  for (const [line, signer] of signers) {
    const png = values.images?.[line];
    const box = TEXT_FIELDS[line];
    if (!png || !box) continue;
    if (await drawSignature(doc, page, box, png)) drawn.add(line);
    else if (!text[line] && signer) text[line] = `/s/ ${signer} (signed electronically)`;
  }

  for (const [name, box] of Object.entries(TEXT_FIELDS)) {
    const field = addText(form, page, name, box, clean(text[name] ?? ""));
    if (drawn.has(name)) field.enableReadOnly();
  }
  for (const [name, box] of Object.entries(CHECKBOXES)) {
    const cb = form.createCheckBox(name);
    cb.addToPage(page, clear(box));
    if (values.checked[name as keyof typeof CHECKBOXES]) cb.check();
  }
  form.updateFieldAppearances(font);

  if (values.realEstate || values.extra?.length || values.audit) {
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    addSchedulePages(doc, { regular: font, bold }, clean, values);
  }
  doc.setTitle("Lamp Working Capital Application");
  doc.setCreator("Lamp");
  return doc.save();
}

/** Fetches the template and builds the PDF's bytes. Browser only. */
export async function applicationPdfBytes(
  src: ApplicationSource,
  full?: ApplicationValues,
): Promise<Uint8Array> {
  const res = await fetch(APPLICATION_TEMPLATE_URL);
  if (!res.ok) throw new Error("Couldn't load the application form.");
  return buildApplicationPdf(await res.arrayBuffer(), full ?? applicationValues(src));
}

/** Fetches the template, builds the PDF and starts the download. Browser only. */
export async function downloadApplicationPdf(
  src: ApplicationSource,
  full?: ApplicationValues,
): Promise<void> {
  const bytes = await applicationPdfBytes(src, full);
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
