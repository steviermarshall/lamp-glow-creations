// deno test --node-modules-dir=none tests/open-signal.test.ts
//
// 2026-11-25, Asad: "if i seen they opened/started the application how true is this signal do we
// know the ip address to verify it was the recipient". GAUDIOSO CONTRACTING showed Started because
// the rep filled it in on the call. Opened and Started now mean the merchant's own browser.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { deviceOf, isScanner, openLines, tracksMerchant } from "../src/lib/open-signal.ts";
import {
  fetchStartWithin,
  fromServer,
  keptStartKey,
  retryKeptStart,
  sendStart,
  START_TIMEOUT_MS,
  startVerdict,
  type KeptStorage,
  type StartReply,
} from "../src/lib/start-retry.ts";
import { openRequest } from "../src/lib/application-resume.ts";
import server from "../src/lib/application-links.server.ts" with { type: "text" };
import paper from "../src/components/application/paper-application.tsx" with { type: "text" };
import link from "../src/components/application/link-application.tsx" with { type: "text" };
import visit from "../src/lib/visit-headers.ts" with { type: "text" };
import sent from "../src/components/staff/sent-applications.tsx" with { type: "text" };
import sql from "../supabase/migrations/20261125130000_merchant_opens.sql" with { type: "text" };

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

Deno.test("device: phone, tablet or computer from the browser", () => {
  assertEquals(deviceOf(IPHONE), "phone");
  assertEquals(deviceOf(ANDROID_PHONE), "phone");
  assertEquals(deviceOf(ANDROID_TABLET), "tablet");
  assertEquals(deviceOf(IPAD), "tablet");
  assertEquals(deviceOf(MAC), "computer");
});

Deno.test("scanners: link checkers and empty agents aren't the merchant", () => {
  for (const a of [
    "",
    null,
    "Mozilla/5.0 (compatible; Googlebot/2.1)",
    "Mozilla/5.0 HeadlessChrome/120.0",
    "python-requests/2.31",
    "curl/8.4",
    "Proofpoint URL Defense",
    "Mimecast",
  ])
    assert(isScanner(a), String(a));
  assert(!isScanner(IPHONE) && !isScanner(MAC));
  assertEquals(deviceOf("Mozilla/5.0 (compatible; bingbot/2.0)"), null);
});

const NOW = Date.parse("2026-11-25T15:00:00Z");

Deno.test("lines: before the SQL runs there are none, so the old status shows alone", () => {
  assert(!tracksMerchant({}));
  assertEquals(openLines({}, NOW), []);
});

Deno.test("lines: a link the rep filled in and the merchant never opened says so", () => {
  const r = {
    rep_filled_at: "2026-11-21T14:00:00Z",
    merchant_open_count: 0,
    merchant_opened_at: null,
  };
  assertEquals(openLines(r, NOW), [
    "Filled in by the rep on the call.",
    "No open by them recorded.",
  ]);
});

Deno.test("lines: the merchant's opens, how many, when last and on what", () => {
  const r = {
    rep_filled_at: null,
    merchant_open_count: 3,
    merchant_opened_at: "2026-11-24T10:00:00Z",
    merchant_last_opened_at: "2026-11-25T13:00:00Z",
    merchant_device: "phone",
    merchant_started_at: "2026-11-25T13:02:00Z",
  };
  assertEquals(openLines(r, NOW), [
    "They opened it 3 times, last 2h ago on a phone.",
    "They typed answers themselves.",
  ]);
  assertEquals(
    openLines(
      { ...r, merchant_open_count: 1, merchant_started_at: null, merchant_device: null },
      NOW,
    ),
    ["They opened it once, last 2h ago."],
  );
});

Deno.test("server: a staff visit or a scanner doesn't mark a link opened or started", () => {
  const open = server.slice(server.indexOf("export async function openApplication"));
  assert(
    open.includes("const merchant = !isScanner(agent) && !(await isStaffVisit(request, svc));"),
  );
  assert(open.includes("if (merchant) {"));
  // the old stamps sit inside that guard
  const guarded = open.slice(
    open.indexOf("if (merchant) {"),
    open.indexOf('"note_merchant_open" as never'),
  );
  assert(guarded.includes("started_at: now") && guarded.includes("opened_at: now"));
  assert(server.includes('x.role === "rep" || x.role === "admin"'));
});

