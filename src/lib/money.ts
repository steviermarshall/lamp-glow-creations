// Shared money helpers for the staff side: funders, submissions, offers, deals and the
// commission ledger. Pure functions only, so the arithmetic can be checked without a database.
import type { Database } from "@/integrations/supabase/types";

type Enums = Database["public"]["Enums"];
export type FunderType = Enums["funder_type"];
export type Frequency = Enums["payment_frequency"];
export type OfferStatus = Enums["offer_status"];
export type SubmissionStatus = Enums["submission_status"];
export type DealStatus = Enums["deal_status"];
export type LedgerKind = Enums["ledger_kind"];

export const FUNDER_TYPES: readonly FunderType[] = ["direct", "iso", "bank", "other"];
export const FUNDER_TYPE_LABEL: Record<FunderType, string> = {
  direct: "Direct funder",
  iso: "Through an ISO",
  bank: "Bank",
  other: "Other",
};

export const FREQUENCIES: readonly Frequency[] = ["daily", "weekly", "biweekly", "monthly"];
export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
};

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  received: "Received (merchant can't see it)",
  presented: "Presented",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  submitted: "Waiting on funder",
  offer: "Offer in",
  declined: "Declined",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

export const DEAL_STATUS_LABEL: Record<DealStatus, string> = {
  funded: "Funded",
  paid_off: "Paid off",
  renewed: "Renewed",
  defaulted: "Defaulted",
};

export const LEDGER_KIND_LABEL: Record<LedgerKind, string> = {
  owed: "Owed to Lamp",
  paid: "Received",
  clawback: "Clawed back",
  adjustment: "Adjustment",
};

/** "$12,500" (whole dollars) or "$12,500.50" when there are cents. */
export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const cents = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

/** A money field a person typed: "$12,500", "12500.5", "12.5k". Null when it isn't a number. */
export function parseMoney(raw: string): number | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[$,\s]/g, "");
  if (!s) return null;
  const k = s.endsWith("k");
  const n = Number(k ? s.slice(0, -1) : s);
  if (!Number.isFinite(n)) return null;
  return Math.round((k ? n * 1000 : n) * 100) / 100;
}

/** What one offer costs the merchant, in the plain terms the Offer Check uses. */
export function offerMath(o: { amount: number; payback: number; fees: number; payments: number }) {
  return {
    factor: o.payback / o.amount,
    payment: o.payback / o.payments,
    net: o.amount - o.fees,
    cost: o.payback - o.amount + o.fees,
  };
}

/** Commission on a funded amount at the funder's points (5 points = 5%). */
export function commissionDue(
  fundedAmount: number,
  points: number | null | undefined,
): number | null {
  if (points === null || points === undefined) return null;
  return Math.round(fundedAmount * points) / 100;
}

/** Sums a deal's ledger. Still to collect = owed + adjustments − received − clawed back. */
export function ledgerTotals(entries: { kind: LedgerKind; amount: number }[]) {
  const t = { owed: 0, paid: 0, clawback: 0, adjustment: 0 };
  for (const e of entries) t[e.kind] += e.amount;
  return {
    ...t,
    outstanding: Math.round((t.owed + t.adjustment - t.paid - t.clawback) * 100) / 100,
    earned: Math.round((t.paid - t.clawback) * 100) / 100,
  };
}

const PERIOD_DAYS: Record<Exclude<Frequency, "daily">, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30.4,
};

/** Business days (Mon–Fri) after `from` up to and including `to`. Daily MCA debits skip weekends. */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let n = 0;
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (d.getTime() < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
  }
  return n;
}

/**
 * How far a deal is paid down, estimated from its schedule (no bank data): payments that should
 * have cleared since funding, out of the total. An estimate only; a bounced debit or a modified
 * schedule makes it wrong, so the radar says "about".
 */
export function paidDown(
  fundedOn: string,
  frequency: Frequency,
  payments: number,
  today = new Date(),
): { made: number; share: number } {
  const start = new Date(`${fundedOn}T00:00:00Z`);
  const made =
    frequency === "daily"
      ? businessDaysBetween(start, today)
      : Math.floor((today.getTime() - start.getTime()) / 86_400_000 / PERIOD_DAYS[frequency]);
  const capped = Math.max(0, Math.min(payments, made));
  return { made: capped, share: payments > 0 ? capped / payments : 0 };
}

/** Renewal radar: a funded deal about half paid down is the best call there is. */
export const RENEWAL_AT = 0.5;
export const RENEWAL_WATCH_FROM = 0.4;
/** Clawback watch: funders can take commission back if the merchant defaults this early. */
export const CLAWBACK_DAYS = 30;

export function daysSince(isoDate: string, today = new Date()): number {
  return Math.floor((today.getTime() - new Date(`${isoDate}T00:00:00Z`).getTime()) / 86_400_000);
}
