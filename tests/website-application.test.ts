// deno test --node-modules-dir=none tests/website-application.test.ts
// The website's own full application (getlamp.app/application, Asad 2026-11-19): quick questions,
// contact (saved as a lead with no rep), a rough range, then the full application; the signed
// file lands unassigned and says it came from the website. /apply and /apply/<rep> send people on.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  APPLICATION_PARTS,
  carriedSearch,
  funnelLabel,
  funnelStep,
  QUESTIONS,
  quickFromParams,
} from "../src/lib/apply.ts";
import { startedEmail } from "../src/lib/new-application-email.ts";
import {
  applicationPath,
  countWord,
  firstPaint,
  firstUnanswered,
  openRequest,
  pickSaved,
  quickOptionHref,
  resumeAt,
  STATEMENT_MONTHS,
  stepTracked,
  WEBSITE_OPEN,
  withThisBrowser,
} from "../src/lib/application-resume.ts";
import { REQUIRED_DOCUMENTS } from "../src/lib/documents.ts";
import quickQuestion from "../src/components/site/quick-question.tsx" with { type: "text" };
import original from "../supabase/migrations/20261027120000_application_links.sql" with { type: "text" };
import migration from "../supabase/migrations/20261119200000_website_application.sql" with { type: "text" };
import applyRoute from "../src/routes/apply.tsx" with { type: "text" };
import applyRepRoute from "../src/routes/apply_.$rep.tsx" with { type: "text" };
import websiteRoute from "../src/routes/application.index.tsx" with { type: "text" };
import repRoute from "../src/routes/application.$rep.tsx" with { type: "text" };
import page from "../src/components/application/link-application.tsx" with { type: "text" };
import links from "../src/lib/application-links.server.ts" with { type: "text" };
import start from "../src/lib/application-start.server.ts" with { type: "text" };
import cameIn from "../src/components/staff/came-in.tsx" with { type: "text" };
import started from "../src/components/staff/started-leads.tsx" with { type: "text" };
import dashboard from "../src/components/staff/dashboard.tsx" with { type: "text" };
import sitemap from "../public/sitemap.xml" with { type: "text" };

const FN = "create or replace function public.submit_link_application(";
const fnOf = (sql: string, end: string) =>
  sql.slice(sql.indexOf(FN), sql.indexOf(end, sql.indexOf(FN)));

Deno.test("drop-off: every screen of a public application is the next numbered step", () => {
  const seen: { step: number; question: string }[] = [];
  for (let i = 0; i < QUESTIONS.length; i++)
    seen.push(
      funnelStep({ quickStep: i, contactDone: false, showRange: false, part: 0, signed: false }),
    );
  seen.push(
    funnelStep({
      quickStep: QUESTIONS.length,
      contactDone: false,
      showRange: false,
      part: 0,
      signed: false,
    }),
  );
  seen.push(
    funnelStep({
      quickStep: QUESTIONS.length,
      contactDone: true,
      showRange: true,
      part: 0,
      signed: false,
    }),
  );
  for (let p = 0; p < APPLICATION_PARTS.length; p++)
    seen.push(
      funnelStep({
        quickStep: QUESTIONS.length,
        contactDone: true,
        showRange: false,
        part: p,
        signed: false,
      }),
    );
  seen.push(
    funnelStep({
      quickStep: QUESTIONS.length,
      contactDone: true,
      showRange: false,
      part: 5,
      signed: true,
    }),
  );
  assertEquals(
    seen.map((s) => s.step),
    seen.map((_, i) => i),
  );
  assertEquals(seen[QUESTIONS.length]!.question, "contact");
  assertEquals(seen[QUESTIONS.length + 1]!.question, "result");
  assertEquals(seen.at(-1)!.question, "signed");
  // the dashboard names each one in words, never the raw key
  for (const s of seen) assert(!/^app_|^step /.test(funnelLabel(s.question)), s.question);
  assertEquals(funnelLabel("app_statements"), "Application: statements");
  assertEquals(funnelLabel("result"), "Saw their options");
  assertEquals(funnelLabel(QUESTIONS[0]!.key), QUESTIONS[0]!.title);
  // a step past the end of the application is the last part, never undefined
  assertEquals(
    funnelStep({ quickStep: 99, contactDone: true, showRange: false, part: 40, signed: false })
      .question,
    "app_sign",
  );
  assert(dashboard.includes("funnelLabel(s.question)"));
});

