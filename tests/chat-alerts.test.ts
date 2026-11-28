// deno test --node-modules-dir=none tests/chat-alerts.test.ts
// A merchant's chat message rings the bell (20261127110000_chat_staff_alerts.sql). The database side
// is proven on a local stack by tests/chat-alerts.local.ts; this covers the bell's count, how the
// alert reaches Discord, and that the migration keeps what main already had.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { alertThread, bellCount, unreadThreads } from "../src/lib/chat.ts";
import {
  channelKey,
  CHANNEL_KINDS,
  dmText,
  type TeamNotification,
} from "../src/lib/team-alerts.ts";
import alertsSql from "../supabase/migrations/20261127110000_chat_staff_alerts.sql" with { type: "text" };
import notesSql from "../supabase/migrations/20261029140000_file_notes_and_calls.sql" with { type: "text" };
import staffChatSql from "../supabase/migrations/20261110120000_chat_staff.sql" with { type: "text" };

const A = "0b8c6f3e-4a1d-4f6e-9a77-2d5c1e9b0a11";
const B = "6d2f0a9c-1e3b-4c5d-8e7f-9a0b1c2d3e4f";
const DM1 = "11111111-2222-4333-8444-555555555555";
const DM2 = "99999999-8888-4777-8666-555555555555";
const link = (thread: string) => `/staff?view=messages&thread=${thread}`;

const note = (kind: string, read = false, thread?: string) => ({
  kind,
  read_at: read ? "2026-11-27T12:00:00Z" : null,
  link: thread ? link(thread) : null,
});

Deno.test("bell: a message alert opens the conversation its link names", () => {
  assertEquals(alertThread(link(A)), A);
  assertEquals(alertThread(link(A.toUpperCase())), A);
  assertEquals(alertThread(`/staff?thread=${A}&view=messages`), A);
  assertEquals(alertThread("/staff?view=messages"), null);
  assertEquals(alertThread("/staff?view=messages&thread=not-a-uuid"), null);
  assertEquals(alertThread(null), null);
  // the link the migration writes is the one parsed here
  assert(alertsSql.includes("lnk := '/staff?view=messages&thread=' || t.id;"));
});

Deno.test("bell: the unread conversations are the inbox rows marked unread", () => {
  assertEquals(
    unreadThreads([
      { thread_id: A, unread: true },
      { thread_id: B, unread: false },
      { thread_id: DM1, unread: true },
    ]),
    [A, DM1],
  );
  assertEquals(unreadThreads([]), []);
});

Deno.test(
  "bell: a merchant's message counts once, not as an alert plus an unread conversation",
  () => {
    // one message alert, and its conversation is unread
    assertEquals(bellCount([note("message", false, A)], [A]), 1);
    // two alerts on two unread conversations, plus a later alert on the same one
    assertEquals(
      bellCount(
        [note("message", false, A), note("message", false, B), note("message", false, A)],
        [A, B],
      ),
      2,
    );
  },
);

Deno.test("bell: other notifications still add to unread conversations", () => {
  assertEquals(bellCount([note("file"), note("document")], [DM1, DM2]), 4);
  assertEquals(bellCount([note("file"), note("message", false, A)], [A]), 2);
  // a staff DM with something new and no alert, next to a merchant's alert on an unread conversation
  assertEquals(bellCount([note("message", false, A)], [A, DM1]), 2);
});

Deno.test(
  "bell: an alert whose conversation was read still counts, next to other unread conversations",
  () => {
    // the rep read merchant A's conversation in the side panel; its alert row is still unread under
    // the bell, and two staff DMs are unread: the bell lists three things, so the badge says 3
    assertEquals(bellCount([note("message", false, A)], [DM1, DM2]), 3);
    assertEquals(bellCount([note("message", false, A)], []), 1);
    // an alert whose link names no conversation is never folded into one
    assertEquals(bellCount([{ kind: "message", read_at: null, link: null }], [A]), 2);
  },
);

Deno.test("bell: read rows never count", () => {
  assertEquals(bellCount([note("message", true, A), note("file", true)], []), 0);
  assertEquals(bellCount([note("message", true, A)], [A]), 1);
  assertEquals(bellCount([], []), 0);
});

const alert: TeamNotification = {
  id: 7,
  kind: "message",
  title: "Message from Joe's *Best* Deli",
  body: null,
  link: "/staff?view=messages&thread=0b8c6f3e-4a1d-4f6e-9a77-2d5c1e9b0a11",
  application_id: "a1b2c3d4-0000-4000-8000-000000000001",
};

Deno.test("discord: a message alert is the person's DM only, never #deals", () => {
  assert(!(CHANNEL_KINDS as readonly string[]).includes("message"));
  assertEquals(channelKey(alert), null);
});

Deno.test(
  "discord: the DM says who wrote and links to the conversation, with no message text",
  () => {
    assertEquals(
      dmText(alert, "https://getlamp.app"),
      "**Message from Joe's \\*Best\\* Deli**\n" +
        "[Open in Lamp](<https://getlamp.app/staff?view=messages&thread=0b8c6f3e-4a1d-4f6e-9a77-2d5c1e9b0a11>)",
    );
  },
);

/** The kinds a notifications_kind_check in this SQL allows (the last one, if several). */
function kinds(sql: string): string[] {
  const all = [...sql.matchAll(/notifications_kind_check\s+check \(kind in \(([^)]*)\)\)/g)];
  assert(all.length, "no notifications_kind_check in this file");
  return all[all.length - 1]![1]!.split(",").map((k) => k.trim().replace(/^'|'$/g, ""));
}

Deno.test("migration: the kind check keeps every kind main had and adds 'message'", () => {
  const before = kinds(notesSql);
  const after = kinds(alertsSql);
  for (const k of before) assert(after.includes(k), `dropped ${k}`);
  assertEquals(
    after.filter((k) => !before.includes(k)),
    ["message"],
  );
});

Deno.test("migration: the new trigger still keeps the conversation's clock", () => {
  const clock =
    /update public\.chat_threads set last_message_at = new\.created_at, last_author = new\.author\s+where id = new\.thread_id and \(last_message_at is null or last_message_at <= new\.created_at\);/;
  assert(clock.test(staffChatSql));
  assert(clock.test(alertsSql));
});

Deno.test("migration: the alert never carries the message's words", () => {
  // the only notify calls pass a null body
  const calls = [
    ...alertsSql.matchAll(/perform public\.notify(?:_rep_and_lead)?\(([^;]*)\);/g),
  ].map((m) => m[1]!.replace(/\s+/g, " "));
  assertEquals(calls.length, 2);
  for (const c of calls) assert(/'message', ttl, null, lnk, a\.id/.test(c), c);
  assert(!/new\.body/.test(alertsSql));
});
