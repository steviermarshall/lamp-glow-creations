// Before/after check for 20261027190000_server_stamp.sql, against a LOCAL Supabase stack only.
//
//   deno run --allow-net --allow-env tests/server-stamp.local.ts
//
// Env: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY (from `supabase status -o
// env` of the local stack), EXPECT=before|after, and for "after" also SITE_URL (the dev server,
// run with LAMP_SERVER_STAMP set) and LAMP_SERVER_STAMP (to try a wrong stamp, never printed).
// Accounts come from war-room/lamp/security/seed.sql: merchant.a owns file A (assigned to the
// stevie rep), asad@ is admin, zeus@ is a rep without file A.
//
// "Direct" rows are what a browser can do with its own sign-in key and the public key, straight to
// the database. "Server" rows go through the site's own routes.

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const URL_ = env("SUPABASE_URL").replace(/\/$/, "");
const PUB = env("SUPABASE_PUBLISHABLE_KEY");
const SVC = env("SUPABASE_SERVICE_ROLE_KEY");
const SITE = env("SITE_URL").replace(/\/$/, "");
const EXPECT = env("EXPECT");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) {
  console.error("Refusing to run: SUPABASE_URL must be a local stack (127.0.0.1 or localhost).");
  Deno.exit(2);
}
if (EXPECT !== "before" && EXPECT !== "after") {
  console.error("Set EXPECT=before or EXPECT=after.");
  Deno.exit(2);
}
const after = EXPECT === "after";

const APP_A = "a0000000-0000-0000-0000-00000000000a";
const MERCHANT_A = "aa000000-0000-0000-0000-00000000000a";
// merchant B's file B has not gone to funders, so B may still remove documents from it
const APP_B = "a0000000-0000-0000-0000-00000000000b";
const MERCHANT_B = "bb000000-0000-0000-0000-00000000000b";
const PDF = new TextEncoder().encode("%PDF-1.4\n% Lamp test statement\n%%EOF\n");

async function call(path: string, init: RequestInit & { key?: string; token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("apikey", init.key ?? PUB);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const res = await fetch(`${URL_}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body };
}
const asService = (path: string, init: RequestInit = {}) =>
  call(path, { ...init, key: SVC, token: SVC });

/** A real session for a seeded account: a magic link made by the admin API, then verified. */
async function sessionFor(email: string): Promise<string> {
  const link = await asService("/auth/v1/admin/generate_link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const hashed = (link.body as { hashed_token?: string }).hashed_token;
  if (!hashed) throw new Error(`no link for ${email}: ${link.status}`);
  const v = await call("/auth/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
  });
  const token = (v.body as { access_token?: string }).access_token;
  if (!token) throw new Error(`no session for ${email}: ${v.status}`);
  return token;
}

/** A file in a merchant's folder, optionally with its documents row, made with the service role. */
async function fixture(
  tag: string,
  withRow: boolean,
  owner = MERCHANT_A,
  app = APP_A,
): Promise<{ path: string; id: string | null }> {
  const path = `${owner}/${Date.now()}-${tag}.pdf`;
  const up = await asService(`/storage/v1/object/documents/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: PDF,
  });
  if (up.status !== 200) throw new Error(`fixture upload ${up.status}`);
  if (!withRow) return { path, id: null };
  const row = await asService("/rest/v1/documents?select=id", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      application_id: app,
      user_id: owner,
      bucket: "documents",
      storage_path: path,
      kind: "bank_statement",
      original_name: `${tag}.pdf`,
      mime_type: "application/pdf",
    }),
  });
  const id = (row.body as { id: string }[])[0]?.id;
  if (!id) throw new Error(`fixture row ${row.status}`);
  return { path, id };
}

async function logCount(action: string): Promise<number> {
  const r = await asService(`/rest/v1/sensitive_access_log?select=id&action=eq.${action}`);
  return Array.isArray(r.body) ? r.body.length : -1;
}

type Row = { area: string; what: string; want: string; got: string; ok: boolean };
const rows: Row[] = [];
function record(
  area: string,
  what: string,
  want: "allowed" | "refused",
  allowed: boolean,
  got: string,
) {
  rows.push({ area, what, want, got, ok: (want === "allowed") === allowed });
}
const either = (refusedAfter: boolean) => (after && refusedAfter ? "refused" : "allowed");

