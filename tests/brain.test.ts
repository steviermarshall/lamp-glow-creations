// deno test --node-modules-dir=none tests/brain.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type BrainFile,
  type BrainInput,
  briefDay,
  checkBrief,
  factsFor,
  findToday,
  looksPrivate,
  roundAmount,
  safeName,
  sizePoints,
} from "../src/lib/brain.ts";

const NOW = new Date("2026-10-30T14:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const file = (id: string, over: Partial<BrainFile> = {}): BrainFile => ({
  id,
  status: "reviewing",
  rep_slug: "stevie",
  user_id: `merchant-${id}`,
  business_name: `Biz ${id}`,
  amount_requested: 50_000,
  created_at: ago(24 * 10),
  updated_at: ago(2),
  last_activity_at: ago(2),
  document_count: 0,
  documents_pending_review: 0,
  submission_count: 0,
  ...over,
});

const input = (over: Partial<BrainInput> = {}): BrainInput => ({
  files: [],
  offers: [],
  events: [],
  signed: [],
  invites: [],
  ...over,
});

const stevie = { isAdmin: false, repSlug: "stevie" };
const admin = { isAdmin: true, repSlug: "asad" };

Deno.test("a quiet, healthy file is not on the list", () => {
  assertEquals(findToday(input({ files: [file("a")] }), NOW, stevie), []);
});

Deno.test("an offer running out beats everything and says how many hours", () => {
  const got = findToday(
    input({
      files: [file("a"), file("b", { documents_pending_review: 2 })],
      offers: [
        {
          application_id: "a",
          status: "presented",
          presented_at: ago(30),
          expires_at: ahead(20),
          accepted_at: null,
        },
      ],
    }),
    NOW,
    stevie,
  );
  assertEquals(
    got.map((g) => [g.ref, g.id, g.signal]),
    [
      ["F1", "a", "offer_expiring"],
      ["F2", "b", "docs_in"],
    ],
  );
  assert(got[0]!.next.includes("20 hours"));
  assertEquals(got[1]!.next, "2 new documents came in. Review them so the file can move.");
});

Deno.test("an accepted or expired offer doesn't count as running out", () => {
  const got = findToday(
    input({
      files: [file("a"), file("b")],
      offers: [
        {
          application_id: "a",
          status: "accepted",
          presented_at: ago(30),
          expires_at: ahead(5),
          accepted_at: ago(1),
        },
        {
          application_id: "b",
          status: "presented",
          presented_at: ago(30),
          expires_at: ago(1),
          accepted_at: null,
        },
      ],
    }),
    NOW,
    stevie,
  );
  assertEquals(got, []);
});

Deno.test("the merchant working on their file now, but not staff touching it", () => {
  const got = findToday(
    input({
      files: [file("a"), file("b")],
      events: [
        {
          application_id: "a",
          kind: "document_uploaded",
          actor_user_id: "merchant-a",
          occurred_at: ago(0.1),
        },
        { application_id: "b", kind: "call", actor_user_id: "staff-1", occurred_at: ago(0.1) },
        {
          application_id: "b",
          kind: "document_uploaded",
          actor_user_id: "merchant-b",
          occurred_at: ago(2),
        },
      ],
    }),
    NOW,
    stevie,
  );
  assertEquals(
    got.map((g) => [g.id, g.signal]),
    [["a", "active_now"]],
  );
});

Deno.test(
  "signed: package ready with 3+ documents, else ask for statements while it's fresh",
  () => {
    const got = findToday(
      input({
        files: [
          file("ready", { document_count: 4 }),
          file("fresh", { document_count: 1 }),
          file("old", { document_count: 1 }),
          file("sent", { document_count: 4, submission_count: 2, status: "submitted" }),
        ],
        signed: [
          { application_id: "ready", signed_at: ago(30) },
          { application_id: "fresh", signed_at: ago(5) },
          { application_id: "old", signed_at: ago(24 * 5) },
          { application_id: "sent", signed_at: ago(30) },
        ],
      }),
      NOW,
      stevie,
    );
    assertEquals(
      got.map((g) => [g.id, g.signal]),
      [
        ["ready", "package_ready"],
        ["fresh", "reached_signing"],
      ],
    );
  },
);

Deno.test("gone quiet: 3 days for your own files, 7 for an admin looking at someone else's", () => {
  const files = [
    file("mine4", { rep_slug: "asad", last_activity_at: ago(24 * 4) }),
    file("theirs4", { rep_slug: "stevie", last_activity_at: ago(24 * 4) }),
    file("theirs8", { rep_slug: "stevie", last_activity_at: ago(24 * 8) }),
  ];
  assertEquals(
    findToday(input({ files }), NOW, admin)
      .map((g) => g.id)
      .sort(),
    ["mine4", "theirs8"],
  );
  assertEquals(
    findToday(input({ files }), NOW, stevie)
      .map((g) => g.id)
      .sort(),
    ["theirs4", "theirs8"],
  );
});

