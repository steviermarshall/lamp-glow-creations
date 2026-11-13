// deno test --node-modules-dir=none tests/public-wording.test.ts
//
// The pages anyone can open without signing in must never call what Lamp arranges lending: an
// advance is a purchase of future receivables. This reads the source of every one of those pages
// (as text, so no file permission is needed) and fails when a banned word is in it outside a code
// comment. A new page fails the last test until it is put in one of the two lists below.
import { assertEquals } from "jsr:@std/assert@1";

import root from "../src/routes/__root.tsx" with { type: "text" };
import home from "../src/routes/index.tsx" with { type: "text" };
import about from "../src/routes/about.tsx" with { type: "text" };
import faqPage from "../src/routes/faq.tsx" with { type: "text" };
import howItWorks from "../src/routes/how-it-works.tsx" with { type: "text" };
import apply from "../src/routes/apply.tsx" with { type: "text" };
import applyRep from "../src/routes/apply_.$rep.tsx" with { type: "text" };
import offerCheck from "../src/routes/offer-check.tsx" with { type: "text" };
import privacy from "../src/routes/privacy.tsx" with { type: "text" };
import terms from "../src/routes/terms.tsx" with { type: "text" };
import login from "../src/routes/login.tsx" with { type: "text" };
import router from "../src/router.tsx" with { type: "text" };
import layout from "../src/components/site/layout.tsx" with { type: "text" };
import faqList from "../src/components/site/faq.tsx" with { type: "text" };
import applyFlow from "../src/components/site/apply-flow.tsx" with { type: "text" };
import auth from "../src/components/site/auth.tsx" with { type: "text" };
import quickQuestion from "../src/components/site/quick-question.tsx" with { type: "text" };
import lampOrb from "../src/components/site/lamp-orb.tsx" with { type: "text" };
import lampField from "../src/components/site/lamp-field.tsx" with { type: "text" };
import siteCopy from "../src/lib/site.ts" with { type: "text" };
import applyCopy from "../src/lib/apply.ts" with { type: "text" };
import offerCheckCopy from "../src/lib/offer-check.ts" with { type: "text" };
import errorPage from "../src/lib/error-page.ts" with { type: "text" };
import routeTree from "../src/routeTree.gen.ts" with { type: "text" };

/** Every page a visitor can open without signing in, and the shared pieces those pages show. */
const PUBLIC: Record<string, string> = {
  "src/routes/__root.tsx": root,
  "src/routes/index.tsx": home,
  "src/routes/about.tsx": about,
  "src/routes/faq.tsx": faqPage,
  "src/routes/how-it-works.tsx": howItWorks,
  "src/routes/apply.tsx": apply,
  "src/routes/apply_.$rep.tsx": applyRep,
  "src/routes/offer-check.tsx": offerCheck,
  "src/routes/privacy.tsx": privacy,
  "src/routes/terms.tsx": terms,
  "src/routes/login.tsx": login,
  "src/router.tsx": router,
  "src/components/site/layout.tsx": layout,
  "src/components/site/faq.tsx": faqList,
  "src/components/site/apply-flow.tsx": applyFlow,
  "src/components/site/auth.tsx": auth,
  "src/components/site/quick-question.tsx": quickQuestion,
  "src/components/site/lamp-orb.tsx": lampOrb,
  "src/components/site/lamp-field.tsx": lampField,
  "src/lib/site.ts": siteCopy,
  "src/lib/apply.ts": applyCopy,
  "src/lib/offer-check.ts": offerCheckCopy,
  "src/lib/error-page.ts": errorPage,
};

/** Pages this test does not read: each needs a sign-in or a link sent to one person. */
const NOT_PUBLIC = new Set([
  "account", // a merchant's own account, after signing in
  "staff", // staff only
  "discord-link", // staff only, after signing in
  "application.$rep", // the full application, from a link a rep sends
  "application.$rep_.pdf", // the same application as a PDF
  "upload.$token", // a document upload link sent to one merchant
]);

const BANNED = /\bloans?\b|\blend(?:s|er|ers|ing)?\b|\bborrow\w*|\bcredit lines?\b/gi;

// Lamp has to be able to say it is not one. These exact sentences are the only places a banned
// word may appear; the word "loan" is not in any of them.
const DENIALS = [
  "not a lender",
  "Is Lamp a lender?",
  "Lamp does not lend money",
  "commitments to lend",
];

/** The banned words a visitor could read in a source file, each with the words around it. */
function bannedWords(source: string): string[] {
  let text = source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments, and {/* */} inside the markup
    .replace(/(^|[\s;,{}()[\]])\/\/[^\n]*/gm, "$1") // line comments, but not the // in a web address
    .replace(/\s+/g, " ");
  for (const d of DENIALS) text = text.split(d).join(" ");
  return [...text.matchAll(BANNED)].map((m) =>
    text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).trim(),
  );
}

Deno.test("the check catches lending words and lets the denials through", () => {
  assertEquals(bannedWords('title: "Short-term loans",').length, 1);
  assertEquals(bannedWords('title: "SBA loans",').length, 1);
  assertEquals(bannedWords("<p>Talk to a lender about lending.</p>").length, 2);
  assertEquals(bannedWords("<p>Borrow against a\n  credit line.</p>").length, 2);
  assertEquals(bannedWords("<li>We're not a lender, so we're not pushing one product.</li>"), []);
  assertEquals(bannedWords("<p>not offers, approvals, or commitments\n  to lend</p>"), []);
  assertEquals(bannedWords('const a = 1; // never the word "loan"\n{/* a loan */}'), []);
  assertEquals(bannedWords('title: "Term financing", title: "SBA financing",'), []);
  assertEquals(bannedWords('url: "https://getlamp.app/loans"').length, 1);
});

Deno.test("no public page shows a lending word to visitors", () => {
  const found: Record<string, string[]> = {};
  for (const [file, source] of Object.entries(PUBLIC)) {
    const words = bannedWords(source);
    if (words.length) found[file] = words;
  }
  assertEquals(found, {});
});

Deno.test("the home page names the two products the way Lamp's emails do", () => {
  assertEquals(home.includes('title: "Term financing"'), true);
  assertEquals(home.includes('title: "SBA financing"'), true);
});

Deno.test("every page is either read by this test or listed as not public", () => {
  const pages = [...routeTree.matchAll(/from '\.\/routes\/([^']+)'/g)]
    .map((m) => m[1] ?? "")
    .filter((name) => !name.startsWith("api."));
  const unsorted = pages.filter(
    (name) => !(`src/routes/${name}.tsx` in PUBLIC) && !NOT_PUBLIC.has(name),
  );
  assertEquals(unsorted, []);
  assertEquals(pages.length > 10, true);
});
