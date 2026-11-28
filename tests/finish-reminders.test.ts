// deno test --node-modules-dir=none tests/finish-reminders.test.ts
// "Finish your application" reminders (Asad, 2026-11-19): an hour after someone leaves, then the
// next morning, then nothing; never at night; stopped by signing, the stop link or a rep.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  easternParts,
  easternTime,
  firstReminderAt,
  inviteIdOf,
  inviteLeftAt,
  leadLeftAt,
  parseStopToken,
  REMIND_TOKEN,
  reminderLine,
  reminderPlan,
  remindToken,
  secondReminderAt,
  sign,
  STALE_MS,
  stopToken,
} from "../src/lib/finish-reminders.ts";
import { isToken, reminderEmail } from "../src/lib/application-links.ts";
import { reminderRun } from "../src/lib/notice-retry.ts";
import server from "../src/lib/finish-reminders.server.ts" with { type: "text" };
import links from "../src/lib/application-links.server.ts" with { type: "text" };
import stopPage from "../src/routes/reminders.stop.tsx" with { type: "text" };
import started from "../src/components/staff/started-leads.tsx" with { type: "text" };
import sentLinks from "../src/components/staff/sent-applications.tsx" with { type: "text" };
import migration from "../supabase/migrations/20261120090000_finish_reminders.sql" with { type: "text" };
import schedule from "../supabase/migrations/20261120090100_finish_reminders_schedule.sql" with { type: "text" };

