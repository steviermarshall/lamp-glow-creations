/**
 * What staff can ask a merchant for with a documents link (see document-requests.server.ts), and
 * the document kind each lands as. Merchant-facing labels: plain words (house rule: an MCA is never called a borrowing).
 */
export const DOC_ITEMS = {
  voided_check: {
    label: "A voided check",
    hint: "For the business bank account",
    kind: "voided_check",
  },
  photo_id: {
    label: "Photo ID",
    hint: "Driver's license or passport, front",
    kind: "drivers_license",
  },
  statements: {
    label: "Bank statements",
    hint: "Business account, every page",
    kind: "bank_statement",
  },
  other: { label: "Something else", hint: "", kind: "other" },
} as const;

export type DocItemKey = keyof typeof DOC_ITEMS;

export const docItem = (key: DocItemKey) => DOC_ITEMS[key];

export const isDocItemKey = (k: unknown): k is DocItemKey =>
  typeof k === "string" && k in DOC_ITEMS;