Deno.test("links keep their quick answers and utm tags; nothing personal rides in the URL", () => {
  const params = {
    amount: QUESTIONS.find((q) => q.key === "amount")!.options[1]!.id,
    industry: "not-a-real-option",
    utm_source: "google",
    utm_campaign: "trucking",
    ref: "zeus",
    email: "someone@example.test",
    phone: "2015550100",
    name: "Thomas",
  };
  const quick = quickFromParams(params);
  assertEquals(quick, { amount: params.amount });
  assertEquals(carriedSearch(params), {
    amount: params.amount,
    utm_source: "google",
    utm_campaign: "trucking",
  });
});

Deno.test("routes: /apply and /apply/<rep> send people on to the full application", () => {
  assert(applyRoute.includes('throw redirect({ to: "/application", search: carriedSearch(search)'));
  assert(!applyRoute.includes("ApplyFlow"));
  assert(applyRepRoute.includes('to: "/application/$rep"'));
  assert(applyRepRoute.includes("params.rep.toLowerCase()"));
  assert(!applyRepRoute.includes("ApplyFlow"));
  // the website's own page has no rep and no personal link
  assert(websiteRoute.includes('createFileRoute("/application/")'));
  assert(websiteRoute.includes('<LinkApplication repSlug="" token={null}'));
  // a rep's public link takes the same quick answers; a personal link never does
  assert(repRoute.includes("prefill={i ? {} : quickFromParams(search)}"));
  assert(sitemap.includes("https://getlamp.app/application<"));
  assert(!sitemap.includes("https://getlamp.app/apply<"));
});

Deno.test("page: website mode says Lamp, shows the range, then the application", () => {
  assert(page.includes('const website = !token && repSlug === "";'));
  assert(page.includes('rep?.name ?? (website ? "the Lamp team" : "your Lamp rep")'));
  assert(page.includes("if (!token && estimate(quick)) setShowRange(true);"));
  assert(page.includes("Finish my application · about 10 minutes"));
  assert(page.includes('website ? "The Lamp team" : repName'));
  // the done screen never reads "your has it" when there is no rep
  assert(page.includes('done.rep_name ? (done.rep_name.split(" ")[0] ?? done.rep_name) : "Lamp"'));
  // a range is never an approval or an offer, and the product is never called a loan
  assert(page.includes("not an offer"));
  const shown = page.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
  assert(!shown.some((l) => /\bloans?\b/i.test(l)));
});

Deno.test(
  "server: the website opens and signs with no rep; a rep link still needs a real rep",
  () => {
    // (whitespace-insensitive, so formatting can't break it)
    const flat = links.replace(/\s+/g, " ");
    assert(
      flat.includes(
        'if (slug === "") return json(200, { state: "open", draft: null, rep: null, prefill: null,',
      ),
    );
    assert(links.includes('if (token === null && rep !== "" && !SLUG.test(rep))'));
    assert(links.includes('"the website\'s application"'));
    assert(start.includes('const website = rep === "";'));
    assert(start.includes("if (!website && !SLUG.test(rep)) return json(400"));
    assert(start.includes('website ? { utm_source: "website" } : { ref: rep }'));
    // a website lead is never handed to a rep through ref
    assert(!/website \? \{[^}]*ref:/.test(start));
  },
);

