/** Engine leads: statuses, labels and the small helpers the staff view and tests share. */

export const ENGINE_STATUSES = [
  "new",
  "called",
  "no_answer",
  "callback",
  "qualified",
  "submitted",
  "funded",
  "dead",
  "do_not_call",
] as const;
export type EngineStatus = (typeof ENGINE_STATUSES)[number];

export const ENGINE_STATUS_LABEL: Record<EngineStatus, string> = {
  new: "New",
  called: "Called",
  no_answer: "No answer",
  callback: "Callback",
  qualified: "Qualified",
  submitted: "Submitted",
  funded: "Funded",
  dead: "Dead",
  do_not_call: "Do not call",
};

export const TIERS = ["A", "B", "C"] as const;

type Signal = { source?: string; signal_type?: string; signal_date?: string };

/** "nyc_license 2026-10-12 · fmcsa 2026-10-03": what the engine saw, newest first. */
export function signalSummary(signals: unknown): string {
  if (!Array.isArray(signals)) return "";
  return (signals as Signal[])
    .filter((s) => s && typeof s === "object")
    .map((s) => [s.source, s.signal_type, s.signal_date].filter(Boolean).join(" "))
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ");
}

export const tel = (phone: string | null) => (phone ?? "").replace(/[^0-9+]/g, "");

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** The columns of the CSV the Board downloads for Lamp, in its order. */
export const COLUMNS = [
  "source",
  "source_key",
  "name",
  "phone",
  "email",
  "city",
  "state",
  "industry",
  "tier",
  "need",
  "reason",
  "signals",
  "first_found",
  "rep_slug",
] as const;
type Column = (typeof COLUMNS)[number];

/** One row of the CSV the Board downloads for Lamp, ready to upsert by (source, source_key). */
export type LeadUpload = {
  source: string;
  source_key: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  tier: string | null;
  need: number | null;
  reason: string | null;
  signals: unknown[];
  first_found: string | null;
  rep_slug: string;
};

/**
 * Reads the Board's CSV. Every lead needs a source and key, and a rep: the file's rep_slug
 * column, or `rep` when the admin picks one rep for the whole file. Rows that can't be used
 * are listed in `problems` with their line number and left out.
 */
export function leadsFromCsv(
  text: string,
  repSlugs: string[],
  rep: string | null,
): { leads: LeadUpload[]; problems: string[] } {
  const [head, ...body] = parseCsv(text);
  const problems: string[] = [];
  if (!head) return { leads: [], problems: ["The file is empty."] };
  const at = {} as Record<Column, number>;
  for (const k of COLUMNS) at[k] = head.findIndex((h) => h.trim().toLowerCase() === k);
  if (at.source < 0 || at.source_key < 0) {
    return {
      leads: [],
      problems: ["This isn't a Lamp lead file: it has no source and source_key columns."],
    };
  }
  const seen = new Set<string>();
  const leads: LeadUpload[] = [];
  body.forEach((r, i) => {
    const line = i + 2;
    const v = (k: Column) => (at[k] >= 0 ? (r[at[k]] ?? "").trim() : "");
    const orNull = (k: Column) => v(k) || null;
    const source = v("source");
    const key = v("source_key");
    if (!source || !key) {
      problems.push(`Line ${line}: no source or source_key.`);
      return;
    }
    if (seen.has(`${source}\u0000${key}`)) {
      problems.push(`Line ${line}: the same lead appears twice in the file.`);
      return;
    }
    const slug = (rep ?? v("rep_slug")).toLowerCase();
    if (!slug || !repSlugs.includes(slug)) {
      problems.push(
        `Line ${line}: ${slug ? `"${slug}" is not a Lamp rep` : "no rep"} (${v("name") || key}).`,
      );
      return;
    }
    const tier = v("tier").toUpperCase();
    if (tier && !["A", "B", "C", "X"].includes(tier)) {
      problems.push(`Line ${line}: tier "${tier}" should be A, B, C or X.`);
      return;
    }
    const need = v("need");
    let signals: unknown[] = [];
    if (v("signals")) {
      try {
        const parsed: unknown = JSON.parse(v("signals"));
        signals = Array.isArray(parsed) ? parsed : [];
      } catch {
        problems.push(
          `Line ${line}: the signals column isn't valid JSON; uploaded without signals.`,
        );
      }
    }
    const found = v("first_found");
    seen.add(`${source}\u0000${key}`);
    leads.push({
      source,
      source_key: key,
      name: orNull("name"),
      phone: orNull("phone"),
      email: orNull("email"),
      city: orNull("city"),
      state: orNull("state"),
      industry: orNull("industry"),
      tier: tier || null,
      need: /^-?\d+$/.test(need) ? Number(need) : null,
      reason: orNull("reason"),
      signals,
      first_found: /^\d{4}-\d{2}-\d{2}$/.test(found.slice(0, 10)) ? found.slice(0, 10) : null,
      rep_slug: slug,
    });
  });
  return { leads, problems };
}

