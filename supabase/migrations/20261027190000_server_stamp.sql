-- Lamp's own server in front of the sensitive parts of the database (2026-10-27).
--
-- The browser keeps its sign-in (email link, Google through Lovable's broker), so it always holds
-- a key the database accepts. This migration lets the database refuse that key on its own, for the
-- parts that now go through getlamp.app's server routes:
--   * every file in the documents bucket (bank statements, IDs, the signed application): upload,
--     list, open and remove;
--   * adding, reviewing or removing a documents row. Reading the list stays as it is: the staff
--     board counts documents through pipeline_board;
--   * staff reading the full application (staff_application_details, reveal_application_details);
--   * the public lead form.
-- The server proves a request came through it with a secret header, x-lamp-server. The database
-- keeps only the secret's SHA-256 (lamp_private.server_stamp), and one extra restrictive rule on each of
-- those tables requires it. Restrictive rules only ever take away: every existing per-person rule
-- still decides who sees and changes what, for the server's requests too.
--
-- Also:
--   * opening a document writes a row to sensitive_access_log ('open_document'), like Show SSN;
--   * the lead form may set only email, first name, phone, answers and utm (the rep still comes
--     from the ref link through leads_before_insert), and the server lets one network send at most
--     10 leads an hour (lead_intake_allowed).
--
-- Nothing is refused until the switch is on. After the site is published with LAMP_SERVER_STAMP
-- set, and getlamp.app/api/server-check says the stamp arrives:
--   update lamp_private.server_stamp set enforce = true;    -- switch on
--   update lamp_private.server_stamp set enforce = false;   -- back to today's behaviour at once
-- The secret's hash is set on its own line in the SQL editor, never in this file (see the PR).
-- Safe to run again.

set lock_timeout = '5s';

do $$
begin
  perform 'public.can_see_application_details(uuid)'::regprocedure;
  perform 'public.rep_can_see_application(uuid)'::regprocedure;
  perform 'public._ip_key(text)'::regprocedure;
exception when undefined_function then
  raise exception 'Run 20261027120000_application_links.sql before this one.';
end;
$$;

-- ---------- 1. The stamp ----------
create schema if not exists lamp_private;
revoke all on schema lamp_private from public, anon, authenticated;

create table if not exists lamp_private.server_stamp (
  id boolean primary key default true check (id),
  stamp_hash text check (stamp_hash ~ '^[0-9a-f]{64}$'),
  enforce boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into lamp_private.server_stamp (id) values (true) on conflict (id) do nothing;
revoke all on lamp_private.server_stamp from public, anon, authenticated;

create or replace function lamp_private.server_stamp_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists server_stamp_touch on lamp_private.server_stamp;
create trigger server_stamp_touch
  before update on lamp_private.server_stamp
  for each row execute function lamp_private.server_stamp_touch();

-- Does this request carry the server's stamp? The header as the API saw it; nothing else sets it.
create or replace function lamp_private.stamp_received()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select s.stamp_hash = encode(sha256(convert_to(coalesce(
      (nullif(current_setting('request.headers', true), '')::json ->> 'x-lamp-server'), ''),
      'UTF8')), 'hex')
    from lamp_private.server_stamp s where s.id
  ), false);
$$;

-- The check the restrictive rules use: true while the switch is off (today's behaviour), and once
-- it is on, only for a request that carries the stamp.
create or replace function public.via_lamp_server()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when coalesce((select s.enforce from lamp_private.server_stamp s where s.id), false)
      then lamp_private.stamp_received()
    else true
  end;
$$;

-- For getlamp.app/api/server-check: is the switch on, is a hash set, did this request's stamp
-- match. Yes or no only.
create or replace function public.server_stamp_status()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enforcing', coalesce((select s.enforce from lamp_private.server_stamp s where s.id), false),
    'hash_set', coalesce((select s.stamp_hash is not null from lamp_private.server_stamp s where s.id), false),
    'received', lamp_private.stamp_received()
  );
$$;