Deno.test("heads-up email for a website lead says the website, not 'your link'", () => {
  const m = startedEmail({
    repName: null,
    first: "Thomas",
    last: "Reed",
    phone: "(201) 555-0100",
    email: "t@example.test",
    textsOk: true,
  });
  assertEquals(m.subject, "Started: Thomas Reed opened the application on the website");
  assert(m.text.startsWith("Hi,"));
  assert(m.text.includes("on the website (getlamp.app). No rep has them yet."));
  assert(!m.text.includes("your link"));
  const r = startedEmail({
    repName: "Zeus Diaz",
    first: "A",
    last: "B",
    phone: "1",
    email: "e",
    textsOk: false,
  });
  assert(r.subject.endsWith("on Zeus Diaz's link"));
  assert(r.text.includes("on your link"));
});

Deno.test("migration: the same signing function plus only the website case", () => {
  const before = fnOf(original, "-- ---------- 6.");
  const after = fnOf(migration, "-- read-only check");
  // every line of today's function is still there, except the four the website case rewrites
  const kept = new Set(after.split("\n"));
  const rewritten = [
    "  select name into rep_name from public.reps where slug = rep;",
    "    null, rep, rep, now(), '{}'::jsonb,",
    "    jsonb_build_object('ref', rep, 'source', 'application_link')",
    "  else",
  ];
  const lost = before.split("\n").filter((l) => !kept.has(l) && !rewritten.includes(l));
  assertEquals(lost, []);
  // the website: no rep, its own hourly cap, unassigned, says where it came from
  assert(after.includes("elsif coalesce(trim(_rep_slug), '') = '' then"));
  assert(after.includes("if recent >= 30 then"));
  assert(after.includes("case when rep is null then null else now() end"));
  assert(after.includes("jsonb_build_object('source', 'website_application')"));
  assert(after.includes("Submitted from the website''s application (getlamp.app)"));
  // a rep's public link keeps its cap of 20 and its unknown_rep refusal
  assert(after.includes("raise exception 'unknown_rep'"));
  assert(after.includes("if recent >= 20 then"));
  // still callable only the way it was
  assert(migration.includes("revoke all on function public.submit_link_application("));
  assert(migration.includes("grant execute on function public.submit_link_application("));
  assert(migration.includes("create index if not exists applications_website_link_idx"));
});

Deno.test("staff see where a website file or lead came from", () => {
  assert(cameIn.includes('utm["source"] === "website_application"'));
  assert(cameIn.includes("The website's application (getlamp.app/application)"));
  assert(started.includes(': "Website"'));
});

// ---------- first paint (gap 4, 2026-11-27) ----------
// /application used to render a spinner until the script loaded and /api/application/open
// answered, although for the website that answer is a constant. Now the server renders the first
// question, a tap works before the script runs, and this browser's saved place comes back after
// the first render, so the server's HTML and the browser's first render match.

const AMOUNT = QUESTIONS[0]!;
const ANSWER = AMOUNT.options[2]!.id;

Deno.test("first paint: the website asks the server nothing; links still do", () => {
  assertEquals(openRequest(null, ""), null);
  assertEquals(openRequest("tok", "zeus"), { token: "tok" });
  assertEquals(openRequest(null, "zeus"), { rep: "zeus" });
  // the page starts with exactly what the server would have answered for the website
  assertEquals(WEBSITE_OPEN, { state: "open", draft: null, rep: null, prefill: null });
  const flat = links.replace(/\s+/g, " ");
  assert(
    flat.includes(
      'if (slug === "") return json(200, { state: "open", draft: null, rep: null, prefill: null,',
    ),
  );
  // wiring: the website's first render is already open, and the one open call sits after the
  // website returns (so it is never made for the website)
  assert(page.includes('useState<OpenResponse | "error" | null>(website ? WEBSITE_OPEN : null)'));
  const mount = page.slice(page.indexOf("const ask = openRequest(token, repSlug);"));
  const websiteReturn = mount.indexOf("if (!ask) {");
  const call = mount.indexOf('fetch("/api/application/open"');
  assert(websiteReturn >= 0 && call > websiteReturn);
  assert(mount.slice(websiteReturn, call).includes("return;"));
  assert(mount.includes("body: JSON.stringify(ask),"));
});

