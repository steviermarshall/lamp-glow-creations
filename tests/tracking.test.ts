// deno test --node-modules-dir=none tests/tracking.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import actionsSql from "../supabase/migrations/20261127120000_site_event_actions.sql" with { type: "text" };
import {
  applicationLinkOf,
  browserOf,
  buildActivity,
  buildOfferCheck,
  buildWebsite,
  countsAsCalculated,
  deviceOf,
  flowOf,
  isBot,
  RESERVED_SLUGS,
  SITE_ACTIONS,
  signedPath,
  siteEventFields,
  sourceOf,
  text,
  type ActivityRow,
  type SiteEventRow,
} from "../src/lib/tracking.ts";

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const span = (from: string, to: string, prev?: [string, string]) => ({
  from: new Date(from),
  to: new Date(to),
  prev: prev ? { from: new Date(prev[0]), to: new Date(prev[1]) } : null,
});

const ev = (over: Partial<SiteEventRow>): SiteEventRow => ({
  occurred_at: "2026-10-20T12:00:00Z",
  visitor: "v1",
  kind: "page_view",
  path: "/",
  step: null,
  question: null,
  referrer_host: null,
  utm_source: null,
  device: "desktop",
  country: "US",
  region: "New Jersey",
  city: "Newark",
  ...over,
});

const act = (over: Partial<ActivityRow>): ActivityRow => ({
  occurred_at: "2026-10-20T12:00:00Z",
  user_id: "u1",
  email: "partners@getlamp.app",
  action: "sign_in",
  application_id: null,
  detail: null,
  ip: "203.0.113.5",
  country: "US",
  region: "New Jersey",
  city: "Newark",
  device: "desktop",
  browser: "Chrome on Mac",
  ...over,
});

Deno.test("device, browser and bots from the user agent", () => {
  assertEquals([deviceOf(MAC_CHROME), browserOf(MAC_CHROME)], ["desktop", "Chrome on Mac"]);
  assertEquals([deviceOf(IPHONE_SAFARI), browserOf(IPHONE_SAFARI)], ["mobile", "Safari on iPhone"]);
  assertEquals(isBot("Googlebot/2.1"), true);
  assertEquals(isBot(MAC_CHROME), false);
});

Deno.test("text: trimmed, capped, control characters out, non-strings null", () => {
  assertEquals(text("  hi\u0000there  ", 20), "hi there");
  assertEquals(text("abcdef", 3), "abc");
  assertEquals(text(5, 3), null);
  assertEquals(text("   ", 3), null);
});

Deno.test("sources: campaign first, then search, social, our own site as direct", () => {
  assertEquals(sourceOf({ utm_source: "ig", referrer_host: null }), "Instagram");
  assertEquals(sourceOf({ utm_source: null, referrer_host: "www.google.com" }), "Google");
  assertEquals(sourceOf({ utm_source: null, referrer_host: "getlamp.app" }), "Direct");
  assertEquals(sourceOf({ utm_source: null, referrer_host: null }), "Direct");
  assertEquals(sourceOf({ utm_source: null, referrer_host: "l.instagram.com" }), "Instagram");
  assertEquals(
    sourceOf({ utm_source: null, referrer_host: "news.example.com" }),
    "news.example.com",
  );
});

Deno.test("website: views and visitors against the period before, sources by first visit", () => {
  const rows = [
    ev({ visitor: "a", referrer_host: "www.google.com" }),
    ev({ visitor: "a", path: "/apply", occurred_at: "2026-10-20T12:05:00Z" }),
    ev({ visitor: "b", utm_source: "ig", device: "mobile" }),
    ev({ visitor: "c", occurred_at: "2026-10-10T12:00:00Z" }), // the span before
  ];
  const w = buildWebsite(rows, span("2026-10-15", "2026-10-22", ["2026-10-08", "2026-10-15"]));
  assertEquals(w.views, { now: 3, prev: 1 });
  assertEquals(w.visitors, { now: 2, prev: 1 });
  assertEquals(w.sources, [
    { key: "Google", count: 1 },
    { key: "Instagram", count: 1 },
  ]);
  assertEquals(w.pages[0], { key: "/", count: 2 });
  assertEquals(w.places[0], { key: "Newark, New Jersey, US", count: 2 });
});

Deno.test("website: /apply counts each visitor once, at the furthest step they reached", () => {
  const step = (visitor: string, s: number, q: string) =>
    ev({ visitor, kind: "apply_step", path: "/apply", step: s, question: q });
  const rows = [
    step("a", 0, "amount"),
    step("a", 1, "purpose"),
    step("a", 2, "contact"),
    step("b", 0, "amount"),
    step("b", 0, "amount"), // came back to the same question
    step("c", 0, "amount"),
    step("c", 1, "purpose"),
  ];
  const w = buildWebsite(rows, span("2026-10-15", "2026-10-22"));
  assertEquals(
    w.apply.map((s) => [s.question, s.visitors]),
    [
      ["amount", 3],
      ["purpose", 2],
      ["contact", 1],
    ],
  );
});

