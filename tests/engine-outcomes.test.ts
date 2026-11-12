// deno test --node-modules-dir=none tests/engine-outcomes.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  changedSince,
  DEFAULT_DAYS,
  gate,
  type InviteRow,
  LEAD_COLUMNS,
  type LeadRow,
  outcome,
  parseSince,
} from "../src/lib/engine-outcomes.ts";

const NOW = new Date("2026-11-12T21:30:00Z");
const url = (q = "") => `https://getlamp.app/api/engine/outcomes${q}`;
const req = (q = "", secret: string | null = "s3cret") =>
  new Request(url(q), { headers: secret === null ? {} : { "x-engine-push-secret": secret } });

const lead = (over: Partial<LeadRow> = {}): LeadRow => ({
  id: 7,
  source: "war-room-engine",
  source_key: "ACME PAVING|NJ",
  status: "new",
  rep_slug: "stevie",
  pushed_at: "2026-11-10T12:45:00+00:00",
  worked_at: null,
  contact_updated_at: null,
  notes: "",
  ...over,
});

const invite = (over: Partial<InviteRow> = {}): InviteRow => ({
  engine_lead_id: 7,
  sent_at: "2026-11-11T15:00:00+00:00",
  submitted_at: null,
  cancelled_at: null,
  application_id: null,
  ...over,
});

Deno.test("outcomes: since defaults to 8 days back and reads ISO dates and times", () => {
  assertEquals(
    parseSince(new URL(url()), NOW)?.toISOString(),
    new Date(NOW.getTime() - DEFAULT_DAYS * 86400000).toISOString(),
  );
  assertEquals(
    parseSince(new URL(url("?since=2026-11-04")), NOW)?.toISOString(),
    "2026-11-04T00:00:00.000Z",
  );
  assertEquals(
    parseSince(new URL(url("?since=2026-11-04T21:30:00Z")), NOW)?.toISOString(),
    "2026-11-04T21:30:00.000Z",
  );
  assertEquals(
    parseSince(new URL(url("?since=2026-11-04T16:30:00-05:00")), NOW)?.toISOString(),
    "2026-11-04T21:30:00.000Z",
  );
});

Deno.test("outcomes: a since that isn't a past date is refused", () => {
  for (const bad of ["yesterday", "2026-13-45", "2026-11-04;drop", "2027-01-01", "1730000000"])
    assertEquals(parseSince(new URL(url(`?since=${encodeURIComponent(bad)}`)), NOW), null, bad);
});

Deno.test("outcomes: the gate wants the push's own secret, in the push's order", () => {
  assertEquals(gate(req(), "", true, NOW), { status: 503, error: "Engine push is not set up." });
  assertEquals((gate(req(), "s3cret", false, NOW) as { status: number }).status, 500);
  assertEquals((gate(req("", null), "s3cret", true, NOW) as { status: number }).status, 401);
  assertEquals((gate(req("", "s3cre"), "s3cret", true, NOW) as { status: number }).status, 401);
  assertEquals((gate(req("?since=nope"), "s3cret", true, NOW) as { status: number }).status, 400);
  const ok = gate(req("?since=2026-11-01"), "s3cret", true, NOW);
  assert("since" in ok);
  assertEquals(ok.since.toISOString(), "2026-11-01T00:00:00.000Z");
});

Deno.test("outcomes: an untouched lead comes back as handed off, nothing more", () => {
  const o = outcome(lead(), []);
  assertEquals(o.source_key, "ACME PAVING|NJ");
  assertEquals(o.status, "new");
  assertEquals(o.rep_slug, "stevie");
  assertEquals(o.pushed_at, "2026-11-10T12:45:00.000Z");
  assertEquals(
    [o.first_touched_at, o.last_activity_at, o.link_sent_at, o.application_id],
    [null, null, null, null],
  );
  assertEquals([o.has_notes, o.has_contact], [false, false]);
});

Deno.test(
  "outcomes: first touch is the earliest of status change, contact saved and link sent",
  () => {
    const o = outcome(
      lead({
        status: "qualified",
        worked_at: "2026-11-12T14:00:00+00:00",
        contact_updated_at: "2026-11-11T13:00:00+00:00",
        notes: "  spoke to owner ",
      }),
      [
        invite(),
        invite({ sent_at: "2026-11-12T16:00:00+00:00", cancelled_at: "2026-11-12T17:00:00Z" }),
      ],
    );
    assertEquals(o.first_touched_at, "2026-11-11T13:00:00.000Z");
    assertEquals(o.last_activity_at, "2026-11-12T16:00:00.000Z");
    assertEquals(o.status_changed_at, "2026-11-12T14:00:00.000Z");
    assertEquals(o.link_sent_at, "2026-11-11T15:00:00.000Z");
    assertEquals([o.has_notes, o.has_contact], [true, true]);
    assertEquals(o.application_id, null);
  },
);

Deno.test("outcomes: a lead still new does not count its push-time stamp as a touch", () => {
  const o = outcome(lead({ worked_at: "2026-11-10T12:45:00Z" }), []);
  assertEquals(o.first_touched_at, null);
  assertEquals(o.status_changed_at, "2026-11-10T12:45:00.000Z");
});

Deno.test("outcomes: a signed link gives the file's id; other leads' links are ignored", () => {
  const o = outcome(lead({ status: "submitted", worked_at: "2026-11-12T18:00:00Z" }), [
    invite({ engine_lead_id: 8, submitted_at: "2026-11-11T18:00:00Z", application_id: "other" }),
    invite({ submitted_at: "2026-11-12T18:00:00Z", application_id: "app-2" }),
    invite({
      sent_at: "2026-11-09T10:00:00Z",
      submitted_at: "2026-11-10T18:00:00Z",
      application_id: "app-1",
    }),
  ]);
  assertEquals(o.application_id, "app-1");
  assertEquals(o.application_submitted_at, "2026-11-10T18:00:00.000Z");
  assertEquals(o.link_sent_at, "2026-11-09T10:00:00.000Z");
  assertEquals(o.first_touched_at, "2026-11-09T10:00:00.000Z");
});

Deno.test("outcomes: nothing about the merchant goes back but the engine's own key", () => {
  for (const col of [
    "name",
    "phone",
    "email",
    "city",
    "contact_name",
    "contact_email",
    "contact_phone",
    "signals",
    "reason",
  ])
    assert(!LEAD_COLUMNS.split(",").includes(col), col);
  const o = outcome(lead({ notes: "owner Jane Doe 201-555-0101" } as Partial<LeadRow>), []);
  assert(!JSON.stringify(o).includes("Jane"));
  assertEquals(Object.keys(o).sort(), [
    "application_id",
    "application_submitted_at",
    "first_touched_at",
    "has_contact",
    "has_notes",
    "last_activity_at",
    "link_sent_at",
    "pushed_at",
    "rep_slug",
    "source",
    "source_key",
    "status",
    "status_changed_at",
  ]);
});

Deno.test("outcomes: the changed-since filter covers push, status and contact, quoted", () => {
  assertEquals(
    changedSince(new Date("2026-11-04T00:00:00Z")),
    'pushed_at.gte."2026-11-04T00:00:00.000Z",worked_at.gte."2026-11-04T00:00:00.000Z",' +
      'contact_updated_at.gte."2026-11-04T00:00:00.000Z"',
  );
});
