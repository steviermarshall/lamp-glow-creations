// deno test --node-modules-dir=none tests/dashboard.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  buildDashboard,
  businessDays,
  type DashboardData,
  delta,
  median,
  periodRange,
  toTime,
  within,
} from "../src/lib/dashboard.ts";

const NOW = new Date(2026, 9, 27, 12, 0, 0); // 27 Oct 2026, noon local

const empty = (): DashboardData => ({
  files: [],
  leads: [],
  signed: [],
  invites: [],
  submissions: [],
  offers: [],
  deals: [],
  ledger: [],
  events: [],
  engine: [],
  access: [],
  reps: [
    { slug: "stevie", name: "Stevie", user_id: "u-stevie" },
    { slug: "zeus", name: "Zeus", user_id: null },
  ],
  funders: [
    { id: "f1", name: "Alpha" },
    { id: "f2", name: "Beta" },
  ],
});

const file = (id: string, over: Partial<DashboardData["files"][number]> = {}) => ({
  id,
  status: "new",
  rep_slug: "stevie",
  business_name: `Biz ${id}`,
  created_at: "2026-10-20T10:00:00",
  updated_at: "2026-10-20T10:00:00",
  submitted_at: null,
  last_activity_at: null,
  documents_pending_review: 0,
  funded_at: null,
  ...over,
});
const deal = (id: string, funded_on: string, amount: number, over = {}) => ({
  id,
  application_id: `a-${id}`,
  funder_id: "f1",
  rep_slug: "stevie",
  funded_on,
  funded_amount: amount,
  commission_due: amount * 0.05,
  commission_points: 5 as number | null,
  status: "funded",
  ...over,
});

Deno.test(
  "plain dates count as local midnight, so a deal funded on the 1st lands in that month",
  () => {
    assertEquals(toTime("2026-10-01"), new Date(2026, 9, 1).getTime());
    const p = periodRange("month", NOW);
    assertEquals(within("2026-10-01", p.from, p.to), true);
    assertEquals(within("2026-09-30", p.from, p.to), false);
  },
);

Deno.test("this month compares with the same number of days last month", () => {
  const p = periodRange("month", NOW);
  assertEquals(p.from, new Date(2026, 9, 1));
  assertEquals(p.prev!.from, new Date(2026, 8, 1));
  assertEquals(p.prev!.to.getTime() - p.prev!.from.getTime(), NOW.getTime() - p.from!.getTime());
});

Deno.test("last month runs first to first; all time has nothing to compare with", () => {
  const p = periodRange("last_month", NOW);
  assertEquals([p.from, p.to], [new Date(2026, 8, 1), new Date(2026, 9, 1)]);
  assertEquals(p.prev, { from: new Date(2026, 7, 1), to: new Date(2026, 8, 1) });
  assertEquals(periodRange("all", NOW).prev, null);
});

Deno.test("delta: small counts move by units, money and big counts by percent", () => {
  assertEquals(delta({ now: 3, prev: 1 }), "+2");
  assertEquals(delta({ now: 1, prev: 3 }), "−2");
  assertEquals(delta({ now: 150, prev: 100 }), "+50%");
  assertEquals(delta({ now: 5000, prev: 10000 }, true), "−50%");
  assertEquals(delta({ now: 2, prev: 0 }), "new");
  assertEquals(delta({ now: 2, prev: 2 }), "same");
  assertEquals(delta({ now: 2, prev: null }), null);
});

Deno.test("median of odd and even lists, none for empty", () => {
  assertEquals(median([5, 1, 3]), 3);
  assertEquals(median([4, 1, 3, 2]), 2.5);
  assertEquals(median([]), null);
});

Deno.test("north star counts merchants funded in the period, not deals, and skips defaults", () => {
  const d = empty();
  d.deals = [
    deal("1", "2026-10-05", 50000),
    deal("2", "2026-10-06", 20000, { application_id: "a-1" }), // second deal, same merchant
    deal("3", "2026-10-07", 30000, { status: "defaulted" }),
    deal("4", "2026-09-05", 10000), // last month, inside the same-days window
  ];
  const b = buildDashboard(d, periodRange("month", NOW), { repSlug: null, now: NOW });
  assertEquals(b.northStar.merchants, { now: 1, prev: 1 });
  assertEquals(b.northStar.funded, { now: 70000, prev: 10000 });
  assertEquals(b.northStar.expected.now, 3500);
});

