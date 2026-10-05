import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { seo } from "@/lib/site";
import { btnPrimary, card, Eyebrow, PageShell } from "@/components/site/layout";

export const Route = createFileRoute("/how-it-works")({
  head: () =>
    seo({
      path: "/how-it-works",
      title: "How it works — Lamp",
      description:
        "What Lamp needs from you, what happens next, and how long each step takes, from a few questions to comparing real offers side by side.",
    }),
  component: HowItWorksPage,
});

const STEPS = [
  {
    title: "Check your options",
    time: "About a minute",
    body: "A few tap-to-answer questions about the business: how much you need, what it's for, monthly deposits, and time in business. You see a rough range right away.",
    detail: "No credit pull and no Social Security number.",
  },
  {
    title: "Create your account and upload",
    time: "About ten minutes",
    body: "Sign in with Google or an emailed link, no password. Then upload your last three months of business bank statements and a photo of your driver's license.",
    detail: "Your files are private to you and the Lamp team.",
  },
  {
    title: "We shop your file",
    time: "Usually same business day",
    body: "We package a clean file and take it to the funders in our network that fit your business, then bring back what they'll actually do.",
    detail: "Complete files move fastest.",
  },
  {
    title: "Compare offers side by side",
    time: "On your phone",
    body: "Every offer laid out the same way: what you receive, the factor rate, the term, each payment, and the total you pay back. Any fees are shown in writing.",
    detail: "Ask us anything before you decide.",
  },
  {
    title: "You choose, or say no",
    time: "Your call",
    body: "Pick the offer that fits and sign with that funder. Once you accept, many funders can send money within 24 to 48 hours.",
    detail: "Say no to all of them and nothing happens.",
  },
];

const WONT = [
  "Pull your credit just to show you options",
  "Push one product because it pays us more",
  "Hide the total payback behind a rate",
  "Pressure you to sign today",
  "Sell your personal information",
];

function HowItWorksPage() {
  return (
    <PageShell>
      <section className="lamp-light text-paper">
        <div className="mx-auto max-w-3xl px-5 pb-16 pt-14 sm:px-6 sm:pt-20">
          <Eyebrow dark>How it works</Eyebrow>
          <h1 className="mt-5 font-display text-4xl font-bold tracking-tight sm:text-6xl">
            From a few questions to real offers.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-mist">
            What we need from you, what happens next, and how long each step takes. No surprises
            along the way.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-16 sm:px-6 sm:py-20">
        <ol className="relative space-y-10 border-l-2 border-line pl-8 sm:pl-10">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative">
              <span
                className="absolute -left-[2.85rem] top-0 grid size-9 place-items-center rounded-full bg-ink font-display text-sm font-bold tabular-nums text-amber sm:-left-[3.35rem]"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-deep">
                {s.time}
              </p>
              <h2 className="mt-1 font-display text-2xl font-bold">{s.title}</h2>
              <p className="mt-2 text-lg leading-relaxed text-smoke">{s.body}</p>
              <p className="mt-2 flex items-center gap-2 font-medium">
                <BadgeCheck className="size-5 shrink-0 text-amber-deep" /> {s.detail}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-line bg-sand">
        <div className="mx-auto grid max-w-5xl gap-8 px-5 py-16 sm:px-6 sm:py-20 md:grid-cols-2">
          <div className={cn(card, "p-6 sm:p-8")}>
            <h2 className="font-display text-2xl font-bold">What it costs</h2>
            <p className="mt-3 text-lg leading-relaxed text-smoke">
              Nothing up front. Checking your options and seeing offers is free. If you accept an
              offer, every cost and fee is disclosed to you in writing before you sign.
            </p>
            <h2 className="mt-8 font-display text-2xl font-bold">What you'll need</h2>
            <ul className="mt-3 space-y-2 text-lg text-smoke">
              <li>Three months of business bank statements</li>
              <li>A photo of your driver's license</li>
              <li>Your business name and EIN</li>
            </ul>
          </div>
          <div className="rounded-2xl bg-ink p-6 text-paper sm:p-8">
            <h2 className="font-display text-2xl font-bold">What we won't do</h2>
            <ul className="mt-5 space-y-3.5">
              {WONT.map((w) => (
                <li key={w} className="flex items-start gap-3 text-lg">
                  <X className="mt-1 size-5 shrink-0 text-amber" aria-hidden="true" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-20 text-center sm:px-6">
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Ready when you are.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-lg text-smoke">
          A few questions, about a minute, and no effect on your credit.
        </p>
        <Link to="/apply" className={cn(btnPrimary, "mt-8")}>
          Check my options <ArrowRight className="size-4" />
        </Link>
      </section>
    </PageShell>
  );
}
