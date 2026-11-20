// deno test --node-modules-dir=none tests/site-address.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { SITE } from "../src/lib/site.ts";
// The footer's own source, read as text: it is a React component, so this test can't draw it.
import layout from "../src/components/site/layout.tsx" with { type: "text" };

const ADDRESS = "206 E Broad St, Westfield, NJ 07090";

Deno.test("the site knows the company's legal name and mailing address", () => {
  assertEquals(SITE.legalName, "Lamp Capital Group LLC");
  assertEquals(SITE.address, ADDRESS);
});

Deno.test("the footer prints the legal name and the mailing address together", () => {
  const start = layout.indexOf("export function SiteFooter");
  const end = layout.indexOf("type FooterLink");
  assert(start >= 0 && end > start, "the footer moved: point this test at it again");
  const footer = layout.slice(start, end);
  const block = footer.match(/<address[^>]*>([\s\S]*?)<\/address>/)?.[1] ?? "";
  assert(block.includes("{SITE.legalName}"), "the footer's address block lost the legal name");
  assert(block.includes("{SITE.address}"), "the footer's address block lost the mailing address");
});

Deno.test("the address is one plain line, safe to drop into an email footer", () => {
  assert(!/[\r\n<>]/.test(SITE.address));
  assert(/, NJ \d{5}$/.test(SITE.address));
});
