import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { seo } from "@/lib/site";
import {
  checkOffer,
  DEPOSIT_SHARE_CAUTION,
  DEPOSIT_SHARE_HEAVY,
  FEE_SHARE_CAUTION,
  paymentsFor,
  pct,
  usd,
  type Frequency,
} from "@/lib/offer-check";
import { btnPrimary, card, Eyebrow, PageShell } from "@/components/site/layout";

export const Route = createFileRoute("/offer-check")({
  head: () =>
    seo({
      path: "/offer-check",
      title: "Offer Check: what your funding offer really costs — Lamp",
      description:
        "Already have a funding offer? Enter the amount, payback and term to see the real cost in dollars, an estimated yearly rate, and how much it takes out of your deposits each week.",
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

const num = (s: string) => {
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function OfferCheckPage() {
  // Opens on a worked example so the page shows what it does; the owner types over it.
  const [amount, setAmount] = useState("50,000");
  const [pricing, setPricing] = useState<"factor" | "payback">("factor");
  const [factor, setFactor] = useState("1.35");
  const [payback, setPayback] = useState("67,500");
  const [fees, setFees] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [length, setLength] = useState<"months" | "payment">("months");
  const [months, setMonths] = useState("9");
  const [payment, setPayment] = useState("");
  const [deposits, setDeposits] = useState("");
  const [hasExisting, setHasExisting] = useState(false);
  const [existing, setExisting] = useState("");
  const [existingFreq, setExistingFreq] = useState<Frequency>("daily");

  const totalPayback = pricing === "factor" ? num(amount) * num(factor) : num(payback);
  const nPayments =
    length === "months"
      ? paymentsFor(num(months), frequency)
      : num(payment) > 0
        ? Math.max(1, Math.round(totalPayback / num(payment)))
        : 0;

  const result = useMemo(
    () =>
      checkOffer({
        amount: num(amount),
        payback: totalPayback,
        fees: num(fees),
        frequency,
        payments: nPayments,
        ...(length === "payment" && num(payment) > 0 ? { payment: num(payment) } : {}),
        ...(num(deposits) > 0 ? { monthlyDeposits: num(deposits) } : {}),
        ...(hasExisting && num(existing) > 0
          ? { existingWeekly: existingFreq === "daily" ? num(existing) * 5 : num(existing) }
          : {}),
      }),
    [
      amount,
      totalPayback,
      fees,
      frequency,
      nPayments,
      length,
      payment,
      deposits,
      hasExisting,
      existing,
      existingFreq,
    ],
  );

  return (
    <PageShell>
      <section className="lamp-light text-paper">
        <div className="mx-auto max-w-6xl px-5 pb-14 pt-14 sm:px-6 sm:pt-20">
          <Eyebrow dark>Offer Check · free</Eyebrow>
          <h1 className="mt-5 max-w-3xl font-display text-4xl font-bold tracking-tight sm:text-6xl">
            Already have an offer? See what it really costs.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-mist">
            Type in the numbers from the offer you got. You'll see the cost in dollars, an estimated
            yearly rate, and how much it takes out of your deposits each week. Nothing is saved and
            nobody calls you.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-14 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:items-start">
        <form className={cn(card, "space-y-7 p-6 sm:p-8")} onSubmit={(e) => e.preventDefault()}>
          <p className="rounded-xl bg-sand px-4 py-3 text-sm text-smoke ring-1 ring-line">
            The numbers below are an example. Replace them with your offer.
          </p>

          <MoneyField
            id="oc-amount"
            label="Amount on the offer"
            value={amount}
            onChange={setAmount}
          />

          <div>
            <Toggle
              label="How is it priced?"
              value={pricing}
              onChange={setPricing}
              options={[
                ["factor", "Factor rate"],
                ["payback", "Total payback"],
              ]}
            />
            <div className="mt-3">
              {pricing === "factor" ? (
                <TextField
                  id="oc-factor"
                  label="Factor rate"
                  hint="Usually a number like 1.25 or 1.40."
                  value={factor}
                  onChange={setFactor}
                  inputMode="decimal"
                />
              ) : (
                <MoneyField
                  id="oc-payback"
                  label="Total you pay back"
                  value={payback}
                  onChange={setPayback}
                />
              )}
            </div>
          </div>

          <MoneyField
            id="oc-fees"
            label="Fees taken out up front (optional)"
            hint="Origination, underwriting or other fees subtracted before you get the money."
            value={fees}
            onChange={setFees}
            placeholder="0"
          />

          <Toggle
            label="How often do you pay?"
            value={frequency}
            onChange={setFrequency}
            options={[
              ["daily", "Every business day"],
              ["weekly", "Every week"],
            ]}
          />

          <div>
            <Toggle
              label="What does the offer tell you?"
              value={length}
              onChange={setLength}
              options={[
                ["months", "The term"],
                ["payment", "The payment amount"],
              ]}
            />
            <div className="mt-3">
              {length === "months" ? (
                <TextField
                  id="oc-months"
                  label="Term in months"
                  value={months}
                  onChange={setMonths}
                  inputMode="numeric"
                />
              ) : (
                <MoneyField
                  id="oc-payment"
                  label={frequency === "daily" ? "Daily payment" : "Weekly payment"}
                  value={payment}
                  onChange={setPayment}
                />
              )}
            </div>
          </div>

          <MoneyField
            id="oc-deposits"
            label="Your average monthly deposits (optional)"
            hint="Total that comes into your business account in a normal month."
            value={deposits}
            onChange={setDeposits}
            placeholder="e.g. 60,000"
          />

          <div>
            <Toggle
              label="Are you already paying back another advance?"
              value={hasExisting ? "yes" : "no"}
              onChange={(v) => setHasExisting(v === "yes")}
              options={[
                ["no", "No"],
                ["yes", "Yes"],
              ]}
            />
            {hasExisting && (
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <MoneyField
                  id="oc-existing"
                  label="What it takes per payment"
                  value={existing}
                  onChange={setExisting}
                />
                <Toggle
                  label="Paid"
                  value={existingFreq}
                  onChange={setExistingFreq}
                  options={[
                    ["daily", "Daily"],
                    ["weekly", "Weekly"],
                  ]}
                />
              </div>
            )}
          </div>
        </form>

        <div className="lg:sticky lg:top-24">
          <Results
            result={result}
            frequency={frequency}
            hasDeposits={num(deposits) > 0}
            amount={num(amount)}
          />
        </div>
      </section>
    </PageShell>
  );
}

function Results({
  result,
  frequency,
  hasDeposits,
  amount,
}: {
  result: ReturnType<typeof checkOffer>;
  frequency: Frequency;
  hasDeposits: boolean;
  amount: number;
}) {
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
  if (frequency === "daily" && result.months <= 6)
    notes.push({
      tone: "info",
      text: `Daily payments over a short term add up fast: ${usd(result.weekly)} leaves your account every week.`,
    });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-ink p-6 text-paper sm:p-8" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber">
          Your offer in dollars
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5">
          <Stat label="You receive" value={usd(result.received)} />
          <Stat label="You pay back" value={usd(result.received + result.cost)} />
          <Stat
            label="Cost of the money"
            value={usd(result.cost)}
            sub={`${usd(result.costPerDollar * 100)} for every $100`}
          />
          <Stat
            label={frequency === "daily" ? "Each business day" : "Each week"}
            value={usd(result.payment)}
            sub={`${Math.round(result.payments)} payments, about ${Math.round(result.months * 10) / 10} months`}
          />
          <Stat label="Out of your account each week" value={usd(result.weekly)} />
          {result.depositShare !== null && (
            <Stat label="Share of monthly deposits" value={pct(result.depositShare)} />
          )}
        </dl>

        {result.apr !== null && (
          <div className="mt-6 rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
            <p className="text-sm text-mist">Estimated yearly rate</p>
            <p className="font-display text-4xl font-bold tabular-nums text-amber">
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
      </div>

      {notes.length > 0 && (
        <ul className={cn(card, "space-y-3 p-5")}>
          {notes.map((n) => (
            <li key={n.text} className="flex gap-3 leading-relaxed">
              {n.tone === "warn" ? (
                <AlertTriangle
                  className="mt-1 size-5 shrink-0 text-amber-deep"
                  aria-hidden="true"
                />
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
          search={{ amount: amountBand(amount), utm_source: "offer-check" }}
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