Deno.test("a rep never sees another rep's files or links", () => {
  const got = findToday(
    input({
      files: [file("z", { rep_slug: "zeus", documents_pending_review: 1 })],
      invites: [
        {
          id: "i1",
          rep_slug: "zeus",
          business_name: "Z Co",
          sent_at: ago(24 * 3),
          opened_at: null,
          cancelled_at: null,
          expires_at: ahead(500),
          application_id: null,
        },
      ],
    }),
    NOW,
    stevie,
  );
  assertEquals(got, []);
});

Deno.test("closed and funded files are skipped", () => {
  const files = ["funded", "declined", "withdrawn", "closed"].map((s) =>
    file(s, { status: s, documents_pending_review: 3 }),
  );
  assertEquals(findToday(input({ files }), NOW, stevie), []);
});

Deno.test("links: unopened 2+ days shows, opened or cancelled doesn't", () => {
  const base = {
    rep_slug: "stevie",
    business_name: "Link Co",
    cancelled_at: null,
    expires_at: ahead(500),
    application_id: null,
  };
  const got = findToday(
    input({
      invites: [
        { ...base, id: "late", sent_at: ago(24 * 3), opened_at: null },
        { ...base, id: "new", sent_at: ago(10), opened_at: null },
        { ...base, id: "opened", sent_at: ago(24 * 3), opened_at: ago(24) },
        { ...base, id: "cancel", sent_at: ago(24 * 3), opened_at: null, cancelled_at: ago(1) },
      ],
    }),
    NOW,
    stevie,
  );
  assertEquals(
    got.map((g) => [g.ref, g.id]),
    [["L1", "late"]],
  );
});

Deno.test("bigger asks and older problems rank higher within a signal", () => {
  const got = findToday(
    input({
      files: [
        file("small", { amount_requested: 10_000, documents_pending_review: 1 }),
        file("big", { amount_requested: 300_000, documents_pending_review: 1 }),
      ],
    }),
    NOW,
    stevie,
  );
  assertEquals(
    got.map((g) => g.id),
    ["big", "small"],
  );
  assertEquals(sizePoints(300_000), 15);
  assertEquals(sizePoints(null), 0);
});

Deno.test("amounts are rounded before the model sees them", () => {
  assertEquals(roundAmount(47_350), 45_000);
  assertEquals(roundAmount(1_200), 5_000);
  assertEquals(roundAmount(137_000), 125_000);
  assertEquals(roundAmount(null), undefined);
});

Deno.test("facts carry only the allowlist and hide private-looking names", () => {
  const items = findToday(
    input({
      files: [
        file("a", { business_name: "jane@corner.com", documents_pending_review: 1 }),
        file("b", {
          business_name: "Tony's Pizza",
          documents_pending_review: 1,
          amount_requested: 47_350,
        }),
      ],
    }),
    NOW,
    stevie,
  );
  const facts = factsFor(items, () => "Stevie");
  const keys = new Set(facts.flatMap((f) => Object.keys(f)));
  for (const k of keys)
    assert(
      ["ref", "business", "stage", "signals", "days", "hours", "docs", "amount", "rep"].includes(k),
      k,
    );
  assertEquals(facts.find((f) => f.business === "A business")?.ref !== undefined, true);
  assertEquals(facts.find((f) => f.business === "Tony's Pizza")?.amount, 45_000);
  assert(!JSON.stringify(facts).includes("merchant-"));
  assert(!JSON.stringify(facts).includes('"a"'));
});

Deno.test("private-looking text is caught", () => {
  for (const s of [
    "call 212-555-0199",
    "SSN 123-45-6789",
    "EIN 12-3456789",
    "acct 000123456789",
    "a@b.co",
  ])
    assert(looksPrivate(s), s);
  for (const s of ["7-Eleven", "Route 66 Diner", "Tony's Pizza"]) assert(!looksPrivate(s), s);
  assertEquals(safeName("  Big   Truck Co "), "Big Truck Co");
});

Deno.test("the model's answer is kept only inside the facts", () => {
  const refs = new Set(["F1", "F2"]);
  assertEquals(
    checkBrief(
      {
        headline: "Two files need you before noon.",
        items: [
          { ref: "F1", next: "Call now, the offer runs out tonight." },
          { ref: "F9", next: "Unknown file." },
          { ref: "F2", next: "Pitch the loan again." },
          { ref: "F2", next: "Call them at 212-555-0199." },
          { ref: "F2", next: "Do this after F1." },
          { ref: "F1", next: "A second line for F1." },
        ],
      },
      refs,
    ),
    {
      headline: "Two files need you before noon.",
      items: [{ ref: "F1", next: "Call now, the offer runs out tonight." }],
    },
  );
  assertEquals(checkBrief({ headline: "Get the loan done", items: [] }, refs), null);
  assertEquals(checkBrief("nope", refs), null);
});

Deno.test("a brief belongs to the New York day", () => {
  assertEquals(briefDay(new Date("2026-10-31T03:00:00Z")), "2026-10-30");
  assertEquals(briefDay(new Date("2026-10-31T05:00:00Z")), "2026-10-31");
});
