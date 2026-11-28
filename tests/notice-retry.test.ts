// deno test --node-modules-dir=none tests/notice-retry.test.ts
// A signed file's new-file email reaches a person even when the browser never asks for it: the
// finish-reminders job tries again, a claim lets only one try send, and every try leaves a record.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  CLAIM_BODY,
  type Delivery,
  mailNotice,
  MAX_FAILED,
  NOTICE,
  type NoticeEvent,
  noticeState,
  noticeSweep,
  pickForRetry,
  RETRY_AFTER_MS,
  RETRY_UNTIL_MS,
  NOTICE_LIMIT_MS,
  sendNoticeOnce,
  type SignedRow,
  READ_CHUNK,
  STALE_CLAIM_MS,
  type SweepStore,
  UPLOAD_QUIET_MS,
  type UploadRow,
} from "../src/lib/notice-retry.ts";
import links from "../src/lib/application-links.server.ts" with { type: "text" };
import migration from "../supabase/migrations/20261127100000_unassigned_alerts.sql" with { type: "text" };

const NOW = Date.parse("2026-11-27T15:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/**
 * The file's timeline in memory, holding to the database's one rule: one claim row per file and
 * attempt (events_notice_claim_once).
 */
function memoryStore(signed: SignedRow[] = [], seed: NoticeEvent[] = [], docs: UploadRow[] = []) {
  const rows: NoticeEvent[] = seed.map((e) => ({ ...e }));
  let nextId = 1000;
  const calls = { claims: 0, finishes: 0, records: 0, eventReads: [] as number[] };
  const store: SweepStore = {
    events(ids) {
      calls.eventReads.push(ids.length);
      return Promise.resolve(
        rows.filter((e) => ids.includes(e.application_id)).map((e) => ({ ...e })),
      );
    },
    claim(appId, attempt) {
      calls.claims++;
      const clash = rows.some(
        (e) =>
          e.application_id === appId &&
          e.payload?.["notice_claim"] === NOTICE &&
          Number(e.payload?.["attempt"] ?? 0) === attempt,
      );
      if (clash) return Promise.resolve("taken" as const);
      const id = nextId++;
      rows.push({
        id,
        application_id: appId,
        created_at: new Date(NOW).toISOString(),
        payload: { notice_claim: NOTICE, attempt },
      });
      return Promise.resolve(id);
    },
    finish(id, _body, payload) {
      calls.finishes++;
      const row = rows.find((e) => e.id === id);
      if (!row) return Promise.resolve(null);
      // like the server's update, only onto a claim that has no result yet
      const p = row.payload ?? {};
      if (p["notice"] === NOTICE || p["notice_failed"] === NOTICE) return Promise.resolve(false);
      row.payload = payload;
      return Promise.resolve(true);
    },
    record(appId, _body, payload) {
      calls.records++;
      rows.push({
        id: nextId++,
        application_id: appId,
        created_at: new Date(NOW).toISOString(),
        payload,
      });
      return Promise.resolve(true);
    },
    signed() {
      // every row, whatever the window: the job's own filter is what is under test
      return Promise.resolve(signed);
    },
    uploads(ids, since) {
      return Promise.resolve(
        docs.filter((d) => ids.includes(d.application_id) && d.created_at >= since),
      );
    },
  };
  return { store, rows, calls };
}

const sent: Delivery = { ok: true, body: "Emailed the signed application to a@b.co.", payload: {} };
const failed = (n: number, app: string): NoticeEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    id: 100 + i,
    application_id: app,
    created_at: ago(30 * MIN),
    payload: { notice_failed: NOTICE, error: "Gmail 500", notice_claim: NOTICE, attempt: i },
  }));

Deno.test("windows: the job looks from 10 minutes to 47 hours, inside the 48 hour limit", () => {
  assertEquals(RETRY_AFTER_MS, 10 * MIN);
  assertEquals(RETRY_UNTIL_MS, 47 * HOUR);
  assert(RETRY_UNTIL_MS < NOTICE_LIMIT_MS);
  assertEquals(MAX_FAILED, 2);
  // the server's own refusal uses the same limit
  assert(links.includes("Date.now() - Date.parse(d.signed_at) > NOTICE_LIMIT_MS"));
});

Deno.test("state: sent, failed tries, open claims and the next attempt", () => {
  const s = noticeState([
    ...failed(2, "a"),
    {
      id: 9,
      application_id: "a",
      created_at: ago(MIN),
      payload: { notice_claim: NOTICE, attempt: 2 },
    },
  ]);
  assertEquals(s.sent, false);
  assertEquals(s.failed, 2);
  assertEquals(
    s.open.map((e) => e.id),
    [9],
  );
  assertEquals(s.next, 3);
  // a notice written before claims existed still counts as sent
  assert(
    noticeState([{ id: 1, application_id: "a", created_at: ago(MIN), payload: { notice: NOTICE } }])
      .sent,
  );
  assertEquals(noticeState([]).next, 0);
});

