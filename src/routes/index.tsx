import { useState, type CSSProperties, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Banknote,
  BadgeCheck,
  Clock,
  Landmark,
  Receipt,
  Repeat,
  ShieldCheck,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { AMOUNT_OPTIONS } from "@/lib/apply";
import { cn } from "@/lib/utils";
import { SITE, seo } from "@/lib/site";
import { btnGhost, btnPrimary, PageShell } from "@/components/site/layout";
import { FAQS, FaqList } from "@/components/site/faq";
import { LampOrb } from "@/components/site/lamp-orb";
import { useLamplightGlass } from "@/components/site/lamp-lens";

export const Route = createFileRoute("/")({
  head: () =>
    seo({
      path: "/",
      title: "Lamp — Working capital, made clear.",
      description:
        "Lamp is a small-business working capital brokerage in NJ and NYC. Answer a few questions, see what you qualify for, and compare offers side by side in plain terms.",
    }),
  component: Index,
});

function Index() {
  useLamplightGlass();
  return (
    <PageShell tone="night">
      <Hero />
      <Ticker />
      <HowItWorks />
      <FundingOptions />
      <OfferExplainer />
      <WhoItsFor />
      <FaqPreview />
      <ForFunders />
      <FinalCta />
    </PageShell>
  );
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// About 21 business days and 52/12 weeks in a month.
const paymentsIn = (months: number, freq: "daily" | "weekly") =>
  freq === "daily" ? Math.round(months * 21) : Math.round((months * 52) / 12);

/** Small uppercase label in the mono face, with the lamp's dot. */
function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 font-mono text-[0.7rem] font-medium uppercase tracking-[0.14em] text-dim",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-leaf shadow-[0_0_10px_2px_oklch(0.615_0.117_150/0.55)]" />
      {children}
    </span>
  );
}

function SectionHead({
  kicker,
  title,
  accent,
  body,
}: {
  kicker: string;
  title: string;
  accent: string;
  body?: string;
}) {
  return (
    <div className="max-w-2xl">
      <Kicker>{kicker}</Kicker>
      <h2 className="mt-4 font-display text-[2rem] font-bold leading-[1.04] tracking-[-0.03em] sm:text-5xl">
        {title}{" "}
        <em className="font-serif font-normal italic tracking-[-0.02em] text-leaf-hi">{accent}</em>
      </h2>
      {body && <p className="mt-5 text-lg leading-relaxed text-mist">{body}</p>}
    </div>
  );
}

const glass = "ll-glass rounded-[1.4rem]";
const glassSm = "ll-glass rounded-xl";
const mono = "font-mono text-[0.68rem] font-medium uppercase tracking-[0.13em] text-dim";

