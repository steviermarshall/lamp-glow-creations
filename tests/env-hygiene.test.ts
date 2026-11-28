// deno test --node-modules-dir=none --allow-run=git tests/env-hygiene.test.ts -- --require-scan
//
// The repo is public, so a server secret that gets committed is out for good: git history keeps
// it. This scans every file git tracks (what is staged, read through git itself) and fails when
// one assigns a server secret by name, or holds a Supabase secret key (sb_secret_...), a JWT whose
// role is service_role, or a postgres:// URL. The only values that may be committed are the
// public VITE_ ones the browser reads (project id, URL, publishable key).
//
// .env itself is never opened: Asad's machine blocks agents from reading it, and it holds the
// public VITE_ values Lovable builds with (decision D11). A failure names the file, the line and
// the variable or kind of value, never the value, so the report is safe to read in CI logs.
//
// The scanner checks below need no permission and run with every other test. The scan of the
// repo needs to run git, so it runs in its own CI step (.github/workflows/checks.yml, "No secrets
// in tracked files") with --allow-run=git, and shows as ignored in a plain `deno test tests/`.
// That step also passes `-- --require-scan`, so losing the git permission there fails the step
// rather than skipping the scan and staying green.
import { assert, assertEquals } from "jsr:@std/assert@1";

/** Secrets the site's server reads at runtime. None of them may be given a value in a tracked file. */
export const SERVER_SECRET_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "LAMP_SERVER_STAMP",
  "LOVABLE_CRON_SECRET",
  "LOVABLE_CRON_SECRET_PREVIOUS",
  "LOVABLE_DB_MIGRATION_URL",
  "ANTHROPIC_API_KEY",
  "DISCORD_BOT_TOKEN",
  "DISCORD_DEALS_WEBHOOK",
  "GOOGLE_CLIENT_SECRET",
  "FUNDER_SEND_SECRET",
  "ENGINE_PUSH_SECRET",
] as const;

/** Where a problem is and what it is. Deliberately has no field for the value. */
export type Finding = { file: string; line: number; what: string };

export const KIND_SB_SECRET = "Supabase secret key (sb_secret_...)";
export const KIND_SERVICE_JWT = "JWT with role service_role";
export const KIND_POSTGRES_URL = "postgres:// URL";

const NAMES = [...SERVER_SECRET_NAMES].sort((a, b) => b.length - a.length).join("|");
// NAME = "value", NAME: 'value', "NAME": "value", NAME="value" anywhere on a line
const QUOTED = new RegExp(
  `(?<![A-Za-z0-9_])["']?(${NAMES})["']?\\s*[:=]\\s*(["'\`])([^"'\`\\r\\n]*)\\2`,
  "g",
);
// a hard-coded fallback next to a read by name: process.env.NAME ?? "value",
// env("NAME") || 'value', Deno.env.get("NAME") ?? `value`
const FALLBACK = new RegExp(
  `(?<![A-Za-z0-9_])(${NAMES})["'\`\\])]*\\s*(?:\\?\\?|\\|\\|)\\s*(["'\`])([^"'\`\\r\\n]*)\\2`,
  "g",
);
// NAME=value, export NAME=value, NAME: value at the start of a line (env, YAML, TOML files)
const BARE = new RegExp(
  `^\\s*(?:export\\s+|-\\s+)?["']?(${NAMES})["']?\\s*[:=]\\s*([^\\s"'\`#;,]+)`,
);
const SB_SECRET = /(?<![A-Za-z0-9_])sb_secret_[A-Za-z0-9_-]{16,}/;
const JWT = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]*/g;
const POSTGRES_URL = /(?<![A-Za-z0-9_])postgres(?:ql)?:\/\/[^\s"'`<>)]/i;
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/i;

/**
 * True when an assigned value is a literal that could be a secret, not a reference, a template
 * or a blank. `quoted` is true when the value sat inside quotes: a quoted string is text, never a
 * code reference, so only templates, placeholders and prose are let through. An unquoted value
 * (env, YAML and TOML files) is also let through when it reads a variable or calls something.
 */
export function isLiteral(value: string, quoted: boolean): boolean {
  if (value.length < 8) return false;
  if (/\$\{|\{\{/.test(value)) return false; // ${NAME}, ${{ secrets.NAME }}, {{ name }}
  if (/^<[^<>]*>$/.test(value)) return false; // <the key from Lovable Cloud>
  if (/^\$[A-Za-z_]\w*$/.test(value)) return false; // $NAME in a shell or env file
  if (/^env\([A-Za-z_]\w*\)$/.test(value)) return false; // env(NAME) in supabase/config.toml
  if (quoted) return !/\s/.test(value); // words with spaces are prose, not a key
  if (/^(?:process\.env|import\.meta|Deno\.env|env\.|secrets\.|vars\.)/.test(value)) return false;
  if (/[()[\]{}<>]/.test(value)) return false; // a call or an expression, not a value
  return true;
}

function base64UrlJson(part: string): unknown {
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))),
    );
  } catch {
    return null;
  }
}

