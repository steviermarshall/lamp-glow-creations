// deno test --node-modules-dir=none tests/engine-leads.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  BOARD_MAX_CSV,
  boardBatch,
  leadsFromCsv,
  leadsToCsv,
  type LeadExport,
  searchFilter,
} from "../src/lib/engine-leads.ts";

Deno.test("search: empty box searches nothing", () => {
  assertEquals(searchFilter("   "), null);
  assertEquals(searchFilter("(),*%"), null);
});

Deno.test("search: words match name, email, city, industry and phone", () => {
  assertEquals(
    searchFilter("Acme Roofing"),
    'name.ilike."%Acme Roofing%",email.ilike."%Acme Roofing%",city.ilike."%Acme Roofing%",industry.ilike."%Acme Roofing%",phone.ilike."%Acme Roofing%"',
  );
});

Deno.test("search: filter syntax can't be injected", () => {
  const f = searchFilter('x",status.eq.dead,name.ilike."y')!;
  assert(!f.includes('"x"'));
  assertEquals(f.split(",").length, 5);
  assert(!/[(),]/.test(f.replace(/",/g, "")));
});

Deno.test("search: a number finds phones however they're written", () => {
  const f = searchFilter("718-555")!;
  assert(f.endsWith('phone.ilike."%7%1%8%5%5%5%"'));
  assert(searchFilter("12")!.endsWith('phone.ilike."%12%"'));
});

const row = (o: Partial<LeadExport>): LeadExport => ({
  name: null,
  phone: null,
  email: null,
  city: null,
  state: null,
  industry: null,
  tier: null,
  need: null,
  reason: null,
  signals: [],
  first_found: null,
  status: "new",
  notes: "",
  rep_slug: null,
  worked_at: null,
  ...o,
});

Deno.test("csv: header, quoting, labels and rep names", () => {
  const csv = leadsToCsv(
    [
      row({
        name: 'Joe\'s "Best" Deli, LLC',
        phone: "(718) 555-1212",
        status: "no_answer",
        rep_slug: "zeus",
        notes: "line one\nline two",
        signals: [{ source: "nyc_permit", signal_date: "2026-10-01" }],
        worked_at: "2026-10-28T14:00:00Z",
      }),
    ],
    (s) => (s === "zeus" ? "Zeus" : ""),
  );
  assert(csv.startsWith("﻿Business,Phone,Email"));
  const [, line] = csv.slice(1).split("\r\n");
  assert(line.startsWith('"Joe\'s ""Best"" Deli, LLC",(718) 555-1212,'));
  assert(line.includes(",No answer,"));
  assert(line.includes('"line one\nline two",Zeus,2026-10-28'));
  assert(line.includes("nyc_permit 2026-10-01"));
});

Deno.test("csv: a cell that looks like a formula opens as text", () => {
  const csv = leadsToCsv(
    [row({ name: '=HYPERLINK("http://x")', phone: "+1 718 555 1212", notes: "@sum" })],
    () => "",
  );
  const line = csv.slice(1).split("\r\n")[1];
  assert(line.startsWith(`"'=HYPERLINK(""http://x"")",'+1 718 555 1212,`));
  assert(line.includes(",'@sum,"));
});

const BOARD_CSV =
  "source,source_key,name,phone,rep_slug\r\nwar-room-engine,k1,Acme,(718) 555-1212,zeus\r\n";

Deno.test("board: a well-formed batch is taken and reads like the downloaded file", () => {
  const b = boardBatch({
    type: "lamp-board:leads",
    batch: 7,
    label: " 1 lead for Zeus ",
    csv: BOARD_CSV,
  });
  assertEquals(b, { batch: 7, label: "1 lead for Zeus", csv: BOARD_CSV });
  const { leads, problems } = leadsFromCsv(b!.csv, ["zeus"], null);
  assertEquals(problems, []);
  assertEquals(leads[0].rep_slug, "zeus");
});

Deno.test("board: anything else is ignored", () => {
  assertEquals(boardBatch(null), null);
  assertEquals(boardBatch("lamp-board:leads"), null);
  assertEquals(boardBatch({ type: "other", batch: 1, csv: BOARD_CSV }), null);
  assertEquals(boardBatch({ type: "lamp-board:leads", batch: 0, csv: BOARD_CSV }), null);
  assertEquals(boardBatch({ type: "lamp-board:leads", batch: 1.5, csv: BOARD_CSV }), null);
  assertEquals(boardBatch({ type: "lamp-board:leads", batch: 1, csv: "" }), null);
  assertEquals(
    boardBatch({ type: "lamp-board:leads", batch: 1, csv: "x".repeat(BOARD_MAX_CSV + 1) }),
    null,
  );
  assertEquals(
    boardBatch({ type: "lamp-board:leads", batch: 3, csv: BOARD_CSV })?.label,
    "Board batch #3",
  );
});