Deno.test("first paint: the first render reads only the link, never this browser's storage", () => {
  // any read of storage during the first render fails this test
  const g = globalThis as Record<string, unknown>;
  const had = "localStorage" in g;
  const before = g["localStorage"];
  Object.defineProperty(g, "localStorage", {
    configurable: true,
    get() {
      throw new Error("the first render read localStorage");
    },
  });
  try {
    assertEquals(firstPaint(null, {}), { quick: {}, quickStep: 0, contactDone: false });
    assertEquals(firstPaint(null, { amount: ANSWER }), {
      quick: { amount: ANSWER },
      quickStep: 1,
      contactDone: false,
    });
    // a personal link already knows who it's for
    assertEquals(firstPaint("tok", {}).contactDone, true);
  } finally {
    if (had) Object.defineProperty(g, "localStorage", { configurable: true, value: before });
    else delete g["localStorage"];
  }
  // wiring: no state starts from storage. Every useState in the page starts from a constant, the
  // link (firstPaint) or the website's fixed answer, so a storage read through a helper of any
  // name is caught too
  const comp = page.slice(page.indexOf("export function LinkApplication("));
  const body = comp.slice(0, comp.indexOf("\nfunction "));
  const inits: string[] = [];
  for (let at = body.indexOf("useState"); at >= 0; at = body.indexOf("useState", at + 1)) {
    let i = body.indexOf("(", at);
    if (i < 0 || !/^useState(<[\s\S]*>)?$/.test(body.slice(at, i))) continue;
    const from = ++i;
    for (let depth = 1; depth; i++) depth += body[i] === "(" ? 1 : body[i] === ")" ? -1 : 0;
    inits.push(body.slice(from, i - 1).trim());
  }
  assert(inits.length >= 10, String(inits.length));
  const SAFE =
    /^(|false|true|-?\d+|""|null|\[\]|empty[A-Z]\w*|first\.\w+|\(\) => firstPaint\(token, prefill\)|website \? WEBSITE_OPEN : null)$/;
  for (const init of inits) assert(SAFE.test(init), `useState(${init})`);
  assert(page.includes("const [first] = useState(() => firstPaint(token, prefill));"));
});

Deno.test("returning visitor: their answers and contact come back, then their step", () => {
  const first = firstPaint(null, {});
  const stored = { amount: ANSWER, purpose: QUESTIONS[1]!.options[0]!.id };
  // quick answers kept in this browser come back, the link's answers win, and someone who gave
  // their name and number skips the questions
  const back = withThisBrowser(first, { amount: AMOUNT.options[0]!.id }, stored, true);
  assertEquals(back.quick, { amount: AMOUNT.options[0]!.id, purpose: stored.purpose });
  assertEquals(back.quickStep, 2);
  assertEquals(back.contactDone, true);
  assertEquals(withThisBrowser(first, {}, {}, false), first);
  // the saved draft: this browser's, unless a rep's phone answers are newer
  const local = { d: "browser", step: 4, savedAt: 200 };
  const server = { d: "phone", step: 2, savedAt: 100 };
  assertEquals(pickSaved(local, server), local);
  assertEquals(pickSaved(local, { ...server, savedAt: 300 })?.d, "phone");
  assertEquals(pickSaved(null, server), server);
  assertEquals(pickSaved(null, null), null);
  // they land on the first step with a gap, and every step they reached stays reachable
  assertEquals(resumeAt(4, 1), { step: 1, visited: 4 });
  assertEquals(resumeAt(4, -1), { step: 4, visited: 4 });
  assertEquals(resumeAt(2, 5), { step: 2, visited: 2 });
  // wiring: the restore is one function, run at mount for the website and after the open call
  // for a link, so a returning website visitor keeps their place
  assert(page.includes("const restoreSaved = (o: OpenResponse) => {"));
  assert(page.includes("const saved = pickSaved(local, server);"));
  const mount = page.slice(page.indexOf("const ask = openRequest(token, repSlug);"));
  assert(
    mount.indexOf("restoreSaved(WEBSITE_OPEN);") < mount.indexOf('fetch("/api/application/open"'),
  );
  assert(mount.includes('if (o.state === "open") restoreSaved(o);'));
  assert(page.includes("loadDraft(draftKey(o.draft, store))"));
});

