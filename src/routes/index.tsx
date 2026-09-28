import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Clock,
  FileText,
  Handshake,
  Landmark,
  Receipt,
  ShieldCheck,
  Timer,
  Truck,
  Wallet,
} from "lucide-react";
import { AMOUNT_OPTIONS } from "@/lib/apply";
import { cn } from "@/lib/utils";
import { btnGhost, btnPrimary, card, Eyebrow, PageShell } from "@/components/site/layout";
import { FAQS, FaqList } from "@/components/site/faq";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lamp — Working capital, made clear." },
      {
        name: "description",
        content:
          "Lamp is a small-business working capital brokerage in NJ and NYC. Answer a few questions, see what you qualify for, and compare offers side by side in plain terms.",
      },
    ],
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
      <FaqPreview />
      <ForFunders />
      <FinalCta />
    </PageShell>
  );
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-16">
      <div className="rise">
        <Eyebrow>Clarity, not pressure</Eyebrow>
        <h1 className="mt-6 font-display text-[2.75rem] font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
          Working capital,
          <span className="block bg-gradient-to-r from-aurora-a via-aurora-b to-aurora-c bg-clip-text text-transparent">
            made clear.
          </span>
        </h1>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-mist">
          Answer a few quick questions and see what your business could qualify for. We shop your
          file to our funder network and lay the offers out side by side — readable in a minute, on
          your phone, between jobs.
        </p>

        <div className={cn(card, "mt-8 max-w-lg p-5 sm:p-6")}>
          <p className="font-display text-base font-semibold">How much do you need?</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {AMOUNT_OPTIONS.map((o) => (
              <Link
                key={o.id}
                to="/apply"
                search={{ amount: o.id }}
                className="rounded-xl bg-white/5 px-3 py-3 text-center text-sm font-semibold text-white ring-1 ring-white/10 transition hover:bg-aurora-a/15 hover:ring-aurora-a/50"
              >
                {o.label}
              </Link>
            ))}
            <Link
              to="/apply"
              className="rounded-xl bg-white px-3 py-3 text-center text-sm font-semibold text-ink transition hover:brightness-110"
            >
              Not sure yet →
            </Link>
          </div>
          <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-mist">
            <li className="flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-aurora-a" /> Doesn't affect your credit
            </li>
            <li className="flex items-center gap-1.5">
              <Timer className="size-4 text-aurora-b" /> About 60 seconds
            </li>
            <li className="flex items-center gap-1.5">
              <BadgeCheck className="size-4 text-aurora-c" /> No cost to check
            </li>
          </ul>
        </div>
      </div>

      <OffersCard />
    </section>
  );
}

