// deno test --node-modules-dir=none tests/phone-start.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { fillInUrl, phoneStartProblem } from "../src/lib/phone-start.ts";
import {
  gmailSend,
  postStart,
  runStart,
  startFailureLine,
  startOutcome,
  type Mail,
  type SendResult,
  type StartDeps,
  type StartFailure,
  type StartInput,
  type StartRep,
} from "../src/lib/application-start.ts";
import server from "../src/lib/application-start.server.ts" with { type: "text" };
import paper from "../src/components/application/paper-application.tsx" with { type: "text" };

const ok = { email: "maria@example.com", phone: "", first_name: "Maria", business_name: "" };

Deno.test("the email comes first", () => {
  assertEquals(phoneStartProblem({ ...ok, email: "" }), "Get their email first.");
  assertEquals(phoneStartProblem({ ...ok, email: "  " }), "Get their email first.");
  assertEquals(
    phoneStartProblem({ ...ok, email: "maria@" }),
    "That email address doesn't look right.",
  );
});

Deno.test("a name or a business, and a cell only if it looks like one", () => {
  assertEquals(phoneStartProblem(ok), null);
  assertEquals(phoneStartProblem({ ...ok, first_name: "", business_name: "Joe's Pizza" }), null);
  assertEquals(
    phoneStartProblem({ ...ok, first_name: "", business_name: "" }),
    "Add their first name or business, so you know who it's for.",
  );
  assertEquals(phoneStartProblem({ ...ok, phone: "(718) 555-0142" }), null);
  assertEquals(
    phoneStartProblem({ ...ok, phone: "call me" }),
    "Numbers only for the cell, like (718) 555-0142.",
  );
});

Deno.test("fill-in mode is the link with fill=rep", () => {
  assertEquals(
    fillInUrl("https://getlamp.app/application/zeus?i=abc"),
    "https://getlamp.app/application/zeus?i=abc&fill=rep",
  );
  assertEquals(
    fillInUrl("https://getlamp.app/application/zeus"),
    "https://getlamp.app/application/zeus?fill=rep",
  );
});

// ---------- the application's first screen: a contact always reaches the team ----------

const COPY = ["asad@test.dev", "stevie@test.dev"];
const ana: StartInput = {
  rep: "zeus",
  first: "Ana",
  last: "Diaz",
  email: "ana@test.dev",
  phone: "(201) 555-0100",
  businessName: "Riverbend Diner",
  textsOk: true,
  quick: { amount: "50-100k" },
};
const zeus: StartRep = { name: "Zeus Diaz", user_id: "u-zeus", active: true };

/** A pretend database and mailbox: leads saved today, mail sent, failures counted. */
function world(o: {
  rep?: StartRep | null;
  /** How many rep lookups fail before one works (true: all of them). */
  repError?: boolean | number;
  insertFails?: number;
  allowed?: boolean;
  send?: SendResult;
}) {
  const leads: string[] = [];
  const mail: Mail[] = [];
  const fails: { reason: StartFailure; detail?: string }[] = [];
  let inserts = 0;
  let lookups = 0;
  let failsLeft = o.insertFails ?? 0;
  const deps: StartDeps = {
    copy: COPY,
    findRep: () => {
      lookups++;
      const error = o.repError === true || lookups <= Number(o.repError ?? 0);
      return Promise.resolve({ rep: error ? null : o.rep === undefined ? zeus : o.rep, error });
    },
    seenToday: () => Promise.resolve(leads.includes(ana.email)),
    intakeAllowed: () => Promise.resolve(o.allowed ?? true),
    insertLead: () => {
      inserts++;
      if (failsLeft > 0) {
        failsLeft--;
        return Promise.resolve(false);
      }
      leads.push(ana.email);
      return Promise.resolve(true);
    },
    repEmail: () => Promise.resolve("zeus@test.dev"),
    send: (m) => {
      mail.push(m);
      return Promise.resolve(o.send ?? { ok: true });
    },
    progress: () => Promise.resolve(leads.length ? "tok" : null),
    fail: (reason, detail) => fails.push(detail ? { reason, detail } : { reason }),
  };
  return { deps, leads, mail, fails, inserts: () => inserts, lookups: () => lookups };
}
const reasons = (w: { fails: { reason: StartFailure }[] }) => w.fails.map((f) => f.reason);

Deno.test("start: saved first time, the rep is emailed with the copy list on cc", async () => {
  const w = world({});
  const r = await runStart(ana, w.deps);
  assertEquals(r, { status: 200, body: { ok: true, progress: "tok" } });
  assertEquals(w.mail.length, 1);
  assertEquals(w.mail[0]!.to, "zeus@test.dev");
  assertEquals(w.mail[0]!.cc, COPY);
  assert(!w.mail[0]!.text.includes("Not saved in Lamp"));
  assertEquals(w.fails, []);
});