Deno.test(
  "sweep: only files signed 10 min to 47 h ago, with fewer than 3 failures, unclaimed",
  async () => {
    const signed: SignedRow[] = [
      { application_id: "too-new", signed_at: ago(5 * MIN) },
      { application_id: "fresh", signed_at: ago(11 * MIN) },
      { application_id: "old", signed_at: ago(46 * HOUR) },
      { application_id: "too-old", signed_at: ago(47 * HOUR + MIN) },
      { application_id: "two-failed", signed_at: ago(2 * HOUR) },
      { application_id: "three-failed", signed_at: ago(2 * HOUR) },
      { application_id: "emailed", signed_at: ago(2 * HOUR) },
      { application_id: "sending", signed_at: ago(2 * HOUR) },
    ];
    const { store } = memoryStore(signed, [
      ...failed(2, "two-failed"),
      ...failed(3, "three-failed"),
      { id: 1, application_id: "emailed", created_at: ago(HOUR), payload: { notice: NOTICE } },
      // another try claimed it a minute ago and is still sending
      {
        id: 2,
        application_id: "sending",
        created_at: ago(MIN),
        payload: { notice_claim: NOTICE, attempt: 0 },
      },
    ]);
    const tried: string[] = [];
    const r = await noticeSweep(store, NOW, (id) => {
      tried.push(id);
      return Promise.resolve({ kind: "sent" });
    });
    // the oldest first
    assertEquals(tried, ["old", "two-failed", "fresh"]);
    assertEquals(r.sent, 3);
    assertEquals(r.stale, 0);
  },
);

Deno.test("sweep: at most the per-run cap, the rest next run", async () => {
  const signed = Array.from({ length: 8 }, (_, i) => ({
    application_id: `f${i}`,
    signed_at: ago((20 + i) * MIN),
  }));
  const tried: string[] = [];
  const { store } = memoryStore(signed);
  await noticeSweep(
    store,
    NOW,
    (id) => {
      tried.push(id);
      return Promise.resolve({ kind: "sent" });
    },
    3,
  );
  assertEquals(tried, ["f7", "f6", "f5"]);
  // the default cap is five
  assertEquals(pickForRetry(signed, [], NOW).send.length, 5);
});

Deno.test("sweep: a claim that never got a result is written off, then tried again", async () => {
  const signed = [{ application_id: "stuck", signed_at: ago(3 * HOUR) }];
  const { store, rows } = memoryStore(signed, [
    {
      id: 5,
      application_id: "stuck",
      created_at: ago(STALE_CLAIM_MS + MIN),
      payload: { notice_claim: NOTICE, attempt: 0 },
    },
  ]);
  const tried: string[] = [];
  const send = (id: string) => {
    tried.push(id);
    return sendNoticeOnce(store, id, () => Promise.resolve(sent));
  };
  const first = await noticeSweep(store, NOW, send);
  assertEquals(first.stale, 1);
  assertEquals(tried, []);
  assertEquals(rows[0]!.payload?.["notice_failed"], NOTICE);
  // next run: a new attempt number, so the claim is free, and the email goes
  const second = await noticeSweep(store, NOW, send);
  assertEquals(second.sent, 1);
  const sentRow = rows.find((e) => e.payload?.["notice"] === NOTICE)!;
  assertEquals(sentRow.payload?.["attempt"], 1);
});

Deno.test("claim: a second sender after a claim does nothing", async () => {
  const { store, rows } = memoryStore();
  let release: (d: Delivery) => void = () => {};
  let firstCalls = 0;
  const first = sendNoticeOnce(store, "app", () => {
    firstCalls++;
    return new Promise<Delivery>((r) => (release = r));
  });
  // let the first try take its claim
  await new Promise((r) => setTimeout(r, 0));
  let secondCalls = 0;
  const second = await sendNoticeOnce(store, "app", () => {
    secondCalls++;
    return Promise.resolve(sent);
  });
  assertEquals(second.kind, "busy");
  assertEquals(secondCalls, 0);
  release(sent);
  assertEquals((await first).kind, "sent");
  assertEquals(firstCalls, 1);
  // one row, the claim turned into the record of what was sent
  assertEquals(rows.length, 1);
  assertEquals(rows[0]!.payload?.["notice"], NOTICE);
  // and once sent, nobody sends again
  const third = await sendNoticeOnce(store, "app", () => Promise.resolve(sent));
  assertEquals(third.kind, "already");
});

