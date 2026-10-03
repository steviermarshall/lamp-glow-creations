import { createFileRoute, Link } from "@tanstack/react-router";
import { ProsePage, btnPrimary } from "@/components/site/layout";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — Lamp" },
      {
        name: "description",
        content:
          "Lamp is a working capital brokerage for owner-operators in New Jersey and New York City. We shop your file and show you the offers in plain English.",
      },
    ],
  }),
  component: About,
});

function About() {
  return (
    <ProsePage
      eyebrow="About Lamp"
      title="A brighter way to find working capital."
      intro="Most small-business owners don't have time to call ten funders and decode ten contracts. That's the job we do."
    >
      <h2>Why we started Lamp</h2>
      <p>
        Business funding is full of fine print: factor rates, holdbacks, daily debits, origination
        fees. Owners get called, pushed, and rushed, and too often sign something they didn't fully
        understand. We think the money itself is useful — the confusion isn't.
      </p>
      <h2>What we do</h2>
      <p>
        Lamp is a brokerage. You tell us about your business once. We package a clean file and take
        it to our network of funders, then bring back what they'll actually do — laid out side by
        side with the payment, the term, and the total cost in plain English.
      </p>
      <ul>
        <li>We're not a lender, so we're not pushing one product.</li>
        <li>You see every offer's total payback before you decide.</li>
        <li>You can say no to all of them. Nothing happens.</li>
      </ul>
      <h2>Who we work with</h2>
      <p>
        Owner-operators across New Jersey and New York City — restaurants, trucking companies,
        contractors, retail shops, salons, auto shops, and medical offices. If you run the place
        yourself, we built this for you.
      </p>
      <h2>Get in touch</h2>
      <p>
        Questions? Email <a href="mailto:hello@getlamp.app">hello@getlamp.app</a>. Funders and ISOs
        can reach the partner desk at <a href="mailto:partners@getlamp.app">partners@getlamp.app</a>
        .
      </p>
      <div className="mt-10">
        <Link to="/apply" className={btnPrimary}>
          Check my options
        </Link>
      </div>
    </ProsePage>
  );
}