Deno.test("sign-ins: newest first, a new place or browser flagged, never the first one", () => {
  const rows = [
    act({ occurred_at: "2026-10-01T12:00:00Z" }), // first ever: not flagged, outside the span
    act({ occurred_at: "2026-10-20T09:00:00Z" }), // same place and browser
    act({ occurred_at: "2026-10-21T09:00:00Z", city: "Miami", region: "Florida" }),
    act({ occurred_at: "2026-10-21T10:00:00Z", browser: "Safari on iPhone" }),
    act({ occurred_at: "2026-10-21T11:00:00Z", action: "open_file", application_id: "f1" }),
    act({ occurred_at: "2026-10-20T08:00:00Z", user_id: "u2", email: "marshall@getlamp.app" }),
  ];
  const a = buildActivity(rows, span("2026-10-15", "2026-10-22"));
  assertEquals(
    a.signIns.map((s) => [s.occurred_at.slice(5, 13), s.newPlace, s.newBrowser]),
    [
      ["10-21T10", false, true],
      ["10-21T09", true, false],
      ["10-20T09", false, false],
      ["10-20T08", false, false],
    ],
  );
  assertEquals(a.flagged, 2);
  assertEquals(
    a.recent.map((r) => r.action),
    ["open_file"],
  );
  assertEquals(a.byPerson.find((p) => p.email === "partners@getlamp.app")!.counts, {
    sign_in: 3,
    open_file: 1,
  });
});

// ---------- signed files, application links, split drop-off, Offer Check actions ----------

const VISITOR = "0f0e0d0c-0b0a-4908-8706-050403020100";

Deno.test("recordSigned's path: the website's file (no rep) is /application/signed", () => {
  assertEquals(signedPath(null, false), "/application/signed");
  assertEquals(signedPath(undefined, false), "/application/signed");
  assertEquals(signedPath("", false), "/application/signed");
  // the website has no paper form, so there is no /application/pdf/signed
  assertEquals(signedPath(null, true), "/application/signed");
  assertEquals(signedPath("stevie", false), "/application/stevie/signed");
  assertEquals(signedPath("stevie", true), "/application/stevie/pdf/signed");
  // not a rep slug, or one of the reserved words: nothing is written
  assertEquals(signedPath("Not A Slug", false), null);
  assertEquals(signedPath("null", false), null);
  assertEquals(signedPath("pdf", false), null);
  assertEquals(signedPath(5 as unknown as string, false), null);
});

Deno.test("application paths: opens and signed files, by link", () => {
  assertEquals(applicationLinkOf("/application"), {
    link: "/application",
    rep: null,
    paper: false,
    signed: false,
  });
  assertEquals(applicationLinkOf("/application/signed")?.signed, true);
  assertEquals(applicationLinkOf("/application/signed")?.rep, null);
  // old website rows, before the migration relabels them
  assertEquals(applicationLinkOf("/application/null/signed")?.link, "/application");
  assertEquals(applicationLinkOf("/application/stevie/pdf/signed"), {
    link: "/application/stevie/pdf",
    rep: "stevie",
    paper: true,
    signed: true,
  });
  assertEquals(applicationLinkOf("/application/pdf"), null);
  assertEquals(applicationLinkOf("/offer-check"), null);
});

Deno.test("application links: unique openers, signed files and the rate, website first", () => {
  const view = (visitor: string, path: string) => ev({ visitor, path });
  const rows = [
    view("a", "/application"),
    view("a", "/application"), // a reload is still one opener
    view("b", "/application"),
    view("c", "/application"),
    view("d", "/application"),
    view("s1", "/application/signed"),
    view("e", "/application/stevie"),
    view("f", "/application/stevie"),
    view("s2", "/application/stevie/signed"),
    view("s3", "/application/stevie/signed"),
    view("g", "/application/zeus/pdf"),
    view("h", "/"), // not an application page
  ];
  const w = buildWebsite(rows, span("2026-10-15", "2026-10-22"));
  assertEquals(
    w.links.map((l) => [l.link, l.opened, l.signed, l.rate]),
    [
      ["/application", 4, 1, 0.25],
      ["/application/stevie", 2, 2, 1],
      ["/application/zeus/pdf", 1, 0, 0],
    ],
  );
});

Deno.test("website: the drop-off is split into the website's application and reps' links", () => {
  const step = (visitor: string, path: string, s: number, q: string) =>
    ev({ visitor, kind: "apply_step", path, step: s, question: q });
  const rows = [
    step("a", "/application", 0, "amount"),
    step("a", "/application", 1, "purpose"),
    step("b", "/application", 0, "amount"),
    step("c", "/application/stevie", 0, "amount"),
    step("c", "/application/stevie", 1, "purpose"),
    step("c", "/application/stevie", 2, "revenue"),
    step("d", "/apply/zeus", 0, "amount"), // the old rep page
  ];
  const w = buildWebsite(rows, span("2026-10-15", "2026-10-22"));
  const pairs = (xs: { question: string; visitors: number }[]) =>
    xs.map((x) => [x.question, x.visitors]);
  assertEquals(pairs(w.funnels.website), [
    ["amount", 2],
    ["purpose", 1],
  ]);
  assertEquals(pairs(w.funnels.reps), [
    ["amount", 2],
    ["purpose", 1],
    ["revenue", 1],
  ]);
  // everyone together, as before
  assertEquals(pairs(w.apply), [
    ["amount", 4],
    ["purpose", 2],
    ["revenue", 1],
  ]);
  assertEquals(
    [flowOf("/application/"), flowOf("/apply"), flowOf("/application/x")],
    ["website", "website", "reps"],
  );
});