const et = (y: number, m: number, d: number, h: number, min = 0) => easternTime(y, m, d, h, min);
const wall = (t: Date) => {
  const p = easternParts(t);
  return `${p.m}/${p.d} ${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
};

Deno.test("Eastern time: wall clock and back, in winter and summer", () => {
  assertEquals(et(2026, 11, 19, 14).toISOString(), "2026-11-19T19:00:00.000Z"); // EST, UTC-5
  assertEquals(et(2026, 7, 1, 14).toISOString(), "2026-07-01T18:00:00.000Z"); // EDT, UTC-4
  assertEquals(wall(et(2026, 11, 30, 9, 30)), "11/30 09:30");
  // a day past the month's end rolls over
  assertEquals(wall(et(2026, 11, 31, 9, 30)), "12/1 09:30");
});

Deno.test("first reminder: an hour later, or 9:30 when that lands at night", () => {
  assertEquals(wall(firstReminderAt(et(2026, 11, 19, 14))), "11/19 15:00");
  assertEquals(wall(firstReminderAt(et(2026, 11, 19, 7, 15))), "11/19 08:15");
  // left at 20:30: 21:30 is quiet, so the next morning
  assertEquals(wall(firstReminderAt(et(2026, 11, 19, 20, 30))), "11/20 09:30");
  // left at 2 am: 3 am is quiet, so 9:30 that morning
  assertEquals(wall(firstReminderAt(et(2026, 11, 19, 2))), "11/19 09:30");
  // second: 9:30 the morning after the first
  assertEquals(wall(secondReminderAt(et(2026, 11, 19, 15))), "11/20 09:30");
  assertEquals(wall(secondReminderAt(et(2026, 11, 20, 9, 30))), "11/21 09:30");
});

Deno.test("plan: two reminders, then nothing; stale ones are skipped, never sent late", () => {
  const left = et(2026, 11, 19, 14);
  const s = { leftAt: left, sent: 0, lastAt: null, stoppedAt: null };
  const before = reminderPlan(s, et(2026, 11, 19, 14, 30));
  assert(before.kind === "next" && before.n === 1 && !before.due);
  const due = reminderPlan(s, et(2026, 11, 19, 15, 5));
  assert(due.kind === "next" && due.n === 1 && due.due);
  // switched on long after they left: no catch-up email
  assertEquals(
    reminderPlan(s, new Date(et(2026, 11, 19, 15).getTime() + STALE_MS + 60_000)).kind,
    "missed",
  );
  const one = { leftAt: left, sent: 1, lastAt: et(2026, 11, 19, 15), stoppedAt: null };
  const next = reminderPlan(one, et(2026, 11, 20, 9, 40));
  assert(next.kind === "next" && next.n === 2 && next.due);
  assertEquals(reminderPlan(one, et(2026, 11, 21, 9, 40)).kind, "done");
  assertEquals(reminderPlan({ ...one, sent: 2 }, et(2026, 11, 20, 9, 40)).kind, "done");
  assertEquals(
    reminderPlan({ ...one, stoppedAt: et(2026, 11, 19, 16) }, et(2026, 11, 20, 9, 40)).kind,
    "stopped",
  );
});

Deno.test("quiet hours: a late reminder never goes out at night; it waits, then is skipped", () => {
  // started 12:39, due 13:39; the site goes live at 23:00: not then
  const s = { leftAt: et(2026, 11, 19, 12, 39), sent: 0, lastAt: null, stoppedAt: null };
  const night = reminderPlan(s, et(2026, 11, 19, 23));
  assert(night.kind === "next" && !night.due);
  // by 8:00 it is more than 12 hours late: skipped, never sent
  assertEquals(reminderPlan(s, et(2026, 11, 20, 8)).kind, "missed");
  // the same lateness in the evening still sends (before 21:00)
  const evening = reminderPlan(s, et(2026, 11, 19, 20, 50));
  assert(evening.kind === "next" && evening.due);
});

Deno.test("left at: their furthest step, never before they started", () => {
  const created = "2026-11-19T19:00:00.000Z";
  assertEquals(leadLeftAt(created, null).toISOString(), created);
  assertEquals(
    leadLeftAt(created, {
      progress: { stage: "owners", at: "2026-11-19T19:20:00.000Z" },
    }).toISOString(),
    "2026-11-19T19:20:00.000Z",
  );
  assertEquals(leadLeftAt(created, { progress: { at: "garbage" } }).toISOString(), created);
  assertEquals(
    inviteLeftAt(created, "2026-11-19T19:45:00.000Z").toISOString(),
    "2026-11-19T19:45:00.000Z",
  );
  assertEquals(inviteLeftAt(created, null).toISOString(), created);
});

Deno.test(
  "links: a reminder's link opens the same personal link until the rep resends it",
  async () => {
    const id = "0b7e7c1e-3f1a-4c55-9d0e-6a2b9c1d2e3f";
    const t = await remindToken("secret-a", id, "hash-1");
    assert(REMIND_TOKEN.test(t) && isToken(t), t);
    assertEquals(t.length, 55);
    assertEquals(inviteIdOf(t), id);
    // a resend changes the link's hash: the old reminder link no longer matches
    assert(t !== (await remindToken("secret-a", id, "hash-2")));
    assert(t !== (await remindToken("secret-b", id, "hash-1")));
    // a rep's own 43-character token is never read as a reminder link
    assert(!REMIND_TOKEN.test("a".repeat(43)));
    // the lookup checks the signature before trusting the id in it
    assert(links.includes("sameText(token, await remindToken(secret, row.id, row.token_hash))"));
    assert(links.includes("tokenHash = found.tokenHash;"));
  },
);

Deno.test("stop links: signed per person; a changed id or signature is refused", async () => {
  const id = "0b7e7c1e-3f1a-4c55-9d0e-6a2b9c1d2e3f";
  const t = await stopToken("s", "lead", id);
  const p = parseStopToken(t)!;
  assertEquals(p.kind, "lead");
  assertEquals(p.id, id);
  assertEquals(p.sig, await sign("s", `stop:lead:${id}`));
  assert(p.sig !== (await sign("s", `stop:invite:${id}`)));
  assertEquals(parseStopToken("x." + id + "." + p.sig), null);
  assertEquals(parseStopToken(42), null);
  assert(server.includes("sameText(t.sig, await sign(secret, `stop:${t.kind}:${t.id}`))"));
  // opening the page changes nothing (mail scanners open links): only the button posts
  assertEquals(stopPage.match(/fetch\(/g)?.length, 1);
  assert(stopPage.includes("onClick={() => void stop()}"));
});

Deno.test("the email: the map's words, honest about what's saved, a working stop link", () => {
  const base = {
    firstName: "Thomas",
    businessName: "Sample Counseling LLC",
    repName: "Zeus Diaz",
    url: "https://getlamp.app/application/zeus?i=r0b7e",
    stopUrl: "https://getlamp.app/reminders/stop?t=l.x.y",
    legalName: "Lamp Capital Group LLC",
    address: "206 E Broad St, Westfield, NJ 07090",
  };
  const one = reminderEmail({ ...base, n: 1 });
  assertEquals(one.subject, "Finish your Lamp application for Sample Counseling LLC");
  assert(one.text.startsWith("Hi Thomas,"));
  assert(one.text.includes("You're most of the way there."));
  assert(
    one.text.includes("On the phone or computer you started on, it picks up where you left off."),
  );
  assert(one.text.includes(`Finish my application: ${base.url}`));
  assert(one.html.includes(`href="${base.url}"`));
  assert(one.text.includes(`Don't want reminders? Stop them: ${base.stopUrl}`));
  assert(one.html.includes(`<a href="${base.stopUrl}"`));
  assert(one.text.includes("from Zeus Diaz's link"));
  assert(one.text.includes("Zeus Diaz\r\nLamp · getlamp.app"));
  const two = reminderEmail({ ...base, n: 2, repName: null, businessName: "" });
  assertEquals(two.subject, "Your Lamp application is still open");
  assert(two.text.includes("This is the last reminder we'll send."));
  assert(two.text.includes("The Lamp team\r\nLamp · getlamp.app"));
  assert(!two.text.includes("'s link"));
  for (const m of [one, two])
    for (const part of [m.subject, m.text, m.html]) {
      assert(!/\bloans?\b/i.test(part));
      // the answers live in their browser: never promise they're saved everywhere
      assert(!/already saved|answers so far are saved/i.test(part));
    }
});

