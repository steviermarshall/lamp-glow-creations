// deno test --node-modules-dir=none tests/engine-outbox.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  DECISIONS,
  MAX_BODY,
  MAX_ITEMS,
  parseDecision,
  parseOffer,
  parseResults,
  reviewCard,
  stageLabel,
  type Item,
} from "../src/lib/engine-outbox.ts";

const HASH = "a".repeat(64);
const offer = (over: Record<string, unknown> = {}) => ({
  id: "ab12cd34ef",
  date: "2026-11-16",
  from: "Partners@GetLamp.app",
  from_name: "Asad Matsumoto",
  to: "Mike@Example.com",
  business: "Summit Remodeling",
  stage: 1,
  list: "nj_hic",
  subject: "Materials before you're paid?",
  body: "Hey Mike,\n\nAsad here.\n",
  hash: HASH,
  ...over,
});

Deno.test("offer: a whole email is kept word for word, addresses in lower case", () => {
  const r = parseOffer({ offer: [offer()] });
  assertEquals(r.rejected, []);
  assertEquals(r.offers.length, 1);
  const o = r.offers[0]!;
  assertEquals(o.engine_id, "ab12cd34ef");
  assertEquals(o.batch_date, "2026-11-16");
  assertEquals(o.sender_email, "partners@getlamp.app");
  assertEquals(o.to_email, "mike@example.com");
  // the words are not trimmed or cut: what the admin reads is what the engine holds
  assertEquals(o.body, "Hey Mike,\n\nAsad here.\n");
  assertEquals(o.body_hash, HASH);
});

Deno.test(
  "offer: an email that could not be shown or sent is refused by its id, the rest stay",
  () => {
    const r = parseOffer({
      offer: [
        offer({ id: "good000001" }),
        offer({ id: "x" }), // no usable id
        offer({ id: "nodate0001", date: "tomorrow" }),
        offer({ id: "nofrom0001", from: "not a mailbox" }),
        offer({ id: "noto000001", to: "" }),
        offer({ id: "stage00001", stage: 0 }),
        offer({ id: "stage00002", stage: 1.5 }),
        offer({ id: "nosubj0001", subject: "   " }),
        offer({ id: "nobody0001", body: "   " }),
        offer({ id: "long000001", body: "x".repeat(MAX_BODY + 1) }),
        offer({ id: "nohash0001", hash: "abc" }),
        offer({ id: "good000001" }), // the same email twice
      ],
    });
    assertEquals(
      r.offers.map((o) => o.engine_id),
      ["good000001"],
    );
    assertEquals(r.rejected.length, 11);
    assert(r.rejected.every((x) => x.problem.length > 10));
    assertEquals(r.rejected[0], { id: "x", problem: "The email has no usable id." });
  },
);

Deno.test(
  "offer: the wrong shape and too many are refused whole; nothing offered is not an error",
  () => {
    assertEquals(parseOffer({}), { offers: [], rejected: [] });
    assertEquals(parseOffer(null), { offers: [], rejected: [] });
    assertEquals(parseOffer({ offer: "all of them" }).rejected.length, 1);
    const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => offer({ id: `id${i}00000` }));
    const r = parseOffer({ offer: many });
    assertEquals(r.offers, []);
    assertEquals(r.rejected, [{ id: null, problem: `At most ${MAX_ITEMS} emails in one call.` }]);
  },
);

Deno.test("results: sent needs its time, failed keeps its reason, anything else is refused", () => {
  const r = parseResults({
    results: [
      { id: "sent000001", status: "sent", at: "2026-11-16T09:04:10" },
      { id: "sent000002", status: "sent" }, // no time
      { id: "fail000001", status: "failed", error: "Gmail said no" },
      { id: "back000001", status: "withdrawn", error: "they replied first" },
      { id: "odd0000001", status: "approved" }, // the engine cannot approve
      { id: "sent000001", status: "sent", at: "2026-11-16T09:05:00" }, // twice
    ],
  });
  assertEquals(
    r.results.map((x) => [x.engine_id, x.status, x.error]),
    [
      ["sent000001", "sent", ""],
      ["fail000001", "failed", "Gmail said no"],
      ["back000001", "withdrawn", "they replied first"],
    ],
  );
  assertEquals(r.rejected.length, 3);
  assertEquals(parseResults({}), { results: [], rejected: [] });
});

Deno.test("decision: one of four actions on the page's own rows, nothing else", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  assertEquals(parseDecision({ action: "send", ids: [id, id] }), { action: "send", ids: [id] });
  assert("problem" in parseDecision({ action: "approve", ids: [id] }));
  assert("problem" in parseDecision({ action: "send", ids: [] }));
  assert("problem" in parseDecision({ action: "send", ids: ["ab12cd34ef"] }));
  assert("problem" in parseDecision({ action: "send" }));
  assert("problem" in parseDecision(null));
  // the engine's own marks are never something an admin's request can set
  for (const d of Object.values(DECISIONS))
    assert(!["sent", "failed", "withdrawn"].includes(d.to), `${d.to} is the engine's to say`);
  // only a waiting email can be approved or left out; only a failed one retried
  assertEquals(DECISIONS.send.from, ["pending"]);
  assertEquals(DECISIONS.skip.from, ["pending"]);
  assertEquals(DECISIONS.retry.from, ["failed"]);
});