Deno.test("start: one failed save is tried again and saved, with one email", async () => {
  const w = world({ insertFails: 1 });
  const r = await runStart(ana, w.deps);
  assertEquals(r.status, 200);
  assertEquals(w.inserts(), 2);
  assertEquals(w.leads.length, 1);
  assertEquals(w.mail.length, 1);
  assert(!w.mail[0]!.subject.includes("NOT SAVED"));
  assertEquals(reasons(w), ["save_retried"]);
});

Deno.test(
  "start: the save fails twice, and the rep still gets the person, marked not saved",
  async () => {
    const w = world({ insertFails: 2 });
    const r = await runStart(ana, w.deps);
    assertEquals(w.inserts(), 2);
    assertEquals(w.leads.length, 0);
    // the team has them, so the browser is told not to send it again
    assertEquals(r, { status: 200, body: { ok: true, saved: false, progress: null } });
    assertEquals(w.mail.length, 1);
    const m = w.mail[0]!;
    assertEquals(m.to, "zeus@test.dev");
    assertEquals(m.cc, COPY);
    assert(m.subject.startsWith("NOT SAVED IN LAMP · Started: Ana Diaz"));
    assertStringIncludes(m.text, "Not saved in Lamp, add this person by hand.");
    assertStringIncludes(m.text, "Phone: (201) 555-0100");
    assertStringIncludes(m.text, "Email: ana@test.dev");
    assertEquals(reasons(w), ["save_retried", "save_failed"]);
  },
);

Deno.test(
  "start: not saved and the email failed too: a 500, so the browser tries again",
  async () => {
    const w = world({ insertFails: 2, send: { ok: false, why: "gmail_503" } });
    const r = await runStart(ana, w.deps);
    assertEquals(r.status, 500);
    assertEquals(reasons(w), ["save_retried", "save_failed", "email_failed"]);
    assertEquals(w.fails.at(-1)!.detail, "gmail_503");
  },
);

Deno.test("start: the network cap counts the refusal and emails no one", async () => {
  const w = world({ allowed: false });
  const r = await runStart(ana, w.deps);
  assertEquals(r.status, 429);
  assertEquals(w.inserts(), 0);
  assertEquals(w.mail, []);
  assertEquals(reasons(w), ["rate_limited"]);
  const line = startFailureLine("rate_limited", 3);
  assertEquals(line, "application start: rate_limited, 3 since this server started");
});

Deno.test("start: an inactive rep link emails the copy list, not the rep", async () => {
  const w = world({ rep: { ...zeus, active: false } });
  const r = await runStart(ana, w.deps);
  assertEquals(r.status, 404);
  assertEquals(w.inserts(), 0);
  assertEquals(w.mail.length, 1);
  assertEquals(w.mail[0]!.to, "asad@test.dev");
  assertEquals(w.mail[0]!.cc, ["stevie@test.dev"]);
  assert(!w.mail[0]!.to.includes("zeus") && !w.mail[0]!.cc.includes("zeus@test.dev"));
  assert(w.mail[0]!.subject.startsWith("Inactive link: Ana Diaz"));
  assertStringIncludes(w.mail[0]!.text, "that link is inactive");
  assertEquals(reasons(w), ["inactive_link"]);
});

Deno.test(
  "start: an inactive link within the network cap only; no such rep emails no one",
  async () => {
    const capped = world({ rep: { ...zeus, active: false }, allowed: false });
    assertEquals((await runStart(ana, capped.deps)).status, 429);
    assertEquals(capped.mail, []);
    const none = world({ rep: null });
    assertEquals((await runStart(ana, none.deps)).status, 404);
    assertEquals(none.mail, []);
    assertEquals(none.fails, []);
  },
);

Deno.test("start: a failed rep lookup still saves and reaches the copy list", async () => {
  const w = world({ repError: true });
  const r = await runStart(ana, w.deps);
  assertEquals(r.status, 200);
  assertEquals(w.lookups(), 2);
  assertEquals(w.leads.length, 1);
  assertEquals(w.mail.length, 1);
  assertEquals(w.mail[0]!.to, "asad@test.dev");
  assertEquals(w.mail[0]!.cc, ["stevie@test.dev"]);
  // written to the copy list, not as if to the rep: it names the link and asks them to pass it on
  assertStringIncludes(w.mail[0]!.subject, "REP NOT LOOKED UP");
  assertStringIncludes(w.mail[0]!.subject, 'on the "zeus" link');
  assert(w.mail[0]!.text.startsWith("Hi,"));
  assert(!w.mail[0]!.text.includes("on your link"));
  assertStringIncludes(w.mail[0]!.text, "Pass them to that rep");
  assertEquals(reasons(w), ["rep_lookup_failed"]);
});

