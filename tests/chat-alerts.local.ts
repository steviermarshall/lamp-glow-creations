// A merchant's chat message rings the right bells (20261127110000_chat_staff_alerts.sql), checked
// against a LOCAL Postgres only.
//
//   CONTAINER=lamp-chat-proof deno run --allow-run --allow-env tests/chat-alerts.local.ts
//
// The container is Supabase's Postgres image (public.ecr.aws/supabase/postgres:17.6.1.131) with
// every file in supabase/migrations applied in order, as for tests/chat-rules.local.ts. This file
// adds its own people and files, sends each message as that person (role "authenticated" with their
// id as the JWT subject, as PostgREST does), reads the notifications back as the database, rolls
// every case back, and removes its people at the end. It never talks to Lovable Cloud, and the
// Discord relay stays quiet because a local stack has no team_relay_url in its Vault.
// Not run by `deno test`.

const C = (Deno.env.get("CONTAINER") ?? "").trim();
if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(C)) {
  console.error("Set CONTAINER to the local Postgres container's name.");
  Deno.exit(2);
}

const U = {
  admin: "d1000000-0000-0000-0000-000000000001",
  lead: "d2000000-0000-0000-0000-000000000002",
  rep: "d3000000-0000-0000-0000-000000000003",
  mA: "da000000-0000-0000-0000-00000000000a",
} as const;
const FILE_A = "ea000000-0000-0000-0000-00000000000a"; // rep "alertrep", team lead "alertlead"
const FILE_U = "ec000000-0000-0000-0000-00000000000c"; // unassigned
const FILE_G = "ed000000-0000-0000-0000-00000000000d"; // rep seat "alertghost", which has no login
type Who = keyof typeof U | "db";
const IDS = Object.values(U)
  .map((u) => `'${u}'`)
  .join(",");
const SLUGS = `'alertlead', 'alertrep', 'alertghost', 'alertadmin'`;

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
        !["BEGIN", "SET", "RESET", "ROLLBACK", "COMMIT", "ALTER TABLE"].includes(l) &&
        !/^(INSERT|UPDATE|DELETE) /.test(l),
    );
  const err =
    new TextDecoder()
      .decode(r.stderr)
      .split("\n")
      .find((l) => /ERROR/.test(l)) ?? "";
  return { ok: r.success, out, err: err.replace(/^psql:<stdin>:\d+: /, "") };
}

/** SQL that makes the rest of the transaction run as this person ("db": as the database). */
const as = (who: Who) =>
  who === "db"
    ? "reset role;\n"
    : `set local role authenticated;\nselect set_config('request.jwt.claim.sub', '${U[who]}', true) \\g /dev/null\n`;

const FILE_T = (file: string) =>
  `(select id from public.chat_threads where application_id = '${file}')`;
/** Sends a text message as `who`, then goes back to being the database to look. */
const send = (who: Who, file: string, body: string) =>
  `${as(who)}insert into public.chat_messages (thread_id, body) values (${FILE_T(file)}, $b$${body}$b$);\n${as("db")}`;
/** 'message' alerts on a file for one person. */
const alertsFor = (file: string, user: string) =>
  `(select count(*) from public.notifications where kind = 'message' and application_id = '${file}' and user_id = '${user}')`;
const ADMINS = `(select count(distinct user_id) from public.user_roles where role::text = 'admin')`;