let n = 0;
const item = (over: Partial<Item> = {}): Item => {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    engine_id: `eng${String(n).padStart(7, "0")}`,
    batch_date: "2026-11-16",
    sender_email: "partners@getlamp.app",
    sender_name: "Asad Matsumoto",
    to_email: `owner${n}@example.com`,
    business: `Business ${n}`,
    stage: 1,
    list: "nj_hic",
    subject: "Materials before you're paid?",
    body: "Hey Mike,",
    body_hash: HASH,
    status: "pending",
    decided_name: "",
    decided_at: null,
    sent_at: null,
    error: "",
    ...over,
  };
};
const stevie = { sender_email: "marshall@getlamp.app", sender_name: "Stevie Marshall" };

Deno.test("card: nothing waiting says so, and offers no button", () => {
  const c = reviewCard([]);
  assertEquals([c.tone, c.pill, c.primary, c.subtitle], ["done", "Nothing waiting", null, ""]);
  assertEquals(c.steps, []);
  // an email the engine took back is not on the card at all
  const w = reviewCard([item({ status: "withdrawn" })]);
  assertEquals([w.tone, w.pill, w.primary], ["done", "Nothing waiting", null]);
});

Deno.test("card: waiting emails give one button that names exactly how many it sends", () => {
  const rows = [item(), item(), item(stevie), item({ status: "skipped" })];
  const c = reviewCard(rows);
  assertEquals(c.tone, "ready");
  assertEquals(c.pill, "3 to approve");
  assertEquals(c.subtitle, "4 emails from 2 mailboxes");
  assertEquals(c.primary?.action, "send");
  assertEquals(c.primary?.label, "Send 3 emails");
  // the button carries the waiting ones only: a left-out email is never in it
  assertEquals(
    c.primary?.ids,
    rows.filter((r) => r.status === "pending").map((r) => r.id),
  );
  assertEquals(c.steps.length, 2);
  assertEquals(c.steps[0]!.title, "Asad Matsumoto · partners@getlamp.app");
  assertEquals(c.steps[0]!.detail, "2 waiting for you, 1 left out");
  assertEquals(reviewCard([item()]).primary?.label, "Send 1 email");
});

Deno.test("card: once approved there is no button until the engine reports", () => {
  const c = reviewCard([
    item({ status: "approved" }),
    item({ status: "sent", sent_at: "2026-11-16T14:04:00Z" }),
  ]);
  assertEquals([c.tone, c.pill, c.primary], ["working", "Approved, going out", null]);
  assert(c.next.includes("1 email approved") && c.next.includes("1 sent so far"));
  assertEquals(c.steps[0]!.state, "active");
});

Deno.test("card: it says sent only for emails the engine reported as sent", () => {
  const done = reviewCard([
    item({ status: "sent" }),
    item({ status: "sent" }),
    item({ status: "skipped" }),
  ]);
  assertEquals([done.tone, done.pill, done.primary], ["done", "Sent 2", null]);
  assert(done.next.startsWith("2 emails sent, 1 left out."));
  const none = reviewCard([item({ status: "skipped" })]);
  assertEquals([none.tone, none.pill], ["done", "Nothing sent"]);
  assert(none.next.includes("Nothing was sent."));
});

Deno.test("card: a failure is shown as not sent, and the button comes back for those only", () => {
  const bad = item({ status: "failed", error: "Gmail refused the message" });
  const c = reviewCard([item({ status: "sent" }), bad]);
  assertEquals([c.tone, c.pill], ["failed", "1 not sent"]);
  assertEquals(c.primary, { action: "retry", ids: [bad.id], label: "Try 1 email again" });
  assertEquals(c.steps[0]!.state, "failed");
  // waiting emails come first: a failure from earlier does not hide today's approval
  const mixed = reviewCard([bad, item()]);
  assertEquals([mixed.tone, mixed.primary?.action], ["ready", "send"]);
});

Deno.test("card: every number on it is counted from the rows", () => {
  const rows = [
    ...Array.from({ length: 30 }, () => item()),
    ...Array.from({ length: 30 }, () => item(stevie)),
    ...Array.from({ length: 30 }, () =>
      item({ sender_email: "zeus@getlamp.app", sender_name: "" }),
    ),
  ];
  const c = reviewCard(rows);
  assertEquals(c.subtitle, "90 emails from 3 mailboxes");
  assertEquals(c.primary?.label, "Send 90 emails");
  assertEquals(c.primary?.ids.length, 90);
  assertEquals(c.counts.pending, 90);
  // a mailbox with no name on file is shown by its address, never by a made-up name
  assertEquals(c.steps[2]!.title, "zeus@getlamp.app · zeus@getlamp.app");
  assertEquals(
    [stageLabel(1), stageLabel(2), stageLabel(3), stageLabel(4)],
    ["First email", "Second email", "Last email", "Email 4"],
  );
});
