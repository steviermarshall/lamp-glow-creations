// Offer Check: turns an offer a merchant already has into plain dollars and an estimated
// yearly rate. Pure functions only, so the math can be tested without the page.

/** About 21 business days and 52/12 weeks in a month (same convention as the home page). */
export const BUSINESS_DAYS_PER_MONTH = 21;
export const WEEKS_PER_MONTH = 52 / 12;
const PERIODS_PER_YEAR = { daily: BUSINESS_DAYS_PER_MONTH * 12, weekly: 52 } as const;

/** Where we start telling owners to be careful. Adjust here; the page reads these. */
export const DEPOSIT_SHARE_CAUTION = 0.15;
export const DEPOSIT_SHARE_HEAVY = 0.25;
export const FEE_SHARE_CAUTION = 0.03;

export type Frequency = "daily" | "weekly";

export type OfferInput = {
  amount: number; // what the offer says you get
  payback: number; // total you pay back
  fees: number; // taken out up front, so you receive amount - fees
  frequency: Frequency;
  payments: number; // number of payments
  payment?: number; // when the offer states the payment, use it exactly (payments = payback / payment)
  monthlyDeposits?: number; // optional: average monthly deposits
  existingWeekly?: number; // optional: what current advances already take per week
};

export type OfferResult = {
  received: number;
  cost: number;
  costPerDollar: number;
  payment: number;
  payments: number;
  months: number;
  weekly: number;
  apr: number | null; // estimated yearly rate as a fraction (0.62 = 62%)
  depositShare: number | null; // this offer's payments / monthly deposits
  combinedShare: number | null; // with existing advances
  feeShare: number;
};

export function paymentsFor(months: number, frequency: Frequency) {
  return Math.max(
    1,
    Math.round(months * (frequency === "daily" ? BUSINESS_DAYS_PER_MONTH : WEEKS_PER_MONTH)),
  );
}

/**
 * Estimated APR the way loans are quoted: find the per-period rate r where the payments are
 * worth exactly what you receive today, then annualize (r × periods per year). Returns null
 * when there's no cost or the inputs don't describe a real offer.
 */
export function estimateApr(
  received: number,
  payment: number,
  payments: number,
  frequency: Frequency,
) {
  if (!(received > 0) || !(payment > 0) || !(payments >= 1)) return null;
  if (payment * payments <= received) return null;
  const pv = (r: number) => payment * ((1 - (1 + r) ** -payments) / r);
  let lo = 1e-9;
  let hi = 1;
  while (pv(hi) > received && hi < 1e6) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > received) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * PERIODS_PER_YEAR[frequency];
}

export function checkOffer(o: OfferInput): OfferResult | null {
  const payments = o.payment && o.payment > 0 ? o.payback / o.payment : o.payments;
  if (!(o.amount > 0) || !(o.payback > o.amount * 0.5) || !(payments >= 1)) return null;
  const received = Math.max(0, o.amount - Math.max(0, o.fees));
  const payment = o.payment && o.payment > 0 ? o.payment : o.payback / payments;
  const weekly = o.frequency === "daily" ? payment * 5 : payment;
  const monthlyOut = weekly * WEEKS_PER_MONTH;
  const deposits = o.monthlyDeposits && o.monthlyDeposits > 0 ? o.monthlyDeposits : null;
  const existingMonthly = (o.existingWeekly ?? 0) * WEEKS_PER_MONTH;
  return {
    received,
    cost: o.payback - received,
    costPerDollar: received > 0 ? (o.payback - received) / received : 0,
    payment,
    payments,
    months: payments / (o.frequency === "daily" ? BUSINESS_DAYS_PER_MONTH : WEEKS_PER_MONTH),
    weekly,
    apr: estimateApr(received, payment, payments, o.frequency),
    depositShare: deposits ? monthlyOut / deposits : null,
    combinedShare:
      deposits && existingMonthly > 0 ? (monthlyOut + existingMonthly) / deposits : null,
    feeShare: o.amount > 0 ? Math.max(0, o.fees) / o.amount : 0,
  };
}

export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const pct = (n: number) => `${Math.round(n * 100)}%`;
