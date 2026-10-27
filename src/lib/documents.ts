// What funders need from every merchant, and how the site labels each kind of file.
// Shared by the account page (the merchant's checklist) and, later, the staff page.
// The database keeps the same list in the documents.kind check constraint
// (supabase/migrations/20261019180000_document_kinds.sql); change both together.

export const DOCUMENT_KINDS = [
  "bank_statement",
  "voided_check",
  "drivers_license",
  "funder_application",
  "other",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type DocumentRequirement = {
  kind: Exclude<DocumentKind, "other">;
  /** Shown on the checklist and in the "this file is" picker. */
  label: string;
  /** How many received or accepted files of this kind complete the item. */
  required: number;
  /** One plain line on why funders ask for it. */
  help: string;
};

/** The four things every funder asks for, in the order the checklist shows them. */
export const REQUIRED_DOCUMENTS: readonly DocumentRequirement[] = [
  {
    kind: "bank_statement",
    label: "Business bank statements",
    required: 3,
    help: "The last 3 months, one file per month. Funders size an offer on your deposits.",
  },
  {
    kind: "voided_check",
    label: "Voided business check or bank letter",
    required: 1,
    help: "Confirms the business account your funds go to and your payments come from.",
  },
  {
    kind: "drivers_license",
    label: "Driver's license (front)",
    required: 1,
    help: "Confirms the owner's identity. A clear photo is fine.",
  },
  {
    kind: "funder_application",
    label: "Signed funder application",
    required: 1,
    help: "The PDF your Lamp rep sends you. Sign it, then upload it here.",
  },
];

/**
 * What the browser asks of /api/documents (documents.server.ts). The browser never touches the
 * documents bucket itself: files are uploaded through /api/documents/upload, and listed, opened
 * (logged) and removed here.
 */
export type DocumentsRequest =
  | { action: "folder" }
  | { action: "remove"; path: string }
  | { action: "open"; document_id: string }
  | { action: "review"; document_id: string; status: "accepted" | "rejected" };

export type FolderFile = { name: string; created_at: string | null };

/** "kept": the row is with the team now, so the file stays. "unknown": the reply was lost. */
export type DocumentOutcome = "saved" | "removed" | "kept" | "failed" | "unknown";

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  bank_statement: "Business bank statement",
  voided_check: "Voided business check or bank letter",
  drivers_license: "Driver's license (front)",
  funder_application: "Signed funder application",
  other: "Something else",
};

export const isDocumentKind = (value: unknown): value is DocumentKind =>
  typeof value === "string" && (DOCUMENT_KINDS as readonly string[]).includes(value);

/** A file counts toward its item once the team has it, unless they turned it down. */
export const countsTowardChecklist = (status: string | null | undefined) =>
  status === "received" || status === "accepted";

export type ChecklistItem = DocumentRequirement & {
  /** Received or accepted files of this kind. */
  have: number;
  done: boolean;
};

/** The checklist for one application, from its documents' kind and status. */
export function checklistFor(
  docs: readonly { kind: string | null; status: string | null }[],
): ChecklistItem[] {
  return REQUIRED_DOCUMENTS.map((item) => {
    const have = docs.filter((d) => d.kind === item.kind && countsTowardChecklist(d.status)).length;
    return { ...item, have, done: have >= item.required };
  });
}

/** The item to suggest for the next upload: the first one still short, else "other". */
export const nextMissingKind = (items: readonly ChecklistItem[]): DocumentKind =>
  items.find((i) => !i.done)?.kind ?? "other";