Deno.test("drop-off: nothing is logged before a returning visitor's place is back", () => {
  assertEquals(stepTracked(null, false, WEBSITE_OPEN), false);
  assertEquals(stepTracked(null, true, WEBSITE_OPEN), true);
  // a personal link, a link still opening, or one that didn't open is never counted here
  assertEquals(stepTracked("tok", true, WEBSITE_OPEN), false);
  assertEquals(stepTracked(null, true, null), false);
  assertEquals(stepTracked(null, true, "error"), false);
  assertEquals(stepTracked(null, true, { ...WEBSITE_OPEN, state: "expired" }), false);
  // wiring: the track waits for that flag, which is set only after the restore
  const effect = page.slice(page.indexOf("useEffect(() => {\n    if (!stepTracked("));
  assert(effect.includes('track(\n      "apply_step",'));
  assert(page.includes("[token, restored, open, quickStep, contactDone, showRange, step, done]"));
  const mount = page.slice(page.indexOf("const ask = openRequest(token, repSlug);"));
  for (const restore of ["restoreSaved(WEBSITE_OPEN);", 'if (o.state === "open") restoreSaved(o);'])
    assert(mount.indexOf(restore) < mount.indexOf("setRestored(true);", mount.indexOf(restore)));
});

Deno.test("quick questions: each answer is a link that works before the script loads", () => {
  const carried = { amount: ANSWER, utm_source: "google", email: "someone@example.test" };
  const href = quickOptionHref(
    applicationPath(""),
    carried,
    { amount: ANSWER },
    "purpose",
    "payroll",
  );
  const url = new URL(href, "https://getlamp.app");
  assertEquals(url.pathname, "/application");
  assertEquals(url.searchParams.get("purpose"), "payroll");
  assertEquals(url.searchParams.get("amount"), ANSWER);
  assertEquals(url.searchParams.get("utm_source"), "google");
  // nothing personal rides in the link
  assertEquals(url.searchParams.get("email"), null);
  // loading that link skips both questions: the server renders the third
  const landed = quickFromParams(Object.fromEntries(url.searchParams));
  assertEquals(landed, { amount: ANSWER, purpose: "payroll" });
  assertEquals(firstPaint(null, landed).quickStep, 2);
  assertEquals(firstUnanswered(landed), 2);
  // a rep's public link stays on that rep's page
  assertEquals(
    new URL(quickOptionHref(applicationPath("zeus"), {}, {}, "amount", ANSWER), "https://x.test")
      .pathname,
    "/application/zeus",
  );
  // the option is an <a>; once the script runs the page handles the tap and the link isn't followed
  assert(quickQuestion.includes("href={hrefFor(o.id)}"));
  const anchor = quickQuestion.slice(quickQuestion.indexOf("<a\n"));
  assert(anchor.indexOf("e.preventDefault();") < anchor.indexOf("onChoose(o.id);"));
  assert(page.includes("quickOptionHref(applicationPath(repSlug), carried, quick, key, id)"));
  // the routes hand over the quick answers and utm_ tags; a personal link carries none
  assert(websiteRoute.includes("carried={search}"));
  assert(repRoute.includes("carried={i ? {} : carriedSearch(search)}"));
});

Deno.test("copy: the credit line covers checking, and the months match the checklist", () => {
  assert(page.includes("Checking your options never affects your credit."));
  assert(!page.includes("Your answers are private and never affect your credit"));
  const statements = REQUIRED_DOCUMENTS.find((r) => r.kind === "bank_statement")!;
  assertEquals(STATEMENT_MONTHS, statements.required);
  assertEquals(countWord(3), "three");
  assertEquals(countWord(12), "12");
  assert(
    page.includes("Your last {countWord(STATEMENT_MONTHS)} months of business bank statements."),
  );
  assert(!/last (three|four) months/.test(page));
});
