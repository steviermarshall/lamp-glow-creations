// deno test --node-modules-dir=none tests/calendar.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type CalInput,
  type CalItem,
  type Desired,
  type Existing,
  RULES,
  businessDay,
  isOverdue,
  itemView,
  moveTo,
  newestReply,
  nyAt,
  nyDay,
  planCalendar,
  reconcile,
  weekOf,
} from "../src/lib/calendar.ts";

// Monday 2026-11-16, 10:00 New York (15:00 UTC)
const NOW = new Date("2026-11-16T15:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const REP = "user-rep";
const ADMIN = "user-admin";
const empty = (over: Partial<CalInput> = {}): CalInput => ({
  seats: [
    { slug: "zeus", user_id: REP, active: true },
    { slug: "gone", user_id: "user-gone", active: false },
  ],
  admins: [ADMIN],
  files: [],
  calls: [],
  leads: [],
  engineLeads: [],
  invites: [],
  offers: [],
  submissions: [],
  docRequests: [],
  outbox: [],
  loaded: [...RULES],
  ...over,
});
const file = (id: string, status = "submitted", rep: string | null = "zeus") => ({
  id,
  status,
  rep_slug: rep,
  business_name: `Biz ${id}`,
  first_name: null,
});
const invite = (over: Partial<CalInput["invites"][number]> = {}) => ({
  id: "inv1",
  rep_slug: "zeus",
  business_name: "Corner Deli",
  first_name: null,
  last_name: null,
  sent_at: ago(24),
  opened_at: null,
  started_at: null,
  draft_saved_at: null,
  submitted_at: null,
  cancelled_at: null,
  expires_at: ahead(24 * 20),
  application_id: null,
  ...over,
});
const only = (input: CalInput) => {
  const out = planCalendar(input, NOW);
  assertEquals(out.length, 1, JSON.stringify(out, null, 1));
  return out[0]!;
};

// ---------- New York days ----------

Deno.test("New York time: 9:00 on a winter and a summer day", () => {
  assertEquals(new Date(nyAt("2026-11-16", 9)).toISOString(), "2026-11-16T14:00:00.000Z");
  assertEquals(new Date(nyAt("2026-07-01", 9)).toISOString(), "2026-07-01T13:00:00.000Z");
  // 11pm New York on the 16th is already the 17th in UTC, still the 16th here
  assertEquals(nyDay(Date.parse("2026-11-17T03:30:00Z")), "2026-11-16");
});

Deno.test("business days skip the weekend", () => {
  const fri = Date.parse("2026-11-13T17:00:00Z");
  assertEquals(businessDay(fri, 1), "2026-11-16"); // Friday + 1 = Monday
  assertEquals(businessDay(fri, 2), "2026-11-17");
  const sat = Date.parse("2026-11-14T17:00:00Z");
  assertEquals(businessDay(sat, 0), "2026-11-16");
  assertEquals(businessDay(sat, 1), "2026-11-17");
});

Deno.test("a week starts Monday; a moved item keeps its time of day", () => {
  assertEquals(weekOf("2026-11-18")[0], "2026-11-16");
  assertEquals(weekOf("2026-11-22")[6], "2026-11-22");
  assertEquals(moveTo("2026-11-16T14:00:00.000Z", "2026-11-20"), "2026-11-20T14:00:00.000Z");
});

// ---------- each rule ----------

Deno.test("nothing recorded, nothing scheduled", () => {
  assertEquals(planCalendar(empty(), NOW), []);
});

Deno.test("an assigned call lands on its due date for the rep it was assigned to", () => {
  const d = only(
    empty({
      files: [file("f1")],
      calls: [
        {
          id: 7,
          application_id: "f1",
          lead_id: null,
          assigned_to: "zeus",
          due_on: "2026-11-18",
          body: "Ask about the March statements",
          author_name: "Stevie",
          created_at: ago(5),
        },
      ],
    }),
  );
  assertEquals(d.rule, "assigned_call");
  assertEquals(d.owner, REP);
  assertEquals(d.source_key, "call:7");
  assertEquals(d.due_at, new Date(nyAt("2026-11-18", 9)).toISOString());
  assertEquals(d.link, "/staff?file=f1");
  assert(d.why.includes("Stevie asked you to call by Wed, Nov 18"));
  assert(d.why.includes("March statements"));
});

Deno.test("an assigned call with no date sits on the day it was assigned and says so", () => {
  const d = only(
    empty({
      leads: [{ id: "l1", name: "Ana Ruiz", rep_slug: "zeus" }],
      calls: [
        {
          id: 8,
          application_id: null,
          lead_id: "l1",
          assigned_to: "zeus",
          due_on: null,
          body: "Call her",
          author_name: null,
          created_at: "2026-11-13T15:00:00Z",
        },
      ],
    }),
  );
  assertEquals(d.title, "Call Ana Ruiz");
  assertEquals(d.link, "/staff?lead=l1");
  assertEquals(nyDay(Date.parse(d.due_at)), "2026-11-13");
  assert(d.why.includes("no date was set"));
});

Deno.test("an assigned call on a closed file makes nothing", () => {
  const out = planCalendar(
    empty({
      files: [file("f1", "funded")],
      calls: [
        {
          id: 9,
          application_id: "f1",
          lead_id: null,
          assigned_to: "zeus",
          due_on: null,
          body: "x",
          author_name: null,
          created_at: ago(1),
        },
      ],
    }),
    NOW,
  );
  assertEquals(out, []);
});

Deno.test("an unopened link is due two business days after it went out", () => {
  const d = only(empty({ invites: [invite({ sent_at: "2026-11-13T16:00:00Z" })] }));
  assertEquals(d.rule, "link_unopened");
  assertEquals(nyDay(Date.parse(d.due_at)), "2026-11-17"); // Fri + 2 business days = Tue
  assertEquals(d.source_key, "link:inv1:unopened");
  assertEquals(d.owner, REP);
});

Deno.test("a link moves through opened and started, each with its own key", () => {
  const opened = only(empty({ invites: [invite({ opened_at: ago(20) })] }));
  assertEquals(opened.rule, "link_unstarted");
  assertEquals(opened.source_key, "link:inv1:unstarted");
  const started = only(
    empty({
      invites: [invite({ opened_at: ago(20), started_at: ago(10), draft_saved_at: ago(2) })],
    }),
  );
  assertEquals(started.rule, "link_unfinished");
  // a day after the last saved step (Monday morning) is Tuesday
  assertEquals(nyDay(Date.parse(started.due_at)), "2026-11-17");
});

Deno.test("a link that was filed, cancelled, submitted or ran out makes nothing", () => {
  for (const over of [
    { application_id: "f1" },
    { cancelled_at: ago(1) },
    { submitted_at: ago(1) },
    { expires_at: ago(1) },
    { sent_at: null },
  ])
    assertEquals(planCalendar(empty({ invites: [invite(over)] }), NOW), [], JSON.stringify(over));
});

Deno.test("an offer with an expiry is due a day before it runs out", () => {
  const d = only(
    empty({
      files: [file("f1", "offers_ready")],
      offers: [
        {
          id: "o1",
          application_id: "f1",
          status: "presented",
          presented_at: ago(30),
          expires_at: ahead(48),
          funder: "Acme Capital",
        },
      ],
    }),
  );
  assertEquals(d.rule, "offer_waiting");
  assertEquals(d.due_at, ahead(24));
  assertEquals(d.all_day, false);
  assert(d.why.includes("from Acme Capital"));
});

Deno.test("an offer with no expiry is due three business days after it was presented", () => {
  const d = only(
    empty({
      files: [file("f1", "offers_ready")],
      offers: [
        {
          id: "o1",
          application_id: "f1",
          status: "presented",
          presented_at: "2026-11-13T15:00:00Z",
          expires_at: null,
          funder: null,
        },
      ],
    }),
  );
  assertEquals(nyDay(Date.parse(d.due_at)), "2026-11-18");
  assertEquals(d.all_day, true);
});

Deno.test("an offer that is answered, expired or on a closed file makes nothing", () => {
  const offer = {
    id: "o1",
    application_id: "f1",
    status: "presented",
    presented_at: ago(30),
    expires_at: ahead(48),
    funder: null,
  };
  for (const [f, o] of [
    [file("f1", "offers_ready"), { ...offer, status: "accepted" }],
    [file("f1", "offers_ready"), { ...offer, expires_at: ago(1) }],
    [file("f1", "declined"), offer],
  ] as const)
    assertEquals(planCalendar(empty({ files: [f], offers: [o] }), NOW), []);
});

Deno.test("a funder with no answer goes to whoever sent the package", () => {
  const sub = {
    id: "s1",
    application_id: "f1",
    status: "submitted",
    submitted_at: "2026-11-12T15:00:00Z",
    decided_at: null,
    submitted_by: ADMIN,
    funder: "Acme Capital",
  };
  const d = only(empty({ files: [file("f1")], submissions: [sub] }));
  assertEquals(d.rule, "funder_silent");
  assertEquals(d.owner, ADMIN);
  assertEquals(nyDay(Date.parse(d.due_at)), "2026-11-16"); // Thu + 2 = Mon
  // sent by someone no longer on staff: the file's rep
  assertEquals(
    only(empty({ files: [file("f1")], submissions: [{ ...sub, submitted_by: "x" }] })).owner,
    REP,
  );
  assertEquals(
    planCalendar(
      empty({ files: [file("f1")], submissions: [{ ...sub, decided_at: ago(1) }] }),
      NOW,
    ),
    [],
  );
});

Deno.test("a documents request with nothing uploaded is chased; one that got files is not", () => {
  const req = {
    id: "r1",
    application_id: "f1",
    title: "Bank statements",
    created_at: ago(30),
    expires_at: ahead(200),
    closed_at: null,
    received: 0,
  };
  const d = only(empty({ files: [file("f1", "docs_needed")], docRequests: [req] }));
  assertEquals(d.rule, "docs_missing");
  assert(d.why.includes('"Bank statements"'));
  assertEquals(
    planCalendar(
      empty({ files: [file("f1", "docs_needed")], docRequests: [{ ...req, received: 2 }] }),
      NOW,
    ),
    [],
  );
});

Deno.test("Callback and No answer go on the next business day, keyed by when they were set", () => {
  const lead = {
    id: 42,
    source: "fl_ucc",
    name: "Tampa Tile",
    status: "callback",
    rep_slug: "zeus",
    worked_at: "2026-11-13T20:00:00Z",
    pushed_at: null,
    signals: [],
  };
  const cb = only(empty({ engineLeads: [lead] }));
  assertEquals(cb.rule, "lead_callback");
  assertEquals(nyDay(Date.parse(cb.due_at)), "2026-11-16");
  assertEquals(cb.source_key, "callback:42:2026-11-13T20:00:00Z");
  // the portal doesn't record the day they asked for: the item says so instead of guessing
  assert(cb.why.includes("doesn't record the day they asked for"));
  const na = only(empty({ engineLeads: [{ ...lead, status: "no_answer" }] }));
  assertEquals(na.rule, "lead_no_answer");
  // too long ago, or nobody's lead: nothing
  assertEquals(
    planCalendar(empty({ engineLeads: [{ ...lead, worked_at: ago(24 * 40) }] }), NOW),
    [],
  );
  assertEquals(planCalendar(empty({ engineLeads: [{ ...lead, rep_slug: null }] }), NOW), []);
  assertEquals(planCalendar(empty({ engineLeads: [{ ...lead, status: "called" }] }), NOW), []);
});

Deno.test(
  "an email reply is due when it came in; an opt-out or a worked lead makes nothing",
  () => {
    const signals = [
      { signal_type: "email_reply", signal_date: "2026-11-15T13:00:00", message_id: "m1" },
      { signal_type: "email_reply", signal_date: "2026-11-16T09:30:00", message_id: "m2" },
    ];
    const lead = {
      id: 5,
      source: "email-reply",
      name: "Bay Auto",
      status: "new",
      rep_slug: null,
      worked_at: null,
      pushed_at: ago(1),
      signals,
    };
    const d = only(empty({ engineLeads: [lead] }));
    assertEquals(d.rule, "email_reply");
    assertEquals(d.source_key, "reply:5:m2");
    assertEquals(d.owner, null); // nobody's lead: the admins' Unassigned lane
    assertEquals(d.link, "/staff?view=replies");
    const optout = [
      ...signals,
      { signal_type: "email_optout", signal_date: "2026-11-16T10:00:00", message_id: "m3" },
    ];
    assertEquals(planCalendar(empty({ engineLeads: [{ ...lead, signals: optout }] }), NOW), []);
    assertEquals(planCalendar(empty({ engineLeads: [{ ...lead, status: "called" }] }), NOW), []);
    assertEquals(newestReply("nope"), null);
  },
);

Deno.test("the engine's waiting emails make one item per admin, at 8:30", () => {
  const out = planCalendar(
    empty({
      admins: [ADMIN, "user-admin-2"],
      outbox: [
        { batch_date: "2026-11-16", pending: 23 },
        { batch_date: "2026-11-16", pending: 0 },
        { batch_date: "2026-10-01", pending: 5 }, // too old
      ],
    }),
    NOW,
  );
  assertEquals(out.length, 2);
  assertEquals(out[0]!.rule, "emails_to_approve");
  assertEquals(out[0]!.due_at, new Date(nyAt("2026-11-16", 8, 30)).toISOString());
  assert(out[0]!.why.startsWith("23 emails for Mon, Nov 16 wait for an admin"));
  assertEquals(out[0]!.link, "/staff?view=autopilot");
  assertEquals(new Set(out.map((x) => x.owner)), new Set([ADMIN, "user-admin-2"]));
});

Deno.test("an inactive rep's records have no owner (admins see them as Unassigned)", () => {
  const d = only(empty({ invites: [invite({ rep_slug: "gone" })] }));
  assertEquals(d.owner, null);
});

Deno.test("no item ever says loan", () => {
  const input = empty({
    files: [file("f1", "offers_ready")],
    invites: [invite()],
    offers: [
      {
        id: "o1",
        application_id: "f1",
        status: "presented",
        presented_at: ago(1),
        expires_at: null,
        funder: null,
      },
    ],
  });
  for (const d of planCalendar(input, NOW)) assert(!/\bloans?\b/i.test(d.title + d.why));
});

// ---------- matching the table ----------

const desired = (
  key: string,
  owner: string | null = REP,
  over: Partial<Desired> = {},
): Desired => ({
  rule: "link_unopened",
  source_key: key,
  owner,
  rep_slug: "zeus",
  title: "Follow up",
  why: "Why",
  link: "/staff?view=sent",
  due_at: ahead(5),
  all_day: true,
  application_id: null,
  lead_id: null,
  engine_lead_id: null,
  invite_id: "inv1",
  ...over,
});
const row = (key: string, over: Partial<Existing> = {}): Existing => ({
  id: `id-${key}`,
  source_key: key,
  rule: "link_unopened",
  owner: REP,
  status: "open",
  title: "Follow up",
  why: "Why",
  link: "/staff?view=sent",
  rep_slug: "zeus",
  ...over,
});
const rep = { isAdmin: false, userId: REP };
const admin = { isAdmin: true, userId: ADMIN };

Deno.test(
  "reconcile adds new items with their first due time, and running it twice adds nothing",
  () => {
    const p = reconcile([], [desired("a")], rep, [...RULES], NOW);
    assertEquals(p.insert.length, 1);
    assertEquals(p.insert[0]!.scheduled_at, p.insert[0]!.due_at);
    const again = reconcile([row("a")], [desired("a")], rep, [...RULES], NOW);
    assertEquals(again, { insert: [], update: [] });
  },
);

Deno.test(
  "reconcile never touches a due time, follows new words and owner, leaves done items alone",
  () => {
    const p = reconcile(
      [row("a"), row("b", { status: "done" })],
      [
        desired("a", REP, { why: "New why", due_at: ahead(99) }),
        desired("b", REP, { why: "Changed" }),
      ],
      rep,
      [...RULES],
      NOW,
    );
    assertEquals(p.insert, []);
    assertEquals(p.update, [{ id: "id-a", patch: { why: "New why" } }]);
  },
);

Deno.test(
  "reconcile clears an item whose reason passed, and reopens it if the reason comes back",
  () => {
    const cleared = reconcile([row("a")], [], rep, [...RULES], NOW);
    assertEquals(cleared.update, [
      { id: "id-a", patch: { status: "cleared", cleared_at: NOW.toISOString() } },
    ]);
    const back = reconcile([row("a", { status: "cleared" })], [desired("a")], rep, [...RULES], NOW);
    assertEquals(back.update, [{ id: "id-a", patch: { status: "open", cleared_at: null } }]);
  },
);

Deno.test("reconcile never clears an item of a rule whose records couldn't be read", () => {
  const p = reconcile([row("a")], [], rep, ["offer_waiting"], NOW);
  assertEquals(p.update, []);
});

Deno.test("a rep's run touches only their own items; an admin's run covers everyone", () => {
  const someone = row("x", { owner: "user-other" });
  assertEquals(reconcile([someone], [], rep, [...RULES], NOW).update, []);
  assertEquals(reconcile([], [desired("y", "user-other")], rep, [...RULES], NOW).insert, []);
  assertEquals(reconcile([someone], [], admin, [...RULES], NOW).update.length, 1);
  // a file handed to another rep: the item follows it
  const moved = reconcile([row("a")], [desired("a", "user-other")], admin, [...RULES], NOW);
  assertEquals(moved.update, [{ id: "id-a", patch: { owner: "user-other" } }]);
});

// ---------- the card ----------

const item = (over: Partial<CalItem> = {}): CalItem => ({
  id: "i1",
  owner: REP,
  rule: "offer_waiting",
  title: "Get an answer",
  why: "The offer has no answer.",
  link: "/staff?file=f1",
  rep_slug: "zeus",
  due_at: new Date(nyAt("2026-11-16", 9)).toISOString(),
  all_day: true,
  scheduled_at: new Date(nyAt("2026-11-16", 9)).toISOString(),
  status: "open",
  done_at: null,
  cleared_at: null,
  ...over,
});

Deno.test("overdue: an all-day item from an earlier day, a timed one whose time passed", () => {
  assertEquals(isOverdue(item(), NOW), false); // today, all day
  assertEquals(isOverdue(item({ due_at: "2026-11-13T14:00:00Z" }), NOW), true);
  assertEquals(isOverdue(item({ all_day: false, due_at: ago(1) }), NOW), true);
  assertEquals(isOverdue(item({ all_day: false, due_at: ahead(1) }), NOW), false);
  assertEquals(isOverdue(item({ due_at: "2026-11-13T14:00:00Z", status: "done" }), NOW), false);
});

Deno.test("the card: one main button while open, none once done or cleared", () => {
  const open = itemView(item(), NOW);
  assertEquals([open.tone, open.pill, open.primary?.label], ["ready", "Today", "Mark done"]);
  const late = itemView(item({ due_at: "2026-11-13T14:00:00Z" }), NOW);
  assertEquals([late.tone, late.pill], ["attention", "Overdue"]);
  assertEquals(itemView(item(), NOW, { busy: true }).tone, "working");
  assertEquals(itemView(item(), NOW, { error: "no" }).pill, "Not saved");
  const done = itemView(item({ status: "done" }), NOW);
  assertEquals(
    [done.tone, done.primary, done.canReopen, done.canMove],
    ["done", null, true, false],
  );
  const gone = itemView(item({ status: "cleared" }), NOW);
  assertEquals([gone.primary, gone.canReopen], [null, false]);
  assert(gone.next.includes("the offer was answered"));
  assert(
    itemView(item({ due_at: ahead(48), scheduled_at: ahead(1) }), NOW).subtitle.endsWith("· moved"),
  );
});
