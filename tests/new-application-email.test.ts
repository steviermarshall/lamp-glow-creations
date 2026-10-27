// deno test --node-modules-dir=none tests/new-application-email.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  einVariants,
  newApplicationEmail,
  prettyEin,
  recipients,
  type NewApplication,
} from "../src/lib/new-application-email.ts";
import { buildMime } from "../src/lib/funder-send.ts";

const COPY = ["partners@getlamp.app", "marshall@getlamp.app"];

const base = (over: Partial<NewApplication> = {}): NewApplication => ({
  repName: "Zeus",
  via: "an application link",
  signer: "Brian Kelly",
  business: {
    legal_name: "Bergen Line Auto Body LLC",
    ein: "221234567",
    phone: "(201) 555-0142",
    email: "office@bergen.test",
    monthly_revenue: "120000",
    premises: "rent",
    rent: "6500",
  },
  owner: { first: "Brian", last: "Kelly", email: "brian@bergen.test", mobile: "(201) 555-0199" },
  amount: "150000",
  openPositions: 1,
  ownsRealEstate: false,
  fileUrl: "https://getlamp.app/staff?file=abc",
  duplicates: [],
  attached: { application: true, statements: 3, leftOff: 0 },
  ...over,
});

Deno.test("tax IDs match however they were typed; anything not 9 digits is skipped", () => {
  assertEquals(einVariants("22-1234567"), ["22-1234567", "221234567"]);
  assertEquals(einVariants(" 221234567 "), ["22-1234567", "221234567"]);
  assertEquals(einVariants("12345"), []);
  assertEquals(einVariants(null), []);
  assertEquals(prettyEin("221234567"), "22-1234567");
});

Deno.test("the rep gets it, Asad and Stevie are copied, nobody twice", () => {
  assertEquals(recipients("Zeus@GetLamp.app", COPY), {
    to: "zeus@getlamp.app",
    cc: ["partners@getlamp.app", "marshall@getlamp.app"],
  });
  // Stevie's own link: he's the rep and not copied a second time
  assertEquals(recipients("marshall@getlamp.app", COPY), {
    to: "marshall@getlamp.app",
    cc: ["partners@getlamp.app"],
  });
  // no rep (or no login yet): still goes to Asad and Stevie
  assertEquals(recipients(null, COPY), {
    to: "partners@getlamp.app",
    cc: ["marshall@getlamp.app"],
  });
  assertEquals(recipients("not an email", []), null);
});

Deno.test("details on top, in Tip Top's order, and no SSN or date of birth", () => {
  const m = newApplicationEmail(base());
  assertEquals(m.subject, "Signed: Bergen Line Auto Body LLC · $150,000 · Zeus");
  const lines = m.text.split("\r\n");
  assertEquals(lines.slice(0, 5), [
    "Name: Brian Kelly",
    "Email: brian@bergen.test",
    "Phone: (201) 555-0199",
    "Business name: Bergen Line Auto Body LLC",
    "Tax ID: 22-1234567",
  ]);
  assertStringIncludes(m.text, "Rent amount: $6,500");
  assertStringIncludes(m.text, "Attached: the signed application and 3 bank statements.");
  assertStringIncludes(m.text, "Open the file: https://getlamp.app/staff?file=abc");
  assert(!/ssn|birth|dob/i.test(m.text));
});

Deno.test("a tax ID already in Lamp leads the email and the subject", () => {
  const m = newApplicationEmail(
    base({
      duplicates: [
        {
          business: "Bergen Line Auto",
          stage: "Submitted",
          rep: "Stevie Marshall",
          signedAt: "2026-10-12T15:00:00Z",
        },
      ],
    }),
  );
  assert(m.subject.startsWith("ALREADY IN LAMP · Signed: Bergen Line Auto Body LLC"));
  const lines = m.text.split("\r\n");
  assertEquals(lines[0], "THE TAX ID 22-1234567 IS ALREADY IN LAMP:");
  assertStringIncludes(
    lines[1]!,
    "Bergen Line Auto (Submitted, Stevie Marshall, signed Oct 12, 2026)",
  );
  assertEquals(lines[2], "DOUBLE-CHECK BEFORE SUBMITTING IT TO A FUNDER.");
});

Deno.test("says what's missing when the PDF or statements didn't come", () => {
  const none = newApplicationEmail(
    base({ attached: { application: false, statements: 0, leftOff: 0 } }),
  );
  assertStringIncludes(none.text, "The signed PDF didn't come through");
  assert(!none.text.includes("Attached:"));
  assertStringIncludes(none.text, "No bank statements yet.");
  const big = newApplicationEmail(
    base({ attached: { application: true, statements: 2, leftOff: 1 } }),
  );
  assertStringIncludes(big.text, "1 more statement is on the file but couldn't be attached.");
  const owns = newApplicationEmail(
    base({ business: { legal_name: "X", premises: "own" }, repName: null }),
  );
  assertStringIncludes(owns.text, "Premises: Owns the business premises");
  assertStringIncludes(owns.text, "Rep: No rep yet, from an application link");
});

Deno.test("the message is copied with a Cc header, and refuses a header break", () => {
  const raw = buildMime({
    from: "Lamp <partners@getlamp.app>",
    to: "zeus@getlamp.app",
    cc: ["partners@getlamp.app", "marshall@getlamp.app"],
    subject: "Signed: X",
    body: "hi",
    attachments: [],
    boundary: "b",
  });
  assertStringIncludes(
    raw,
    "To: zeus@getlamp.app\r\nCc: partners@getlamp.app, marshall@getlamp.app\r\n",
  );
  let threw = false;
  try {
    buildMime({
      from: "a@b.c",
      to: "x@y.z",
      cc: ["evil@x.y\r\nBcc: z@z.z"],
      subject: "s",
      body: "b",
      attachments: [],
    });
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("started: tells the rep who to call, with texts allowed or calls only", async () => {
  const { startedEmail } = await import("../src/lib/new-application-email.ts");
  const m = startedEmail({
    repName: "Stevie Marshall",
    first: "Ana",
    last: "Diaz",
    phone: "(201) 555-0100",
    email: "ana@test.dev",
    textsOk: false,
  });
  assertEquals(m.subject, "Started: Ana Diaz opened the application on Stevie Marshall's link");
  const lines = m.text.split("\r\n");
  assertEquals(lines[0], "Stevie,");
  assertStringIncludes(m.text, "Phone: (201) 555-0100");
  assertStringIncludes(m.text, "Texts OK: No, calls only");
});