Deno.test("a deal with points but no saved amount still counts its commission", () => {
  const d = empty();
  d.deals = [deal("1", "2026-10-05", 50000, { commission_due: null, commission_points: 4 })];
  const b = buildDashboard(d, periodRange("month", NOW), { repSlug: null, now: NOW });
  assertEquals(b.northStar.expected.now, 2000);
  assertEquals(b.money.clawbackAmount, 2000);
});

Deno.test(
  "commission earned is paid minus clawed back; still to collect matches the Money tab",
  () => {
    const d = empty();
    d.ledger = [
      { deal_id: "1", kind: "owed", amount: 2500, entry_date: "2026-10-05" },
      { deal_id: "1", kind: "paid", amount: 2500, entry_date: "2026-10-10" },
      { deal_id: "2", kind: "owed", amount: 1000, entry_date: "2026-10-06" },
      { deal_id: "2", kind: "clawback", amount: 500, entry_date: "2026-10-12" },
    ];
    const b = buildDashboard(d, periodRange("month", NOW), { repSlug: null, now: NOW });
    assertEquals(b.northStar.earned.now, 2000);
    assertEquals(b.money.toCollect, 500);
    assertEquals(b.funnel.find((s) => s.key === "paid")!.count, 1);
  },
);

Deno.test("monthly bars cover the last 12 months, oldest first, ending this month", () => {
  const d = empty();
  d.deals = [
    deal("1", "2026-10-05", 50000),
    deal("2", "2025-11-30", 7000),
    deal("3", "2025-10-31", 9),
  ];
  const b = buildDashboard(d, periodRange("7d", NOW), { repSlug: null, now: NOW });
  assertEquals(b.monthly.length, 12);
  assertEquals(b.monthly[0]!.key, "2025-11");
  assertEquals(b.monthly[0]!.funded, 7000);
  assertEquals(b.monthly[11]!.key, "2026-10");
  assertEquals(b.monthly[11]!.deals, 1);
});

Deno.test("funnel counts distinct files at each step inside the period", () => {
  const d = empty();
  d.leads = [{ created_at: "2026-10-10T09:00:00", rep_slug: null }];
  d.files = [file("a"), file("b", { created_at: "2026-08-01T00:00:00" })];
  d.signed = [{ application_id: "a", signed_at: "2026-10-21T00:00:00" }];
  d.submissions = [
    { id: "s1", application_id: "a", funder_id: "f1", submitted_at: "2026-10-22T09:00:00" },
    { id: "s2", application_id: "a", funder_id: "f2", submitted_at: "2026-10-22T09:00:00" },
  ];
  const b = buildDashboard(d, periodRange("month", NOW), { repSlug: null, now: NOW });
  const at = (k: string) => b.funnel.find((s) => s.key === k)!.count;
  assertEquals([at("email"), at("file"), at("signed"), at("sent")], [1, 1, 1, 1]);
});

Deno.test("speed: median days between steps, from files that made both", () => {
  const d = empty();
  d.files = [
    file("a", { created_at: "2026-10-01T00:00:00" }),
    file("b", { created_at: "2026-10-01T00:00:00" }),
  ];
  d.submissions = [
    { id: "s1", application_id: "a", funder_id: "f1", submitted_at: "2026-10-03T00:00:00" },
    { id: "s2", application_id: "b", funder_id: "f1", submitted_at: "2026-10-05T00:00:00" },
  ];
  const b = buildDashboard(d, periodRange("all", NOW), { repSlug: null, now: NOW });
  // 1 Oct 2026 is a Thursday: a to Saturday the 3rd is 2 working days, b to Monday the 5th is 2
  assertEquals(b.speed[0], {
    label: "File started to sent to funders",
    medianDays: 3,
    medianBusinessDays: 2,
    n: 2,
    recent: { medianDays: 3, medianBusinessDays: 2, n: 2 },
  });
  assertEquals(b.speed[1]!.n, 0);
});

const offer = (application_id: string, created_at: string, accepted_at: string | null = null) => ({
  application_id,
  funder_id: "f1",
  submission_id: null,
  amount: 50_000,
  factor_rate: 1.3,
  created_at,
  accepted_at,
});
const row = (b: ReturnType<typeof buildDashboard>, label: string) =>
  b.speed.find((s) => s.label === label)!;

Deno.test("speed: a deal funded the same day as its first offer is counted", () => {
  const d = empty();
  d.files = [
    file("a", {
      status: "funded",
      created_at: "2026-10-19T09:00:00",
      funded_at: "2026-10-20T16:00:00",
    }),
  ];
  d.offers = [offer("a", "2026-10-20T10:00:00", "2026-10-20T13:00:00")];
  // the deal's funded_on is a bare date, midnight before the offer: it used to drop the file out
  d.deals = [deal("x", "2026-10-20", 50_000, { application_id: "a" })];
  const b = buildDashboard(d, periodRange("all", NOW), { repSlug: null, now: NOW });
  assertEquals(row(b, "First offer to funded").n, 1);
  assertEquals(row(b, "First offer to funded").medianDays, 0.3);
  assertEquals(row(b, "File started to funded").medianDays, 1.3);
});

