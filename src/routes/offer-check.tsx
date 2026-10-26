import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Check, Info, Link as LinkIcon, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { seo, SITE } from "@/lib/site";
import {
  checkOffer,
  compareTags,
  DEPOSIT_SHARE_CAUTION,
  DEPOSIT_SHARE_HEAVY,
  FEE_SHARE_CAUTION,
  FREQUENCIES,
  months1,
  paymentsFor,
  pct,
  pct1,
  SHOW_YEARLY_RATE,
  usd,
  type Frequency,
  type OfferResult,
  type TermUnit,
} from "@/lib/offer-check";
import { btnOutline, btnPrimary, card, Eyebrow, PageShell } from "@/components/site/layout";

// Campaign links and shared links stay simple:
// /offer-check?amount=50000&factor=1.35&term=9&unit=months&freq=daily
// The router parses bare numbers in the query as numbers, so every reader accepts both.
type Search = Record<string, string | number | undefined>;

export const Route = createFileRoute("/offer-check")({
  validateSearch: (search: Record<string, unknown>) => search as Search,
  head: () =>
    seo({
      path: "/offer-check",
      title: "Offer Check: what your funding offer really costs — Lamp",
      description:
        "Already have a funding offer? Enter the amount, payback and term to see the real cost in dollars, an estimated yearly rate, how much it takes out of your deposits each week, and compare up to three offers side by side.",
    }),
  component: OfferCheckPage,
});

// The /apply amount bands, so "try to beat it" lands with the amount already answered.
function amountBand(n: number) {
  if (n < 25_000) return "lt-25k";
  if (n < 50_000) return "25-50k";
  if (n < 100_000) return "50-100k";
  if (n < 250_000) return "100-250k";
  return "250k-plus";
}