revoke all on function lamp_private.server_stamp_touch() from public, anon, authenticated;
revoke all on function lamp_private.stamp_received() from public, anon, authenticated;
revoke all on function public.via_lamp_server() from public;
grant execute on function public.via_lamp_server() to anon, authenticated, service_role;
revoke all on function public.server_stamp_status() from public;
grant execute on function public.server_stamp_status() to anon, authenticated, service_role;

-- ---------- 2. Files in the documents bucket: only through the server ----------
drop policy if exists "Documents bucket through Lamp's server" on storage.objects;
create policy "Documents bucket through Lamp's server" on storage.objects
  as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'documents' or (select public.via_lamp_server()))
  with check (bucket_id <> 'documents' or (select public.via_lamp_server()));

-- ---------- 3. Documents rows: adding, reviewing and removing only through the server ----------
drop policy if exists "Documents added through Lamp's server" on public.documents;
create policy "Documents added through Lamp's server" on public.documents
  as restrictive
  for insert to anon, authenticated
  with check ((select public.via_lamp_server()));
drop policy if exists "Documents changed through Lamp's server" on public.documents;
create policy "Documents changed through Lamp's server" on public.documents
  as restrictive
  for update to anon, authenticated
  using ((select public.via_lamp_server()))
  with check ((select public.via_lamp_server()));
drop policy if exists "Documents removed through Lamp's server" on public.documents;
create policy "Documents removed through Lamp's server" on public.documents
  as restrictive
  for delete to anon, authenticated
  using ((select public.via_lamp_server()));

-- ---------- 4. Opening a document is logged ----------
alter table public.sensitive_access_log
  add column if not exists document_id uuid references public.documents (id) on delete set null;

do $$
declare c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.sensitive_access_log'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%reveal_ssn%';
  if c is not null then
    execute format('alter table public.sensitive_access_log drop constraint %I', c);
  end if;
  alter table public.sensitive_access_log add constraint sensitive_access_log_action_check
    check (action in ('reveal_ssn', 'application_pdf', 'funder_submission', 'open_document'));
exception when duplicate_object then null;
end;
$$;