/** Every secret-shaped thing in one file's text. Prints nothing and never returns a value. */
export function scanText(file: string, text: string): Finding[] {
  const found = new Map<string, Finding>();
  const add = (line: number, what: string) =>
    found.set(`${line}\u0000${what}`, { file, line, what });
  const code = CODE_FILE.test(file);
  text.split(/\r?\n/).forEach((lineText, i) => {
    const line = i + 1;
    for (const m of lineText.matchAll(QUOTED)) if (isLiteral(m[3], true)) add(line, m[1]);
    for (const m of lineText.matchAll(FALLBACK)) if (isLiteral(m[3], true)) add(line, m[1]);
    if (!code) {
      const bare = BARE.exec(lineText);
      if (bare && isLiteral(bare[2], false)) add(line, bare[1]);
    }
    if (SB_SECRET.test(lineText)) add(line, KIND_SB_SECRET);
    for (const m of lineText.matchAll(JWT)) {
      const claims = base64UrlJson(m[1]);
      if (
        claims &&
        typeof claims === "object" &&
        (claims as { role?: unknown }).role === "service_role"
      ) {
        add(line, KIND_SERVICE_JWT);
      }
    }
    if (POSTGRES_URL.test(lineText)) add(line, KIND_POSTGRES_URL);
  });
  return [...found.values()];
}