Deno.test("speed: offer accepted to funded is a median over the first acceptance per file", () => {
  const d = empty();
  d.files = [
    file("a", { funded_at: "2026-10-21T12:00:00" }),
    file("b", { funded_at: "2026-10-23T12:00:00" }),
    file("c", { funded_at: "2026-10-26T12:00:00" }),
    file("open"), // accepted, not funded yet: not counted
  ];
  d.offers = [
    offer("a", "2026-10-19T10:00:00", "2026-10-20T12:00:00"), // 1 day
    offer("b", "2026-10-19T10:00:00", "2026-10-21T12:00:00"), // 2 days
    offer("b", "2026-10-19T11:00:00", "2026-10-22T12:00:00"), // a later acceptance: ignored
    offer("c", "2026-10-19T10:00:00", "2026-10-22T12:00:00"), // Thu to Mon: 4 days, 2 working
    offer("open", "2026-10-19T10:00:00", "2026-10-20T12:00:00"),
  ];
  const b = buildDashboard(d, periodRange("all", NOW), { repSlug: null, now: NOW });
  const r = row(b, "Offer accepted to funded");
  assertEquals([r.medianDays, r.medianBusinessDays, r.n], [2, 2, 3]);
});

Deno.test("business days skip the weekend, to a tenth of a day", () => {
  // 23 Oct 2026 is a Friday
  const t = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
  assertEquals(businessDays(t(23, 15), t(26, 9)), 0.8); // Fri 3 PM to Mon 9 AM: 9 h + 9 h
  assertEquals(businessDays(t(24, 10), t(25, 18)), 0); // all weekend
  assertEquals(businessDays(t(19, 9), t(26, 9)), 5); // a full week
  assertEquals(businessDays(t(26, 9), t(26, 9)), 0);
  assertEquals(businessDays(t(26, 9), t(23, 9)), 0); // backwards is nothing
});

Deno.test("speed: the 90-day figures leave out files whose later step is older", () => {
  const d = empty();
  d.files = [
    file("old", { created_at: "2026-06-01T09:00:00", funded_at: "2026-06-11T09:00:00" }), // 10 days
    file("new", { created_at: "2026-10-12T09:00:00", funded_at: "2026-10-14T09:00:00" }), // 2 days
  ];
  const b = buildDashboard(d, periodRange("all", NOW), { repSlug: null, now: NOW });
  const r = row(b, "File started to funded");
  assertEquals([r.n, r.medianDays], [2, 6]);
  assertEquals(r.recent, { medianDays: 2, medianBusinessDays: 2, n: 1 });
});

Deno.test(
  "stuck: open files with no movement for 3+ days, oldest first; finished files never",
  () => {
    const d = empty();
    d.files = [
      file("fresh", { last_activity_at: "2026-10-26T12:00:00" }),
      file("old", { last_activity_at: "2026-10-20T12:00:00" }),
      file("older", { status: "reviewing", updated_at: "2026-10-10T12:00:00" }),
      file("done", { status: "funded", updated_at: "2026-09-01T12:00:00" }),
    ];
    const b = buildDashboard(d, periodRange("7d", NOW), { repSlug: null, now: NOW });
    assertEquals(
      b.pipeline.stuck.map((s) => [s.id, s.idleDays]),
      [
        ["older", 17],
        ["old", 7],
      ],
    );
    assertEquals(b.pipeline.open, 3);
    assertEquals(b.pipeline.byStage.find((s) => s.stage === "new")!.count, 2);
  },
);

