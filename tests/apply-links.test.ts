// deno test --node-modules-dir=none tests/apply-links.test.ts
// Gap 5 (2026-11-27): the site's own "Check my options" buttons pointed at /apply, which only
// answers 307 → /application. Before the page hydrates (0.2-0.5 s on a phone) a tap paid that
// round trip. Internal links now go straight to /application; /apply and /apply/<rep> stay as
// redirects for old emails, ads and rep links.
//
// CI runs tests with no file permission, so the check reads, as text, every file in src/ that
// links anywhere (LINKING below). Run it with --allow-read and one more test walks all of src/:
// it fails on an /apply link in any file, and on a file that links but is missing from LINKING.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { orgJsonLd, postalAddress } from "../src/lib/org-json-ld.ts";
import { SITE } from "../src/lib/site.ts";
import { carriedSearch } from "../src/lib/apply.ts";
import linkApplication from "../src/components/application/link-application.tsx" with { type: "text" };
import chatMessages from "../src/components/chat/messages.tsx" with { type: "text" };
import layout from "../src/components/site/layout.tsx" with { type: "text" };
import aiActivity from "../src/components/staff/ai-activity.tsx" with { type: "text" };
import board from "../src/components/staff/board.tsx" with { type: "text" };
import calendar from "../src/components/staff/calendar.tsx" with { type: "text" };
import dashboard from "../src/components/staff/dashboard.tsx" with { type: "text" };
import emailReplies from "../src/components/staff/email-replies.tsx" with { type: "text" };
import engineLeads from "../src/components/staff/engine-leads.tsx" with { type: "text" };
import fileView from "../src/components/staff/file-view.tsx" with { type: "text" };
import findAnything from "../src/components/staff/find-anything.tsx" with { type: "text" };
import leadProfile from "../src/components/staff/lead-profile.tsx" with { type: "text" };
import money from "../src/components/staff/money.tsx" with { type: "text" };
import notesCalls from "../src/components/staff/notes-calls.tsx" with { type: "text" };
import sentApplications from "../src/components/staff/sent-applications.tsx" with { type: "text" };
import startedLeads from "../src/components/staff/started-leads.tsx" with { type: "text" };
import today from "../src/components/staff/today.tsx" with { type: "text" };
import errorPage from "../src/lib/error-page.ts" with { type: "text" };
import root from "../src/routes/__root.tsx" with { type: "text" };
import about from "../src/routes/about.tsx" with { type: "text" };
import account from "../src/routes/account.tsx" with { type: "text" };
import applicationIndex from "../src/routes/application.index.tsx" with { type: "text" };
import applyRoute from "../src/routes/apply.tsx" with { type: "text" };
import applyRepRoute from "../src/routes/apply_.$rep.tsx" with { type: "text" };
import discordLink from "../src/routes/discord-link.tsx" with { type: "text" };
import faq from "../src/routes/faq.tsx" with { type: "text" };
import howItWorks from "../src/routes/how-it-works.tsx" with { type: "text" };
import home from "../src/routes/index.tsx" with { type: "text" };
import login from "../src/routes/login.tsx" with { type: "text" };
import offerCheck from "../src/routes/offer-check.tsx" with { type: "text" };
import staff from "../src/routes/staff.tsx" with { type: "text" };
import terms from "../src/routes/terms.tsx" with { type: "text" };

/** Every file in src/ with a link or redirect target in it, by path under src/. */
const LINKING: Record<string, string> = {
  "components/application/link-application.tsx": linkApplication,
  "components/chat/messages.tsx": chatMessages,
  "components/site/layout.tsx": layout,
  "components/staff/ai-activity.tsx": aiActivity,
  "components/staff/board.tsx": board,
  "components/staff/calendar.tsx": calendar,
  "components/staff/dashboard.tsx": dashboard,
  "components/staff/email-replies.tsx": emailReplies,
  "components/staff/engine-leads.tsx": engineLeads,
  "components/staff/file-view.tsx": fileView,
  "components/staff/find-anything.tsx": findAnything,
  "components/staff/lead-profile.tsx": leadProfile,
  "components/staff/money.tsx": money,
  "components/staff/notes-calls.tsx": notesCalls,
  "components/staff/sent-applications.tsx": sentApplications,
  "components/staff/started-leads.tsx": startedLeads,
  "components/staff/today.tsx": today,
  "lib/error-page.ts": errorPage,
  "routes/__root.tsx": root,
  "routes/about.tsx": about,
  "routes/account.tsx": account,
  "routes/apply.tsx": applyRoute,
  "routes/apply_.$rep.tsx": applyRepRoute,
  "routes/discord-link.tsx": discordLink,
  "routes/faq.tsx": faq,
  "routes/how-it-works.tsx": howItWorks,
  "routes/index.tsx": home,
  "routes/login.tsx": login,
  "routes/offer-check.tsx": offerCheck,
  "routes/staff.tsx": staff,
  "routes/terms.tsx": terms,
};

