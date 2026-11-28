// deno test --node-modules-dir=none tests/team-alerts.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  channelKey,
  channelText,
  dmText,
  esc,
  isDiscordId,
  lampLink,
  leadsText,
  linkPayload,
  memberRows,
  parseCommand,
  readLinkToken,
  todayText,
  type TeamNotification,
} from "../src/lib/team-alerts.ts";

const SITE = "https://getlamp.app";
const n = (o: Partial<TeamNotification>): TeamNotification => ({
  id: 1,
  kind: "file",
  title: "New file: Joe's *Best* Deli @everyone",
  body: "Signed from an application link.",
  link: "/staff?file=abc",
  application_id: "abc",
  ...o,
});

Deno.test("dm: bold title, body, a link back into Lamp; markdown and pings stay plain", () => {
  const t = dmText(n({}), SITE);
  assert(t.startsWith("**New file: Joe's \\*Best\\* Deli @​everyone**\n"));
  assert(t.endsWith("[Open in Lamp](<https://getlamp.app/staff?file=abc>)"));
  assert(!t.includes("@everyone"));
});

Deno.test("links: only paths on the site", () => {
  assertEquals(lampLink(SITE, "/staff"), "https://getlamp.app/staff");
  assertEquals(lampLink(SITE, "https://evil.example"), null);
  assertEquals(lampLink(SITE, "//evil.example"), null);
  assert(dmText(n({ link: "javascript:x" }), SITE).endsWith("(<https://getlamp.app/staff>)"));
});

Deno.test("channel: deal events once per event, with the rep", () => {
  assertEquals(channelKey(n({})), "file:abc");
  assertEquals(channelKey(n({ kind: "assigned" })), null);
  assertEquals(channelKey(n({ application_id: null })), null);
  assert(
    channelText(n({ kind: "funded", title: "Funded: ISK" }), SITE, "Zeus").startsWith(
      "💰 **Funded: ISK** · Zeus",
    ),
  );
});

Deno.test("command: Discord subcommands", () => {
  assertEquals(parseCommand([{ name: "today", type: 1 }]), { cmd: "today" });
  assertEquals(parseCommand([{ name: "link", type: 1 }]), { cmd: "link" });
  assertEquals(
    parseCommand([
      { name: "lead", type: 1, options: [{ name: "query", type: 3, value: "  ISK   co " }] },
    ]),
    { cmd: "lead", query: "ISK co" },
  );
  assertEquals(
    parseCommand([{ name: "lead", type: 1, options: [{ name: "query", value: "x" }] }]),
    { cmd: "help" },
  );
  assertEquals(parseCommand(undefined), { cmd: "help" });
  assertEquals(parseCommand([{ name: "help" }]), { cmd: "help" });
});

Deno.test("link token: shape, expiry, and Discord ids", () => {
  const now = 1_762_300_000_000;
  const sig = "a".repeat(43);
  const tok = `${linkPayload("123456789012345678", now + 60_000)}.${sig}`;
  assertEquals(readLinkToken(tok, now), {
    discordId: "123456789012345678",
    expires: now + 60_000,
    sig,
  });
  assertEquals(readLinkToken(tok, now + 120_000), null);
  assertEquals(readLinkToken("123.456.abc", now), null);
  assertEquals(readLinkToken(42, now), null);
  assert(isDiscordId("123456789012345678"));
  assert(!isDiscordId("12345"));
  assert(!isDiscordId("12345678901234567x"));
});

Deno.test("answers: today and lead hits read plainly", () => {
  const t = todayText("Zeus", { new: 28, callback: 2, dead: 0 }, { submitted: 1 }, SITE);
  assert(t.includes("Engine leads: 28 new, 2 callback"));
  assert(t.includes("Files: 1 submitted"));
  assertEquals(leadsText("zz", [], false), 'No leads of yours match "zz".');
  assertEquals(
    leadsText(
      "isk",
      [
        {
          name: "ISK CONSTRUCTION",
          phone: "3473800756",
          contact_phone: null,
          status: "no_answer",
          owner: "Gjovalin Celaj",
          city: "BRONX",
          state: "NY",
        },
      ],
      true,
    ),
    "• **ISK CONSTRUCTION** (BRONX, NY) · ask for Gjovalin Celaj · 3473800756 · no answer\n_More match; add a word to narrow it._",
  );
  assertEquals(esc("a_b"), "a\\_b");
});

Deno.test("member list: people only, named as the server shows them, once, A to Z", () => {
  const rows = memberRows([
    { nick: null, user: { id: "111111111111111111", username: "zeus99", global_name: "Zeus" } },
    { nick: "Stevie M", user: { id: "222222222222222222", username: "stevie", global_name: null } },
    { user: { id: "333333333333333333", username: "lamp", bot: true } },
    { user: { id: "444444444444444444", username: "darrell_x", global_name: "" } },
    { user: { id: "111111111111111111", username: "zeus99", global_name: "Zeus" } },
    { user: { id: "nope", username: "bad" } },
    null,
  ]);
  assertEquals(rows, [
    { id: "444444444444444444", name: "darrell_x", username: "darrell_x" },
    { id: "222222222222222222", name: "Stevie M", username: "stevie" },
    { id: "111111111111111111", name: "Zeus", username: "zeus99" },
  ]);
  assertEquals(memberRows({ message: "Missing Access" }), []);
});

Deno.test("channel: a website file every admin hears is still one #deals post", () => {
  // notify_admins (20261127100000_unassigned_alerts.sql) writes one row per admin for one file
  const forAda = n({
    id: 7,
    title: "New file: ISK",
    body: "Came in from the website with no rep yet.",
  });
  const forBo = { ...forAda, id: 8 };
  assertEquals(channelKey(forAda), "file:abc");
  assertEquals(channelKey(forAda), channelKey(forBo));
  assertEquals(new Set([forAda, forBo].map(channelKey)).size, 1);
  // two files are two posts
  assert(channelKey(forAda) !== channelKey({ ...forBo, application_id: "def" }));
  // an unassigned start carries no file: the admins' DMs only, never #deals
  assertEquals(
    channelKey(n({ kind: "started", title: "Started on the website: Joe", application_id: null })),
    null,
  );
});
