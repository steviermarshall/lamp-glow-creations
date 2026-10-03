import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  FileText,
  Landmark,
  Receipt,
  ShieldCheck,
  Truck,
  Wallet,
} from "lucide-react";
import { AMOUNT_OPTIONS } from "@/lib/apply";
import { cn } from "@/lib/utils";
import { SITE, seo } from "@/lib/site";
import {
  btnGhost,
  btnOutline,
  btnPrimary,
  card,
  cardDark,
  Eyebrow,
  PageShell,
} from "@/components/site/layout";
import { FAQS, FaqList } from "@/components/site/faq";

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
  return (
    <PageShell>
      <Hero />
      <TrustStrip />
      <HowItWorks />
      <FundingOptions />
      <OfferExplainer />
      <WhoItsFor />
      <ForFunders />
      <FaqPreview />
      <FinalCta />
    </PageShell>
  );
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function Hero() {
  return (
    <section className="lamp-light text-paper">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-20">
        <div className="rise">
          <Eyebrow dark>Working capital brokerage · NJ &amp; NYC</Eyebrow>
          <h1 className="mt-6 font-display text-[2.8rem] font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-[4.4rem]">
            Working capital,
            <span className="block text-amber">made clear.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-mist">
            Answer a few quick questions and see what your business could qualify for. We shop your
            file to our funder network and lay the offers out side by side, in dollars, readable on
            your phone between jobs.
          </p>

          <div className={cn(cardDark, "mt-8 max-w-lg p-5 sm:p-6")}>
            <p className="font-display text-base font-semibold">How much do you need?</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AMOUNT_OPTIONS.map((o) => (
                <Link
                  key={o.id}
                  to="/apply"
                  search={{ amount: o.id }}
                  className="rounded-xl bg-white/5 px-3 py-3 text-center text-[0.95rem] font-semibold text-paper ring-1 ring-white/10 transition hover:bg-amber/15 hover:ring-amber/60"
                >
                  {o.label}
                </Link>
              ))}
              <Link
                to="/apply"
                className="rounded-xl bg-amber px-3 py-3 text-center text-[0.95rem] font-semibold text-ink transition hover:brightness-105"
              >
                Not sure yet
              </Link>
            </div>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-mist">
              <li className="flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-amber" /> Doesn't affect your credit
              </li>
              <li className="flex items-center gap-1.5">
                <BadgeCheck className="size-4 text-amber" /> No cost to check
              </li>
              <li className="flex items-center gap-1.5">
                <BadgeCheck className="size-4 text-amber" /> About a minute
              </li>
            </ul>
          </div>
        </div>

        <OfferSheet />
      </div>
    </section>
  );
}

const SAMPLE_AMOUNT = 50_000;
const SAMPLE_OFFERS = [
  { name: "Funder A", factor: 1.28, months: 12, freq: "daily" },
  { name: "Funder B", factor: 1.22, months: 9, freq: "weekly" },
  { name: "Funder C", factor: 1.35, months: 18, freq: "weekly" },
] as const;

// About 21 business days and 52/12 weeks in a month.
const paymentsIn = (months: number, freq: "daily" | "weekly") =>
  freq === "daily" ? Math.round(months * 21) : Math.round((months * 52) / 12);

function OfferSheet() {
  const [picked, setPicked] = useState(1);
  const o = SAMPLE_OFFERS[picked] ?? SAMPLE_OFFERS[1];
  const payback = SAMPLE_AMOUNT * o.factor;
  const payment = payback / paymentsIn(o.months, o.freq);

  return (
    <div className="rise [animation-delay:120ms]">
      <div className="rounded-[1.4rem] bg-paper p-5 text-ink shadow-[0_30px_80px_-30px_oklch(0.8_0.145_72/0.55)] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-display text-base font-bold">Your offers, side by side</p>
            <p className="text-sm text-smoke">
              {usd(SAMPLE_AMOUNT)} requested · {SAMPLE_OFFERS.length} offers back
            </p>
          </div>
          <span className="rounded-full bg-sand px-2.5 py-1 text-xs font-semibold text-smoke ring-1 ring-line">
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
                  on ? "bg-white ring-amber ring-2" : "bg-white/60 ring-line hover:ring-ink/25",
                )}
              >
                <span>
                  <span className="block text-[0.95rem] font-semibold">{x.name}</span>
                  <span className="block text-sm text-smoke">
                    {x.months} months · {x.freq} payments
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-display text-lg font-bold tabular-nums">
                    {x.factor.toFixed(2)}
                  </span>
                  <span className="block text-[0.7rem] font-semibold uppercase tracking-wider text-smoke">
                    factor
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl bg-ink px-4 py-4 text-paper">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber">
            What {o.name} means in dollars
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <dt className="text-xs text-mist">You get</dt>
              <dd className="font-display text-lg font-bold tabular-nums">{usd(SAMPLE_AMOUNT)}</dd>
            </div>
            <div>
              <dt className="text-xs text-mist">You pay back</dt>
              <dd className="font-display text-lg font-bold tabular-nums">{usd(payback)}</dd>
            </div>
            <div>
              <dt className="text-xs text-mist">Each {o.freq === "daily" ? "weekday" : "week"}</dt>
              <dd className="font-display text-lg font-bold tabular-nums">{usd(payment)}</dd>
            </div>
          </dl>
        </div>
        <p className="mt-4 text-[0.8rem] leading-relaxed text-smoke">
          Sample terms for illustration. Real offers depend on your business and the funder's
          review.
        </p>
      </div>
    </div>
  );
}