const FIXTURE = `
begin;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email, '{}', now(), now()
from (values
  ('${U.admin}', 'alert.admin@test.dev'), ('${U.lead}', 'alert.lead@test.dev'),
  ('${U.rep}', 'alert.rep@test.dev'), ('${U.mA}', 'alert.ma@test.dev')) v(id, email);
insert into public.user_roles (user_id, role) values
  ('${U.admin}', 'admin'), ('${U.lead}', 'rep'), ('${U.rep}', 'rep');
insert into public.reps (slug, name, user_id, active) values
  ('alertlead', 'Lena Lead', '${U.lead}', true),
  ('alertrep', 'Ray Rep', '${U.rep}', true),
  ('alertghost', 'Gus Ghost', null, true),
  ('alertadmin', 'Ada Admin', '${U.admin}', true)
on conflict (slug) do nothing;
update public.reps set admin_slug = 'alertlead' where slug = 'alertrep';
insert into public.applications (id, user_id, status, business_name, first_name, email, rep_slug) values
  ('${FILE_A}', '${U.mA}', 'reviewing', 'A Trucking', 'Maria', 'alert.ma@test.dev', 'alertrep'),
  ('${FILE_U}', '${U.mA}', 'new', 'A Trucking 2', 'Maria', 'alert.ma@test.dev', null),
  ('${FILE_G}', '${U.mA}', 'reviewing', 'A Trucking 3', 'Maria', 'alert.ma@test.dev', 'alertghost');
update public.applications set rep_slug = 'alertrep' where id = '${FILE_A}';
update public.applications set rep_slug = null where id = '${FILE_U}';
update public.applications set rep_slug = 'alertghost' where id = '${FILE_G}';
commit;
begin; ${as("mA")}select public.open_file_thread('${FILE_A}') \\g /dev/null
select public.open_file_thread('${FILE_U}') \\g /dev/null
select public.open_file_thread('${FILE_G}') \\g /dev/null
commit;
begin; delete from public.notifications where user_id in (${IDS}) and kind <> 'announcement'; commit;
`;

