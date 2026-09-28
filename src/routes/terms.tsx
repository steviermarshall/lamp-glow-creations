import { createFileRoute } from "@tanstack/react-router";
import { ProsePage } from "@/components/site/layout";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Use — Lamp" }] }),
  component: Terms,
});

function Terms() {
  return (
    <ProsePage eyebrow="Legal" title="Terms of Use" intro="Last updated September 28, 2026.">
      <p>
        These terms govern your use of this website and services provided by Lamp Financial Group
        LLC ("Lamp", "we"). By using the site or creating an account, you agree to them.
      </p>
      <h2>Lamp is a broker, not a lender</h2>
      <p>
        Lamp does not lend money or make credit decisions. We help you prepare a file and present it
        to third-party funders. Any offer, approval, terms, and funding come solely from the funder,
        under that funder's own agreement.
      </p>
      <h2>Estimates are not offers</h2>
      <p>
        Ranges, calculators, and examples on this site are illustrations based on the information
        you provide. They are not offers, approvals, or commitments to lend, and actual terms may
        differ.
      </p>
      <h2>Your information</h2>
      <p>
        You agree that the information and documents you provide are accurate and that you're
        authorized to share them on behalf of the business. You authorize us to share your file with
        funders for the purpose of obtaining offers for you. See our{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>
      <h2>Communications</h2>
      <p>
        By creating an account you agree that we may contact you by email about your application. If
        you provide a phone number, you agree we may contact you at that number about your
        application. You can opt out of marketing messages at any time.
      </p>
      <h2>No obligation</h2>
      <p>You are never obligated to accept any offer presented to you.</p>
      <h2>Limitation of liability</h2>
      <p>
        The site is provided "as is." To the fullest extent permitted by law, Lamp is not liable for
        indirect or consequential damages arising from your use of the site or from any funder's
        products or decisions.
      </p>
      <h2>Contact</h2>
      <p>
        Questions? Email <a href="mailto:hello@getlamp.com">hello@getlamp.com</a>.
      </p>
    </ProsePage>
  );
}
