import { createFileRoute } from "@tanstack/react-router";
import { ProsePage } from "@/components/site/layout";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy — Lamp" }] }),
  component: Privacy,
});

function Privacy() {
  return (
    <ProsePage eyebrow="Legal" title="Privacy Policy" intro="Last updated September 28, 2026.">
      <p>
        This policy explains what information Lamp Financial Group LLC ("Lamp", "we") collects when
        you use this website, how we use it, and the choices you have.
      </p>
      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>What you tell us:</strong> your answers to our questions (such as funding amount,
          monthly revenue, time in business, industry, and estimated credit range), your name,
          business name, email address, and phone number.
        </li>
        <li>
          <strong>Documents you upload:</strong> such as bank statements and identification.
        </li>
        <li>
          <strong>Account information:</strong> if you sign in with Google, we receive your name and
          email address from Google.
        </li>
        <li>
          <strong>Usage information:</strong> basic technical data such as browser type, pages
          visited, and campaign details from links you clicked (for example, UTM parameters).
        </li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>
          To evaluate your funding options and present your file to funders you may work with.
        </li>
        <li>
          To create and maintain your account and communicate with you about your application.
        </li>
        <li>To send you updates and marketing you can opt out of at any time.</li>
        <li>To comply with law, prevent fraud, and improve our services.</li>
      </ul>
      <h2>Sharing</h2>
      <p>
        We share your file with funders in our network for the purpose of obtaining offers for you,
        and with service providers who help us run the site (such as hosting, authentication, and
        email). We do not sell your personal information.
      </p>
      <h2>Your choices</h2>
      <p>
        You can ask us to access, correct, or delete your information, or unsubscribe from
        marketing, by emailing <a href="mailto:hello@getlamp.com">hello@getlamp.com</a>. Every
        marketing email includes an unsubscribe link.
      </p>
      <h2>Security</h2>
      <p>
        Documents are stored in private, access-controlled storage. No method of transmission or
        storage is perfectly secure, but we take reasonable measures to protect your information.
      </p>
      <h2>Contact</h2>
      <p>
        Questions about this policy? Email <a href="mailto:hello@getlamp.com">hello@getlamp.com</a>.
      </p>
    </ProsePage>
  );
}