type Case = [expect: string, label: string, sql: string];
const CASES: Case[] = [
  [
    "lead:true:true:Message from A Trucking,rep:true:true:Message from A Trucking",
    "a merchant's text on an assigned file: one alert each for the rep and team lead",
    send("mA", FILE_A, "Hi, when will I hear back?") +
      `select string_agg(who || ':' || (body is null)::text || ':' || (link = '/staff?view=messages&thread=' || ${FILE_T(FILE_A)})::text || ':' || title, ',' order by who)
         from (select case user_id when '${U.rep}' then 'rep' when '${U.lead}' then 'lead' else 'other' end as who, body, link, title
                 from public.notifications where kind = 'message' and application_id = '${FILE_A}') x`,
  ],
  [
    "0",
    "no admin hears about an assigned file's message",
    send("mA", FILE_A, "Hello?") + `select ${alertsFor(FILE_A, U.admin)}`,
  ],
  [
    "true",
    "an unassigned file's message: every admin, once, and no rep",
    send("mA", FILE_U, "Is anyone there?") +
      `select (count(*) = ${ADMINS} and count(*) filter (where user_id = '${U.admin}') = 1
               and count(*) filter (where user_id in ('${U.rep}', '${U.lead}')) = 0)::text
         from public.notifications where kind = 'message' and application_id = '${FILE_U}'`,
  ],
  [
    "true",
    "a file whose rep has no login: every admin",
    send("mA", FILE_G, "Anyone?") +
      `select (count(*) = ${ADMINS} and count(*) filter (where user_id = '${U.admin}') = 1)::text
         from public.notifications where kind = 'message' and application_id = '${FILE_G}'`,
  ],
  [
    "true",
    "a rep who lost their staff role can't answer, so admins hear instead",
    `delete from public.user_roles where user_id = '${U.rep}';\n` +
      send("mA", FILE_A, "Hello?") +
      `select (${alertsFor(FILE_A, U.rep)} = 0 and ${alertsFor(FILE_A, U.admin)} = 1)::text`,
  ],
  [
    "0|1|document",
    "a merchant's upload: the 'document' bell only, no 'message' alert",
    `insert into public.documents (application_id, user_id, storage_path, kind, original_name) values ('${FILE_A}', '${U.mA}', '${U.mA}/statement.pdf', 'bank_statement', 'statement.pdf');\n` +
      `select (select count(*) from public.notifications where kind = 'message' and application_id = '${FILE_A}')
         || '|' || (select count(*) from public.notifications where kind = 'document' and application_id = '${FILE_A}' and user_id = '${U.rep}')
         || '|' || (select kind from public.chat_messages where thread_id = ${FILE_T(FILE_A)} and author_role = 'merchant' order by id desc limit 1)`,
  ],
  [
    "0",
    "a staff reply alerts nobody (rep, then team lead)",
    send("rep", FILE_A, "We're on it, Maria.") +
      send("lead", FILE_A, "Ray will call you today.") +
      `select count(*) from public.notifications where kind = 'message' and application_id = '${FILE_A}'`,
  ],
  [
    "0",
    "an admin's reply on an unassigned file alerts nobody",
    send("admin", FILE_U, "Hi Maria, this is Lamp.") +
      `select count(*) from public.notifications where kind = 'message' and application_id = '${FILE_U}'`,
  ],
  [
    "1|1|3",
    "three texts in a row: still one alert each, and all three messages saved",
    send("mA", FILE_A, "One") +
      send("mA", FILE_A, "Two") +
      send("mA", FILE_A, "Three") +
      `select ${alertsFor(FILE_A, U.rep)} || '|' || ${alertsFor(FILE_A, U.lead)} || '|' ||
         (select count(*) from public.chat_messages where thread_id = ${FILE_T(FILE_A)} and kind = 'text')`,
  ],
  [
    "2|2",
    "an unread alert older than 15 minutes no longer holds the next one back",
    send("mA", FILE_A, "First") +
      `update public.notifications set created_at = now() - interval '16 minutes' where kind = 'message' and application_id = '${FILE_A}';\n` +
      send("mA", FILE_A, "Still there?") +
      `select ${alertsFor(FILE_A, U.rep)} || '|' || ${alertsFor(FILE_A, U.lead)}`,
  ],
  [
    "1|2",
    "once the team lead has read theirs, only the team lead hears the next one",
    send("mA", FILE_A, "First") +
      `update public.notifications set read_at = now() where kind = 'message' and user_id = '${U.lead}';\n` +
      send("mA", FILE_A, "Second") +
      `select ${alertsFor(FILE_A, U.rep)} || '|' || ${alertsFor(FILE_A, U.lead)}`,
  ],
  [
    "2|1",
    "once the rep has read theirs, only the rep hears the next one",
    send("mA", FILE_A, "First") +
      `update public.notifications set read_at = now() where kind = 'message' and user_id = '${U.rep}';\n` +
      send("mA", FILE_A, "Second") +
      `select ${alertsFor(FILE_A, U.rep)} || '|' || ${alertsFor(FILE_A, U.lead)}`,
  ],
  [
    "1|0|true",
    "an error inside the alert: the message is still saved, and the conversation's clock moves",
    `alter table public.notifications add constraint chat_alert_test_block check (kind <> 'message') not valid;\n` +
      send("mA", FILE_A, "Did this go through?") +
      `select (select count(*) from public.chat_messages where thread_id = ${FILE_T(FILE_A)} and body = 'Did this go through?')
         || '|' || (select count(*) from public.notifications where kind = 'message' and application_id = '${FILE_A}')
         || '|' || (select (last_author = '${U.mA}')::text from public.chat_threads where application_id = '${FILE_A}')`,
  ],
  [
    "refused",
    "staff can't write alerts themselves",
    `${as("rep")}select public.chat_alert_staff(${FILE_T(FILE_A)})`,
  ],
  [
    "1",
    "a staff member reads their own alert under the bell",
    send("mA", FILE_A, "Hi") +
      `${as("rep")}select count(*) from public.notifications where kind = 'message'`,
  ],
  [
    "0",
    "and nobody else's",
    send("mA", FILE_A, "Hi") +
      `${as("rep")}select count(*) from public.notifications where kind = 'message' and user_id <> '${U.rep}'`,
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
    `${ok ? "ok  " : "FAIL"}  ${label.padEnd(92)} -> ${got}${!ok ? `  (wanted ${expect}) ${r.err}` : ""}`,
  );
}

// leave the container as it was
await psql(`begin;
delete from public.chat_messages where thread_id in (select id from public.chat_threads where application_id in ('${FILE_A}', '${FILE_U}', '${FILE_G}'));
delete from public.applications where id in ('${FILE_A}', '${FILE_U}', '${FILE_G}');
delete from public.chat_threads where team_slug in (${SLUGS});
delete from public.reps where slug in (${SLUGS});
delete from auth.users where id in (${IDS});
commit;`);
console.log(`\n${bad} problems`);
Deno.exit(bad ? 1 : 0);