function TrustStrip() {
  const items = [
    { title: "A broker, on your side", body: "We compare funders for you." },
    { title: "No credit hit to check", body: "No SSN needed up front." },
    { title: "Offers usually same day", body: "For complete files." },
    { title: "Say no anytime", body: "No obligation, ever." },
  ];
  return (
    <section className="border-b border-line bg-sand">
      <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-5 px-5 py-8 sm:px-6 md:grid-cols-4">
        {items.map(({ title, body }) => (
          <li key={title} className="flex items-start gap-3">
            <BadgeCheck className="mt-0.5 size-5 shrink-0 text-amber-deep" />
            <span>
              <span className="block text-[0.95rem] font-semibold">{title}</span>
              <span className="block text-sm text-smoke">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mb-10 max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-lg leading-relaxed text-smoke">{body}</p>}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: "Answer a few questions",
      body: "How much, what for, and a little about the business. Then create your account with Google or email to save your spot.",
      tag: "About a minute",
    },
    {
      title: "We shop the file",
      body: "Upload three months of bank statements. We take your file to our funder network and bring back what they'll actually do.",
      tag: "Usually same day",
    },
    {
      title: "You choose",
      body: "Payment amount, length, and total cost, compared line by line in plain English. Say no and nothing happens.",
      tag: "Your call, always",
    },
  ];
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
      <SectionHead
        eyebrow="How it works"
        title="Three steps. One clear view."
        body="No single product to push. Just your real options, side by side."
      />
      <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
        {steps.map((s, i) => (
          <li key={s.title} className="border-t-2 border-ink pt-5">
            <span className="font-display text-sm font-bold tabular-nums text-amber-deep">
              Step {i + 1}
            </span>
            <h3 className="mt-2 font-display text-xl font-bold">{s.title}</h3>
            <p className="mt-2 leading-relaxed text-smoke">{s.body}</p>
            <p className="mt-3 text-sm font-semibold">{s.tag}</p>
          </li>
        ))}
      </ol>
      <Link to="/how-it-works" className={cn(btnOutline, "mt-10")}>
        The full walkthrough <ArrowRight className="size-4" />
      </Link>
    </section>
  );
}

function FundingOptions() {
  const options = [
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
      icon: Landmark,
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
      icon: FileText,
      title: "SBA loans",
      body: "Longer terms and lower costs for established businesses that can wait.",
    },
  ];
  return (
    <section id="options" className="border-y border-line bg-sand">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
        <SectionHead
          eyebrow="Funding options"
          title="One application. Every kind of funding."
          body="You don't need to know which product fits. Tell us about the business and we'll show you what's realistic across the options below."
        />
        <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {options.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white ring-1 ring-line">
                <Icon className="size-5 text-amber-deep" />
              </span>
              <div>
                <h3 className="font-display text-lg font-bold">{title}</h3>
                <p className="mt-1 leading-relaxed text-smoke">{body}</p>
              </div>
            </li>
          ))}
        </ul>
        <Link to="/apply" className={cn(btnPrimary, "mt-12")}>
          Check my options <ArrowRight className="size-4" />
        </Link>
      </div>
    </section>
  );
}