Deno.test("server: every merchant visit is counted, and a missing function changes nothing", () => {
  assert(server.includes('"note_merchant_open" as never,'));
  assert(server.includes("_device: deviceOf(agent)"));
  assert(/\.then\(\s*\(\) => undefined,\s*\(\) => undefined,\s*\)/.test(server));
});

Deno.test("pages: the open and start calls carry the staff session when there is one", () => {
  for (const page of [paper, link]) {
    assert(page.includes("headers: await visitHeaders(),"));
    assert(page.includes("void visitHeaders()"));
    assert(
      !page.includes(
        'headers: { "Content-Type": "application/json" },\n          body: JSON.stringify(token ? { token } : { rep: repSlug }),',
      ),
    );
  }
  assert(visit.includes('headers["Authorization"] = `Bearer ${token}`'));
  // a personal link and a rep's public link still make the open call, with the staff session;
  // only the website (no token, no rep) skips it
  assert(openRequest("tok", "zeus") !== null && openRequest(null, "zeus") !== null);
  assert(link.includes("const ask = openRequest(token, repSlug);"));
  const call = link.slice(link.indexOf('fetch("/api/application/open", {'));
  assert(call.slice(0, 200).includes("headers: await visitHeaders(),"));
});

// ---------- the contact save is retried, never lost to one bad answer (gap 2, 2026-11-27) ----------

/** A tab's sessionStorage, in memory. */
function tab(): KeptStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** The start route's own answer: { error } in its own words, or the saved lead's progress. */
const own = (status: number): StartReply => ({
  status,
  body:
    status === 200
      ? { ok: true, progress: "p-1" }
      : status === 400
        ? { error: "Enter a valid email." }
        : { error: "Couldn't save that. Try again." },
});
/** A 5xx the route never wrote: the edge's error page, or a worker that crashed. */
const edge = (status: number): StartReply => ({ status, body: null });
const LOST: StartReply = { status: null, body: null };
const SLOW: StartReply = { status: null, body: null, timedOut: true };

/** A start route that answers each call from the list, and remembers what it was sent. */
function route(...answers: StartReply[]) {
  const sent: Record<string, unknown>[] = [];
  const send = (body: Record<string, unknown>): Promise<StartReply> => {
    sent.push(body);
    return Promise.resolve(answers.shift() ?? LOST);
  };
  return { sent, send };
}

const CONTACT = { rep: "", first_name: "Thomas", email: "t@example.test", form: "online" };
const now = () => Promise.resolve();

Deno.test("start: only a request the server never answered is worth another try", () => {
  assertEquals(startVerdict(200), "saved");
  assertEquals(startVerdict(400, true), "fix");
  for (const s of [500, 502, 503, 504, null]) assertEquals(startVerdict(s), "retry", String(s));
  // the route's own 500 has already emailed the team the details: one person, one email
  for (const s of [500, 503]) assertEquals(startVerdict(s, true), "stop", String(s));
  assertEquals(fromServer(own(500).body), true);
  assertEquals(fromServer(edge(502).body), false);
  assertEquals(fromServer("<html>error 1101</html>"), false);
  // the network's hourly cap and an inactive rep's link are final
  for (const s of [429, 404, 403, 409]) assertEquals(startVerdict(s, true), "stop", String(s));
});

Deno.test(
  "start: a lost answer keeps the contact and tries once more before the range",
  async () => {
    const storage = tab();
    const r = route(LOST, own(200));
    const out = await sendStart(CONTACT, { send: r.send, storage, store: "website", wait: now });
    assertEquals(out, { outcome: "saved", progress: "p-1" });
    assertEquals(r.sent, [CONTACT, CONTACT]);
    // saved on the retry: nothing is left to try again
    assertEquals(storage.data.size, 0);
    assertEquals(await retryKeptStart({ send: r.send, storage, store: "website" }), null);
    assertEquals(r.sent.length, 2);
  },
);