-- Who may open a document is who may read its row: the merchant it belongs to ("Users read own
-- documents"), an admin, or staff who can see the file ("Staff read documents"). The server reads
-- the row as the caller first and asks for the signed link as the caller after, so the storage
-- rules decide too; this records the open and returns where the file is.
create or replace function public.open_document(_document_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  d public.documents;
begin
  if not public.via_lamp_server() then
    raise exception 'documents open only through getlamp.app' using errcode = 'insufficient_privilege';
  end if;
  select * into d from public.documents where id = _document_id;
  if not found
     or not (
       d.user_id = auth.uid()
       or public.has_role('admin')
       or (public.is_staff() and public.rep_can_see_application(d.application_id))
     ) then
    raise exception 'that document is not yours to open' using errcode = 'insufficient_privilege';
  end if;
  insert into public.sensitive_access_log (actor_user_id, actor_email, application_id, document_id, action)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          d.application_id, d.id, 'open_document');
  return jsonb_build_object(
    'bucket', d.bucket,
    'storage_path', d.storage_path,
    'original_name', d.original_name
  );
end;
$$;
revoke all on function public.open_document(uuid) from public, anon;
grant execute on function public.open_document(uuid) to authenticated;

-- ---------- 5. The public lead form ----------
-- Only the fields the form has; rep_slug, source and the conversion columns are set by triggers.
revoke insert on public.leads from anon, authenticated;
grant insert (email, first_name, phone, answers, utm) on public.leads to anon, authenticated;

drop policy if exists "Leads through Lamp's server" on public.leads;
create policy "Leads through Lamp's server" on public.leads
  as restrictive
  for insert to anon, authenticated
  with check ((select public.via_lamp_server()));

-- One row per lead the server let through, kept a day, for the per-network limit.
create table if not exists public.lead_intake (
  id bigint generated always as identity primary key,
  ip_key text not null,
  created_at timestamptz not null default now()
);
create index if not exists lead_intake_ip_idx on public.lead_intake (ip_key, created_at desc);
alter table public.lead_intake enable row level security;
revoke all on public.lead_intake from public, anon, authenticated;
grant all on public.lead_intake to service_role;

-- The server's service role asks before it records a lead: at most 10 an hour from one network
-- (an IPv6 address counts by its /64, as for link signing). The lock makes parallel requests
-- from one network take turns. With no address (the edge didn't say) there is no limit, as for
-- link signing, rather than one shared limit for every visitor.
create or replace function public.lead_intake_allowed(_ip text)
returns boolean
language plpgsql volatile security definer
set search_path = public
as $$
declare
  k text;
  recent int;
begin
  if nullif(trim(coalesce(_ip, '')), '') is null then
    return true;
  end if;
  k := public._ip_key(left(trim(_ip), 64));
  perform pg_advisory_xact_lock(hashtext('lead_ip:' || k));
  delete from public.lead_intake where created_at < now() - interval '1 day';
  select count(*) into recent from public.lead_intake
  where ip_key = k and created_at > now() - interval '1 hour';
  if recent >= 10 then
    return false;
  end if;
  insert into public.lead_intake (ip_key) values (k);
  return true;
end;
$$;
revoke all on function public.lead_intake_allowed(text) from public, anon, authenticated;
grant execute on function public.lead_intake_allowed(text) to service_role;

-- ---------- 6. Staff read the full application only through the server ----------
-- Same as 20261027120000_application_links.sql section 7, with the stamp checked first.
create or replace function public.staff_application_details(_application_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  r public.application_details;
begin
  if not public.via_lamp_server() then
    raise exception 'the full application opens only through getlamp.app'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.can_see_application_details(_application_id) then
    raise exception 'the full application is visible to admins and the assigned rep'
      using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.application_details where application_id = _application_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'business', r.business,
    'owners', coalesce(
      (select jsonb_agg(public.mask_owner(o.value) order by o.ordinality)
       from jsonb_array_elements(r.owners) with ordinality as o),
      '[]'::jsonb),
    'balances', r.balances,
    'request', r.request,
    'real_estate', r.real_estate,
    'signed_name', r.signed_name,
    'signed_name_2', r.signed_name_2,
    'signed_at', r.signed_at,
    'signed_via', r.signed_via,
    'signature_image', r.signature_image,
    'signature_image_2', r.signature_image_2,
    'signer_ip', r.signer_ip,
    'signer_agent', r.signer_agent,
    'consent_version', r.consent_version
  );
end;
$$;

create or replace function public.reveal_application_details(
  _application_id uuid,
  _purpose text default 'reveal_ssn'
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  r public.application_details;
begin
  if not public.via_lamp_server() then
    raise exception 'the full application opens only through getlamp.app'
      using errcode = 'insufficient_privilege';
  end if;
  if _purpose is null or _purpose not in ('reveal_ssn', 'application_pdf', 'funder_submission') then
    raise exception 'unknown purpose' using errcode = 'invalid_parameter_value';
  end if;
  if not public.can_see_application_details(_application_id) then
    raise exception 'the full application is visible to admins and the assigned rep'
      using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.application_details where application_id = _application_id;
  if not found then
    return null;
  end if;
  insert into public.sensitive_access_log (actor_user_id, actor_email, application_id, action)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          _application_id, _purpose);
  return jsonb_build_object(
    'business', r.business,
    'owners', r.owners,
    'balances', r.balances,
    'request', r.request,
    'real_estate', r.real_estate,
    'signed_name', r.signed_name,
    'signed_name_2', r.signed_name_2,
    'signed_at', r.signed_at,
    'signed_via', r.signed_via,
    'signature_image', r.signature_image,
    'signature_image_2', r.signature_image_2,
    'signer_ip', r.signer_ip,
    'signer_agent', r.signer_agent,
    'consent_version', r.consent_version
  );
end;
$$;
revoke all on function public.staff_application_details(uuid) from public, anon;
revoke all on function public.reveal_application_details(uuid, text) from public, anon;
grant execute on function public.staff_application_details(uuid) to authenticated;
grant execute on function public.reveal_application_details(uuid, text) to authenticated;

reset lock_timeout;