function OffersCard() {
  const offers = [
    { name: "Offer A", terms: "12 months · daily payments", rate: "1.28", color: "text-aurora-a" },
    { name: "Offer B", terms: "9 months · weekly payments", rate: "1.22", color: "text-aurora-b" },
    { name: "Offer C", terms: "18 months · weekly payments", rate: "1.35", color: "text-aurora-c" },
  ];
  return (
    <div className="rise relative [animation-delay:150ms]">
      <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-aurora-a/25 via-aurora-b/20 to-aurora-c/10 blur-2xl" />
      <div className="float relative rounded-[1.6rem] border border-white/10 bg-panel/75 p-6 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">Your offers, side by side</span>
          <span className="rounded-full bg-aurora-a/15 px-2.5 py-1 text-xs font-semibold text-aurora-a">
            Example
          </span>
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="font-display text-4xl font-bold tabular-nums tracking-tight">3</span>
          <span className="text-sm font-medium text-mist">offers back, same day</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-[68%] rounded-full bg-gradient-to-r from-aurora-a to-aurora-b" />
        </div>
        <div className="mt-6 space-y-3">
          {offers.map((o) => (
            <div
              key={o.name}
              className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/5"
            >
              <div>
                <p className="text-sm font-semibold text-white">{o.name}</p>
                <p className="text-xs text-mist">{o.terms}</p>
              </div>
              <div className="text-right">
                <span className={`text-sm font-semibold tabular-nums ${o.color}`}>{o.rate}</span>
                <p className="text-[10px] uppercase tracking-wider text-mist/60">factor</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-5 text-xs leading-relaxed text-mist/70">
          Sample terms shown for illustration. Your offers depend on your business.
        </p>
      </div>
    </div>
  );
}

function TrustStrip() {
  const items = [
    { icon: Handshake, title: "A broker, on your side", body: "We compare funders for you." },
    { icon: ShieldCheck, title: "No credit hit to check", body: "No SSN needed up front." },
    { icon: Clock, title: "Offers usually same day", body: "For complete files." },
    { icon: BadgeCheck, title: "Say no anytime", body: "No obligation, ever." },
  ];
  return (
    <section className="border-y border-white/5 bg-white/[0.02]">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-5 py-8 sm:px-6 md:grid-cols-4">
        {items.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex items-start gap-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-aurora-a" />
            <div>
              <p className="text-sm font-semibold text-white">{title}</p>
              <p className="text-xs text-mist">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mb-10 max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-aurora-a">{eyebrow}</p>
      <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-base leading-relaxed text-mist">{body}</p>}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Answer a few questions",
      body: "How much, what for, and a little about the business. Then create your account with Google or email to save your spot.",
      tag: "About a minute",
      badge: "bg-aurora-a/15 text-aurora-a",
      text: "text-aurora-a",
      hover: "hover:border-aurora-a/30",
    },
    {
      n: "02",
      title: "We shop the file",
      body: "Upload three months of bank statements. We take your file to our funder network and bring back what they'll actually do.",
      tag: "Usually same day",
      badge: "bg-aurora-b/15 text-aurora-b",
      text: "text-aurora-b",
      hover: "hover:border-aurora-b/30",
    },
    {
      n: "03",
      title: "You choose",
      body: "Payment amount, length, and total cost, compared line by line in plain English. Say no and nothing happens.",
      tag: "Your call, always",
      badge: "bg-aurora-c/15 text-aurora-c",
      text: "text-aurora-c",
      hover: "hover:border-aurora-c/30",
    },
  ] as const;
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-24">
      <SectionHead
        eyebrow="How it works"
        title="Three steps. One clear view."
        body="No single product to push — just your real options, side by side."
      />
      <div className="grid gap-5 md:grid-cols-3">
        {steps.map((s) => (
          <div key={s.n} className={cn(card, "p-6 transition", s.hover)}>
            <span
              className={cn(
                "grid size-11 place-items-center rounded-xl font-display text-sm font-bold",
                s.badge,
              )}
            >
              {s.n}
            </span>
            <h3 className="mt-5 font-display text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-mist">{s.body}</p>
            <p className={cn("mt-4 text-sm font-semibold", s.text)}>{s.tag} →</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FundingOptions() {
  const options = [
    {
      icon: Wallet,
      title: "Working capital",
      body: "Fast funding based on your sales, for payroll, bills, and busy seasons.",
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
      body: "Trucks, ovens, lifts, chairs — the equipment itself helps secure it.",
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
    <section id="options" className="mx-auto max-w-6xl px-5 pb-20 sm:px-6 sm:pb-24">
      <SectionHead
        eyebrow="Funding options"
        title="One application. Every kind of funding."
        body="You don't need to know which product fits. Tell us about the business and we'll show you what's realistic across the options below."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {options.map(({ icon: Icon, title, body }) => (
          <Link
            key={title}
            to="/apply"
            className={cn(
              card,
              "group flex flex-col p-6 transition hover:-translate-y-0.5 hover:border-white/20",
            )}
          >
            <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-aurora-a/20 to-aurora-b/20 ring-1 ring-white/10">
              <Icon className="size-5 text-white" />
            </span>
            <h3 className="mt-5 font-display text-lg font-semibold">{title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-mist">{body}</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-aurora-a">
              Check my options
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
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
  const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;

  return (
    <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-6 sm:pb-24">
      <div className={cn(card, "grid gap-10 p-6 sm:p-10 lg:grid-cols-2")}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-aurora-c">
            Read any offer in a minute
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">
            See the real cost before you sign.
          </h2>
          <p className="mt-4 leading-relaxed text-mist">
            Many offers are priced with a <strong className="text-white">factor rate</strong>, not
            an interest rate. Multiply it by the amount and you get the total you'll pay back. Move
            the sliders to see how it works — we'll show you these same numbers on every real offer.
          </p>
          <div className="mt-8 space-y-6">
            <Slider
              label="Amount"
              value={fmt(amount)}
              min={10_000}
              max={250_000}
              step={5_000}
              current={amount}
              onChange={setAmount}
            />
            <Slider
              label="Factor rate"
              value={factor.toFixed(2)}
              min={1.1}
              max={1.5}
              step={0.01}
              current={factor}
              onChange={setFactor}
            />
            <Slider
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
        <div className="flex flex-col justify-center gap-3">
          <Stat label="You receive" value={fmt(amount)} />
          <Stat label="Total payback" value={fmt(payback)} accent />
          <Stat label="Cost of the money" value={fmt(payback - amount)} />
          <Stat label="About per week" value={fmt(weekly)} />
          <p className="mt-2 text-xs leading-relaxed text-mist/70">
            Illustration only. Real offers vary by funder and may include fees, which we'll always
            show you in writing.
          </p>
        </div>
      </div>
    </section>
  );
}

function Slider(props: {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm">
        <span className="font-medium text-mist">{props.label}</span>
        <span className="font-semibold tabular-nums text-white">{props.value}</span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.current}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="mt-3 w-full accent-[oklch(0.83_0.13_172)]"
      />
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-xl px-5 py-4 ring-1",
        accent ? "bg-aurora-a/10 ring-aurora-a/30" : "bg-white/5 ring-white/5",
      )}
    >
      <span className="text-sm text-mist">{label}</span>
      <span
        className={cn(
          "font-display text-xl font-bold tabular-nums",
          accent ? "text-aurora-a" : "text-white",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function WhoItsFor() {
  return (
    <section id="who-its-for" className="mx-auto max-w-6xl px-5 pb-20 sm:px-6 sm:pb-24">
      <div className={cn(card, "grid gap-10 p-6 sm:p-10 md:grid-cols-2")}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-aurora-b">
            Who it's for
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">
            Built for the people who run the place.
          </h2>
          <p className="mt-4 max-w-md leading-relaxed text-mist">
            Owner-operators doing $20k to $500k a month across New Jersey and New York City. If you
            open the doors in the morning and do the books at night, this is for you.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {[
              "Restaurants",
              "Trucking",
              "Contractors",
              "Retail",
              "Salons",
              "Auto shops",
              "Medical & dental",
            ].map((t) => (
              <span
                key={t}
                className="rounded-full bg-white/5 px-3.5 py-1.5 text-sm text-mist ring-1 ring-white/10"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <div id="apply">
          <h3 className="font-display text-lg font-semibold">What you'll need</h3>
          <ul className="mt-4 space-y-3">
            {[
              "Three months of business bank statements",
              "Six months or more in business",
              "A photo of your driver's license",
              "Your business name and EIN",
            ].map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 rounded-xl bg-white/5 px-4 py-3 text-sm ring-1 ring-white/5"
              >
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-aurora-a" />
                <span className="text-mist">{item}</span>
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
    <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-20 sm:px-6 sm:pb-24 lg:grid-cols-[1fr_1.6fr]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-aurora-a">FAQ</p>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">Straight answers.</h2>
        <p className="mt-4 leading-relaxed text-mist">
          The questions owners ask us most. Don't see yours?
        </p>
        <Link to="/faq" className={cn(btnGhost, "mt-6")}>
          All questions <ArrowRight className="size-4" />
        </Link>
      </div>
      <FaqList items={FAQS.slice(0, 5)} />
    </section>
  );
}

function ForFunders() {
  return (
    <section id="for-funders" className="mx-auto max-w-6xl px-5 pb-20 sm:px-6 sm:pb-24">
      <div className={cn(card, "flex flex-col gap-6 p-6 sm:p-10 md:flex-row md:items-center")}>
        <div className="flex-1">
          <h2 className="font-display text-2xl font-bold tracking-tight">For funders and ISOs</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mist">
            Lamp submits clean, complete files: statements, application, and a plain summary of the
            merchant. We tell the merchant what the terms are before they sign, so there are fewer
            surprises on your side too.
          </p>
        </div>
        <a className={btnGhost} href="mailto:partners@getlamp.com?subject=Partner%20inquiry">
          Reach the partner desk
        </a>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-6">
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-aurora-a via-aurora-b to-aurora-c p-[1px]">
        <div className="rounded-[calc(2rem-1px)] bg-ink/85 px-6 py-14 text-center backdrop-blur-xl sm:px-12">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-5xl">
            See what your business qualifies for.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-mist">
            A few questions, about a minute, and no effect on your credit.
          </p>
          <Link to="/apply" className={cn(btnPrimary, "mt-8")}>
            Check my options <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