Deno.test("start: still unanswered, it is kept for one last try at the next step", async () => {
  const storage = tab();
  const r = route(edge(503), LOST, own(200));
  const out = await sendStart(CONTACT, { send: r.send, storage, store: "website", wait: now });
  // the visitor carries on: kept, not an error on their screen
  assertEquals(out, { outcome: "kept" });
  assertEquals(r.sent.length, 2);
  assertEquals(JSON.parse(storage.data.get(keptStartKey("website"))!), CONTACT);
  // the next step sends it once, and then nothing is kept whatever the answer
  assertEquals(await retryKeptStart({ send: r.send, storage, store: "website" }), {
    outcome: "saved",
    progress: "p-1",
  });
  assertEquals(r.sent.length, 3);
  assertEquals(storage.data.size, 0);
  assertEquals(await retryKeptStart({ send: r.send, storage, store: "website" }), null);
  assertEquals(r.sent.length, 3);
  // and a last try that fails too is dropped, never retried a fourth time
  const again = tab();
  const r2 = route(edge(502), edge(502), edge(502), own(200));
  await sendStart(CONTACT, { send: r2.send, storage: again, store: "zeus", wait: now });
  assertEquals(
    (await retryKeptStart({ send: r2.send, storage: again, store: "zeus" }))?.outcome,
    "stopped",
  );
  assertEquals(await retryKeptStart({ send: r2.send, storage: again, store: "zeus" }), null);
  assertEquals(r2.sent.length, 3);
});

Deno.test(
  "start: the server's own 500 is final, so a failing save sends one email, not three",
  async () => {
    // the leads insert keeps failing: the route emails the team "not saved" and answers 500
    const storage = tab();
    const r = route(own(500), own(500), own(500));
    const out = await sendStart(CONTACT, { send: r.send, storage, store: "website", wait: now });
    assertEquals(out, { outcome: "stopped" });
    assertEquals(r.sent.length, 1);
    assertEquals(storage.data.size, 0);
    assertEquals(await retryKeptStart({ send: r.send, storage, store: "website" }), null);
    assertEquals(r.sent.length, 1);
    // a lost first answer, then the route's own 500: two requests, and nothing kept for a third
    const again = tab();
    const r2 = route(LOST, own(500), own(500));
    assertEquals(
      (await sendStart(CONTACT, { send: r2.send, storage: again, store: "website", wait: now }))
        .outcome,
      "stopped",
    );
    assertEquals(await retryKeptStart({ send: r2.send, storage: again, store: "website" }), null);
    assertEquals(r2.sent.length, 2);
  },
);

Deno.test(
  "start: a timeout waits for the next step, so a slow save isn't sent twice at once",
  async () => {
    const storage = tab();
    let paused = 0;
    const r = route(SLOW, own(200));
    const wait = () => {
      paused++;
      return Promise.resolve();
    };
    assertEquals(await sendStart(CONTACT, { send: r.send, storage, store: "website", wait }), {
      outcome: "kept",
    });
    assertEquals(r.sent.length, 1);
    assertEquals(paused, 0);
    assertEquals(JSON.parse(storage.data.get(keptStartKey("website"))!), CONTACT);
    assertEquals(
      (await retryKeptStart({ send: r.send, storage, store: "website" }))?.outcome,
      "saved",
    );
    assertEquals(r.sent.length, 2);
  },
);

Deno.test("start: the browser's send tells a timeout from a dropped connection", async () => {
  const real = globalThis.fetch;
  try {
    // never answers until the page gives up on it
    globalThis.fetch = ((_: unknown, init?: RequestInit) =>
      new Promise((_ok, fail) =>
        init?.signal?.addEventListener("abort", () =>
          fail(new DOMException("aborted", "AbortError")),
        ),
      )) as typeof fetch;
    assertEquals(await fetchStartWithin(5)(CONTACT), { status: null, body: null, timedOut: true });
    globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
    assertEquals(await fetchStartWithin(1000)(CONTACT), { status: null, body: null });
    // an edge's HTML error page has no body the page can read, so it counts as not the route's
    globalThis.fetch = (() =>
      Promise.resolve(new Response("<html>bad gateway</html>", { status: 502 }))) as typeof fetch;
    const reply = await fetchStartWithin(1000)(CONTACT);
    assertEquals(reply, { status: 502, body: null });
    assertEquals(startVerdict(reply.status, fromServer(reply.body)), "retry");
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({ error: "Couldn't save that. Try again." }, { status: 500 }),
      )) as typeof fetch;
    const mine = await fetchStartWithin(1000)(CONTACT);
    assertEquals(startVerdict(mine.status, fromServer(mine.body)), "stop");
  } finally {
    globalThis.fetch = real;
  }
  // well above the route's slowest normal answer (the save plus the Gmail heads-up)
  assert(START_TIMEOUT_MS >= 25_000);
});

