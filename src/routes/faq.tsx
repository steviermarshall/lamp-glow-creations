import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell, Eyebrow, btnPrimary } from "@/components/site/layout";
import { FAQS, FaqList } from "@/components/site/faq";
import { seo } from "@/lib/site";

export const Route = createFileRoute("/faq")({
  head: () => ({
    ...seo({
      path: "/faq",
      title: "FAQ — Lamp",
      description:
        "Straight answers about working capital, factor rates, credit checks, costs, and how Lamp works.",
    }),
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
    ],
  }),
  component: Faq,
});

function Faq() {
  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-5 pb-24 pt-14 sm:px-6 sm:pt-20">
        <Eyebrow>FAQ</Eyebrow>
        <h1 className="mt-5 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Straight answers.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-smoke">
          Everything owners usually ask before they check their options. Still curious? Email{" "}
          <a className="text-amber-deep underline" href="mailto:hello@getlamp.app">
            hello@getlamp.app
          </a>
          .
        </p>
        <div className="mt-10">
          <FaqList />
        </div>
        <Link to="/apply" className={`${btnPrimary} mt-12`}>
          Check my options
        </Link>
      </section>
    </PageShell>
  );
}