Deno.test(
  "claim: two senders that both read before either claims; the database lets one in",
  async () => {
    const { store, calls } = memoryStore();
    let sends = 0;
    const deliver = () => {
      sends++;
      return Promise.resolve(sent);
    };
    const [a, b] = await Promise.all([
      sendNoticeOnce(store, "app", deliver),
      sendNoticeOnce(store, "app", deliver),
    ]);
    assertEquals([a.kind, b.kind].sort(), ["busy", "sent"]);
    assertEquals(sends, 1);
    assertEquals(calls.claims, 2);
  },
);

Deno.test("Google: a token fetch that throws is recorded as a failed try", async () => {
  const { store, rows } = memoryStore();
  let gmailCalls = 0;
  const out = await sendNoticeOnce(store, "app", async () => {
    const m = await mailNotice(
      () => Promise.reject(new Error("token endpoint down")),
      () => {
        gmailCalls++;
        return Promise.resolve({ ok: true, status: 200 });
      },
    );
    return m.ok ? sent : m;
  });
  assertEquals(out, { kind: "failed", why: "Couldn't reach Google." });
  assertEquals(gmailCalls, 0);
  assertEquals(rows.length, 1);
  assertEquals(rows[0]!.payload?.["notice_failed"], NOTICE);
  assertEquals(rows[0]!.payload?.["error"], "Couldn't reach Google.");
  // the job tries again next run with the next attempt number
  assertEquals(noticeState(rows).next, 1);
});

Deno.test("Gmail: a refused send and a send that throws keep their reason", async () => {
  assertEquals(
    await mailNotice(
      () => Promise.resolve({ access: "t" }),
      () => Promise.resolve({ ok: false, status: 429 }),
    ),
    { ok: false, why: "Gmail 429" },
  );
  assertEquals(
    await mailNotice(
      () => Promise.resolve({ access: "t" }),
      () => Promise.reject(new Error("offline")),
    ),
    { ok: false, why: "couldn't reach Gmail" },
  );
  assertEquals(
    await mailNotice(
      () => Promise.resolve({ error: "Mailbox not connected." }),
      () => Promise.resolve({ ok: true, status: 200 }),
    ),
    { ok: false, why: "Mailbox not connected." },
  );
});

Deno.test("deliver: anything else that throws is still written on the file", async () => {
  const { store, rows } = memoryStore();
  const out = await sendNoticeOnce(store, "app", () => Promise.reject(new Error("storage")));
  assertEquals(out.kind, "failed");
  assertEquals(rows[0]!.payload?.["notice_failed"], NOTICE);
});

Deno.test("server: the route and the job share one sender, wired to the claim", () => {
  const route = links.slice(
    links.indexOf("export async function notifyNewApplication("),
    links.indexOf("export async function sendNewApplicationNotice("),
  );
  // the route proves the caller, then hands over
  assert(
    route.indexOf("if (!allowed) return json(404") <
      route.indexOf("sendNewApplicationNotice(svc, appId"),
  );
  const fn = links.slice(links.indexOf("export async function sendNewApplicationNotice("));
  assert(fn.includes("sendNoticeOnce(noticeStore(svc), appId"));
  // the Google token can't throw past the record any more
  assert(fn.includes("mailNotice("));
  assert(!/const access = await gmailAccessToken\(svc\);/.test(fn));
  // a clash on the claim index is "taken", not an error
  assert(fn.includes('r.error?.code === "23505"'));
  assert(fn.includes("body: CLAIM_BODY") || links.includes("body: CLAIM_BODY"));
  assert(CLAIM_BODY.length > 0);
});

Deno.test("migration: one claim per file and attempt", () => {
  assert(migration.includes("create unique index if not exists events_notice_claim_once"));
  assert(migration.includes("where payload ? 'notice_claim'"));
  assert(migration.includes("(coalesce(payload ->> 'attempt', '0'))"));
});

Deno.test(
  "stale: a try that finishes after its claim was written off doesn't overwrite it, and isn't sent twice",
  async () => {
    const signed = [{ application_id: "slow", signed_at: ago(3 * HOUR) }];
    const { store, rows } = memoryStore(signed);
    let release: (d: Delivery) => void = () => {};
    const slow = sendNoticeOnce(store, "slow", () => new Promise<Delivery>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 0));
    // the claim is now older than the stale limit: the job writes it off
    rows[0]!.created_at = ago(STALE_CLAIM_MS + MIN);
    let jobSends = 0;
    const job = (id: string) =>
      sendNoticeOnce(store, id, () => {
        jobSends++;
        return Promise.resolve(sent);
      });
    assertEquals((await noticeSweep(store, NOW, job)).stale, 1);
    // then the slow try's email goes out after all
    release(sent);
    assertEquals((await slow).kind, "sent");
    // the write-off stays as it was, and the send has a row of its own
    assertEquals(rows[0]!.payload?.["notice_failed"], NOTICE);
    assertEquals(rows[0]!.payload?.["notice"], undefined);
    const late = rows.filter((e) => e.payload?.["notice"] === NOTICE);
    assertEquals(late.length, 1);
    assertEquals(late[0]!.payload?.["late"], true);
    assertEquals(late[0]!.payload?.["notice_claim"], undefined);
    // so the next run sees it as sent and sends nothing
    const next = await noticeSweep(store, NOW, job);
    assertEquals(next.sent, 0);
    assertEquals(jobSends, 0);
  },
);