Deno.test("start: a 429 or 404 is never retried, and a 400 shows the server's words", async () => {
  for (const status of [429, 404]) {
    const storage = tab();
    const r = route(own(status), own(200));
    const out = await sendStart(CONTACT, { send: r.send, storage, store: "website", wait: now });
    assertEquals(out, { outcome: "stopped" }, String(status));
    assertEquals(r.sent.length, 1, String(status));
    assertEquals(storage.data.size, 0, String(status));
  }
  // an edge 5xx followed by the cap stops there too
  const storage = tab();
  const r = route(edge(502), own(429), own(200));
  assertEquals(
    (await sendStart(CONTACT, { send: r.send, storage, store: "website", wait: now })).outcome,
    "stopped",
  );
  assertEquals(storage.data.size, 0);
  assertEquals(await retryKeptStart({ send: r.send, storage, store: "website" }), null);
  assertEquals(r.sent.length, 2);
  const bad = route(own(400));
  assertEquals(await sendStart(CONTACT, { send: bad.send, storage: tab(), store: "website" }), {
    outcome: "fix",
    error: "Enter a valid email.",
  });
  // a browser that refuses sessionStorage still gets the retry before the range
  const none = route(LOST, own(200));
  assertEquals(
    (await sendStart(CONTACT, { send: none.send, storage: null, store: "website", wait: now }))
      .outcome,
    "saved",
  );
});

Deno.test("start: the page uses the retry and never holds the visitor up", () => {
  const gate = link.slice(
    link.indexOf("function ContactGate("),
    link.indexOf("function RangeCard("),
  );
  assert(
    gate.includes("await sendStart(body, { send: fetchStart, storage: tabStorage(), store })"),
  );
  assert(gate.includes('if (out.outcome === "fix") {'));
  // past a refusal of the details, they always go on
  assert(gate.indexOf("onDone({") > gate.indexOf('if (out.outcome === "fix") {'));
  // the last try runs when they leave the range and at every step change
  assert(link.includes("setShowRange(false);\n                  retryStart();"));
  assert(
    link.includes(
      "setVisited((v) => Math.max(v, to));\n    retryStart(Math.min(Math.max(visited, to), lastStep));",
    ),
  );
  // a retry that lands reports the furthest step itself: the report sent before it had no token
  const retry = link.slice(link.indexOf("const retryStart = (furthest = 0) => {"));
  const saved = retry.indexOf("saveProgressToken(store, r.progress);");
  assert(saved > 0 && retry.indexOf("reportStage(store, STEPS[furthest]!.id", saved) > saved);
  // before the script runs the contact form can't be sent (a native submit drops the answers)
  assert(gate.includes("const [ready, setReady] = useState(false);"));
  assert(gate.includes("useEffect(() => setReady(true), []);"));
  assert(gate.includes("<fieldset disabled={!ready}"));
  assert(gate.indexOf("<fieldset disabled={!ready}") < gate.indexOf('type="submit"'));
});

Deno.test(
  "applications: Opened and Started come from the merchant's own visits once tracked",
  () => {
    assert(sent.includes('if (r.merchant_started_at) return "started";'));
    assert(sent.includes('if (r.merchant_opened_at) return "opened";'));
    assert(sent.includes('if (r.rep_filled_at) return "filled";'));
    assert(sent.includes('filled: "Filled in on the call",'));
    // the list still loads before the SQL runs
    assert(sent.includes('if (err && (err.code === "42703" || err.code === "PGRST204"))'));
  },
);

Deno.test(
  "database: no IP kept, scanners' device never stored, the counter is the server's alone",
  () => {
    assert(!/\bip\b/i.test(sql.replace(/No IP address is kept/g, "").replace(/-- .*$/gm, "")));
    assert(
      sql.includes(
        "check (merchant_device is null or merchant_device in ('phone', 'tablet', 'computer'))",
      ),
    );
    assert(
      sql.includes(
        "revoke all on function public.note_merchant_open(uuid, text, boolean) from public, anon, authenticated;",
      ),
    );
    assert(sql.includes("add column if not exists merchant_open_count integer not null default 0"));
  },
);

Deno.test("database: history keeps old stamps only where no rep filled the link in", () => {
  assert(
    sql.includes(
      "set rep_filled_at = least(started_at, draft_saved_at)\n     where draft_by is not null;",
    ),
  );
  assert(sql.includes("merchant_started_at = started_at\n     where draft_by is null;"));
  // the backfill runs once
  assert(sql.includes("if not exists (select 1 from public.application_invites"));
});