function OfferExplainer() {
  const [amount, setAmount] = useState(40_000);
  const [factor, setFactor] = useState(1.25);
  const [months, setMonths] = useState(12);
  const payback = Math.round(amount * factor);
  const weekly = Math.round(payback / ((months * 52) / 12));

  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
      <div className="grid gap-12 lg:grid-cols-2">
        <div>
          <Eyebrow>Read any offer in a minute</Eyebrow>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            See the real cost before you sign.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-smoke">
            Many offers are priced with a <strong className="text-ink">factor rate</strong>, not an
            interest rate. Multiply it by the amount and you get the total you'll pay back. Move the
            sliders to see how it works. We show you these same numbers on every real offer.
          </p>
          <div className="mt-8 space-y-6">
            <Slider
              id="calc-amount"
              label="Amount"
              value={usd(amount)}
              min={10_000}
              max={250_000}
              step={5_000}
              current={amount}
              onChange={setAmount}
            />
            <Slider
              id="calc-factor"
              label="Factor rate"
              value={factor.toFixed(2)}
              min={1.1}
              max={1.5}
              step={0.01}
              current={factor}
              onChange={setFactor}
            />
            <Slider
              id="calc-term"
              label="Term"
              value={`${months} months`}
              min={3}
              max={24}
              step={1}
              current={months}
              onChange={setMonths}
            />
          </div>
        </div>
        <div className={cn(card, "flex flex-col justify-center gap-1 p-6 sm:p-8")}>
          <Stat label="You receive" value={usd(amount)} />
          <Stat label="Total payback" value={usd(payback)} accent />
          <Stat label="Cost of the money" value={usd(payback - amount)} />
          <Stat label="About per week" value={usd(weekly)} />
          <p className="mt-4 text-sm leading-relaxed text-smoke">
            Illustration only. Real offers vary by funder and may include fees, which we'll always
            show you in writing.
          </p>
        </div>
      </div>
    </section>
  );
}

function Slider(props: {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <label htmlFor={props.id} className="flex items-center justify-between">
        <span className="font-medium text-smoke">{props.label}</span>
        <span className="font-display font-bold tabular-nums">{props.value}</span>
      </label>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.current}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="mt-3 w-full accent-[oklch(0.52_0.12_58)]"
      />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-line py-4 last-of-type:border-0",
        accent && "-mx-3 rounded-xl border-0 bg-ink px-3 text-paper",
      )}
    >
      <span className={accent ? "text-mist" : "text-smoke"}>{label}</span>
      <span className={cn("font-display text-2xl font-bold tabular-nums", accent && "text-amber")}>
        {value}
      </span>
    </div>
  );
}

function WhoItsFor() {
  return (
    <section id="who-its-for" className="border-t border-line bg-sand">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-6 sm:py-24 md:grid-cols-2">
        <div>
          <Eyebrow>Who it's for</Eyebrow>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Built for the people who run the place.
          </h2>
          <p className="mt-4 max-w-md text-lg leading-relaxed text-smoke">
            Owner-operators doing $20k to $500k a month across New Jersey and New York City. If you
            open the doors in the morning and do the books at night, this is for you.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2">
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
                className="rounded-full bg-white px-3.5 py-1.5 text-[0.95rem] ring-1 ring-line"
              >
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-display text-xl font-bold">What you'll need</h3>
          <ul className="mt-4 divide-y divide-line rounded-2xl bg-white ring-1 ring-line">
            {[
              "Three months of business bank statements",
              "Six months or more in business",
              "A photo of your driver's license",
              "Your business name and EIN",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 px-4 py-3.5">
                <BadgeCheck className="mt-0.5 size-5 shrink-0 text-amber-deep" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Link to="/apply" className={cn(btnPrimary, "mt-6")}>
            Start with a few questions <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function FaqPreview() {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.6fr]">
      <div>
        <Eyebrow>FAQ</Eyebrow>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Straight answers.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-smoke">
          The questions owners ask us most. Don't see yours?
        </p>
        <Link to="/faq" className={cn(btnOutline, "mt-6")}>
          All questions <ArrowRight className="size-4" />
        </Link>
      </div>
      <FaqList items={FAQS.slice(0, 5)} />
    </section>
  );
}

function ForFunders() {
  return (
    <section id="for-funders" className="mx-auto max-w-6xl px-5 pt-20 sm:px-6 sm:pt-24">
      <div className="flex flex-col gap-6 rounded-2xl bg-ink p-6 text-paper sm:p-10 md:flex-row md:items-center">
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
    <section className="lamp-light text-paper">
      <div className="mx-auto max-w-3xl px-5 py-20 text-center sm:px-6 sm:py-24">
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-5xl">
          See what your business qualifies for.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-lg text-mist">
          A few questions, about a minute, and no effect on your credit.
        </p>
        <Link to="/apply" className={cn(btnPrimary, "mt-8")}>
          Check my options <ArrowRight className="size-4" />
        </Link>
      </div>
    </section>
  );
}
