// deno test --node-modules-dir=none tests/tracking.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  browserOf,
  buildActivity,
  buildWebsite,
  deviceOf,
  isBot,
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