const num = (s: string | number | undefined) => {
  const n = typeof s === "number" ? s : Number(String(s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const fmtIn = (n: number) => (n > 0 ? Math.round(n).toLocaleString("en-US") : "");
const str = (s: string | number | undefined) => (s === undefined ? undefined : String(s));

const isFrequency = (s: string | undefined): s is Frequency =>
  FREQUENCIES.some((f) => f.value === s);
const isUnit = (s: string | undefined): s is TermUnit =>
  s === "days" || s === "weeks" || s === "months";

type Inputs = {
  amount: string;
  pricing: "factor" | "payback";
  factor: string;
  payback: string;
  fees: string;
  frequency: Frequency;
  length: "term" | "payment";
  term: string;
  unit: TermUnit;
  payment: string;
  deposits: string;
  hasExisting: boolean;
  existing: string;
  existingFreq: Frequency;
};

// Opens on a worked example so the page shows what it does; the owner types over it.
const EXAMPLE: Inputs = {
  amount: "50,000",
  pricing: "factor",
  factor: "1.35",
  payback: "67,500",
  fees: "",
  frequency: "daily",
  length: "term",
  term: "9",
  unit: "months",
  payment: "",
  deposits: "",
  hasExisting: false,
  existing: "",
  existingFreq: "daily",
};

function fromSearch(s: Search): { inputs: Inputs; prefilled: boolean } {
  const amount = num(s["amount"]);
  if (!(amount > 0)) return { inputs: EXAMPLE, prefilled: false };
  const payback = num(s["payback"]);
  const factor = num(s["factor"]);
  const payment = num(s["payment"]);
  const term = num(s["term"]);
  const freqS = str(s["freq"]);
  const freq = isFrequency(freqS) ? freqS : "daily";
  return {
    prefilled: true,
    inputs: {
      amount: fmtIn(amount),
      pricing: payback > 0 && !(factor > 0) ? "payback" : "factor",
      factor: factor > 0 ? String(factor) : payback > 0 ? (payback / amount).toFixed(2) : "1.35",
      payback: payback > 0 ? fmtIn(payback) : factor > 0 ? fmtIn(amount * factor) : "",
      fees: fmtIn(num(s["fees"])),
      frequency: freq,
      length: payment > 0 && !(term > 0) ? "payment" : "term",
      term: term > 0 ? String(term) : "9",
      unit: isUnit(str(s["unit"])) ? (str(s["unit"]) as TermUnit) : "months",
      payment: fmtIn(payment),
      deposits: fmtIn(num(s["deposits"])),
      hasExisting: false,
      existing: "",
      existingFreq: "daily",
    },
  };
}

function toSearch(i: Inputs): Record<string, string> {
  const out: Record<string, string> = { amount: String(num(i.amount)), freq: i.frequency };
  if (i.pricing === "factor") out["factor"] = String(num(i.factor));
  else out["payback"] = String(num(i.payback));
  if (num(i.fees) > 0) out["fees"] = String(num(i.fees));
  if (i.length === "term") {
    out["term"] = String(num(i.term));
    out["unit"] = i.unit;
  } else out["payment"] = String(num(i.payment));
  if (num(i.deposits) > 0) out["deposits"] = String(num(i.deposits));
  return out;
}

function compute(i: Inputs) {
  const totalPayback = i.pricing === "factor" ? num(i.amount) * num(i.factor) : num(i.payback);
  const nPayments =
    i.length === "term"
      ? paymentsFor(num(i.term), i.unit, i.frequency)
      : num(i.payment) > 0
        ? Math.max(1, Math.round(totalPayback / num(i.payment)))
        : 0;
  const perWeek = (f: Frequency, v: number) =>
    f === "daily" ? v * 5 : f === "weekly" ? v : f === "biweekly" ? v / 2 : (v * 12) / 52;
  return checkOffer({
    amount: num(i.amount),
    payback: totalPayback,
    fees: num(i.fees),
    frequency: i.frequency,
    payments: nPayments,
    ...(i.length === "payment" && num(i.payment) > 0 ? { payment: num(i.payment) } : {}),
    ...(num(i.deposits) > 0 ? { monthlyDeposits: num(i.deposits) } : {}),
    ...(i.hasExisting && num(i.existing) > 0
      ? { existingWeekly: perWeek(i.existingFreq, num(i.existing)) }
      : {}),
  });
}

type Saved = { id: number; name: string; inputs: Inputs; result: OfferResult };
const MAX_SAVED = 3;

function OfferCheckPage() {
  const search = Route.useSearch();
  const start = useMemo(() => fromSearch(search), [search]);
  const [inputs, setInputs] = useState<Inputs>(start.inputs);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [nextId, setNextId] = useState(1);
  const set =
    <K extends keyof Inputs>(k: K) =>
    (v: Inputs[K]) =>
      setInputs((p) => ({ ...p, [k]: v }));

  const result = useMemo(() => compute(inputs), [inputs]);
  const freq = FREQUENCIES.find((f) => f.value === inputs.frequency) ?? FREQUENCIES[0]!;

  // Campaign attribution rides through to the application.
  const utm = {
    utm_source: str(search["utm_source"]) ?? "offer-check",
    ...(search["utm_medium"] ? { utm_medium: String(search["utm_medium"]) } : {}),
    ...(search["utm_campaign"] ? { utm_campaign: String(search["utm_campaign"]) } : {}),
  };

  const save = () => {
    if (!result || saved.length >= MAX_SAVED) return;
    setSaved((p) => [...p, { id: nextId, name: `Offer ${nextId}`, inputs, result }]);
    setNextId((n) => n + 1);
  };

  return (
    <PageShell tone="night">
      <section className="lamp-light text-paper">
        <div className="mx-auto max-w-6xl px-5 pb-14 pt-14 sm:px-6 sm:pt-20">
          <Eyebrow dark>Offer Check · free · nothing saved</Eyebrow>
          <h1 className="mt-5 max-w-3xl font-display text-4xl font-bold tracking-tight sm:text-6xl">
            Already have an offer? See what it really costs.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-mist">
            Type in the numbers from the offer you got. You'll see the cost in dollars, the cost per
            month, how much leaves your account each week, and you can line up to three offers side
            by side. Nothing is saved and nobody calls you.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-14 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:items-start">
        <form className={cn(card, "space-y-7 p-6 sm:p-8")} onSubmit={(e) => e.preventDefault()}>
          <p className="rounded-xl bg-sand px-4 py-3 text-sm text-smoke ring-1 ring-line">
            {start.prefilled
              ? "These are the numbers from your link. Change anything that's different on your offer."
              : "The numbers below are an example. Replace them with your offer."}
          </p>

          <MoneyField
            id="oc-amount"
            label="Amount on the offer"
            value={inputs.amount}
            onChange={set("amount")}
          />

          <div>
            <Toggle
              label="How is it priced?"
              value={inputs.pricing}
              onChange={set("pricing")}
              options={[
                ["factor", "Factor rate"],
                ["payback", "Total payback"],
              ]}
            />
            <div className="mt-3">
              {inputs.pricing === "factor" ? (
                <TextField
                  id="oc-factor"
                  label="Factor rate"
                  hint="Usually a number like 1.25 or 1.40. Multiply it by the amount to get the total payback."
                  value={inputs.factor}
                  onChange={set("factor")}
                  inputMode="decimal"
                />
              ) : (
                <MoneyField
                  id="oc-payback"
                  label="Total you pay back"
                  value={inputs.payback}
                  onChange={set("payback")}
                />
              )}
            </div>
          </div>

          <MoneyField
            id="oc-fees"
            label="Fees taken out up front (optional)"
            hint="Origination, underwriting or other fees subtracted before you get the money."
            value={inputs.fees}
            onChange={set("fees")}
            placeholder="0"
          />

          <Toggle
            label="How often do you pay?"
            value={inputs.frequency}
            onChange={set("frequency")}
            options={FREQUENCIES.map((f) => [f.value, f.label] as [Frequency, string])}
          />

          <div>
            <Toggle
              label="What does the offer tell you?"
              value={inputs.length}
              onChange={set("length")}
              options={[
                ["term", "The term"],
                ["payment", "The payment amount"],
              ]}
            />
            <div className="mt-3">
              {inputs.length === "term" ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <TextField
                    id="oc-term"
                    label="Term"
                    hint="Offers write it as months, weeks or days. Pick whichever yours says."
                    value={inputs.term}
                    onChange={set("term")}
                    inputMode="numeric"
                  />
                  <Toggle
                    label="In"
                    value={inputs.unit}
                    onChange={set("unit")}
                    options={[
                      ["months", "Months"],
                      ["weeks", "Weeks"],
                      ["days", "Days"],
                    ]}
                  />
                </div>
              ) : (
                <MoneyField
                  id="oc-payment"
                  label={`${freq.short} payment`}
                  value={inputs.payment}
                  onChange={set("payment")}
                />
              )}
            </div>
          </div>

          <MoneyField
            id="oc-deposits"
            label="Your average monthly deposits (optional)"
            hint="Total that comes into your business account in a normal month."
            value={inputs.deposits}
            onChange={set("deposits")}
            placeholder="e.g. 60,000"
          />

          <div>
            <Toggle
              label="Are you already paying back another advance?"
              value={inputs.hasExisting ? "yes" : "no"}
              onChange={(v) => set("hasExisting")(v === "yes")}
              options={[
                ["no", "No"],
                ["yes", "Yes"],
              ]}
            />
            {inputs.hasExisting && (
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <MoneyField
                  id="oc-existing"
                  label="What it takes per payment"
                  value={inputs.existing}
                  onChange={set("existing")}
                />
                <Toggle
                  label="Paid"
                  value={inputs.existingFreq}
                  onChange={set("existingFreq")}
                  options={FREQUENCIES.map((f) => [f.value, f.short] as [Frequency, string])}
                />
              </div>
            )}
          </div>
        </form>

        <div className="lg:sticky lg:top-24">
          <Results
            result={result}
            freqLabel={freq.per}
            hasDeposits={num(inputs.deposits) > 0}
            amount={num(inputs.amount)}
            utm={utm}
            canSave={saved.length < MAX_SAVED}
            onSave={save}
            shareUrl={`${SITE.url}/offer-check?${new URLSearchParams(toSearch(inputs)).toString()}`}
          />
        </div>
      </section>

      {saved.length > 0 && (
        <Compare
          saved={saved}
          onRemove={(id) => setSaved((p) => p.filter((s) => s.id !== id))}
          onLoad={(s) => {
            setInputs(s.inputs);
            if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onRename={(id, name) => setSaved((p) => p.map((s) => (s.id === id ? { ...s, name } : s)))}
          utm={utm}
        />
      )}
    </PageShell>
  );
}

function Results({
  result,
  freqLabel,
  hasDeposits,
  amount,
  utm,
  canSave,
  onSave,
  shareUrl,
}: {
  result: OfferResult | null;
  freqLabel: string;
  hasDeposits: boolean;
  amount: number;
  utm: Record<string, string>;
  canSave: boolean;
  onSave: () => void;
  shareUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", shareUrl);
    }
  };

  if (!result) {
    return (
      <div className="rounded-2xl bg-ink p-6 text-paper sm:p-8" role="status">
        <p className="font-display text-xl font-bold">Fill in the offer to see the numbers.</p>
        <p className="mt-2 text-mist">
          You need the amount, the factor rate or total payback, and either the term or the payment
          amount. They're all on the offer.
        </p>
      </div>
    );
  }

  const notes: { tone: "warn" | "info"; text: string }[] = [];
  if (result.feeShare > FEE_SHARE_CAUTION)
    notes.push({
      tone: "warn",
      text: `Fees take ${usd(amount - result.received)} off the top, so you actually receive ${usd(result.received)}. Ask whether they can be lowered or dropped.`,
    });
  if (result.combinedShare !== null)
    notes.push({
      tone: result.combinedShare >= DEPOSIT_SHARE_HEAVY ? "warn" : "info",
      text: `With what you're already paying, about ${pct(result.combinedShare)} of your deposits would go to advances. Stacking a second advance on top of a first is how a lot of owners get squeezed. Ask whether this offer pays off the one you have.`,
    });
  else if (result.depositShare !== null && result.depositShare >= DEPOSIT_SHARE_CAUTION)
    notes.push({
      tone: result.depositShare >= DEPOSIT_SHARE_HEAVY ? "warn" : "info",
      text: `This payment would take about ${pct(result.depositShare)} of your monthly deposits. Ask how the payment changes if sales slow down.`,
    });
  if (result.weekly !== result.payment && result.months <= 6)
    notes.push({
      tone: "info",
      text: `Frequent payments over a short term add up fast: ${usd(result.weekly)} leaves your account every week.`,
    });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-ink p-6 text-paper sm:p-8" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-leaf">
          Your offer in dollars
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5">
          <Stat label="You receive" value={usd(result.received)} />
          <Stat label="You pay back" value={usd(result.payback)} />
          <Stat
            label="Cost of the money"
            value={usd(result.cost)}
            sub={`${usd(result.costPerDollar * 100)} for every $100`}
          />
          <Stat
            label="Cost per month"
            value={usd(result.costPerMonth)}
            sub={`${pct1(result.pctCostPerMonth)} of what you receive, per month`}
          />
          <Stat
            label={freqLabel}
            value={usd(result.payment)}
            sub={`${Math.round(result.payments)} payments, about ${months1(result.months)}`}
          />
          <Stat label="Out of your account each week" value={usd(result.weekly)} />
          {result.depositShare !== null && (
            <Stat label="Share of monthly deposits" value={pct(result.depositShare)} />
          )}
        </dl>

        {SHOW_YEARLY_RATE && result.apr !== null && (
          <div className="mt-6 rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
            <p className="text-sm text-mist">Estimated yearly rate</p>
            <p className="font-display text-4xl font-bold tabular-nums text-leaf">
              about {Math.round(result.apr * 100)}%
            </p>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              Advances are priced with a factor rate, not an interest rate. This estimate shows what
              the same money would cost if it were quoted like a loan, which makes offers easy to
              compare. New York requires funders to show an estimated rate like this on their
              offers.
            </p>
          </div>
        )}
        {!hasDeposits && (
          <p className="mt-5 text-sm text-mist">
            Add your monthly deposits to see how much of them this offer would take.
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-paper ring-1 ring-white/15 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Plus className="size-4" aria-hidden="true" />
            {canSave ? "Save to compare" : `Up to ${MAX_SAVED} offers`}
          </button>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-mist ring-1 ring-white/15 transition hover:text-paper"
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <LinkIcon className="size-4" aria-hidden="true" />
            )}
            {copied ? "Link copied" : "Copy a link to this offer"}
          </button>
        </div>
      </div>

      {notes.length > 0 && (
        <ul className={cn(card, "space-y-3 p-5")}>
          {notes.map((n) => (
            <li key={n.text} className="flex gap-3 leading-relaxed">
              {n.tone === "warn" ? (
                <AlertTriangle className="mt-1 size-5 shrink-0 text-forest" aria-hidden="true" />
              ) : (
                <Info className="mt-1 size-5 shrink-0 text-sky" aria-hidden="true" />
              )}
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className={cn(card, "p-6")}>
        <h2 className="font-display text-xl font-bold">Want us to try to beat it?</h2>
        <p className="mt-2 text-smoke">
          Answer a few questions and upload your statements. We'll take your file to our funders and
          show you what they'll do, side by side with this offer. If we can't beat it, we'll tell
          you.
        </p>
        <Link
          to="/apply"
          search={{ amount: amountBand(amount), ...utm }}
          className={cn(btnPrimary, "mt-5")}
        >
          Get a second offer <ArrowRight className="size-4" />
        </Link>
      </div>
      <p className="px-1 text-sm leading-relaxed text-smoke">
        Estimates for comparison only, based on what you entered. Your actual costs are in your
        offer's contract and the funder's disclosures.
      </p>
    </div>
  );
}

function Compare({
  saved,
  onRemove,
  onLoad,
  onRename,
  utm,
}: {
  saved: Saved[];
  onRemove: (id: number) => void;
  onLoad: (s: Saved) => void;
  onRename: (id: number, name: string) => void;
  utm: Record<string, string>;
}) {
  const tags = compareTags(saved.map((s) => s.result));
  const best = (pick: (r: OfferResult) => number, lower: boolean) => {
    if (saved.length < 2) return -1;
    let idx = 0;
    saved.forEach((s, i) => {
      const a = pick(s.result);
      const b = pick(saved[idx]!.result);
      if (lower ? a < b : a > b) idx = i;
    });
    return idx;
  };
  const rows: { label: string; cell: (r: OfferResult, s: Saved) => string; best: number }[] = [
    { label: "You receive", cell: (r) => usd(r.received), best: best((r) => r.received, false) },
    { label: "You pay back", cell: (r) => usd(r.payback), best: best((r) => r.payback, true) },
    { label: "Cost of the money", cell: (r) => usd(r.cost), best: best((r) => r.cost, true) },
    {
      label: "Cost per month",
      cell: (r) => `${usd(r.costPerMonth)} · ${pct1(r.pctCostPerMonth)}`,
      best: best((r) => r.costPerMonth, true),
    },
    {
      label: "Each payment",
      cell: (r, s) =>
        `${usd(r.payment)} ${FREQUENCIES.find((f) => f.value === s.inputs.frequency)?.short.toLowerCase() ?? ""}`,
      best: -1,
    },
    {
      label: "Out of your account each week",
      cell: (r) => usd(r.weekly),
      best: best((r) => r.weekly, true),
    },
    {
      label: "Term",
      cell: (r) => `${months1(r.months)} · ${Math.round(r.payments)} payments`,
      best: best((r) => r.months, false),
    },
    ...(SHOW_YEARLY_RATE
      ? [
          {
            label: "Estimated yearly rate",
            cell: (r: OfferResult) => (r.apr === null ? "—" : `about ${Math.round(r.apr * 100)}%`),
            best: best((r) => r.apr ?? Infinity, true),
          },
        ]
      : []),
    ...(saved.some((s) => s.result.depositShare !== null)
      ? [
          {
            label: "Share of monthly deposits",
            cell: (r: OfferResult) => (r.depositShare === null ? "—" : pct(r.depositShare)),
            best: best((r) => r.depositShare ?? Infinity, true),
          },
        ]
      : []),
  ];
  const lowestCost = saved.reduce((a, b) => (b.result.cost < a.result.cost ? b : a), saved[0]!);

  return (
    <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-6" aria-labelledby="compare-h">
      <div className={cn(card, "overflow-hidden")}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-6 py-5 sm:px-8">
          <div>
            <Eyebrow>Side by side</Eyebrow>
            <h2 id="compare-h" className="mt-2 font-display text-2xl font-bold tracking-tight">
              {saved.length === 1
                ? "One offer saved. Add another to compare."
                : `${saved.length} offers, lined up.`}
            </h2>
          </div>
          {saved.length > 1 && (
            <p className="max-w-md text-sm text-smoke">
              Best in each row is marked in green. The cheapest offer is not always the right one if
              its weekly payment is too heavy for your deposits.
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[0.95rem]">
            <thead>
              <tr className="align-top">
                <th
                  scope="col"
                  className="w-48 px-6 py-4 text-left text-sm font-medium text-smoke sm:px-8"
                >
                  Offer
                </th>
                {saved.map((s, i) => (
                  <th key={s.id} scope="col" className="px-4 py-4 text-left">
                    <input
                      id={`oc-name-${s.id}`}
                      aria-label="Offer name"
                      value={s.name}
                      onChange={(e) => onRename(s.id, e.target.value)}
                      className="w-full max-w-[12rem] rounded-lg bg-transparent px-2 py-1 font-display text-lg font-bold text-ink ring-1 ring-transparent hover:ring-line focus:outline-none focus:ring-2 focus:ring-sky"
                    />
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {tags[i]?.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-leaf/15 px-2 py-0.5 text-xs font-semibold text-forest"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-3 text-sm">
                      <button
                        type="button"
                        onClick={() => onLoad(s)}
                        className="font-semibold text-forest underline-offset-4 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(s.id)}
                        className="inline-flex items-center gap-1 text-smoke hover:text-ink"
                      >
                        <X className="size-3.5" aria-hidden="true" /> Remove
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-line">
                  <th
                    scope="row"
                    className="px-6 py-3.5 text-left text-sm font-medium text-smoke sm:px-8"
                  >
                    {row.label}
                  </th>
                  {saved.map((s, i) => (
                    <td
                      key={s.id}
                      className={cn(
                        "px-4 py-3.5 tabular-nums",
                        row.best === i && saved.length > 1 && "font-semibold text-forest",
                      )}
                    >
                      {row.cell(s.result, s)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line bg-sand/60 px-6 py-5 sm:px-8">
          <p className="max-w-xl text-smoke">
            {saved.length > 1
              ? `Your lowest-cost offer is ${lowestCost.name}. Want to see if our funders can beat it?`
              : "Want to see if our funders can beat this offer?"}
          </p>
          <Link
            to="/apply"
            search={{ amount: amountBand(lowestCost.result.received), ...utm }}
            className={cn(btnOutline)}
          >
            Get a second offer <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-mist">{label}</dt>
      <dd className="font-display text-2xl font-bold tabular-nums">{value}</dd>
      {sub && <dd className="text-sm text-mist">{sub}</dd>}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl bg-white px-4 py-3.5 text-base text-ink ring-1 ring-line placeholder:text-smoke/60 focus:outline-none focus:ring-2 focus:ring-sky";

function FieldShell({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-sm text-smoke">{hint}</p>}
    </div>
  );
}

function MoneyField(props: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <FieldShell id={props.id} label={props.label} {...(props.hint ? { hint: props.hint } : {})}>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-smoke">
          $
        </span>
        <input
          id={props.id}
          inputMode="decimal"
          autoComplete="off"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          className={cn(inputCls, "pl-8 tabular-nums")}
        />
      </div>
    </FieldShell>
  );
}

function TextField(props: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  inputMode: "decimal" | "numeric";
}) {
  return (
    <FieldShell id={props.id} label={props.label} {...(props.hint ? { hint: props.hint } : {})}>
      <input
        id={props.id}
        inputMode={props.inputMode}
        autoComplete="off"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={cn(inputCls, "tabular-nums")}
      />
    </FieldShell>
  );
}

function Toggle<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-medium">{label}</legend>
      <div className="inline-flex flex-wrap gap-1 rounded-xl bg-sand p-1 ring-1 ring-line">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "rounded-lg px-3.5 py-2 text-[0.95rem] font-semibold transition",
              value === v
                ? "bg-white text-ink shadow-sm ring-1 ring-line"
                : "text-smoke hover:text-ink",
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
