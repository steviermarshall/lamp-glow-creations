// deno test --node-modules-dir=none tests/funder-send.test.ts
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  b64,
  buildMime,
  emailText,
  type FileSummary,
  type Match,
  num,
  pickFunders,
  safeFilename,
  sameSecret,
} from "../src/lib/funder-send.ts";

const m = (over: Partial<Match>): Match => ({
  funder_id: "f1",
  funder_name: "Alpha",
  submission_email: "subs@alpha.example",
  auto_send: false,
  already_sent: false,
  eligible: true,
  blockers: [],
  checks: [],
  ...over,
});

Deno.test("manual sends only the ticked, eligible, unsent funders", () => {
  const matches = [
    m({ funder_id: "a" }),
    m({ funder_id: "b", eligible: false, blockers: ["credit under 650"] }),
    m({ funder_id: "c", already_sent: true }),
    m({ funder_id: "d" }),
    m({ funder_id: "e", submission_email: null }),
  ];
  const picks = pickFunders(matches, "manual", ["a", "b", "c", "e", "zzz"]);
  const by = Object.fromEntries(picks.map((p) => [p.match.funder_id, p]));
  assertEquals(by.a.send, true);
  assertEquals(by.b.send, false);
  assertEquals(by.b.reason, "credit under 650");
  assertEquals(by.c.reason, "already sent this file");
  assertEquals(by.e.reason, "no submission email on the funder");
  assertEquals(by.zzz.reason, "not an active funder");
  assertEquals(by.d, undefined, "an unticked funder is not even listed");
});

Deno.test("auto sends only to funders with auto_send on", () => {
  const picks = pickFunders([m({ funder_id: "a", auto_send: true }), m({ funder_id: "b" })], "auto", null);
  assertEquals(picks.map((p) => [p.match.funder_id, p.send]), [["a", true]]);
});

Deno.test("manual with nothing ticked sends nothing", () => {
  assertEquals(pickFunders([m({})], "manual", []).length, 0);
  assertEquals(pickFunders([m({})], "manual", null).length, 0);
});

const summary: FileSummary = {
  fileId: "bbbbbbbb-0000-0000-0000-00000000000a",
  legalName: "Truck Co LLC",
  dba: "",
  state: "NJ",
  industry: "Trucking & logistics",
  startDate: "2023-10-24",
  monthlyDeposits: 80000,
  requested: 60000,
  openPositions: 1,
  repName: "Zeus",
};

Deno.test("email text carries the summary and never the word loan", () => {
  const t = emailText(summary, "Dana", ["Lamp application - Truck Co LLC.pdf", "Bank statement 1 - jan.pdf"], "partners@getlamp.app");
  assertEquals(t.subject, "New submission: Truck Co LLC – $60,000 – Lamp");
  assert(t.body.startsWith("Hi Dana,"));
  assert(t.body.includes("Monthly deposits (stated): $80,000"));
  assert(t.body.includes("Lamp file BBBBBBBB · Rep: Zeus"));
  assert(t.body.includes("- Bank statement 1 - jan.pdf"));
  assert(!/loan/i.test(t.subject + t.body));
  assert(!/\d{3}-\d{2}-\d{4}/.test(t.body), "no SSN-shaped text in the body");
});

Deno.test("missing figures read as not stated", () => {
  const t = emailText({ ...summary, monthlyDeposits: null, requested: null, openPositions: null, state: "" }, null, [], "x@y.z");
  assert(t.body.startsWith("Hi team,"));
  assert(t.body.includes("Amount requested: not stated"));
  assert(t.body.includes("Open positions: not stated"));
});

Deno.test("MIME message: headers, text part, attachment round-trips", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 fake bytes ü");
  const raw = buildMime({
    from: "Lamp <partners@getlamp.app>",
    to: "subs@alpha.example",
    subject: "New submission: Café Ünïcode – $1",
    body: "Hello",
    attachments: [{ name: "../evil\"name.pdf", mime: "application/pdf", bytes: pdf }],
    boundary: "B",
  });
  assert(raw.includes("To: subs@alpha.example\r\n"));
  assert(raw.includes("Subject: =?UTF-8?B?"), "non-ASCII subject is encoded");
  assert(raw.includes('Content-Type: multipart/mixed; boundary="B"'));
  assert(raw.includes('filename="evilname.pdf"'), "path and quote stripped from the filename");
  assert(raw.trimEnd().endsWith("--B--"));
  const part = raw.split("--B")[2].split("\r\n\r\n")[1].replace(/\r\n/g, "");
  assertEquals(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0))), "%PDF-1.7 fake bytes ü");
});

Deno.test("MIME refuses header injection in the address", () => {
  assertThrows(() => buildMime({ from: "a@b.c", to: "x@y.z\r\nBcc: z@q.r", subject: "s", body: "b", attachments: [] }));
});

Deno.test("base64 wraps at 76 and handles large input", () => {
  const big = new Uint8Array(200_000).map((_, i) => i % 251);
  const s = b64(big);
  assert(s.split("\r\n").every((l) => l.length <= 76));
  assertEquals(Uint8Array.from(atob(s.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)), big);
});

Deno.test("shared secret compare", () => {
  assert(sameSecret("abc123", "abc123"));
  assert(!sameSecret("abc123", "abc124"));
  assert(!sameSecret("", ""));
  assert(!sameSecret("abc", "abcd"));
});

Deno.test("num and safeFilename", () => {
  assertEquals(num("80,000"), 80000);
  assertEquals(num(""), null);
  assertEquals(num(null), null);
  assertEquals(safeFilename("C:\\Users\\x\\März.pdf"), "Marz.pdf");
  assertEquals(safeFilename(""), "file");
});