/**
 * The search box as a PostgREST `or` filter over name, phone, email, city and industry, or null
 * for an empty box. Characters that mean something to the filter are dropped; a term that is
 * all digits and dashes also matches phones however they're written ("7185551212" finds
 * "(718) 555-1212").
 */
export function searchFilter(term: string): string | null {
  const t = term
    .replace(/[^\p{L}\p{N} @.&'_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  const like = `%${t}%`;
  const parts = ["name", "email", "city", "industry"].map((c) => `${c}.ilike."${like}"`);
  const digits = t.replace(/\D/g, "");
  parts.push(
    /^[\d\s-]+$/.test(t) && digits.length >= 3
      ? `phone.ilike."%${digits.split("").join("%")}%"`
      : `phone.ilike."${like}"`,
  );
  return parts.join(",");
}

/** One engine lead as the page shows it, for the admin's CSV download. */
export type LeadExport = {
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  tier: string | null;
  need: number | null;
  reason: string | null;
  signals: unknown;
  first_found: string | null;
  status: string;
  notes: string;
  rep_slug: string | null;
  worked_at: string | null;
};

/**
 * The picked leads as a CSV that opens in Excel or Sheets: a byte-order mark for the accents,
 * and a cell that starts like a formula (=, +, -, @) gets a leading apostrophe so a
 * spreadsheet shows it as text instead of running it.
 */
export function leadsToCsv(rows: LeadExport[], repName: (slug: string | null) => string): string {
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    "Business",
    "Phone",
    "Email",
    "City",
    "State",
    "Industry",
    "Tier",
    "Need",
    "Why",
    "Signals",
    "Found",
    "Status",
    "Notes",
    "Rep",
    "Last worked",
  ];
  const lines = rows.map((r) =>
    [
      r.name,
      r.phone,
      r.email,
      r.city,
      r.state,
      r.industry,
      r.tier,
      r.need,
      r.reason,
      signalSummary(r.signals),
      r.first_found,
      ENGINE_STATUS_LABEL[r.status as EngineStatus] ?? r.status,
      r.notes,
      repName(r.rep_slug),
      r.worked_at ? r.worked_at.slice(0, 10) : "",
    ]
      .map(cell)
      .join(","),
  );
  return "﻿" + [head.join(","), ...lines].join("\r\n") + "\r\n";
}

/**
 * The Board (Asad's War Room, which runs on his own Mac) can hand a batch of leads to an
 * admin's open Engine leads page instead of a downloaded file. It opens this page, waits for
 * "ready", then sends the same CSV it would have downloaded; nothing is saved until the admin
 * presses Hand out, under their own sign-in. Only these origins are listened to, and only from
 * the window that opened this one.
 */
export const BOARD_ORIGINS = ["http://localhost:8777", "http://127.0.0.1:8777"] as const;
export const BOARD_MAX_CSV = 2_000_000;

export type BoardBatch = { batch: number; label: string; csv: string };

/** A message from the Board, if it is a well-formed batch of leads. */
export function boardBatch(data: unknown): BoardBatch | null {
  if (!data || typeof data !== "object") return null;
  const {
    type,
    batch,
    csv,
    label: rawLabel,
  } = data as {
    type?: unknown;
    batch?: unknown;
    csv?: unknown;
    label?: unknown;
  };
  if (type !== "lamp-board:leads") return null;
  if (typeof batch !== "number" || !Number.isInteger(batch) || batch <= 0) return null;
  if (typeof csv !== "string" || !csv || csv.length > BOARD_MAX_CSV) return null;
  const label = typeof rawLabel === "string" ? rawLabel.trim().slice(0, 120) : "";
  return { batch, label: label || `Board batch #${batch}`, csv };
}