Deno.test("staff line: what went out and what's next", () => {
  const when = (d: Date) => wall(d);
  const left = et(2026, 11, 19, 14);
  const s = { leftAt: left, sent: 1, lastAt: et(2026, 11, 19, 15), stoppedAt: null };
  assertEquals(
    reminderLine(reminderPlan(s, et(2026, 11, 19, 18)), 1, s.lastAt, when),
    "Reminder 1 sent 11/19 15:00. Next reminder 11/20 09:30.",
  );
  assertEquals(
    reminderLine(
      reminderPlan({ ...s, sent: 2 }, et(2026, 11, 20, 10)),
      2,
      et(2026, 11, 20, 9, 30),
      when,
    ),
    "Reminder 2 sent 11/20 09:30. No more reminders.",
  );
  assert(started.includes('<ReminderStatus\n                  kind="lead"'));
  assert(sentLinks.includes('kind="invite"'));
});

Deno.test("job: checks before every send, claims before sending, gives back on failure", () => {
  // who: recent, unsigned, not stopped, fewer than two
  assert(server.includes("const WINDOW_MS = 3 * 86_400_000;"));
  assert(server.includes('.is("converted_application_id", null)'));
  assert(server.includes('.is("submitted_at", null)'));
  assert(server.includes('.is("cancelled_at", null)'));
  // never Lamp's own team, anyone do-not-contact, or an email that signed since; a failed check waits
  assert(server.includes("isLampAddress(email, staff)"));
  assert(server.includes("if (signed !== false || dnc !== false)"));
  // one email per person per tick, and a claim that only one tick can win
  assert(server.includes("seen.has(email)"));
  assert(server.includes('.eq("reminders_sent", d.n - 1)'));
  assert(server.includes("reminders_sent: d.n - 1, reminded_at: d.lastAt"));
  // from the rep, the person they report to copied; the website as Lamp
  assert(server.includes('fromName: rep ? `${rep.name} at Lamp` : "Lamp"'));
  assert(server.includes("cc: rep ? await ccFor(svc, rep) : null"));
  // only the database (or a scheduler with the secret) can start a run
  assert(server.includes('sameText(request.headers.get("x-finish-remind-secret") ?? "", secret)'));
  // a rep stops only their own; a website lead is an admin's
  assert(server.includes("ownRow(isAdmin, ownSlug, row.rep_slug)"));
});

