// site_events actions, the website's signed path and the reserved rep slugs, checked against a
// LOCAL Postgres only (migration 20261127120000_site_event_actions.sql).
//
//   CONTAINER=lamp-site-events deno run --allow-run --allow-env --allow-read tests/site-events.local.ts
//
// The container is Supabase's Postgres image (public.ecr.aws/supabase/postgres:17.6.1.131) with
// every file in supabase/migrations applied in order, as the security kit in Asad's war room does
// (war-room/lamp/security/README.txt). Every case runs in a transaction that is rolled back, so the
// container is left as it was. It never talks to Lovable Cloud. Not run by `deno test`.

import { SITE_ACTIONS } from "../src/lib/tracking.ts";

const C = (Deno.env.get("CONTAINER") ?? "").trim();
if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(C)) {
  console.error("Set CONTAINER to the local Postgres container's name.");
  Deno.exit(2);
}

const MIGRATION = await Deno.readTextFile(
  new URL("../supabase/migrations/20261127120000_site_event_actions.sql", import.meta.url),
);

async function psql(sql: string): Promise<{ ok: boolean; out: string[]; err: string }> {
  const cmd = new Deno.Command("docker", {
    args: [
      "exec",
      "-i",
      "-e",
      "PGPASSWORD=postgres",
      C,
      "psql",
      "-U",
      "postgres",
      "-h",
      "localhost",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const p = cmd.spawn();
  const w = p.stdin.getWriter();
  await w.write(new TextEncoder().encode(sql));
  await w.close();
  const r = await p.output();
  const out = new TextDecoder()
    .decode(r.stdout)
    .split("\n")
    .filter(
      (l) =>
        l &&
        !["BEGIN", "SET", "ROLLBACK", "COMMIT", "DO", "ALTER TABLE"].includes(l) &&
        !/^(INSERT|UPDATE|DELETE) /.test(l),
    );
  const err =
    new TextDecoder()
      .decode(r.stderr)
      .split("\n")
      .find((l) => /ERROR/.test(l)) ?? "";
  return { ok: r.success, out, err: err.replace(/^psql:<stdin>:\d+: /, "") };
}

const V = "0f0e0d0c-0b0a-4908-8706-050403020100";
const ADMIN = "5e000000-0000-0000-0000-00000000000a";
const TITLE = `'Admins: the Dashboard''s speed rows and signed counts changed'`;
const event = (kind: string, path: string, question: string | null, step: number | null = null) =>
  `insert into public.site_events (visitor, kind, path, step, question) values ('${V}', '${kind}', '${path}', ${step === null ? "null" : step}, ${question === null ? "null" : `'${question}'`}) returning 1`;

type Case = [expect: string, label: string, sql: string];
const CASES: Case[] = [
  ...SITE_ACTIONS.map((a): Case => [
    "1",
    `an '${a}' action inserts`,
    event("action", "/offer-check", a),
  ]),
  ["refused", "an unknown kind fails", event("purchase", "/offer-check", null)],
  [
    "refused",
    "an action that isn't on the list fails",
    event("action", "/offer-check", "oc_amount"),
  ],
  [
    "refused",
    "an action carrying a number in step fails",
    event("action", "/offer-check", "oc_saved", 50),
  ],
  ["refused", "an action with no name fails", event("action", "/offer-check", null)],
  ["1", "a page view still inserts", event("page_view", "/", null)],
  ["1", "an /apply step still inserts", event("apply_step", "/application", "amount", 0)],
  [
    "/application/signed|/application/stevie/signed",
    "running the migration again relabels the website's old signed rows, and only those",
    `${event("page_view", "/application/null/signed", null)} \\g /dev/null
${event("page_view", "/application/stevie/signed", null)} \\g /dev/null
${MIGRATION}
select string_agg(path, '|' order by path) from public.site_events
 where visitor = '${V}' and path like '/application/%signed'`,
  ],
  [
    "refused",
    "a new rep can't take the slug 'signed'",
    `insert into public.reps (slug, name, active) values ('signed', 'Sig Ned', true) returning 1`,
  ],
  [
    "refused",
    "nor 'pdf'",
    `insert into public.reps (slug, name, active) values ('pdf', 'P Df', true) returning 1`,
  ],
  [
    "refused",
    "nor 'null'",
    `insert into public.reps (slug, name, active) values ('null', 'Nu Ll', true) returning 1`,
  ],
  [
    "1",
    "an ordinary slug is fine",
    `insert into public.reps (slug, name, active) values ('signedrep', 'Sig Rep', true) returning 1`,
  ],
  [
    "now reserved",
    "the migration stops, naming the slug, when a rep already holds 'signed'",
    `alter table public.reps drop constraint reps_slug_not_reserved;
insert into public.reps (slug, name, active) values ('signed', 'Sig Ned', true);
${MIGRATION}`,
  ],
  [
    "1",
    "running it twice tells each admin once",
    `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('${ADMIN}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'site.admin@test.dev', '{}', now(), now());
insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');
delete from public.notifications where kind = 'announcement' and title = ${TITLE};
${MIGRATION}
${MIGRATION}
select count(*) from public.notifications
 where kind = 'announcement' and title = ${TITLE} and user_id = '${ADMIN}'`,
  ],
];

let bad = 0;
for (const [expect, label, sql] of CASES) {
  const r = await psql(`begin;\n${sql};\nrollback;\n`);
  const got = r.ok
    ? (r.out[r.out.length - 1] ?? "0")
    : expect !== "refused" && r.err.includes(expect)
      ? expect
      : "refused";
  const ok = got === expect;
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label.padEnd(84)} -> ${got}${!ok ? `  (wanted ${expect}) ${r.err}` : ""}`,
  );
}

console.log(`\n${bad} problems`);
Deno.exit(bad ? 1 : 0);
