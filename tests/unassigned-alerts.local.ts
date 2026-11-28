// Who hears about a file or a start with no rep, and the new-file email's claim, checked against a
// LOCAL Postgres only (20261127100000_unassigned_alerts.sql).
//
//   CONTAINER=lamp-alerts-proof deno run --allow-run --allow-env tests/unassigned-alerts.local.ts
//
// The container is Supabase's Postgres image (public.ecr.aws/supabase/postgres:17.6.1.131) with
// every file in supabase/migrations applied in order, as tests/chat-rules.local.ts uses. This file
// adds its own people, runs each case in a transaction it rolls back, and removes its people at
// the end. It never talks to Lovable Cloud. Not run by `deno test`.

const C = (Deno.env.get("CONTAINER") ?? "").trim();
if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(C)) {
  console.error("Set CONTAINER to the local Postgres container's name.");
  Deno.exit(2);
}

const U = {
  a1: "d1000000-0000-0000-0000-000000000001", // admin, and the admin "uanologin" reports to
  a2: "d2000000-0000-0000-0000-000000000002", // admin
  lead: "d3000000-0000-0000-0000-000000000003", // a rep who leads "uarep"
  rep: "d4000000-0000-0000-0000-000000000004", // a rep with a login
} as const;
const FILE = "fd000000-0000-0000-0000-00000000000d"; // a file for the claim cases
const NEW = "fe000000-0000-0000-0000-00000000000e"; // the file each case inserts
const IDS = Object.values(U)
  .map((u) => `'${u}'`)
  .join(",");

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
        !["BEGIN", "SET", "ROLLBACK", "COMMIT"].includes(l) &&
        !/^(INSERT|UPDATE|DELETE) /.test(l),
    );
  const err =
    new TextDecoder()
      .decode(r.stderr)
      .split("\n")
      .find((l) => /ERROR/.test(l)) ?? "";
  return { ok: r.success, out, err: err.replace(/^psql:<stdin>:\d+: /, "") };
}

/** Who of this file's people got rows, as "a1,a2", from the notifications matching `where`. */
const heard = (where: string) =>
  `select coalesce(string_agg(x.who, ',' order by x.who), 'nobody') from (
    select case n.user_id when '${U.a1}' then 'a1' when '${U.a2}' then 'a2'
      when '${U.lead}' then 'lead' when '${U.rep}' then 'rep' end as who
    from public.notifications n where n.user_id in (${IDS}) and ${where}) x`;
const newFile = (rep: string | null, name = "Zed Deli") =>
  `insert into public.applications (id, status, business_name, first_name, email, rep_slug)
   values ('${NEW}', 'new', '${name}', 'Zed', 'zed@test.dev', ${rep ? `'${rep}'` : "null"})`;
const newLead = (rep: string | null, first = "Zed") =>
  `insert into public.leads (email, first_name, answers, rep_slug)
   values ('zed.lead@test.dev', '${first}', '{"source": "application_link"}', ${rep ? `'${rep}'` : "null"})`;
const claim = (attempt: number, extra = "") =>
  `insert into public.events (application_id, kind, body, payload)
   values ('${FILE}', 'system', 'Sending the signed application email.',
     '{"notice_claim": "new_application", "attempt": ${attempt}${extra}}') returning 1`;

const FIXTURE = `
begin;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email, '{}', now(), now()
from (values
  ('${U.a1}', 'ua.a1@test.dev'), ('${U.a2}', 'ua.a2@test.dev'),
  ('${U.lead}', 'ua.lead@test.dev'), ('${U.rep}', 'ua.rep@test.dev')) v(id, email);
insert into public.user_roles (user_id, role) values
  ('${U.a1}', 'admin'), ('${U.a2}', 'admin'), ('${U.lead}', 'rep'), ('${U.rep}', 'rep');
insert into public.reps (slug, name, user_id, active) values
  ('uaadmin', 'Ada Admin', '${U.a1}', true),
  ('ualead', 'Lena Lead', '${U.lead}', true),
  ('uarep', 'Ray Rep', '${U.rep}', true),
  ('uanologin', 'Nora Nologin', null, true)
on conflict (slug) do nothing;
update public.reps set admin_slug = 'ualead' where slug = 'uarep';
update public.reps set admin_slug = 'uaadmin' where slug = 'uanologin';
insert into public.applications (id, status, business_name, first_name, email, rep_slug)
values ('${FILE}', 'new', 'Claim Co', 'Cy', 'cy@test.dev', 'uarep');
commit;
`;