const merchantA = await sessionFor("merchant.a@test.dev");
const merchantB = await sessionFor("merchant.b@test.dev");
const admin = await sessionFor("asad@getlamp.app");
const rep = await sessionFor("rep.stevie@test.dev");
const otherRep = await sessionFor("zeus@getlamp.app");

const statement = await fixture("statement", true);
const loose = await fixture("loose", false);
const removable = await fixture("removable", true, MERCHANT_B, APP_B);

// ---------- Direct: what the browser can do on its own ----------
{
  const r = await call(`/storage/v1/object/list/documents`, {
    method: "POST",
    token: merchantA,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: MERCHANT_A, limit: 100 }),
  });
  const n = Array.isArray(r.body) ? r.body.length : 0;
  record(
    "direct",
    "merchant lists their own folder of statements",
    either(true),
    n > 0,
    `${n} files`,
  );
}
{
  const r = await call(`/storage/v1/object/documents/${MERCHANT_A}/${Date.now()}-direct.pdf`, {
    method: "POST",
    token: merchantA,
    headers: { "Content-Type": "application/pdf" },
    body: PDF,
  });
  record(
    "direct",
    "merchant uploads a file to their folder",
    either(true),
    r.status === 200,
    `HTTP ${r.status}`,
  );
}
{
  const r = await call(`/storage/v1/object/sign/documents/${statement.path}`, {
    method: "POST",
    token: merchantA,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  record(
    "direct",
    "merchant makes a download link to their statement",
    either(true),
    r.status === 200,
    `HTTP ${r.status}`,
  );
}
{
  const r = await call("/rest/v1/documents", {
    method: "POST",
    token: merchantA,
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      application_id: APP_A,
      user_id: MERCHANT_A,
      bucket: "documents",
      storage_path: loose.path,
      kind: "bank_statement",
    }),
  });
  record(
    "direct",
    "merchant adds a documents row",
    either(true),
    r.status === 201,
    `HTTP ${r.status}`,
  );
}
{
  const r = await call(`/rest/v1/documents?id=eq.${removable.id}&select=id`, {
    method: "DELETE",
    token: merchantB,
    headers: { Prefer: "return=representation" },
  });
  const n = Array.isArray(r.body) ? r.body.length : 0;
  record(
    "direct",
    "merchant deletes their unreviewed documents row",
    either(true),
    n === 1,
    `${n} rows`,
  );
}
{
  const r = await call(`/storage/v1/object/sign/documents/${statement.path}`, {
    method: "POST",
    token: admin,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  record(
    "direct",
    "admin makes a download link to a merchant's statement (unlogged)",
    either(true),
    r.status === 200,
    `HTTP ${r.status}`,
  );
}
{
  const r = await call(`/rest/v1/documents?id=eq.${statement.id}&select=id`, {
    method: "PATCH",
    token: rep,
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      status: "accepted",
      reviewed_by: null,
      reviewed_at: new Date().toISOString(),
    }),
  });
  const n = Array.isArray(r.body) ? r.body.length : 0;
  record("direct", "file's rep marks a statement accepted", either(true), n === 1, `${n} rows`);
  // back to received for the server rows below
  await asService(`/rest/v1/documents?id=eq.${statement.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "received", reviewed_by: null, reviewed_at: null }),
  });
}
{
  const r = await call("/rest/v1/rpc/staff_application_details", {
    method: "POST",
    token: rep,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ _application_id: APP_A }),
  });
  record(
    "direct",
    "file's rep reads the masked application",
    either(true),
    r.status === 200,
    `HTTP ${r.status}`,
  );
}
{
  const r = await call("/rest/v1/rpc/reveal_application_details", {
    method: "POST",
    token: rep,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ _application_id: APP_A, _purpose: "reveal_ssn" }),
  });
  record(
    "direct",
    "file's rep reads the full SSN",
    either(true),
    r.status === 200,
    `HTTP ${r.status}`,
  );
}
{
  const r = await call("/rest/v1/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      email: `direct-${Date.now()}@test.dev`,
      first_name: "Dee",
      answers: {},
      utm: {},
    }),
  });
  record(
    "direct",
    "anonymous visitor writes a lead",
    either(true),
    r.status === 201,
    `HTTP ${r.status}`,
  );
}
{
  const r = await call("/rest/v1/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      email: `forged-${Date.now()}@test.dev`,
      rep_slug: "zeus",
      converted_application_id: APP_A,
    }),
  });
  record(
    "direct",
    "anonymous visitor credits a lead to any rep and file (L-005)",
    either(true),
    r.status === 201,
    `HTTP ${r.status}`,
  );
}
if (after) {
  const r = await call(`/storage/v1/object/sign/documents/${statement.path}`, {
    method: "POST",
    token: admin,
    headers: {
      "Content-Type": "application/json",
      "x-lamp-server": `${env("LAMP_SERVER_STAMP")}x`,
    },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  record(
    "direct",
    "admin with a wrong stamp makes a download link",
    "refused",
    r.status === 200,
    `HTTP ${r.status}`,
  );
}

// ---------- Direct reads that stay as they are ----------
{
  const r = await call(`/rest/v1/documents?select=id&user_id=eq.${MERCHANT_A}`, {
    token: merchantA,
  });
  const n = Array.isArray(r.body) ? r.body.length : 0;
  record("unchanged", "merchant reads the list of their documents", "allowed", n > 0, `${n} rows`);
}
{
  const r = await call(`/rest/v1/pipeline_board?select=document_count&id=eq.${APP_A}`, {
    token: rep,
  });
  const c = Array.isArray(r.body)
    ? ((r.body[0] as { document_count?: number })?.document_count ?? 0)
    : 0;
  record(
    "unchanged",
    "rep's board counts the file's documents",
    "allowed",
    c > 0,
    `${c} documents`,
  );
}
{
  const r = await call(
    `/rest/v1/application_details?select=application_id&application_id=eq.${APP_A}`,
    { token: merchantA },
  );
  const n = Array.isArray(r.body) ? r.body.length : 0;
  record(
    "unchanged",
    "merchant reads their own application (moves with send-back)",
    "allowed",
    n === 1,
    `${n} rows`,
  );
}

// ---------- Through the site's server ----------
async function site(
  path: string,
  token: string | null,
  body: object | FormData,
  extra: Record<string, string> = {},
) {
  const form = body instanceof FormData;
  const res = await fetch(`${SITE}${path}`, {
    method: "POST",
    headers: {
      ...(form ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: form ? body : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}
const upload = (name: string, type: string, bytes: Uint8Array) => {
  const f = new FormData();
  f.set("application_id", APP_A);
  f.set("kind", "bank_statement");
  f.set("file", new File([bytes as BlobPart], name, { type }));
  return f;
};

if (after) {
  if (!SITE) throw new Error("Set SITE_URL for the server rows.");
  const check = await (await fetch(`${SITE}/api/server-check`)).json();
  record(
    "server",
    "server-check: the database sees the stamp",
    "allowed",
    check.received === true && check.enforcing === true,
    JSON.stringify(check),
  );

  const folder = await site("/api/documents", merchantA, { action: "folder" });
  const n = Array.isArray(folder.data.files) ? folder.data.files.length : 0;
  record("server", "merchant's folder", "allowed", n > 0, `${n} files`);

  const saved = await site(
    "/api/documents/upload",
    merchantA,
    upload("march.pdf", "application/pdf", PDF),
  );
  record(
    "server",
    "merchant uploads a PDF statement",
    "allowed",
    saved.data.outcome === "saved",
    String(saved.data.outcome ?? saved.status),
  );

  const copyForm = upload("signed-application.pdf", "application/pdf", PDF);
  copyForm.set("kind", "funder_application");
  copyForm.set("signed_copy", "1");
  const copy = await site("/api/documents/upload", merchantA, copyForm);
  record(
    "server",
    "merchant's signed copy after signing on the account page",
    "allowed",
    copy.data.outcome === "saved",
    String(copy.data.outcome ?? copy.status),
  );

  const fake = await site(
    "/api/documents/upload",
    merchantA,
    upload("fake.pdf", "application/pdf", new TextEncoder().encode("not a pdf")),
  );
  record(
    "server",
    "merchant uploads a fake PDF (L-009)",
    "refused",
    fake.status === 200,
    `HTTP ${fake.status}`,
  );

  const exe = await site(
    "/api/documents/upload",
    merchantA,
    upload("run.exe", "application/x-msdownload", new Uint8Array([0x4d, 0x5a])),
  );
  record(
    "server",
    "merchant uploads a program (L-009)",
    "refused",
    exe.status === 200,
    `HTTP ${exe.status}`,
  );

  const other = await site(
    "/api/documents/upload",
    merchantB,
    upload("x.pdf", "application/pdf", PDF),
  );
  record(
    "server",
    "merchant B uploads to merchant A's file",
    "refused",
    other.status === 200,
    `HTTP ${other.status}`,
  );

  const rm = await site("/api/documents", merchantA, { action: "remove", path: loose.path });
  record(
    "server",
    "merchant removes a file no row points at",
    "allowed",
    rm.data.outcome === "removed",
    String(rm.data.outcome),
  );

  const before = await logCount("open_document");
  const open = await site("/api/documents", rep, { action: "open", document_id: statement.id });
  const url = typeof open.data.url === "string" ? open.data.url : "";
  const dl = url ? await fetch(url) : null;
  const bytes = dl ? (await dl.arrayBuffer()).byteLength : 0;
  const logged = (await logCount("open_document")) - before;
  record(
    "server",
    "file's rep opens the statement (and it is logged)",
    "allowed",
    dl?.status === 200 && logged === 1,
    `download ${dl?.status ?? "-"}, ${bytes} bytes, ${logged} log row`,
  );

  const theirs = await site("/api/documents", merchantB, {
    action: "open",
    document_id: statement.id,
  });
  record(
    "server",
    "merchant B opens merchant A's statement",
    "refused",
    theirs.status === 200,
    `HTTP ${theirs.status}`,
  );

  const notMine = await site("/api/documents", otherRep, {
    action: "open",
    document_id: statement.id,
  });
  record(
    "server",
    "another rep opens the statement",
    "refused",
    notMine.status === 200,
    `HTTP ${notMine.status}`,
  );

  const rev = await site("/api/documents", rep, {
    action: "review",
    document_id: statement.id,
    status: "accepted",
  });
  record(
    "server",
    "file's rep accepts the statement",
    "allowed",
    rev.status === 200,
    `HTTP ${rev.status}`,
  );

  const masked = await site("/api/application-details", rep, { application_id: APP_A });
  const owners = (masked.data.details as { owners?: { ssn?: string }[] } | null)?.owners ?? [];
  record(
    "server",
    "file's rep reads the masked application",
    "allowed",
    masked.status === 200 && !String(owners[0]?.ssn ?? "").includes("12345"),
    `HTTP ${masked.status}`,
  );

  const ssnBefore = await logCount("reveal_ssn");
  const full = await site("/api/application-details", rep, {
    application_id: APP_A,
    purpose: "reveal_ssn",
  });
  const ssnLogged = (await logCount("reveal_ssn")) - ssnBefore;
  record(
    "server",
    "file's rep reads the full SSN (and it is logged)",
    "allowed",
    full.status === 200 && ssnLogged === 1,
    `HTTP ${full.status}, ${ssnLogged} log row`,
  );

  const zeus = await site("/api/application-details", otherRep, {
    application_id: APP_A,
    purpose: "reveal_ssn",
  });
  record(
    "server",
    "another rep reads the full SSN",
    "refused",
    zeus.status === 200,
    `HTTP ${zeus.status}`,
  );

  // the visitor's address as the edge passes it on (a documentation address, 203.0.113.0/24)
  const edge = { "x-forwarded-for": "203.0.113.7" };
  const lead = await site(
    "/api/leads",
    null,
    {
      email: `server-${Date.now()}@test.dev`,
      first_name: "Sam",
      answers: { industry: "trucking" },
      utm: { ref: "stevie" },
    },
    edge,
  );
  record(
    "server",
    "visitor's lead through the server",
    "allowed",
    lead.status === 200,
    `HTTP ${lead.status}`,
  );

  let limited = 0;
  for (let i = 0; i < 12; i++) {
    const r = await site(
      "/api/leads",
      null,
      { email: `burst-${Date.now()}-${i}@test.dev`, answers: {}, utm: {} },
      edge,
    );
    if (r.status === 429) limited++;
  }
  record(
    "server",
    "12 more leads from one network in a minute",
    "refused",
    limited === 0,
    `${limited} turned away`,
  );
}

const width = Math.max(...rows.map((r) => r.what.length));
for (const r of rows) {
  console.log(
    `${r.ok ? "ok  " : "FAIL"}  ${r.area.padEnd(9)} ${r.what.padEnd(width)}  want ${r.want.padEnd(7)}  got ${r.got}`,
  );
}
const bad = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - bad} of ${rows.length} as expected (${EXPECT}).`);
Deno.exit(bad ? 1 : 0);