Deno.test("track: an action outside the fixed list is dropped", () => {
  const base = { visitor: VISITOR, kind: "action", path: "/offer-check" };
  assertEquals(siteEventFields({ ...base, question: "oc_saved" })?.question, "oc_saved");
  assertEquals(siteEventFields({ ...base, question: "oc_amount_50000" }), null);
  assertEquals(siteEventFields({ ...base, question: "50000" }), null);
  assertEquals(siteEventFields({ ...base }), null);
  assertEquals(siteEventFields({ ...base, kind: "purchase", question: "oc_saved" }), null);
  assertEquals(siteEventFields({ ...base, path: "/staff", question: "oc_saved" }), null);
});

Deno.test("track: an action carries no number, whatever the browser sends", () => {
  const f = siteEventFields({
    visitor: VISITOR,
    kind: "action",
    path: "/offer-check",
    question: "oc_calculated",
    step: 7,
    amount: 50_000,
    factor: 1.35,
  })!;
  assertEquals(f.step, null);
  assertEquals(
    Object.values(f).some((v) => typeof v === "number"),
    false,
  );
  assertEquals("amount" in f || "factor" in f, false);
  // an /apply step still keeps its number
  assertEquals(
    siteEventFields({ visitor: VISITOR, kind: "apply_step", path: "/application", step: 3 })?.step,
    3,
  );
});

Deno.test("Offer Check: people who did each thing, and the leads it brought", () => {
  const act = (visitor: string, question: string) =>
    ev({ visitor, kind: "action", path: "/offer-check", question });
  const rows = [
    ev({ visitor: "a", path: "/offer-check" }),
    ev({ visitor: "a", path: "/offer-check" }),
    ev({ visitor: "b", path: "/offer-check" }),
    ev({ visitor: "c", path: "/offer-check" }),
    act("a", "oc_calculated"),
    act("b", "oc_calculated"),
    act("a", "oc_saved"),
    act("a", "oc_saved"), // saved twice: one person
    act("a", "oc_shared"),
    act("a", "oc_second_offer"),
    act("z", "oc_second_offer"),
    act("old", "oc_calculated"),
  ];
  rows[rows.length - 1]!.occurred_at = "2026-09-01T12:00:00Z"; // before the period
  const leads = [
    { created_at: "2026-10-20T12:00:00Z", utm: { utm_source: "ig", utm_content: "offer-check" } },
    { created_at: "2026-10-20T12:00:00Z", utm: { utm_source: "offer-check" } },
    { created_at: "2026-10-20T12:00:00Z", utm: { utm_source: "website" } },
    { created_at: "2026-09-01T12:00:00Z", utm: { utm_content: "offer-check" } },
  ];
  assertEquals(buildOfferCheck(rows, leads, span("2026-10-15", "2026-10-22")), {
    visitors: 3,
    calculated: 2,
    saved: 1,
    shared: 1,
    secondOffer: 2,
    leads: 2,
  });
});

Deno.test("the database allows the same actions and refuses the same slugs as the site", () => {
  const check = /site_events_action_ok[\s\S]*?question in \(([^)]*)\)/.exec(actionsSql)?.[1] ?? "";
  const inDb = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assertEquals(inDb, [...SITE_ACTIONS]);
  const slugs = /reps_slug_not_reserved\s+check \(slug not in \(([^)]*)\)/.exec(actionsSql)?.[1];
  assert(slugs, "the reps slug check is in the migration");
  assertEquals(
    [...slugs.matchAll(/'([a-z]+)'/g)].map((m) => m[1]),
    [...RESERVED_SLUGS],
  );
});

Deno.test(
  "Offer Check: the example on load is not a calculation; the first edit with a result is",
  () => {
    // the page opens on a worked example, so a result is there before anyone types
    assertEquals(countsAsCalculated({ edited: false, hasResult: true, counted: false }), false);
    // an edit that leaves the form incomplete: nothing yet
    assertEquals(countsAsCalculated({ edited: true, hasResult: false, counted: false }), false);
    // the first edit that gives a result counts
    assertEquals(countsAsCalculated({ edited: true, hasResult: true, counted: false }), true);
    // later edits in the same visit do not
    assertEquals(countsAsCalculated({ edited: true, hasResult: true, counted: true }), false);

    // walk a visit through the rule: load, three edits, one count
    let counted = false;
    let sent = 0;
    for (const s of [
      { edited: false, hasResult: true },
      { edited: true, hasResult: false },
      { edited: true, hasResult: true },
      { edited: true, hasResult: true },
    ]) {
      if (countsAsCalculated({ ...s, counted })) {
        counted = true;
        sent++;
      }
    }
    assertEquals(sent, 1);
  },
);
