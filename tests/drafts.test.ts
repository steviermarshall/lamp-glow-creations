// deno test --node-modules-dir=none tests/drafts.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { SIGNAL_POINTS, type Signal } from "../src/lib/brain.ts";
import {
  canText,
  checkDraft,
  dialable,
  draftProblem,
  fillDraft,
  ruleDraft,
  STOP_LINE,
  TEXT_MAX,
} from "../src/lib/drafts.ts";

const SIGNALS = Object.keys(SIGNAL_POINTS) as Signal[];
const LONG = "Northside Commercial Refrigeration & Kitchen Repair Services"; // 60 characters

Deno.test("Lamp's own drafts pass Lamp's own rules for every signal", () => {
  for (const sig of SIGNALS) {
    for (const docsLink of [false, true]) {
      const d = ruleDraft(sig, { business: LONG, days: 12, hours: 30, docs: 3, docsLink });
      for (const [k, v] of [
        ["text", d.text],
        ["subject", d.email_subject],
        ["body", d.email_body],
      ] as const)
        assertEquals(draftProblem(v, docsLink), null, `${sig} ${k}`);
      assert(d.call.length >= 2, sig);
      const filled = fillDraft(d, {
        first_name: "Christopher",
        rep_name: "Stevie Marshall",
        docs_link: "https://getlamp.app/upload/" + "x".repeat(43),
      });
      assert(filled.text.length <= TEXT_MAX + 60, `${sig} text is ${filled.text.length} long`);
      assert(filled.text.endsWith(STOP_LINE), sig);
      assert(!/\{[a-z_]+\}/.test(JSON.stringify(filled)), `${sig} left a placeholder`);
    }
  }
});

Deno.test("only the statements step offers a documents link", () => {
  assert(
    ruleDraft("reached_signing", { business: "A", docsLink: true }).text.includes("{docs_link}"),
  );
  assert(!ruleDraft("reached_signing", { business: "A" }).text.includes("{docs_link}"));
  assert(!ruleDraft("stale", { business: "A", docsLink: true }).text.includes("{docs_link}"));
});

Deno.test("merchant-facing wording Lamp never uses is caught", () => {
  for (const s of [
    "Your loan is ready",
    "Our lender said yes",
    "You're pre-approved!",
    "Guaranteed funding today",
    "Approval in 24 hours",
    "Rates from 1.2% a month",
    "Low interest",
    "Won't touch your credit score",
  ])
    assertEquals(draftProblem(s, false), "wording", s);
  assertEquals(draftProblem("If you're interested, call me", false), null);
  assertEquals(draftProblem("Call {first_name} at 212-555-0199", false), "private");
  assertEquals(draftProblem("Hi {name}", false), "placeholder");
  assertEquals(draftProblem("Here: {docs_link}", false), "placeholder");
  assertEquals(draftProblem("Here: {docs_link}", true), null);
});

Deno.test("Claude's draft is kept field by field; a bad field falls back", () => {
  const rules = ruleDraft("stale", { business: "Blue Line HVAC", days: 5 });
  const { draft, written } = checkDraft(
    {
      text: "Hi {first_name}, {rep_name} here at Lamp. Still a good time to move ahead on Blue Line HVAC?",
      email_subject: "Your loan application",
      email_body: "Hi {first_name}, just checking in.\n\n{rep_name}",
      call: ["Ask if the timing still works.", "Call 212-555-0199"],
    },
    rules,
    false,
  );
  assertEquals(written, ["text", "email_body"]);
  assertEquals(draft.email_subject, rules.email_subject);
  assertEquals(draft.call, rules.call);
  assert(draft.text.startsWith("Hi {first_name}, {rep_name} here"));
});

Deno.test("a text without the rep's name, or too long, is not kept", () => {
  const rules = ruleDraft("stale", { business: "A" });
  assertEquals(checkDraft({ text: "Hi {first_name}, checking in." }, rules, false).written, []);
  assertEquals(
    checkDraft({ text: "{rep_name} " + "a".repeat(TEXT_MAX) }, rules, false).written,
    [],
  );
  assertEquals(checkDraft("nonsense", rules, false).draft, rules);
});

Deno.test("filling in: first name only, a stand-in when missing, one STOP line", () => {
  const d = fillDraft(
    {
      text: "Hi {first_name}, {rep_name} here. Reply STOP to opt out.",
      email_subject: "s",
      email_body: "Hi {first_name}",
      call: ["Ask {first_name}"],
    },
    { first_name: "  Dana Lee ", rep_name: "Zeus" },
  );
  assertEquals(d.text, "Hi Dana, Zeus here. Reply STOP to opt out.");
  assertEquals(
    fillDraft({ ...d, email_body: "Hi {first_name}" }, { first_name: null, rep_name: "Zeus" })
      .email_body,
    "Hi there",
  );
});

Deno.test("texting needs a phone and consent on record", () => {
  assert(canText({ phone: "2125550199", phone_consent_at: "2026-10-01", signed_at: null }));
  assert(canText({ phone: "2125550199", phone_consent_at: null, signed_at: "2026-10-01" }));
  assert(!canText({ phone: "2125550199", phone_consent_at: null, signed_at: null }));
  assert(!canText({ phone: null, phone_consent_at: "2026-10-01", signed_at: null }));
});

Deno.test("phone numbers become dialable US numbers or nothing", () => {
  assertEquals(dialable("(212) 555-0199"), "+12125550199");
  assertEquals(dialable("1-212-555-0199"), "+12125550199");
  assertEquals(dialable("555-0199"), null);
  assertEquals(dialable(null), null);
});