/** The failure message: file, line and what was found. Never the value. */
export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "";
  const rows = findings.map((f) => `  ${f.file}:${f.line}  ${f.what}`);
  return [
    `${findings.length} secret-shaped value(s) in tracked files (values not shown):`,
    ...rows,
    "Take the value out and set it in Lovable Cloud's secrets instead. The repo is public and git",
    "history keeps old versions, so a real secret that was ever pushed must be rotated as well.",
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Reading what git tracks, through git (no file permission needed, and it is the staged content)

/** The one tracked file this scan never opens (see the top of the file). */
export const NEVER_OPENED = ".env";

async function git(args: string[], input?: Uint8Array): Promise<Uint8Array> {
  const child = new Deno.Command("git", {
    args,
    stdin: input ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (input) {
    const writer = child.stdin.getWriter();
    await writer.write(input);
    await writer.close();
  }
  const out = await child.output();
  if (!out.success)
    throw new Error(`git ${args[0]} failed: ${new TextDecoder().decode(out.stderr)}`);
  return out.stdout;
}

/** Path and blob id of every tracked file except .env (submodules have no blob to read). */
export function parseLsFiles(raw: string): { path: string; sha: string }[] {
  return raw
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const [meta, path] = entry.split("\t");
      const [mode, sha] = meta.split(" ");
      return { mode, sha, path };
    })
    .filter((e) => e.mode !== "160000" && e.path !== NEVER_OPENED)
    .map(({ path, sha }) => ({ path, sha }));
}

async function scanRepo(): Promise<{ scanned: number; findings: Finding[] }> {
  const files = parseLsFiles(new TextDecoder().decode(await git(["ls-files", "-s", "-z"])));
  assert(!files.some((f) => f.path === NEVER_OPENED), ".env is never read");
  const raw = await git(
    ["cat-file", "--batch"],
    new TextEncoder().encode(files.map((f) => f.sha).join("\n") + "\n"),
  );
  const findings: Finding[] = [];
  let pos = 0;
  let scanned = 0;
  for (const f of files) {
    const nl = raw.indexOf(10, pos);
    const header = new TextDecoder().decode(raw.subarray(pos, nl)).split(" ");
    assertEquals(header[0], f.sha, "git cat-file answered out of order");
    if (header[1] === "missing") {
      pos = nl + 1;
      continue;
    }
    const size = Number(header[2]);
    const body = raw.subarray(nl + 1, nl + 1 + size);
    pos = nl + 1 + size + 1;
    if (body.subarray(0, 8000).includes(0)) continue; // binary
    findings.push(...scanText(f.path, new TextDecoder().decode(body)));
    scanned++;
  }
  return { scanned, findings };
}

// ---------------------------------------------------------------------------------------------
// Made-up fixtures, built at run time so this file's own source never holds a match.

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fakeJwt = (role: string) =>
  [
    b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    b64url(JSON.stringify({ iss: "supabase", ref: "fakeprojectref00000", role, iat: 1, exp: 2 })),
    "not-a-real-signature-made-up-for-the-test",
  ].join(".");
const SERVICE_JWT = fakeJwt("service_role");
const ANON_JWT = fakeJwt("anon");
const DB_PASSWORD = "made-up-db-password-7f3a";
const DB_URL = [
  "postgres",
  "://",
  "postgres.fakeref:",
  DB_PASSWORD,
  "@db.example.test:5432/postgres",
].join("");
const SB_SECRET_VALUE = ["sb", "secret", "Zx9fakeFAKEfake0123456789abcd"].join("_");
const PUBLISHABLE = ["sb", "publishable", "Zx9fakeFAKEfake0123456789abcd"].join("_");
const SECRET_VALUE = "Fake0Secret1Value2For3The4Test5";
const [SERVICE_NAME] = SERVER_SECRET_NAMES;

/** The scanner with console output captured, to prove it prints nothing. */
function scanQuietly(file: string, text: string): { findings: Finding[]; printed: string } {
  const printed: string[] = [];
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  const capture = (...args: unknown[]) => printed.push(args.map(String).join(" "));
  Object.assign(console, { log: capture, error: capture, warn: capture, info: capture });
  try {
    return { findings: scanText(file, text), printed: printed.join("\n") };
  } finally {
    Object.assign(console, saved);
  }
}

function assertNoValueLeaks(findings: Finding[], printed: string, values: string[]) {
  const shown = `${JSON.stringify(findings)}\n${formatFindings(findings)}\n${printed}`;
  for (const v of values) assert(!shown.includes(v), "the report never shows a value");
  for (const f of findings) assertEquals(Object.keys(f).sort(), ["file", "line", "what"]);
}

Deno.test("a JWT whose role is service_role fails, and the report never shows it", () => {
  const { findings, printed } = scanQuietly("src/lib/thing.ts", `const key = "${SERVICE_JWT}";`);
  assertEquals(findings, [{ file: "src/lib/thing.ts", line: 1, what: KIND_SERVICE_JWT }]);
  assertEquals(printed, "");
  assertNoValueLeaks(findings, printed, [SERVICE_JWT, SERVICE_JWT.split(".")[1]]);
});

Deno.test(
  "a postgres:// URL fails, assigned by name or on its own, and its password is not shown",
  () => {
    const text = [
      "# made-up deploy settings",
      `LOVABLE_DB_MIGRATION_URL=${DB_URL}`,
      `see ${DB_URL.replace("postgres://", "postgresql://")} for the replica`,
    ].join("\n");
    const { findings, printed } = scanQuietly(".env.production", text);
    assertEquals(findings, [
      { file: ".env.production", line: 2, what: "LOVABLE_DB_MIGRATION_URL" },
      { file: ".env.production", line: 2, what: KIND_POSTGRES_URL },
      { file: ".env.production", line: 3, what: KIND_POSTGRES_URL },
    ]);
    assertEquals(printed, "");
    assertNoValueLeaks(findings, printed, [DB_URL, DB_PASSWORD]);
    const report = formatFindings(findings);
    assert(report.includes(".env.production:2  LOVABLE_DB_MIGRATION_URL"), report);
  },
);

Deno.test("the public VITE_ values pass: project id, URL, publishable key and an anon JWT", () => {
  const text = [
    `VITE_SUPABASE_PROJECT_ID="fakeprojectref00000"`,
    `VITE_SUPABASE_URL="https://fakeprojectref00000.supabase.co"`,
    `VITE_SUPABASE_PUBLISHABLE_KEY="${PUBLISHABLE}"`,
    `VITE_SUPABASE_ANON_KEY=${ANON_JWT}`,
  ].join("\n");
  assertEquals(scanText(".env", text), []);
  assertEquals(scanText("src/integrations/supabase/client.ts", `const k = "${PUBLISHABLE}";`), []);
});

Deno.test("every server secret name with a value fails, in env, YAML, JSON and code", () => {
  for (const name of SERVER_SECRET_NAMES) {
    const cases: [string, string][] = [
      [".env.local", `${name}=${SECRET_VALUE}`],
      ["deploy/.env.staging", `export ${name}="${SECRET_VALUE}"`],
      ["config.yml", `  ${name}: ${SECRET_VALUE}`],
      ["config.toml", `${name} = '${SECRET_VALUE}'`],
      ["settings.json", `{ "${name}": "${SECRET_VALUE}" }`],
      ["src/lib/thing.ts", `const ${name} = "${SECRET_VALUE}";`],
      ["src/lib/thing.ts", `const keys = { ${name}: \`${SECRET_VALUE}\` };`],
    ];
    for (const [file, text] of cases) {
      const { findings, printed } = scanQuietly(file, text);
      assertEquals(findings, [{ file, line: 1, what: name }], `${file}: ${name}`);
      assertNoValueLeaks(findings, printed, [SECRET_VALUE]);
    }
  }
});

Deno.test("reading a secret by name, or leaving it blank, passes", () => {
  const n = SERVICE_NAME;
  const ok: [string, string][] = [
    ["src/lib/a.server.ts", `const ${n} = process.env['${n}'];`],
    ["src/lib/a.server.ts", `const key = env("${n}") ?? process.env.${n};`],
    ["src/lib/a.server.ts", `type Env = { ${n}: string };`],
    ["src/lib/a.server.ts", `const opts = { ${n}: serviceRoleKey };`],
    ["src/lib/a.server.ts", `const keys = { ${n}: \`\${key}\` };`],
    [".github/workflows/x.yml", `      ${n}: \${{ secrets.${n} }}`],
    [".env.example", `${n}=`],
    [".env.example", `${n}="<the service role key from Lovable Cloud>"`],
    [".env.example", `${n}=$${n}`],
    ["docs/setup.md", `Set ${n} in Lovable Cloud's secrets, never in a file.`],
    [".env.example", `${n}=\${${n}}`],
    ["supabase/config.toml", `${n} = "env(${n})"`],
    ["src/lib/a.server.ts", `const k = process.env.${n} ?? "";`],
    ["src/lib/a.server.ts", `const k = env("${n}") || "<not set>";`],
    ["src/i18n/en.json", `{ "${n}": "The service role key from Lovable Cloud" }`],
  ];
  for (const [file, text] of ok) assertEquals(scanText(file, text), [], `${file}: ${text}`);
});

// Shaped like a Discord bot token: three dot-separated parts, each starting with a letter and
// with no '-', so it looks like a dotted name such as config.serviceRoleKey. Made up.
const DISCORD_SHAPED = [
  "MTIzNDU2Nzg5MDEyMzQ1Njc4OQ",
  "GabcDe",
  "abcdefghijklmnopqrstuvwxyzABCDEF",
].join(".");
// A webhook URL with a ?thread_id query, the normal Discord form for posting into a thread. Made up.
const WEBHOOK_WITH_QUERY = [
  "https://discord.com/api/webhooks/1234567890",
  "fakeFAKEfake0123456789abcdefABCDEF?thread_id=99&wait=true",
].join("/");
const PUNCTUATED = "Fake0Secret!Value2#For3*The4^Test$5";

Deno.test("values that look like references or hold punctuation still fail when assigned", () => {
  const cases: [string, string, string, string][] = [
    [".env.local", "DISCORD_BOT_TOKEN", `DISCORD_BOT_TOKEN=${DISCORD_SHAPED}`, DISCORD_SHAPED],
    ["config.yml", "DISCORD_BOT_TOKEN", `  DISCORD_BOT_TOKEN: ${DISCORD_SHAPED}`, DISCORD_SHAPED],
    [
      "src/lib/x.server.ts",
      "DISCORD_BOT_TOKEN",
      `const DISCORD_BOT_TOKEN = "${DISCORD_SHAPED}";`,
      DISCORD_SHAPED,
    ],
    [
      ".env.local",
      "DISCORD_DEALS_WEBHOOK",
      `DISCORD_DEALS_WEBHOOK=${WEBHOOK_WITH_QUERY}`,
      WEBHOOK_WITH_QUERY,
    ],
    [
      "src/lib/x.server.ts",
      "DISCORD_DEALS_WEBHOOK",
      `const DISCORD_DEALS_WEBHOOK = '${WEBHOOK_WITH_QUERY}';`,
      WEBHOOK_WITH_QUERY,
    ],
    [".env.local", "FUNDER_SEND_SECRET", `FUNDER_SEND_SECRET="${PUNCTUATED}"`, PUNCTUATED],
    [
      "settings.json",
      "FUNDER_SEND_SECRET",
      `{ "FUNDER_SEND_SECRET": "${PUNCTUATED}" }`,
      PUNCTUATED,
    ],
  ];
  for (const [file, what, text, value] of cases) {
    const { findings, printed } = scanQuietly(file, text);
    assertEquals(findings, [{ file, line: 1, what }], `${file}: ${what}`);
    assertNoValueLeaks(findings, printed, [value]);
  }
});

Deno.test("a hard-coded fallback next to a read by name fails", () => {
  for (const name of SERVER_SECRET_NAMES) {
    for (const text of [
      `const k = process.env.${name} ?? "${SECRET_VALUE}";`,
      `const k = process.env["${name}"] || '${SECRET_VALUE}';`,
      `const k = env("${name}") ?? \`${SECRET_VALUE}\`;`,
      `const k = Deno.env.get("${name}") || "${PUNCTUATED}";`,
    ]) {
      const { findings, printed } = scanQuietly("src/lib/x.server.ts", text);
      assertEquals(findings, [{ file: "src/lib/x.server.ts", line: 1, what: name }], text);
      assertNoValueLeaks(findings, printed, [SECRET_VALUE, PUNCTUATED]);
    }
  }
});

Deno.test("an sb_secret_ key fails; naming the prefix in code passes", () => {
  const { findings, printed } = scanQuietly("README.md", `key: ${SB_SECRET_VALUE}`);
  assertEquals(findings, [{ file: "README.md", line: 1, what: KIND_SB_SECRET }]);
  assertNoValueLeaks(findings, printed, [SB_SECRET_VALUE]);
  const prefix = ["sb", "secret", ""].join("_");
  assertEquals(scanText("src/a.ts", `return value.startsWith('${prefix}');`), []);
});

Deno.test(
  "the report names file, line and variable on separate rows, and is empty when clean",
  () => {
    assertEquals(formatFindings([]), "");
    const report = formatFindings([
      { file: "a.env", line: 3, what: "DISCORD_BOT_TOKEN" },
      { file: "b.yml", line: 9, what: KIND_POSTGRES_URL },
    ]);
    assert(report.includes("  a.env:3  DISCORD_BOT_TOKEN\n  b.yml:9  postgres:// URL"), report);
    assert(report.includes("rotated"), report);
  },
);

Deno.test("the tracked-file list leaves out .env and submodules", () => {
  const raw =
    [
      "100644 aaaaaaaa 0\t.env",
      "100644 bbbbbbbb 0\t.env.example",
      "160000 cccccccc 0\tvendor/sub",
      "100644 dddddddd 0\tsrc/a file.ts",
    ].join("\0") + "\0";
  assertEquals(parseLsFiles(raw), [
    { path: ".env.example", sha: "bbbbbbbb" },
    { path: "src/a file.ts", sha: "dddddddd" },
  ]);
});

/**
 * Whether the git-backed checks run. In a plain `deno test tests/` git is not allowed, so they are
 * skipped. The CI step that exists for them passes `-- --require-scan`, which needs no permission
 * to read: there a missing git permission fails the run instead of quietly skipping the scan.
 */
export function gitScanMode(gitAllowed: boolean, args: string[]): "run" | "skip" | "fail" {
  if (gitAllowed) return "run";
  return args.includes("--require-scan") ? "fail" : "skip";
}

Deno.test("the scan is skipped without git, unless the run requires it", () => {
  assertEquals(gitScanMode(true, []), "run");
  assertEquals(gitScanMode(true, ["--require-scan"]), "run");
  assertEquals(gitScanMode(false, []), "skip");
  assertEquals(gitScanMode(false, ["--require-scan"]), "fail");
});

const scanMode = gitScanMode(
  (await Deno.permissions.query({ name: "run", command: "git" })).state === "granted",
  Deno.args,
);
const requireGit = () =>
  assert(scanMode === "run", "--require-scan was passed but git may not run: add --allow-run=git");

Deno.test({
  name: "no tracked file holds a server secret (.env itself is not opened)",
  ignore: scanMode === "skip",
  fn: async () => {
    requireGit();
    const { scanned, findings } = await scanRepo();
    assert(scanned > 100, `scanned only ${scanned} files`);
    assertEquals(findings.length, 0, formatFindings(findings));
  },
});

Deno.test({
  name: ".gitignore keeps local env files out, but not .env.example or the public .env",
  ignore: scanMode === "skip",
  fn: async () => {
    requireGit();
    const ignored = async (path: string) => {
      const out = await new Deno.Command("git", {
        args: ["check-ignore", "--no-index", "-q", path],
        stdout: "null",
        stderr: "null",
      }).output();
      return out.code === 0;
    };
    for (const p of [".env.local", ".env.production", ".env.development.local", "x/.env.test"]) {
      assert(await ignored(p), `${p} should be ignored`);
    }
    assert(!(await ignored(".env.example")), ".env.example stays committable");
    assert(!(await ignored(NEVER_OPENED)), "the public .env stays tracked (decision D11)");
  },
});