Deno.test("a rep sees only their own leads, engine leads, links and touches", () => {
  const d = empty();
  d.leads = [
    { created_at: "2026-10-26T00:00:00", rep_slug: "stevie" },
    { created_at: "2026-10-26T00:00:00", rep_slug: "zeus" },
  ];
  d.engine = [
    {
      id: "e1",
      source: "ucc",
      tier: "A",
      rep_slug: "stevie",
      first_found: "2026-10-25",
      worked_at: null,
      has_phone: true,
    },
    {
      id: "e2",
      source: "ucc",
      tier: "A",
      rep_slug: "zeus",
      first_found: "2026-10-25",
      worked_at: null,
      has_phone: true,
    },
  ];
  d.events = [
    { kind: "call", actor_user_id: "u-stevie", occurred_at: "2026-10-26T10:00:00" },
    { kind: "call", actor_user_id: "u-other", occurred_at: "2026-10-26T10:00:00" },
    { kind: "stage_change", actor_user_id: "u-stevie", occurred_at: "2026-10-26T10:00:00" },
  ];
  const b = buildDashboard(d, periodRange("7d", NOW), { repSlug: "stevie", now: NOW });
  assertEquals(b.funnel[0]!.count, 1);
  assertEquals(b.engine.total, 1);
  assertEquals(
    b.reps.map((r) => [r.slug, r.touches]),
    [["stevie", 1]],
  );
});

Deno.test("funders: offer rate, hours to offer, average factor and what they funded", () => {
  const d = empty();
  d.submissions = [
    { id: "s1", application_id: "a", funder_id: "f1", submitted_at: "2026-10-21T10:00:00" },
    { id: "s2", application_id: "b", funder_id: "f1", submitted_at: "2026-10-21T10:00:00" },
  ];
  d.offers = [
    {
      application_id: "a",
      funder_id: "f1",
      submission_id: "s1",
      amount: 40000,
      factor_rate: 1.3,
      created_at: "2026-10-21T16:00:00",
      accepted_at: null,
    },
  ];
  d.deals = [deal("1", "2026-10-22", 40000, { application_id: "a" })];
  const b = buildDashboard(d, periodRange("7d", NOW), { repSlug: null, now: NOW });
  assertEquals(b.funders.length, 1);
  const f = b.funders[0]!;
  assertEquals([f.name, f.sent, f.offers, f.offerRate, f.medianHours], ["Alpha", 2, 1, 0.5, 6]);
  assertEquals([f.avgAmount, f.avgFactor, f.funded, f.fundedAmount], [40000, 1.3, 1, 40000]);
});

Deno.test("lead engine: by source, how many applied through a sent link", () => {
  const d = empty();
  d.engine = [
    {
      id: "e1",
      source: "ucc",
      tier: "A",
      rep_slug: null,
      first_found: "2026-10-25",
      worked_at: "2026-10-26T00:00:00",
      has_phone: true,
    },
    {
      id: "e2",
      source: "permits",
      tier: "B",
      rep_slug: null,
      first_found: "2026-01-01",
      worked_at: null,
      has_phone: false,
    },
  ];
  d.invites = [
    {
      rep_slug: "stevie",
      sent_at: "2026-10-25T00:00:00",
      opened_at: null,
      started_at: null,
      submitted_at: "2026-10-26T00:00:00",
      last_error: null,
      created_at: "2026-10-25T00:00:00",
      engine_lead_id: "e1",
    },
  ];
  const b = buildDashboard(d, periodRange("7d", NOW), { repSlug: null, now: NOW });
  assertEquals(
    [b.engine.total, b.engine.withPhone, b.engine.newInPeriod, b.engine.workedInPeriod],
    [2, 1, 1, 1],
  );
  assertEquals(b.engine.bySource.find((s) => s.source === "ucc")!.applied, 1);
  assertEquals(b.reps[0]!.signed, 1);
});

Deno.test("a team lead's own numbers leave out the team's files, submissions and offers", () => {
  const d = empty();
  // the database hands a lead their own files, the unassigned pool and the team's
  d.files = [
    file("mine", { rep_slug: "zeus" }),
    file("pool", { rep_slug: null }),
    file("team1", { rep_slug: "darrell" }),
    file("team2", { rep_slug: "micheal" }),
  ];
  d.submissions = [
    { id: "s1", application_id: "mine", funder_id: "f1", submitted_at: "2026-10-21T10:00:00" },
    { id: "s2", application_id: "team1", funder_id: "f1", submitted_at: "2026-10-21T10:00:00" },
  ];
  const lead = buildDashboard(d, periodRange("all", NOW), { repSlug: "zeus", now: NOW });
  assertEquals(lead.pipeline.open, 2);
  // an admin (no rep scope) still counts every file
  const admin = buildDashboard(d, periodRange("all", NOW), { repSlug: null, now: NOW });
  assertEquals(admin.pipeline.open, 4);
  // a rep with no team gets what they always got: the rows are already only theirs and the pool
  d.files = [file("mine", { rep_slug: "zeus" }), file("pool", { rep_slug: null })];
  const rep = buildDashboard(d, periodRange("all", NOW), { repSlug: "zeus", now: NOW });
  assertEquals(rep.pipeline.open, 2);
});