Deno.test(
  "stale: a write-off that loses to a finished try leaves its result and isn't counted",
  async () => {
    const claimRow: NoticeEvent = {
      id: 7,
      application_id: "done",
      created_at: ago(STALE_CLAIM_MS + MIN),
      payload: { notice_claim: NOTICE, attempt: 0 },
    };
    const { store, rows } = memoryStore(
      [{ application_id: "done", signed_at: ago(3 * HOUR) }],
      [claimRow],
    );
    // the try writes its result between the job's read and its write-off
    const read = store.events.bind(store);
    store.events = async (ids) => {
      const out = await read(ids);
      rows[0]!.payload = { notice_claim: NOTICE, attempt: 0, notice: NOTICE };
      return out;
    };
    const r = await noticeSweep(store, NOW, () => Promise.resolve({ kind: "sent" }));
    assertEquals(r.stale, 0);
    assertEquals(rows[0]!.payload?.["notice"], NOTICE);
    assertEquals(rows[0]!.payload?.["notice_failed"], undefined);
  },
);

Deno.test("uploads: a file whose statements are still landing is left to the browser", async () => {
  const signed = [
    { application_id: "uploading", signed_at: ago(12 * MIN) },
    { application_id: "quiet", signed_at: ago(25 * MIN) },
  ];
  const { store } = memoryStore(
    signed,
    [],
    [
      { application_id: "uploading", created_at: ago(2 * MIN) },
      { application_id: "quiet", created_at: ago(UPLOAD_QUIET_MS + MIN) },
    ],
  );
  const tried: string[] = [];
  await noticeSweep(store, NOW, (id) => {
    tried.push(id);
    return Promise.resolve({ kind: "sent" });
  });
  assertEquals(tried, ["quiet"]);
  assertEquals(UPLOAD_QUIET_MS, 10 * MIN);
  // a failed documents read doesn't stop the safety net
  const broken = memoryStore(signed).store;
  broken.uploads = () => Promise.resolve(null);
  const again: string[] = [];
  await noticeSweep(broken, NOW, (id) => {
    again.push(id);
    return Promise.resolve({ kind: "sent" });
  });
  assertEquals(again.sort(), ["quiet", "uploading"]);
});

Deno.test("busy days: hundreds of emailed files don't hide a recent one that wasn't", async () => {
  const emailed = Array.from({ length: 240 }, (_, i) => ({
    application_id: `e${i}`,
    signed_at: ago(40 * HOUR - i * MIN),
  }));
  const signed = [...emailed, { application_id: "missed", signed_at: ago(HOUR) }];
  const seed: NoticeEvent[] = emailed.map((r, i) => ({
    id: i + 1,
    application_id: r.application_id,
    created_at: ago(30 * HOUR),
    payload: { notice: NOTICE },
  }));
  const { store, calls } = memoryStore(signed, seed);
  const tried: string[] = [];
  await noticeSweep(store, NOW, (id) => {
    tried.push(id);
    return Promise.resolve({ kind: "sent" });
  });
  assertEquals(tried, ["missed"]);
  // the timeline is read in short chunks
  assert(calls.eventReads.every((n) => n <= READ_CHUNK));
  assertEquals(calls.eventReads.length, Math.ceil(signed.length / READ_CHUNK));
  // and the server reads the newest signed files first, well past 100
  const store_ = links.slice(links.indexOf("export function noticeStore("));
  assert(store_.includes('.order("signed_at", { ascending: false })'));
  assert(store_.includes(".limit(SIGNED_READ_LIMIT)"));
  assert(!store_.includes(".limit(100)"));
  // the result goes only onto a claim that is still open
  assert(store_.includes('.eq("body", CLAIM_BODY)'));
});

Deno.test("migration: the announcement goes out once, however often the file is run", () => {
  const i = migration.indexOf("select public.announce(");
  assert(i > 0);
  const tail = migration.slice(i);
  assert(tail.includes("where not exists ("));
  assert(tail.includes("where kind = 'announcement' and title = 'Website files now alert admins'"));
});
