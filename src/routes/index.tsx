import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lamp — Working capital, made clear." },
      {
        name: "description",
        content:
          "Lamp is a small-business working capital brokerage in NJ and NYC. See what you qualify for, in plain terms.",
      },
      { property: "og:title", content: "Lamp — Working capital, made clear." },
      {
        property: "og:description",
        content:
          "Lamp is a small-business working capital brokerage in NJ and NYC. See what you qualify for, in plain terms.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Wordmark({ size = "lg" }: { size?: "lg" | "sm" }) {
  const box = size === "lg" ? "size-9 rounded-xl" : "size-7 rounded-lg";
  const dot = size === "lg" ? "size-3" : "size-2";
  const text = size === "lg" ? "text-xl" : "text-base";
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`grid ${box} place-items-center bg-gradient-to-br from-aurora-a via-aurora-b to-aurora-c`}
      >
        <span className={`${dot} rounded-full bg-ink/85`} />
      </span>
      <span className={`font-display ${text} font-bold tracking-tight`}>Lamp</span>
    </div>
  );
}

function Index() {
  return (
    <div className="font-body relative min-h-screen overflow-hidden bg-ink text-white antialiased">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="aurora-blob absolute -left-40 -top-52 h-[440px] w-[440px] rounded-full bg-aurora-a/40 blur-[130px]" />
        <div className="aurora-blob-b absolute right-[-12%] top-[-6%] h-[520px] w-[520px] rounded-full bg-aurora-b/40 blur-[140px]" />
        <div className="aurora-blob-c absolute bottom-[-20%] left-1/3 h-[480px] w-[480px] rounded-full bg-aurora-c/25 blur-[150px]" />
      </div>

      <div className="relative">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <Wordmark />
          <nav className="hidden items-center gap-8 text-sm font-medium text-mist md:flex">
            <a className="transition hover:text-white" href="#how-it-works">
              How it works
            </a>
            <a className="transition hover:text-white" href="#who-its-for">
              Who it's for
            </a>
            <a className="transition hover:text-white" href="#for-funders">
              For funders
            </a>
          </nav>
          <a
            className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/15"
            href="#apply"
          >
            See what you qualify for
          </a>
        </header>

        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-2 lg:pt-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-mist ring-1 ring-white/10">
              <span className="size-1.5 rounded-full bg-aurora-a" /> Clarity, not pressure
            </span>
            <h1 className="mt-6 font-display text-5xl font-bold leading-[1.03] tracking-tight sm:text-6xl">
              Working capital,
              <span className="block bg-gradient-to-r from-aurora-a via-aurora-b to-aurora-c bg-clip-text text-transparent">
                made clear.
              </span>
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-mist">
              Lamp is a brokerage for small-business owners. We take your numbers to a
              network of funders, then lay the offers out side by side so you can read
              them in a minute, on your phone, between jobs.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                className="rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-ink shadow-lg shadow-aurora-a/20 transition hover:brightness-110"
                href="#apply"
              >
                See what you qualify for
              </a>
              <a
                className="rounded-full px-6 py-3.5 text-sm font-semibold text-white ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/5"
                href="#for-funders"
              >
                Talk to a funder
              </a>
            </div>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-mist/70">
              Based in New Jersey, working with owners across the NJ and NYC area.
            </p>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-aurora-a/20 via-aurora-b/15 to-aurora-c/10 blur-2xl" />
            <div className="relative rounded-[1.6rem] border border-white/10 bg-panel/70 p-6 shadow-2xl backdrop-blur-2xl">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">
                  Your offers, side by side
                </span>
                <span className="rounded-full bg-aurora-a/15 px-2.5 py-1 text-xs font-semibold text-aurora-a">
                  Example
                </span>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold tabular-nums tracking-tight">
                  3
                </span>
                <span className="text-sm font-medium text-mist">
                  offers back, same day
                </span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-[68%] rounded-full bg-gradient-to-r from-aurora-a to-aurora-b" />
              </div>
              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/5">
                  <div>
                    <p className="text-sm font-semibold text-white">Offer A</p>
                    <p className="text-xs text-mist">12 months, daily payments</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-aurora-a">
                    1.28
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/5">
                  <div>
                    <p className="text-sm font-semibold text-white">Offer B</p>
                    <p className="text-xs text-mist">9 months, weekly payments</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-aurora-b">
                    1.22
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/5">
                  <div>
                    <p className="text-sm font-semibold text-white">Offer C</p>
                    <p className="text-xs text-mist">18 months, weekly payments</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-aurora-c">
                    1.35
                  </span>
                </div>
              </div>
              <p className="mt-5 text-xs leading-relaxed text-mist/70">
                Sample terms shown for illustration. Your offers depend on your business.
              </p>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-6xl px-6 pb-24">
          <div className="mb-8 flex items-end justify-between">
            <h2 className="font-display text-2xl font-bold tracking-tight">
              Three steps. One clear view.
            </h2>
            <span className="hidden text-sm text-mist sm:block">
              No single product — just your options, side by side.
            </span>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-panel/60 p-6 backdrop-blur-xl transition hover:border-aurora-a/30">
              <span className="grid size-11 place-items-center rounded-xl bg-aurora-a/15 font-display text-sm font-bold text-aurora-a">
                01
              </span>
              <h3 className="mt-5 font-display text-lg font-semibold">Send your numbers</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist">
                Three months of bank statements and a few details about the business. It
                takes about ten minutes.
              </p>
              <p className="mt-4 text-sm font-semibold text-aurora-a">
                No cost to you →
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-panel/60 p-6 backdrop-blur-xl transition hover:border-aurora-b/30">
              <span className="grid size-11 place-items-center rounded-xl bg-aurora-b/15 font-display text-sm font-bold text-aurora-b">
                02
              </span>
              <h3 className="mt-5 font-display text-lg font-semibold">We shop the file</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist">
                We take it to our network of funders and bring back what they will
                actually do, with the terms written plainly.
              </p>
              <p className="mt-4 text-sm font-semibold text-aurora-b">
                Usually same day →
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-panel/60 p-6 backdrop-blur-xl transition hover:border-aurora-c/30">
              <span className="grid size-11 place-items-center rounded-xl bg-aurora-c/15 font-display text-sm font-bold text-aurora-c">
                03
              </span>
              <h3 className="mt-5 font-display text-lg font-semibold">You choose</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist">
                Payment amount, length, and total cost, compared line by line. Say no and
                nothing happens.
              </p>
              <p className="mt-4 text-sm font-semibold text-aurora-c">
                Your call, always →
              </p>
            </div>
          </div>
        </section>

        <section id="who-its-for" className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-10 rounded-2xl border border-white/10 bg-panel/60 p-8 backdrop-blur-xl md:grid-cols-2">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight">
                Who it's for
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-mist">
                Owner-operators doing $20k to $500k a month. Restaurants, trucking,
                contractors, retail, salons, auto shops. If you run the place yourself,
                this is built for you.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {[
                  "Restaurants",
                  "Trucking",
                  "Contractors",
                  "Retail",
                  "Salons",
                  "Auto shops",
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
              <h3 className="font-display text-lg font-semibold">What you need to apply</h3>
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
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-aurora-a" />
                    <span className="text-mist">{item}</span>
                  </li>
                ))}
              </ul>
              <a
                className="mt-6 inline-flex rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-ink transition hover:brightness-110"
                href="mailto:hello@getlamp.com?subject=Application"
              >
                Send your file to Lamp
              </a>
            </div>
          </div>
        </section>

        <section id="for-funders" className="mx-auto max-w-6xl px-6 pb-24">
          <div className="rounded-2xl border border-white/10 bg-panel/60 p-8 backdrop-blur-xl">
            <h2 className="font-display text-2xl font-bold tracking-tight">For funders and ISOs</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mist">
              Lamp submits clean, complete files: statements, application, and a plain
              summary of the merchant. We tell the merchant what the terms are before they
              sign, so there are fewer surprises on your side too.
            </p>
            <a
              className="mt-6 inline-flex rounded-full px-6 py-3.5 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/5"
              href="mailto:partners@getlamp.com?subject=Partner%20inquiry"
            >
              Reach the partner desk
            </a>
          </div>
        </section>

        <footer className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-8 sm:flex-row sm:items-center">
            <Wordmark size="sm" />
            <p className="max-w-xl text-xs leading-relaxed text-mist/70">
              © 2026 Lamp Financial Group LLC. Lamp is a brokerage, not a lender, and
              arranges offers through a network of third-party funders.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