Deno.test(
  "start: a rep lookup that fails once is tried again, and the rep is emailed",
  async () => {
    const w = world({ repError: 1 });
    const r = await runStart(ana, w.deps);
    assertEquals(r, { status: 200, body: { ok: true, progress: "tok" } });
    assertEquals(w.lookups(), 2);
    assertEquals(w.mail[0]!.to, "zeus@test.dev");
    assert(!w.mail[0]!.subject.includes("REP NOT LOOKED UP"));
    assertEquals(w.fails, []);
  },
);

Deno.test("start: no rep lookup and no save: the copy list is told both", async () => {
  const w = world({ repError: true, insertFails: 2 });
  const r = await runStart(ana, w.deps);
  assertEquals(r, { status: 200, body: { ok: true, saved: false, progress: null } });
  assertEquals(w.mail.length, 1);
  assertEquals(w.mail[0]!.to, "asad@test.dev");
  assertStringIncludes(w.mail[0]!.subject, "NOT SAVED IN LAMP · REP NOT LOOKED UP");
  assertStringIncludes(w.mail[0]!.text, "Not saved in Lamp, add this person by hand.");
});

Deno.test(
  "start: the same person again today gets 200 and no second email, after a retry",
  async () => {
    const w = world({ insertFails: 1 });
    assertEquals((await runStart(ana, w.deps)).status, 200);
    const again = await runStart(ana, w.deps);
    assertEquals(again, { status: 200, body: { ok: true, progress: "tok" } });
    assertEquals(w.mail.length, 1);
    assertEquals(w.leads.length, 1);
  },
);

Deno.test("start: a save whose answer was lost isn't saved twice", async () => {
  const w = world({});
  let calls = 0;
  const lost = w.deps.insertLead;
  w.deps.insertLead = async () => {
    calls++;
    const ok = await lost();
    return calls === 1 ? !ok : ok; // the first one lands, but reports a failure
  };
  const r = await runStart(ana, w.deps);
  assertEquals(r.status, 200);
  assertEquals(calls, 1);
  assertEquals(w.leads.length, 1);
  assertEquals(w.mail.length, 1);
});

Deno.test(
  "start: a Gmail refusal or a missing mailbox is counted, and the lead stays saved",
  async () => {
    const refused = world({ send: { ok: false, why: "gmail_403" } });
    const r = await runStart(ana, refused.deps);
    assertEquals(r.status, 200);
    assertEquals(refused.fails, [{ reason: "email_failed", detail: "gmail_403" }]);
    const threw = world({});
    threw.deps.send = () => Promise.reject(new Error("socket"));
    assertEquals((await runStart(ana, threw.deps)).status, 200);
    assertEquals(threw.fails, [{ reason: "email_failed", detail: "threw" }]);
  },
);

Deno.test("start: the failure log line carries no name, email or phone", () => {
  const w = world({ insertFails: 2, send: { ok: false, why: "gmail_500" } });
  return runStart(ana, w.deps).then(() => {
    for (const [i, f] of w.fails.entries()) {
      const line = startFailureLine(f.reason, i + 1, f.detail);
      for (const pii of ["Ana", "Diaz", "ana@test.dev", "555", "Riverbend"])
        assert(!line.includes(pii), line);
    }
  });
});

// ---------- the browser's send ----------
const answer = (status: number, body: unknown = {}) =>
  Promise.resolve({ status, json: () => Promise.resolve(body) });
const noWait = () => Promise.resolve();

Deno.test("browser start: a 5xx or no answer is tried once more, then it carries on", async () => {
  let n = 0;
  const flaky = await postStart(
    () => (++n === 1 ? answer(502) : answer(200, { progress: "p" })),
    noWait,
  );
  assertEquals(flaky, { kind: "saved", progress: "p" });
  assertEquals(n, 2);
  n = 0;
  const offline = await postStart(() => {
    n++;
    return Promise.reject(new TypeError("Failed to fetch"));
  }, noWait);
  assertEquals(offline, { kind: "failed" });
  assertEquals(n, 2);
  n = 0;
  assertEquals(await postStart(() => (n++, answer(500)), noWait), { kind: "failed" });
  assertEquals(n, 2);
});

Deno.test("browser start: a 400 is shown, and a 404 or 429 is never sent again", async () => {
  let n = 0;
  const bad = await postStart(
    () => (n++, answer(400, { error: "Enter a 10-digit phone number." })),
    noWait,
  );
  assertEquals(bad, { kind: "problem", error: "Enter a 10-digit phone number." });
  assertEquals(n, 1);
  for (const s of [404, 429]) {
    n = 0;
    assertEquals(await postStart(() => (n++, answer(s)), noWait), { kind: "stopped" });
    assertEquals(n, 1);
  }
});