/** The redirects themselves: they are meant to name /apply. */
const REDIRECTS = ["routes/apply.tsx", "routes/apply_.$rep.tsx"];

/**
 * TEMPORARY: /apply links this PR does not switch. offer-check.tsx is switched by
 * dashboard-measures-claims (same wave). index.tsx (home page tiles and CTAs) and
 * how-it-works.tsx have no owner in this wave: site-copy-matches-flow, a later PR, switches
 * them, so until it merges those links still pay the 307. Remove each entry as its PR merges;
 * once the list is empty the test covers every file.
 */
const OWNED_ELSEWHERE = ["routes/index.tsx", "routes/how-it-works.tsx", "routes/offer-check.tsx"];

/**
 * Linking files CI does not import: apply-flow.tsx is dead and the remove-dead-leads-endpoint PR
 * deletes it, and an import of a deleted file would break every test here. The full walk still
 * checks it while it exists. Drop the entry once that PR merges.
 */
const NOT_IMPORTED = ["components/site/apply-flow.tsx"];

const skipped = (path: string) => REDIRECTS.includes(path) || OWNED_ELSEWHERE.includes(path);

/** A link or redirect target that is /apply or under it: to="/apply", to: "/apply/x", href={"/apply?..."}. */
const APPLY_TARGET = /\b(?:to|href)\s*[=:]\s*\{?\s*["'`]\/apply(?=["'`/?#])/g;
/** Any internal link or redirect target at all, to spot a file missing from LINKING. */
const ANY_TARGET = /\b(?:to|href)\s*[=:]\s*\{?\s*["'`]\//;

function applyLinks(source: string): number[] {
  const lines: number[] = [];
  for (const m of source.matchAll(APPLY_TARGET))
    lines.push(source.slice(0, m.index).split("\n").length);
  return lines;
}

const SRC = new URL("../src/", import.meta.url);
const canRead = Deno.permissions.querySync({ name: "read", path: SRC }).state === "granted";

async function* walk(dir: URL, rel = ""): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const path = rel + e.name;
    if (e.isDirectory) yield* walk(new URL(`${e.name}/`, dir), `${path}/`);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) yield path;
  }
}

Deno.test("the /apply pattern catches every link shape and leaves /application alone", () => {
  for (const hit of [
    '<Link to="/apply" className="x">',
    "<Link\n  to='/apply'\n  search={{ amount }}>",
    '{ label: "Check my options", to: "/apply" }',
    'navigate({ to: "/apply", search })',
    '<a href="/apply?amount=lt-25k">',
    'to={"/apply"}',
    "to={`/apply/${slug}`}",
  ])
    assertEquals(applyLinks(hit).length, 1, hit);
  for (const miss of [
    '<Link to="/application">',
    '<Link to="/application/$rep" params={{ rep }}>',
    '{ label: "Check my options", to: "/application" }',
    'createFileRoute("/apply")', // the redirect route's own id is not a link
    'to="/applying-tips"',
    "// the old /apply page",
  ])
    assertEquals(applyLinks(miss).length, 0, miss);
});

Deno.test("no internal link points at /apply outside the two redirect routes", () => {
  const found: string[] = [];
  for (const [path, source] of Object.entries(LINKING)) {
    if (skipped(path)) continue;
    for (const line of applyLinks(source)) found.push(`src/${path}:${line}`);
  }
  assertEquals(found, [], `link straight to /application instead:\n${found.join("\n")}`);
  // The redirects really do name /apply, so skipping them is what lets the check pass.
  assert(REDIRECTS.every((p) => LINKING[p]!.includes('createFileRoute("/apply')));
});

Deno.test({
  name: "all of src/ (with --allow-read): no /apply link, and every linking file is in LINKING",
  ignore: !canRead,
  fn: async () => {
    const found: string[] = [];
    const unlisted: string[] = [];
    let scanned = 0;
    for await (const path of walk(SRC)) {
      scanned++;
      const source = await Deno.readTextFile(new URL(path, SRC));
      if (ANY_TARGET.test(source) && !(path in LINKING) && !NOT_IMPORTED.includes(path))
        unlisted.push(`src/${path}`);
      if (skipped(path)) continue;
      for (const line of applyLinks(source)) found.push(`src/${path}:${line}`);
    }
    assert(scanned > 50, `walked only ${scanned} files; is SRC right?`);
    assertEquals(found, [], `link straight to /application instead:\n${found.join("\n")}`);
    assertEquals(unlisted, [], "add these to LINKING so CI reads them");
  },
});

Deno.test("the files this PR switched link to /application", () => {
  assert(/to="\/application"[\s\S]{0,200}Check my options/.test(root), "404 page CTA");
  assertEquals(applyLinks(root), []);
  assertEquals(applyLinks(layout), []);
  // header, mobile menu, and footer column
  assertEquals((layout.match(/to[=:]\s*"\/application"/g) ?? []).length, 3);
});

Deno.test("/apply and /apply/<rep> still send old links on to /application", () => {
  assert(applyRoute.includes('createFileRoute("/apply")'));
  assert(/redirect\(\{\s*to: "\/application",\s*search: carriedSearch\(search\)/.test(applyRoute));
  assert(applyRepRoute.includes('createFileRoute("/apply_/$rep")'));
  assert(applyRepRoute.includes('"/application/$rep"'));
});

Deno.test(
  "/application keeps the same search /apply passed on: quick answers and utm_ tags",
  () => {
    // /application's validateSearch is carriedSearch, so a direct link drops exactly what the
    // redirect dropped (ref, unknown keys, contact details) and keeps ?amount= and utm_ tags.
    // Pin both halves: the route still filters with carriedSearch, and what carriedSearch keeps.
    assert(
      /validateSearch:\s*\(\s*\w+(?:\s*:\s*Record<string,\s*unknown>)?\s*\)\s*=>\s*carriedSearch\(\s*\w+\s*\)/.test(
        applicationIndex,
      ),
      "/application must filter its search with carriedSearch, the same as the /apply redirect",
    );
    assertEquals(
      carriedSearch({ amount: "lt-25k", utm_source: "x", ref: "zeus", email: "a@b.co", junk: "1" }),
      { amount: "lt-25k", utm_source: "x" },
    );
  },
);

Deno.test("structured data: no address while SITE.address is empty", () => {
  const ld = orgJsonLd(SITE);
  if (!SITE.address) assert(!("address" in ld), "an empty address must not ship as a blank");
  if (!SITE.phone) assert(!("telephone" in ld));
  assertEquals(ld["@type"], "FinancialService");
  assertEquals(ld.url, SITE.url);
  assertEquals(orgJsonLd({ ...SITE, address: "   " }).address, undefined);
  assert(root.includes("orgJsonLd(SITE)"), "the head uses the same builder the test checks");
});

Deno.test("structured data: a filled address becomes a PostalAddress", () => {
  const ld = orgJsonLd({
    ...SITE,
    phone: "(908) 555-0123",
    address: "123 Main St, Roselle, NJ 07203",
  });
  assertEquals(ld.telephone, "(908) 555-0123");
  assertEquals(ld.address, {
    "@type": "PostalAddress",
    streetAddress: "123 Main St",
    addressLocality: "Roselle",
    addressRegion: "NJ",
    postalCode: "07203",
    addressCountry: "US",
  });
  assertEquals(postalAddress("500 Broad St, Suite 2, Newark, nj 07102-1234"), {
    "@type": "PostalAddress",
    streetAddress: "500 Broad St, Suite 2",
    addressLocality: "Newark",
    addressRegion: "NJ",
    postalCode: "07102-1234",
    addressCountry: "US",
  });
  // A line that isn't "City, ST 12345" is kept whole rather than split wrong.
  assertEquals(postalAddress("PO Box 12, Roselle New Jersey"), {
    "@type": "PostalAddress",
    streetAddress: "PO Box 12, Roselle New Jersey",
    addressCountry: "US",
  });
});