/* ---------------------------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="pb-20 pt-10 sm:pt-16 lg:pb-28 lg:pt-20">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 sm:px-6 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16">
        <div className="ll-shade relative min-w-0">
          <Kicker className="rise">Working capital for real businesses · NJ &amp; NYC</Kicker>
          <h1 className="rise mt-6 font-display text-[3rem] font-bold leading-[0.96] tracking-[-0.045em] [animation-delay:60ms] sm:text-7xl lg:text-[5.6rem]">
            Working capital,
            <em className="block pb-[0.06em] font-serif text-[1.04em] font-normal italic tracking-[-0.03em] text-leaf-hi">
              made clear.
            </em>
          </h1>
          <p className="rise mt-6 max-w-xl text-lg leading-relaxed text-mist [animation-delay:120ms] sm:text-xl">
            Answer a few quick questions and see what your business could qualify for. We shop your
            file to our funder network and lay the offers out side by side, in dollars, readable on
            your phone between jobs.
          </p>

          <div className={cn(glass, "rise mt-8 max-w-xl p-5 [animation-delay:180ms] sm:p-6")}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-display text-base font-semibold">How much do you need?</p>
              <span className={cn(mono, "shrink-0 whitespace-nowrap")}>About a minute</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AMOUNT_OPTIONS.map((o) => (
                <Link
                  key={o.id}
                  to="/apply"
                  search={{ amount: o.id }}
                  className="grid min-h-12 place-items-center rounded-xl bg-white/5 px-2 text-center text-[0.95rem] font-semibold ring-1 ring-white/10 transition hover:-translate-y-px hover:bg-leaf/15 hover:ring-leaf/70"
                >
                  {o.label}
                </Link>
              ))}
              <Link
                to="/apply"
                className="grid min-h-12 place-items-center rounded-xl bg-leaf px-2 text-center text-[0.95rem] font-semibold text-ink transition hover:brightness-110"
              >
                Not sure yet
              </Link>
            </div>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-mist">
              <li className="flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-leaf" /> Doesn't affect your credit
              </li>
              <li className="flex items-center gap-1.5">
                <BadgeCheck className="size-4 text-leaf" /> No cost to check
              </li>
              <li className="flex items-center gap-1.5">
                <Clock className="size-4 text-leaf" /> About a minute
              </li>
            </ul>
          </div>
        </div>

        <div className="rise relative min-w-0 [animation-delay:220ms]">
          <ProofCard className="-left-16 -top-12" depth={22} label="Cost to check" value="$0" dot />
          <ProofCard
            className="-top-[4.75rem] right-6"
            depth={-28}
            label="Credit pull to look"
            value="None"
          />
          <ProofCard
            className="-bottom-14 -left-12"
            depth={30}
            label="Offers back"
            value="Same day, most files"
          />
          <ProofCard
            className="-bottom-14 right-5 2xl:bottom-[26%] 2xl:-right-28"
            depth={-16}
            label="Your call"
            value="Say no anytime"
          />
          <OfferSheet />
        </div>
      </div>
    </section>
  );
}

function ProofCard({
  className,
  depth,
  label,
  value,
  dot,
}: {
  className: string;
  depth: number;
  label: string;
  value: string;
  dot?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      style={{ "--d": depth } as CSSProperties}
      className={cn(
        "ll-glass ll-float absolute z-10 hidden min-w-[9.5rem] gap-0.5 rounded-2xl px-3.5 py-2.5 lg:grid",
        className,
      )}
    >
      <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.13em] text-dim">
        {label}
      </span>
      <span className="flex items-center gap-2 font-display text-[1.05rem] font-bold">
        {dot && (
          <span className="size-1.5 rounded-full bg-leaf shadow-[0_0_10px_2px_oklch(0.615_0.117_150/0.6)]" />
        )}
        {value}
      </span>
    </div>
  );
}

const SAMPLE_AMOUNT = 50_000;
const SAMPLE_OFFERS = [
  { name: "Funder A", factor: 1.28, months: 12, freq: "daily" },
  { name: "Funder B", factor: 1.22, months: 9, freq: "weekly" },
  { name: "Funder C", factor: 1.35, months: 18, freq: "weekly" },
] as const;

function OfferSheet() {
  const [picked, setPicked] = useState(1);
  const o = SAMPLE_OFFERS[picked] ?? SAMPLE_OFFERS[1];
  const payback = SAMPLE_AMOUNT * o.factor;
  const payment = payback / paymentsIn(o.months, o.freq);

  return (
    <div className={cn(glass, "p-5 sm:p-6")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-[1.05rem] font-bold">Your offers, side by side</p>
          <p className="text-sm text-dim">
            {usd(SAMPLE_AMOUNT)} requested · {SAMPLE_OFFERS.length} offers back
          </p>
        </div>
        <span className="rounded-full px-2.5 py-1.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-dim ring-1 ring-white/12">
          Example
        </span>
      </div>

      <div className="mt-5 grid gap-2" role="radiogroup" aria-label="Sample offers">
        {SAMPLE_OFFERS.map((x, i) => {
          const on = i === picked;
          return (
            <button
              key={x.name}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPicked(i)}
              className={cn(
                "grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl px-4 py-3 text-left ring-1 transition",
                on ? "bg-leaf/10 ring-2 ring-leaf" : "bg-white/5 ring-white/10 hover:ring-white/25",
              )}
            >
              <span>
                <span className="block font-display text-[0.95rem] font-semibold">{x.name}</span>
                <span className="block text-sm text-dim">
                  {x.months} months · {x.freq} payments
                </span>
              </span>
              <span className="text-right">
                <span className="block font-mono text-xl font-semibold tabular-nums tracking-tight">
                  {x.factor.toFixed(2)}
                </span>
                <span className="block font-mono text-[0.6rem] font-medium uppercase tracking-[0.14em] text-dim">
                  factor
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-xl bg-ink px-4 py-4 ring-1 ring-white/5">
        <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-leaf">
          What {o.name} means in dollars
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <dt className="text-xs text-dim">You get</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums tracking-tight">
              {usd(SAMPLE_AMOUNT)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-dim">You pay back</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums tracking-tight">
              {usd(payback)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-dim">Each {o.freq === "daily" ? "weekday" : "week"}</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums tracking-tight">
              {usd(payment)}
            </dd>
          </div>
        </dl>
      </div>
      <p className="mt-4 text-[0.8rem] leading-relaxed text-dim">
        Sample terms for illustration. Real offers depend on your business and the funder's review.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

const TICKER = [
  "Working capital",
  "Lines of credit",
  "Equipment financing",
  "Invoice factoring",
  "Short-term funding",
  "SBA",
  "No credit hit to check",
  "Offers side by side, in dollars",
  "Say no anytime",
  "New Jersey & New York City",
];

function Ticker() {
  return (
    <div aria-hidden="true" className="ll-ticker overflow-hidden border-y border-white/10 py-4">
      <div className="ll-ticker-row flex w-max gap-11 font-mono text-xs font-medium uppercase tracking-[0.14em] text-mist">
        {[...TICKER, ...TICKER].map((t, i) => (
          <span key={i} className="inline-flex items-center gap-11 whitespace-nowrap">
            {t}
            <span className="size-[5px] rounded-full bg-leaf" />
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-24 sm:px-6 sm:py-32">
      <SectionHead
        kicker="How it works"
        title="Three steps."
        accent="One clear view."
        body="No single product to push. Just your real options, side by side."
      />
      <ol className="mt-14 grid gap-4 md:grid-cols-3">
        <Step
          n="01"
          tag="About a minute"
          title="Answer a few questions"
          body="How much, what for, and a little about the business. Then create your account with Google or email to save your spot."
        >
          <p className="font-display text-[0.95rem] font-semibold">How much are you looking for?</p>
          <div className="my-3 h-1 overflow-hidden rounded bg-white/10">
            <div className="h-full w-[28%] rounded bg-leaf" />
          </div>
          <div className="flex flex-wrap gap-1.5 text-[0.8rem]">
            <span className="rounded-lg px-2.5 py-1.5 ring-1 ring-white/12">Under $25k</span>
            <span className="rounded-lg bg-leaf/12 px-2.5 py-1.5 ring-[1.5px] ring-leaf">
              $50k – $100k
            </span>
            <span className="rounded-lg px-2.5 py-1.5 ring-1 ring-white/12">$100k+</span>
          </div>
        </Step>
        <Step
          n="02"
          tag="Usually same day"
          title="We shop the file"
          body="Upload three months of bank statements. We take your file to our funder network and bring back what they'll actually do."
        >
          <ul className="grid gap-2.5 text-sm">
            <li className="flex justify-between gap-2">
              Bank statements, 3 months <span className={mono}>Received</span>
            </li>
            <li className="flex justify-between gap-2">
              Driver's license <span className={mono}>Received</span>
            </li>
            <li className="flex items-center justify-between gap-2">
              Your file
              <span className={cn(mono, "inline-flex items-center gap-1.5 text-leaf-hi")}>
                <span className="ll-pulse size-1.5 rounded-full bg-leaf" /> With funders
              </span>
            </li>
          </ul>
        </Step>
        <Step
          n="03"
          tag="Your call, always"
          title="You choose"
          body="Payment amount, length, and total cost, compared line by line in plain English. Say no and nothing happens."
        >
          <table className="w-full font-mono text-[0.78rem] tabular-nums">
            <thead>
              <tr className={mono}>
                <th className="pb-2 text-left font-medium">Offer</th>
                <th className="pb-2 text-right font-medium">Payback</th>
                <th className="pb-2 text-right font-medium">Weekly</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-white/10">
                <td className="py-1.5">Funder A</td>
                <td className="text-right">$64,000</td>
                <td className="text-right">—</td>
              </tr>
              <tr className="border-t border-white/10 text-leaf-hi">
                <td className="py-1.5">Funder B ✓</td>
                <td className="text-right">$61,000</td>
                <td className="text-right">$1,564</td>
              </tr>
              <tr className="border-t border-white/10">
                <td className="py-1.5">Funder C</td>
                <td className="text-right">$67,500</td>
                <td className="text-right">$865</td>
              </tr>
            </tbody>
          </table>
        </Step>
      </ol>
      <Link to="/how-it-works" className={cn(btnGhost, "mt-10")}>
        The full walkthrough <ArrowRight className="size-4" />
      </Link>
    </section>
  );
}

function Step({
  n,
  tag,
  title,
  body,
  children,
}: {
  n: string;
  tag: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <li className={cn(glass, "ll-lift flex min-w-0 flex-col gap-3.5 p-6")}>
      <div className={cn(mono, "flex justify-between")}>
        <span>{n}</span>
        <span>{tag}</span>
      </div>
      <h3 className="font-display text-[1.4rem] font-bold leading-tight tracking-[-0.02em]">
        {title}
      </h3>
      <p className="text-mist">{body}</p>
      <div aria-hidden="true" className="mt-auto rounded-xl bg-black/30 p-3.5 ring-1 ring-white/10">
        {children}
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------------------------------------- */