Deno.test("browser start: emailed but not saved is not sent again", async () => {
  assertEquals(
    await postStart(() => answer(200, { ok: true, saved: false, progress: null }), noWait),
    { kind: "emailed" },
  );
  assertEquals(await postStart(() => answer(200, { ok: true, progress: null }), noWait), {
    kind: "saved",
    progress: null,
  });
});

// ---------- the Gmail answer, every way it can go ----------

const sample: Mail = { to: "zeus@test.dev", cc: COPY, subject: "s", text: "t" };

Deno.test("gmail: sent when the token works and Gmail says yes", async () => {
  const posted: string[] = [];
  const r = await gmailSend(sample, {
    token: () => Promise.resolve({ access: "a" }),
    post: (access, m) => (
      posted.push(`${access}:${m.to}`),
      Promise.resolve({ ok: true, status: 200 })
    ),
  });
  assertEquals(r, { ok: true });
  assertEquals(posted, ["a:zeus@test.dev"]);
});

Deno.test("gmail: no mailbox or Google token is no_access, and nothing is posted", async () => {
  let posted = 0;
  const post = () => (posted++, Promise.resolve({ ok: true, status: 200 }));
  assertEquals(
    await gmailSend(sample, {
      token: () => Promise.resolve({ error: "Connect the mailbox" }),
      post,
    }),
    { ok: false, why: "no_access" },
  );
  assertEquals(await gmailSend(sample, { token: () => Promise.resolve({ access: "" }), post }), {
    ok: false,
    why: "no_access",
  });
  assertEquals(posted, 0);
});

Deno.test("gmail: a refusal is gmail_<status>, and a throw anywhere is threw", async () => {
  const token = () => Promise.resolve({ access: "a" });
  assertEquals(
    await gmailSend(sample, { token, post: () => Promise.resolve({ ok: false, status: 403 }) }),
    { ok: false, why: "gmail_403" },
  );
  assertEquals(
    await gmailSend(sample, { token, post: () => Promise.reject(new Error("offline")) }),
    { ok: false, why: "threw" },
  );
  assertEquals(
    await gmailSend(sample, {
      token: () => Promise.reject(new Error("google down")),
      post: () => Promise.resolve({ ok: true, status: 200 }),
    }),
    { ok: false, why: "threw" },
  );
});

Deno.test("gmail: a missing mailbox on a failed save answers 500, not saved:false", async () => {
  const w = world({ insertFails: 2 });
  w.deps.send = (m) =>
    gmailSend(m, {
      token: () => Promise.resolve({ error: "no mailbox" }),
      post: () => Promise.resolve({ ok: true, status: 200 }),
    });
  const r = await runStart(ana, w.deps);
  assertEquals(r.status, 500);
  assertEquals(w.fails.at(-1), { reason: "email_failed", detail: "no_access" });
});

// ---------- what the one-page form does with each answer ----------

Deno.test("paper form: a token is kept, a 400 is shown, and only real misses send again", () => {
  assertEquals(startOutcome({ kind: "saved", progress: "tok" }), {
    problem: "",
    token: "tok",
    retryOnChange: false,
  });
  // saved without a token: a change to the boxes tries again for one
  assertEquals(startOutcome({ kind: "saved", progress: null }), {
    problem: "",
    token: null,
    retryOnChange: true,
  });
  assertEquals(startOutcome({ kind: "problem", error: "Enter a valid email." }), {
    problem: "Enter a valid email.",
    token: null,
    retryOnChange: true,
  });
  assertEquals(startOutcome({ kind: "failed" }), { problem: "", token: null, retryOnChange: true });
  // the team has them by email, or the link or network said no: don't send it again
  for (const kind of ["emailed", "stopped"] as const)
    assertEquals(startOutcome({ kind }), { problem: "", token: null, retryOnChange: false });
});

Deno.test("server: the start route hands runStart the database and checks Gmail's answer", () => {
  assert(server.includes("const reply = await runStart("));
  assert(server.includes("return gmailSend(m, {"));
  assert(server.includes("token: () => gmailAccessToken(svc),"));
  assert(paper.includes("const o = startOutcome(a);"));
  // the failure log is the no-PII line, never the lead
  assert(server.includes("console.warn(startFailureLine(reason, n, detail))"));
  assert(!/console\.\w+\([^)]*(email|phone|first|last)\b/.test(server));
  assert(paper.includes("void postStart(() =>"));
  assert(!paper.includes("r.ok ? r.json() : null"));
});