Deno.test(
  "database: columns and secret in one file, the schedule (the on switch) in another",
  () => {
    for (const c of [
      "reminders_sent int not null default 0",
      "reminded_at timestamptz",
      "reminders_stopped_at timestamptz",
    ])
      assertEquals(migration.split(c).length - 1, 2, c);
    assert(
      migration.includes(
        "grant execute on function public.finish_remind_secret() to service_role;",
      ),
    );
    assert(
      migration.includes(
        "revoke all on function public.finish_remind_tick() from public, anon, authenticated;",
      ),
    );
    assert(!migration.includes("cron.schedule"));
    assert(schedule.includes("cron.schedule('lamp-finish-reminders', '*/10 * * * *'"));
    assert(schedule.includes("select cron.unschedule('lamp-finish-reminders');"));
  },
);

Deno.test(
  "run: the new-file sweep runs on every run with a mailbox, even with no reminder due",
  async () => {
    const order: string[] = [];
    const notices = { checked: 1, sent: 1, failed: 0, stale: 0 };
    const r = await reminderRun({
      access: () => Promise.resolve({ access: "tok" }),
      sweep: (access) => {
        order.push(`sweep:${access}`);
        return Promise.resolve(notices);
      },
      due: 0,
      remind: () => {
        order.push("remind");
        return Promise.resolve({ sent: 0 });
      },
    });
    assertEquals(order, ["sweep:tok"]);
    assertEquals(r, { mailbox: true, notices, reminders: null });

    // with reminders due: the sweep first, then the reminders, both with the one token
    order.length = 0;
    const due = await reminderRun({
      access: () => Promise.resolve({ access: "tok" }),
      sweep: () => {
        order.push("sweep");
        return Promise.resolve(notices);
      },
      due: 3,
      remind: (access) => {
        order.push(`remind:${access}`);
        return Promise.resolve({ sent: 3 });
      },
    });
    assertEquals(order, ["sweep", "remind:tok"]);
    assertEquals(due, { mailbox: true, notices, reminders: { sent: 3 } });
  },
);

Deno.test("run: no mailbox (or Google throws) means no sweep and no reminders", async () => {
  let ran = 0;
  const steps = {
    sweep: () => {
      ran++;
      return Promise.resolve({ checked: 0, sent: 0, failed: 0, stale: 0 });
    },
    due: 2,
    remind: () => {
      ran++;
      return Promise.resolve(null);
    },
  };
  assertEquals(
    await reminderRun({ ...steps, access: () => Promise.resolve({ error: "Not connected." }) }),
    { mailbox: false, skipped: "Not connected." },
  );
  assertEquals(await reminderRun({ ...steps, access: () => Promise.reject(new Error("down")) }), {
    mailbox: false,
    skipped: "Couldn't reach Google.",
  });
  assertEquals(ran, 0);
  // a sweep that throws never stops the reminders
  let reminded = false;
  const r = await reminderRun({
    access: () => Promise.resolve({ access: "tok" }),
    sweep: () => Promise.reject(new Error("db")),
    due: 1,
    remind: () => {
      reminded = true;
      return Promise.resolve({ sent: 1 });
    },
  });
  assert(reminded);
  assert(r.mailbox && r.notices.error);
});

Deno.test(
  "server: finishReminders runs through reminderRun, and no early return skips the sweep",
  () => {
    const fn = server.slice(
      server.indexOf("export async function finishReminders("),
      server.indexOf("async function sendReminders("),
    );
    assert(fn.includes("const run = await reminderRun({"));
    assert(fn.includes("noticeSweep(noticeStore(svc), now.getTime()"));
    assert(fn.includes("sendNewApplicationNotice(svc, appId, { access })"));
    // the old "nothing due" return came before the mailbox and is gone
    assert(!fn.includes("if (!due.length) return"));
    const runAt = fn.indexOf("const run = await reminderRun(");
    // after the secret check, nothing returns before the run
    const between = fn.slice(
      fn.indexOf('return json(401, { error: "Not the database." });') + 50,
      runAt,
    );
    assert(!between.includes("return json("));
  },
);