type Case = [expect: string, label: string, sql: string];
const CASES: Case[] = [
  // ---------- a new file ----------
  [
    "a1,a2",
    "a file with no rep: one 'file' row per admin",
    `${newFile(null)};\n${heard(`n.application_id = '${NEW}' and n.kind = 'file'`)}`,
  ],
  [
    "t",
    "every admin in the database, not only this file's",
    `${newFile(null)};\nselect (select count(*) from public.notifications where application_id = '${NEW}' and kind = 'file') = (select count(distinct user_id) from public.user_roles where role::text = 'admin')`,
  ],
  [
    "Came in from the website with no rep yet.|/staff?file=" + NEW,
    "what the admins read, and where it opens",
    `${newFile(null)};\nselect body || '|' || link from public.notifications where application_id = '${NEW}' and user_id = '${U.a2}'`,
  ],
  [
    "a2",
    "an admin who makes an unassigned file isn't told about it",
    `select set_config('request.jwt.claim.sub', '${U.a1}', true) \\g /dev/null\n${newFile(null)};\n${heard(`n.application_id = '${NEW}' and n.kind = 'file'`)}`,
  ],
  [
    "a1,a2",
    "a rep with no login: the admins hear instead, once each",
    `${newFile("uanologin")};\n${heard(`n.application_id = '${NEW}' and n.kind = 'file'`)}`,
  ],
  [
    "1",
    "the admin that rep reports to gets one row, not two",
    `${newFile("uanologin")};\nselect count(*) from public.notifications where application_id = '${NEW}' and user_id = '${U.a1}'`,
  ],
  [
    "lead,rep",
    "a rep with a login: the rep and their lead, as before, no admins",
    `${newFile("uarep")};\n${heard(`n.application_id = '${NEW}' and n.kind = 'file'`)}`,
  ],
  // ---------- someone starts ----------
  [
    "a1,a2",
    "a start with no rep: 'started' rows for the admins",
    `${newLead(null, "Quinn")};\n${heard(`n.kind = 'started' and n.title = 'Started on the website: Quinn'`)}`,
  ],
  [
    "t",
    "with no file on them, so Discord keeps them to DMs",
    `${newLead(null, "Quinn")};\nselect bool_and(application_id is null)::text::bool from public.notifications where kind = 'started' and title = 'Started on the website: Quinn'`,
  ],
  [
    "a1,a2",
    "a start on a rep with no login: the admins",
    `${newLead("uanologin", "Quinn")};\n${heard(`n.kind = 'started' and n.title like 'Started on Nora Nologin''s link: Quinn'`)}`,
  ],
  [
    "rep",
    "a start on a rep with a login: that rep only, as before",
    `${newLead("uarep", "Quinn")};\n${heard(`n.kind = 'started' and n.title = 'Started on your link: Quinn'`)}`,
  ],
  [
    "nobody",
    "a lead that isn't an application start tells nobody",
    `insert into public.leads (email, first_name, answers) values ('q@test.dev', 'Quinn', '{}');\n${heard(`n.kind = 'started' and n.title like '%Quinn%'`)}`,
  ],
  // ---------- the new-file email's claim ----------
  ["1", "the first claim on a file is taken", claim(0)],
  [
    "refused",
    "a second claim on the same attempt is refused",
    `${claim(0)} \\g /dev/null\n${claim(0)}`,
  ],
  [
    "refused",
    "even once the first claim became the 'Emailed' record",
    `${claim(0, ', "notice": "new_application"')} \\g /dev/null\n${claim(0)}`,
  ],
  ["1", "the next attempt is free", `${claim(0)} \\g /dev/null\n${claim(1)}`],
  [
    "1",
    "other timeline rows are untouched by the rule",
    `insert into public.events (application_id, kind, body, payload) values ('${FILE}', 'system', 'x', '{"notice": "new_application"}') \\g /dev/null\ninsert into public.events (application_id, kind, body, payload) values ('${FILE}', 'system', 'x', '{"notice": "new_application"}') returning 1`,
  ],
  [
    "refused",
    "nobody signed in can call notify_admins",
    `set local role authenticated;\nselect set_config('request.jwt.claim.sub', '${U.rep}', true) \\g /dev/null\nselect public.notify_admins('file', 'x', null, null, null)`,
  ],
];

let bad = 0;
const fx = await psql(FIXTURE);
if (!fx.ok) {
  console.error("Fixture failed:", fx.err);
  Deno.exit(1);
}
for (const [expect, label, sql] of CASES) {
  const r = await psql(`begin;\n${sql};\nrollback;\n`);
  const got = r.ok && r.out.length ? r.out[r.out.length - 1] : r.ok ? "0" : "refused";
  const ok = got === expect;
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label.padEnd(72)} -> ${got}${!ok ? `  (wanted ${expect}) ${r.err}` : ""}`,
  );
}

// leave the container as it was
await psql(`begin;
delete from public.notifications where user_id in (${IDS});
delete from public.chat_threads where team_slug in ('uaadmin', 'ualead', 'uarep', 'uanologin');
delete from public.applications where id in ('${FILE}', '${NEW}');
delete from public.reps where slug in ('uaadmin', 'ualead', 'uarep', 'uanologin');
delete from auth.users where id in (${IDS});
commit;`);
console.log(`\n${bad} problems`);
Deno.exit(bad ? 1 : 0);