const OPTIONS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Wallet,
    title: "Working capital",
    body: "Funding sized to your sales, for payroll, bills, and slow seasons.",
  },
  {
    icon: Banknote,
    title: "Short-term loans",
    body: "A fixed amount paid back over months, with a set payment schedule.",
  },
  {
    icon: Repeat,
    title: "Lines of credit",
    body: "Draw what you need, when you need it, and only pay on what you use.",
  },
  {
    icon: Truck,
    title: "Equipment financing",
    body: "Trucks, ovens, lifts, chairs. The equipment itself helps secure it.",
  },
  {
    icon: Receipt,
    title: "Invoice factoring",
    body: "Turn unpaid invoices into cash now instead of waiting 30–90 days.",
  },
  {
    icon: Landmark,
    title: "SBA loans",
    body: "Longer terms and lower costs for established businesses that can wait.",
  },
];

// Six products around the orb: one application at the centre, every kind of funding around it.
const hubPoint = (k: number) => {
  const a = ((-90 + k * 60) * Math.PI) / 180;
  return { x: 50 + 41 * Math.cos(a), y: 50 + 41 * Math.sin(a) };
};

function FundingOptions() {
  const [active, setActive] = useState<number | null>(null);
  const shown = active === null ? null : OPTIONS[active];

  return (
    <section id="options" className="mx-auto max-w-6xl px-5 pb-24 sm:px-6 sm:pb-32">
      <div className="grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <SectionHead
            kicker="Funding options"
            title="One application."
            accent="Every kind of funding."
            body="You don't need to know which product fits. Tell us about the business and we'll show you what's realistic across all of these."
          />
          <Link to="/apply" className={cn(btnPrimary, "mt-8")}>
            Check my options <ArrowRight className="size-4" />
          </Link>
        </div>

        <div
          className={cn(
            "ll-hub relative ml-auto hidden aspect-square w-full max-w-[560px] lg:block",
            active !== null && "is-lit",
          )}
          onPointerLeave={() => setActive(null)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            <circle
              cx="50"
              cy="50"
              r="41"
              fill="none"
              className="stroke-white/25"
              strokeDasharray="2 6"
              vectorEffect="non-scaling-stroke"
            />
            {OPTIONS.map((o, k) => (
              <line
                key={o.title}
                x1="50"
                y1="50"
                x2={hubPoint(k).x}
                y2={hubPoint(k).y}
                vectorEffect="non-scaling-stroke"
                className={cn(k === active ? "ll-flow stroke-leaf" : "stroke-white/40")}
                strokeWidth={k === active ? 2 : 1.2}
              />
            ))}
          </svg>
          <div className="ll-glass absolute left-1/2 top-1/2 grid aspect-square w-[41%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full p-5 text-center">
            <div>
              <LampOrb className="mx-auto -mb-1 -mt-3 size-[6.5rem]" />
              <p className="mt-1.5 font-display text-[0.95rem] font-bold" aria-live="polite">
                {shown ? shown.title : "One application"}
              </p>
              <p className="mt-1.5 min-h-[3.6em] text-[0.8rem] leading-snug text-mist">
                {shown ? shown.body : "Six kinds of funding. Point at one to see what it's for."}
              </p>
            </div>
          </div>
          {OPTIONS.map(({ icon: Icon, title }, k) => (
            <button
              key={title}
              type="button"
              onPointerEnter={() => setActive(k)}
              onFocus={() => setActive(k)}
              onClick={() => setActive(k)}
              style={{ left: `${hubPoint(k).x}%`, top: `${hubPoint(k).y}%` }}
              className={cn(
                "ll-glass absolute w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-3 text-center",
                k === active && "ring-[1.5px] ring-leaf",
              )}
            >
              <span className="mx-auto mb-1.5 grid size-9 place-items-center rounded-[10px] bg-leaf/15 text-leaf-hi">
                <Icon className="size-[18px]" />
              </span>
              <span className="block font-display text-sm font-semibold">{title}</span>
            </button>
          ))}
        </div>

        <ul className="grid gap-2.5 sm:grid-cols-2 lg:hidden">
          {OPTIONS.map(({ icon: Icon, title, body }) => (
            <li key={title} className={cn(glassSm, "flex gap-3.5 p-4")}>
              <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-leaf/15 text-leaf-hi">
                <Icon className="size-5" />
              </span>
              <div>
                <h3 className="font-display font-semibold">{title}</h3>
                <p className="mt-0.5 text-sm leading-relaxed text-mist">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function OfferExplainer() {
  const [amount, setAmount] = useState(50_000);
  const [factor, setFactor] = useState(1.25);
  const [months, setMonths] = useState(9);
  const [freq, setFreq] = useState<"daily" | "weekly">("weekly");
  const payback = amount * factor;
  const each = payback / paymentsIn(months, freq);
  const share = 1 / factor;
  const ring = 2 * Math.PI * 42;

  return (
    <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-6 sm:pb-32">
      <SectionHead
        kicker="Read any offer in a minute"
        title="Factor rates,"
        accent="in plain dollars."
        body="Many offers are priced with a factor rate, not an interest rate. Multiply it by the amount and you get the total you'll pay back. We show you these same numbers on every real offer."
      />
      <div className="mt-12 grid gap-4 lg:grid-cols-2">
        <div className={cn(glass, "p-6 sm:p-7")}>
          <Range
            id="calc-amount"
            label="Amount"
            value={usd(amount)}
            min={10_000}
            max={250_000}
            step={5_000}
            current={amount}
            onChange={setAmount}
            ends={["$10k", "$250k"]}
          />
          <Range
            id="calc-factor"
            label="Factor rate"
            value={factor.toFixed(2)}
            min={1.1}
            max={1.5}
            step={0.01}
            current={factor}
            onChange={setFactor}
            ends={["1.10", "1.50"]}
          />
          <Range
            id="calc-term"
            label="Term"
            value={`${months} months`}
            min={3}
            max={24}
            step={1}
            current={months}
            onChange={setMonths}
            ends={["3 mo", "24 mo"]}
          />
          <div
            className="mt-5 inline-flex rounded-full bg-white/5 p-1 ring-1 ring-white/10"
            role="group"
            aria-label="Payment frequency"
          >
            {(["daily", "weekly"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={freq === f}
                onClick={() => setFreq(f)}
                className={cn(
                  "rounded-full px-4 py-2 font-display text-sm font-semibold capitalize transition",
                  freq === f ? "bg-leaf text-ink" : "text-mist hover:text-paper",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className={cn(glass, "p-6 sm:p-7")}>
          <div className="grid items-center gap-7 sm:grid-cols-[auto_1fr]">
            <div className="relative mx-auto size-40" aria-hidden="true">
              <svg viewBox="0 0 100 100" className="size-full -rotate-90">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  strokeWidth="14"
                  className="stroke-white/25"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  strokeWidth="14"
                  strokeLinecap="round"
                  className="stroke-leaf transition-[stroke-dasharray] duration-500"
                  strokeDasharray={`${(ring * share).toFixed(1)} ${ring.toFixed(1)}`}
                />
              </svg>
              <div className="absolute inset-0 grid place-content-center text-center">
                <span className="font-mono text-2xl font-semibold tracking-tight">
                  {Math.round(share * 100)}%
                </span>
                <span className="mt-1 font-mono text-[0.58rem] uppercase leading-tight tracking-[0.12em] text-dim">
                  of payback
                  <br />
                  is your money
                </span>
              </div>
            </div>
            <dl>
              <Stat label="You receive" value={usd(amount)} />
              <Stat label="Total payback" value={usd(payback)} accent />
              <Stat label="Cost of the money" value={usd(payback - amount)} />
              <Stat
                label={freq === "daily" ? "About per weekday" : "About per week"}
                value={usd(each)}
              />
            </dl>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-dim">
            Illustration only. Real offers vary by funder and may include fees, which we'll always
            show you in writing.
          </p>
          <Link
            to="/offer-check"
            className="mt-3 inline-flex items-center gap-1.5 font-semibold text-leaf-hi underline-offset-4 hover:underline"
          >
            Already have an offer? Check what it really costs <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Range(props: {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (n: number) => void;
  ends: [string, string];
}) {
  const pct = ((props.current - props.min) / (props.max - props.min)) * 100;
  return (
    <div className="mt-5 first:mt-0">
      <label htmlFor={props.id} className="flex items-baseline justify-between">
        <span className="text-mist">{props.label}</span>
        <span className="font-mono text-xl font-semibold tabular-nums tracking-tight">
          {props.value}
        </span>
      </label>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.current}
        onChange={(e) => props.onChange(Number(e.target.value))}
        style={{ "--p": `${pct}%` } as CSSProperties}
        className="ll-range mt-2"
      />
      <div className="flex justify-between font-mono text-[0.7rem] text-dim">
        <span>{props.ends[0]}</span>
        <span>{props.ends[1]}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-white/10 py-3 last:border-0",
        accent && "-mx-3 my-1 rounded-xl border-0 bg-ink px-3",
      )}
    >
      <dt className="text-mist">{label}</dt>
      <dd
        className={cn(
          "font-mono text-lg font-semibold tabular-nums tracking-tight",
          accent && "text-leaf-hi",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function WhoItsFor() {
  return (
    <section id="who-its-for" className="mx-auto max-w-6xl px-5 pb-24 sm:px-6 sm:pb-32">
      <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <SectionHead
            kicker="Who it's for"
            title="Built for the people who"
            accent="run the place."
            body="Owner-operators doing $20k to $500k a month across New Jersey and New York City. If you open the doors in the morning and do the books at night, this is for you."
          />
          <ul className="mt-7 flex flex-wrap gap-2">
            {[
              "Restaurants",
              "Trucking",
              "Contractors",
              "Retail",
              "Salons",
              "Auto shops",
              "Medical & dental",
            ].map((t) => (
              <li
                key={t}
                className="rounded-full bg-white/5 px-3.5 py-1.5 text-[0.95rem] text-mist ring-1 ring-white/12"
              >
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className={cn(glass, "p-6 sm:p-7")}>
          <h3 className="font-display text-xl font-bold tracking-[-0.02em]">What you'll need</h3>
          <ul className="mb-6 mt-5 grid gap-3">
            {[
              "Three months of business bank statements",
              "Six months or more in business",
              "A photo of your driver's license",
              "Your business name and EIN",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-mist">
                <BadgeCheck className="mt-0.5 size-5 shrink-0 text-leaf" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Link to="/apply" className={btnPrimary}>
            Start with a few questions <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function FaqPreview() {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-24 sm:px-6 sm:pb-32 lg:grid-cols-[0.8fr_1.2fr]">
      <div>
        <SectionHead
          kicker="FAQ"
          title="Straight"
          accent="answers."
          body="The questions owners ask us most. Don't see yours?"
        />
        <Link to="/faq" className={cn(btnGhost, "mt-7")}>
          All questions <ArrowRight className="size-4" />
        </Link>
      </div>
      <FaqList items={FAQS.slice(0, 5)} dark />
    </section>
  );
}

function ForFunders() {
  return (
    <section id="for-funders" className="mx-auto max-w-6xl px-5 sm:px-6">
      <div className={cn(glass, "flex flex-col gap-6 p-6 sm:p-9 md:flex-row md:items-center")}>
        <div className="flex-1">
          <h2 className="font-display text-2xl font-bold tracking-tight">For funders and ISOs</h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-mist">
            Lamp submits clean, complete files: statements, application, and a plain summary of the
            merchant. We tell the merchant what the terms are before they sign, so there are fewer
            surprises on your side too.
          </p>
          <p className="mt-3 text-sm text-mist">
            Partner desk:{" "}
            <a
              className="text-paper underline underline-offset-4"
              href={`mailto:${SITE.partnersEmail}`}
            >
              {SITE.partnersEmail}
            </a>
          </p>
        </div>
        <a
          className={btnGhost}
          href={`mailto:${SITE.partnersEmail}?subject=${encodeURIComponent("Partner inquiry")}`}
        >
          Reach the partner desk
        </a>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-5 py-28 text-center sm:px-6 sm:py-40">
      <LampOrb className="mx-auto size-16" />
      <h2 className="mx-auto mt-6 max-w-[14ch] font-display text-[2.4rem] font-bold leading-[1.02] tracking-[-0.035em] sm:text-6xl">
        See what your business{" "}
        <em className="font-serif font-normal italic tracking-[-0.02em] text-leaf-hi">
          qualifies for.
        </em>
      </h2>
      <p className="mx-auto mt-5 max-w-md text-lg text-mist">
        A few questions, about a minute, and no effect on your credit.
      </p>
      <Link to="/apply" className={cn(btnPrimary, "mt-9 px-8 py-4 text-base")}>
        Check my options <ArrowRight className="size-4" />
      </Link>
    </section>
  );
}
