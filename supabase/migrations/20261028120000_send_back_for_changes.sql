-- Send back for changes, and notes added by Lamp staff (2026-10-28).
--
-- A signed application is the merchant's attestation, and funders rely on it, so nothing here ever
-- edits one. Instead:
--   * Every signature is kept as a version that never changes (application_versions): version 1
--     when the merchant first signs, version 2 when they sign an update, and so on. Signed files
--     that already exist become version 1 when this runs. application_details keeps holding the
--     newest signed version, exactly as before.
--   * An admin or the file's rep can send a signed file back for changes
--     (application_change_requests): they tick what's missing and add a message. Until the
--     merchant signs the update, or the rep cancels the request, nothing goes to funders.
--   * A merchant with no Lamp account yet gets an update link by email, only to the address on
--     their signed application (application_invites, kind 'changes'). The link opens after they
--     confirm their date of birth (5 tries), with their answers filled in. Their SSN and date of
--     birth are shown only as "on file" and stay in the database unless they type new ones. A
--     merchant with an account updates it from their account page.
--   * resubmit_change_request() is the only way a signed application changes. It runs on Lamp's
--     server, signs the next version in one transaction and closes the request. The database
--     still stamps the time and address; nobody at Lamp can sign for a merchant.
--   * A signed application can no longer be corrected in place, admins included: a correction is
--     a send-back (the merchant signs it) or a staff note (labelled as not signed).
--   * Staff can add notes to a file for things they learned by phone or email
--     (application_staff_additions): dated, with the author's name, never edited, withdrawable,
--     never shown to the merchant, and labelled "not signed by the merchant" wherever they appear.
--   * A file whose newest version is an update goes to funders only when a rep sends it by hand,
--     after reviewing what changed. Automatic sends skip it.
-- Paste before publishing. Safe to run again.

set lock_timeout = '5s';

do $$
begin
  perform 'public.submit_link_application(text, text, jsonb, text, text, text, text, text, text, text, text, text, text)'::regprocedure;
  perform 'public.can_see_application_details(uuid)'::regprocedure;
  perform 'public.funder_package_ready(uuid)'::regprocedure;
  perform 'public.mask_owner(jsonb)'::regprocedure;
  perform 'public._ip_key(text)'::regprocedure;
  perform 'public._num(text)'::regprocedure;
exception when undefined_function then
  raise exception 'Run 20261027120000_application_links.sql before this one.';
end;
$$;
-- the staff reads below keep that migration's "only through getlamp.app" check
do $$
begin
  perform 'public.via_lamp_server()'::regprocedure;
exception when undefined_function then
  raise exception 'Run 20261027190000_server_stamp.sql before this one.';
end;
$$;

-- ---------- 1. Signed versions ----------
create table if not exists public.application_versions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  version integer not null check (version >= 1),
  -- exactly what application_details held when it was signed
  business jsonb not null,
  owners jsonb not null,
  balances jsonb not null,
  request jsonb not null,
  real_estate jsonb not null,
  signed_name text not null,
  signed_name_2 text,
  signature_image text,
  signature_image_2 text,
  signed_at timestamptz not null,
  signed_via text,
  signer_ip text,
  signer_agent text,
  consent_text text,
  consent_version text,
  -- sha256 of the answers, the signatures, the time and the address, for spotting tampering
  snapshot_sha256 text not null,
  -- the change request this version answered (null for version 1); no foreign key, so deleting a
  -- whole file never has to update a version on the way out
  change_request_id uuid,
  recorded_by text not null default 'signing' check (recorded_by in ('signing', 'backfill', 'repair')),
  created_at timestamptz not null default now(),
  unique (application_id, version)
);

-- ---------- 2. Change requests ----------
create table if not exists public.application_change_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  base_version_id uuid not null references public.application_versions (id) on delete cascade,
  base_version integer not null,
  -- [{section, target?, label, note?}]: what the rep ticked, worded for the merchant
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 8),
  message text check (message is null or char_length(message) <= 1000),
  status text not null default 'open' check (status in ('open', 'submitted', 'cancelled')),
  -- 'email': an update link to the address on the application; 'account': they sign in to update
  channel text not null check (channel in ('email', 'account')),
  invite_id uuid,
  sends integer not null default 0 check (sends between 0 and 5),
  notified_at timestamptz,
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  result_version_id uuid references public.application_versions (id) on delete cascade,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  check ((status = 'submitted') = (submitted_at is not null and result_version_id is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (reviewed_at is null or status = 'submitted')
);
create unique index if not exists application_change_requests_one_open
  on public.application_change_requests (application_id) where status = 'open';
create index if not exists application_change_requests_app_idx
  on public.application_change_requests (application_id, created_at desc);

drop trigger if exists update_application_change_requests_updated_at on public.application_change_requests;
create trigger update_application_change_requests_updated_at
  before update on public.application_change_requests
  for each row execute function public.update_updated_at_column();

-- ---------- 3. Update links live with the other links ----------
alter table public.application_invites
  add column if not exists kind text not null default 'new',
  add column if not exists change_request_id uuid,
  add column if not exists verified_at timestamptz,
  add column if not exists failed_checks integer not null default 0,
  add column if not exists locked_at timestamptz;

-- an update link is always emailed by Lamp's server: staff never hold one to copy or text. (Its
-- file id can go null only while the whole file is being deleted, which deletes the link too.)
alter table public.application_invites drop constraint if exists application_invites_kind_check;
alter table public.application_invites add constraint application_invites_kind_check
  check (kind in ('new', 'changes')
         and (kind = 'new' or (channel = 'email' and change_request_id is not null)));
do $$
begin
  alter table public.application_invites add constraint application_invites_change_request_fkey
    foreign key (change_request_id) references public.application_change_requests (id) on delete cascade;
exception when duplicate_object then null;
end;
$$;
do $$
begin
  alter table public.application_change_requests add constraint application_change_requests_invite_fkey
    foreign key (invite_id) references public.application_invites (id) on delete set null;
exception when duplicate_object then null;
end;
$$;
create index if not exists application_invites_change_idx
  on public.application_invites (change_request_id) where change_request_id is not null;

-- A version's PDF is logged under its own reason (as 20261024120000_funder_send.sql and
-- 20261027190000_server_stamp.sql extend it; their reasons stay).
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
    check (action in ('reveal_ssn', 'application_pdf', 'funder_submission', 'open_document',
                      'version_pdf'));
exception when duplicate_object then null;
end;
$$;

-- ---------- 4. Notes added by Lamp staff (not signed by the merchant) ----------
create table if not exists public.application_staff_additions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  about text not null default 'other'
    check (about in ('business', 'owners', 'property', 'funding', 'other')),
  body text not null check (char_length(btrim(body)) between 2 and 2000),
  source text not null default 'phone' check (source in ('phone', 'email', 'text', 'document', 'other')),
  share_with_funders boolean not null default false,
  author_id uuid references auth.users (id) on delete set null,
  author_name text,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users (id) on delete set null
);
create index if not exists application_staff_additions_app_idx
  on public.application_staff_additions (application_id, created_at);

-- ---------- 5. Helpers (nobody calls these directly) ----------

-- What a version's fingerprint covers. The time as fixed UTC text: jsonb would render a
-- timestamptz in the session's zone.
create or replace function public._version_snapshot(_d public.application_details)
returns jsonb
language sql immutable
set search_path = public
as $$
  select jsonb_build_object(
    'business', _d.business, 'owners', _d.owners, 'balances', _d.balances, 'request', _d.request,
    'real_estate', _d.real_estate, 'signed_name', _d.signed_name, 'signed_name_2', _d.signed_name_2,
    'signature_image', _d.signature_image, 'signature_image_2', _d.signature_image_2,
    'signed_at', to_char(_d.signed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'signer_ip', _d.signer_ip, 'consent_version', _d.consent_version);
$$;

-- Records the signed row as the next version unless it already is one. Idempotent: the signing
-- trigger calls it, and so does anything that needs the newest version, which repairs a version
-- the trigger couldn't write (a signed row can't change any more, so the repair is exact).
create or replace function public._record_version(_application_id uuid, _request uuid, _how text)
returns uuid
language plpgsql volatile security definer
set search_path = public
as $$
declare
  d public.application_details;
  prev public.application_versions;
  vid uuid;
begin
  select * into d from public.application_details where application_id = _application_id for update;
  if not found or d.signed_at is null then
    return null;
  end if;
  select * into prev from public.application_versions
   where application_id = _application_id order by version desc limit 1;
  if found and prev.signed_at = d.signed_at then
    return prev.id;
  end if;
  perform set_config('lamp.versioning', 'on', true);
  insert into public.application_versions (
    application_id, version, business, owners, balances, request, real_estate, signed_name,
    signed_name_2, signature_image, signature_image_2, signed_at, signed_via, signer_ip,
    signer_agent, consent_text, consent_version, snapshot_sha256, change_request_id, recorded_by)
  values (
    d.application_id, coalesce(prev.version, 0) + 1, d.business, d.owners, d.balances, d.request,
    d.real_estate, d.signed_name, d.signed_name_2, d.signature_image, d.signature_image_2,
    d.signed_at, d.signed_via, d.signer_ip, d.signer_agent, d.consent_text, d.consent_version,
    encode(sha256(convert_to(public._version_snapshot(d)::text, 'UTF8')), 'hex'),
    case when prev.id is not null then _request end, _how)
  returning id into vid;
  perform set_config('lamp.versioning', 'off', true);
  return vid;
exception when unique_violation then
  -- another session recorded it a moment ago
  perform set_config('lamp.versioning', 'off', true);
  select id into vid from public.application_versions
   where application_id = _application_id and signed_at = d.signed_at;
  return vid;
end;
$$;

-- An SSN or date of birth still in its "on file" form is never signed as an answer.
create or replace function public._has_masked(_owners jsonb)
returns boolean
language sql immutable
set search_path = public
as $$
  select exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(_owners) = 'array' then _owners else '[]'::jsonb end) as o(value)
    where coalesce(o.value ->> 'ssn', '') like '%*%' or coalesce(o.value ->> 'dob', '') like '%*%');
$$;

-- Same person: names compared without case, spaces or punctuation.
create or replace function public._same_person(_a jsonb, _b jsonb)
returns boolean
language sql immutable
set search_path = public
as $$
  select lower(regexp_replace(coalesce(_a ->> 'first', '') || coalesce(_a ->> 'last', ''), '[^[:alpha:]]', '', 'g'))
       = lower(regexp_replace(coalesce(_b ->> 'first', '') || coalesce(_b ->> 'last', ''), '[^[:alpha:]]', '', 'g'))
     and length(regexp_replace(coalesce(_a ->> 'first', '') || coalesce(_a ->> 'last', ''), '[^[:alpha:]]', '', 'g')) > 0;
$$;

-- An "on file" SSN or date of birth sent back from the update page becomes the stored one again,
-- only for the same person in the same place and (for the SSN) the same last four digits.
-- Anything else is refused: the merchant types it again.
create or replace function public._resolve_kept(_new jsonb, _base_owners jsonb)
returns jsonb
language plpgsql immutable
set search_path = public
as $$
declare
  owners jsonb := case when jsonb_typeof(_new -> 'owners') = 'array' then _new -> 'owners' else '[]'::jsonb end;
  out jsonb := '[]'::jsonb;
  o jsonb;
  b jsonb;
  bssn text;
  k integer;
  refused text[] := '{}';
begin
  for k in 0 .. jsonb_array_length(owners) - 1 loop
    o := owners -> k;
    b := _base_owners -> k;
    if coalesce(o ->> 'ssn', '') ~ '^\*{3}-\*{2}-\d{4}$' then
      bssn := regexp_replace(coalesce(b ->> 'ssn', ''), '\D', '', 'g');
      if b is null or not public._same_person(o, b) or length(bssn) <> 9
         or right(bssn, 4) <> right(o ->> 'ssn', 4) then
        refused := refused || ('owners.' || k || '.ssn');
      else
        o := o || jsonb_build_object('ssn', b ->> 'ssn');
      end if;
    end if;
    if coalesce(o ->> 'dob', '') = '**/**/****' then
      if b is null or not public._same_person(o, b) or coalesce(b ->> 'dob', '') = '' then
        refused := refused || ('owners.' || k || '.dob');
      else
        o := o || jsonb_build_object('dob', b ->> 'dob');
      end if;
    end if;
    out := out || jsonb_build_array(o);
  end loop;
  -- all of them at once, so the page can ask for every one in a single round
  if cardinality(refused) > 0 then
    raise exception 'kept_value' using errcode = 'P0001', detail = array_to_string(refused, ',');
  end if;
  return _new || jsonb_build_object('owners', out);
end;
$$;

-- Per owner in the newer version: did the SSN or date of birth change, or is the owner new.
-- Computed on the full values so staff learn only that something changed.
create or replace function public._secret_changes(_before jsonb, _after jsonb)
returns jsonb
language sql immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'added', b.value is null,
      'ssn', b.value is not null and regexp_replace(coalesce(a.value ->> 'ssn', ''), '\D', '', 'g')
                                  <> regexp_replace(coalesce(b.value ->> 'ssn', ''), '\D', '', 'g'),
      'dob', b.value is not null and coalesce(a.value ->> 'dob', '') <> coalesce(b.value ->> 'dob', ''))
    order by a.ordinality), '[]'::jsonb)
  from jsonb_array_elements(coalesce(_after, '[]'::jsonb)) with ordinality as a
  left join jsonb_array_elements(coalesce(_before, '[]'::jsonb)) with ordinality as b
    on b.ordinality = a.ordinality;
$$;

-- SSN-shaped text (nine digits, dashed or not). A ten-digit phone number doesn't match.
create or replace function public._sensitive_text(_t text)
returns boolean
language sql immutable
set search_path = public
as $$
  select coalesce(_t, '') ~ '(^|[^0-9])[0-9]{3}[- ]?[0-9]{2}[- ]?[0-9]{4}([^0-9]|$)';
$$;

-- What a rep may ask for: at most 8 items, each with a section, an optional target the page
-- highlights, a label the merchant reads and an optional note. No SSNs in any of it.
create or replace function public._valid_change_items(_items jsonb)
returns boolean
language sql immutable
set search_path = public
as $$
  select jsonb_typeof(_items) = 'array'
     and jsonb_array_length(_items) <= 8
     and not exists (
       select 1 from jsonb_array_elements(_items) as i(value)
       where jsonb_typeof(i.value) <> 'object'
          or coalesce(i.value ->> 'section', '') not in ('business', 'owners', 'property', 'funding', 'other')
          or (coalesce(i.value ->> 'target', '') <> ''
              and (i.value ->> 'target') !~ '^(business|owners\.(0|1|new)|real_estate(\.properties\.(new|[0-9](\.liens(\.[0-9])?)?))?|balances|request|other)$')
          or char_length(btrim(coalesce(i.value ->> 'label', ''))) not between 3 and 140
          or char_length(coalesce(i.value ->> 'note', '')) > 300
          or public._sensitive_text(i.value ->> 'label')
          or public._sensitive_text(i.value ->> 'note'));
$$;

-- What an update link shows once the date of birth matched: the answers, with SSNs cut to the
-- last four and dates of birth hidden. Never signatures, addresses, devices or consent.
create or replace function public._link_prefill(_v public.application_versions)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'business', _v.business,
    'owners', coalesce((select jsonb_agg(public.mask_owner(o.value) order by o.ordinality)
                        from jsonb_array_elements(_v.owners) with ordinality as o), '[]'::jsonb),
    'balances', _v.balances,
    'request', _v.request,
    'real_estate', _v.real_estate);
$$;

-- The date-of-birth check on an update link. It returns rather than raises, so a wrong try is
-- counted even though nothing else happens; the fifth wrong one locks the link.
create or replace function public._check_change_dob(_invite_id uuid, _expected text, _given text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  want text := regexp_replace(coalesce(_expected, ''), '\D', '', 'g');
  got text := regexp_replace(coalesce(_given, ''), '\D', '', 'g');
  n integer;
  app uuid;
begin
  if want <> '' and want = got then
    update public.application_invites
       set verified_at = coalesce(verified_at, now()), failed_checks = 0
     where id = _invite_id;
    return null;
  end if;
  update public.application_invites
     set failed_checks = failed_checks + 1,
         locked_at = case when failed_checks + 1 >= 5 then coalesce(locked_at, now()) else locked_at end
   where id = _invite_id
  returning failed_checks, application_id into n, app;
  if n >= 5 then
    insert into public.events (application_id, kind, body)
    values (app, 'system', 'Update link locked after 5 wrong dates of birth. Email it again to send a new one.');
    return jsonb_build_object('error', 'locked', 'tries_left', 0);
  end if;
  return jsonb_build_object('error', 'wrong_dob', 'tries_left', 5 - n);
end;
$$;

-- ---------- 6. The application_details guard, now with versions ----------
-- As in 20261027120000_application_links.sql, with three changes: an update is signed only
-- through an open change request (resubmit_change_request); a signed application is final for
-- everyone, admins included (the admin correction is gone); and an "on file" SSN or date of
-- birth is never signed as an answer.
create or replace function public.application_details_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  -- set, transaction-local, only by the definer functions that sign; nothing a signed-in user
  -- can call sets them
  link_signing boolean := coalesce(current_setting('lamp.link_signing', true), '') = 'on';
  claiming boolean := coalesce(current_setting('lamp.claiming', true), '') = 'on';
  resigning boolean := coalesce(current_setting('lamp.resigning', true), '') = 'on';
  req uuid;
  hdr text;
  kept public.application_details;
begin
  -- a claim moves a link-signed row into the merchant's new account and changes nothing else
  if tg_op = 'UPDATE' and claiming and old.user_id is null and new.user_id is not null then
    kept := old;
    kept.user_id := new.user_id;
    return kept;
  end if;

  -- signing an update after "Send back for changes": the answers being replaced are already a
  -- recorded version, and this one becomes the next
  if tg_op = 'UPDATE' and resigning then
    begin
      req := nullif(current_setting('lamp.change_request', true), '')::uuid;
    exception when others then
      req := null;
    end;
    if old.signed_at is null or req is null or not exists (
         select 1 from public.application_change_requests r
         where r.id = req and r.application_id = old.application_id and r.status = 'open') then
      raise exception 'a signed application changes only through its open change request'
        using errcode = 'insufficient_privilege';
    end if;
    new.application_id := old.application_id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    if length(trim(coalesce(new.signed_name, ''))) < 3 or new.signature_image is null then
      raise exception 'bad_request: signature' using errcode = 'invalid_parameter_value';
    end if;
    if public._has_masked(new.owners) then
      raise exception 'bad_request: masked value' using errcode = 'invalid_parameter_value';
    end if;
    new.signed_via := case when old.user_id is null then 'link' else 'account' end;
    new.signer_ip := left(nullif(trim(coalesce(new.signer_ip, '')), ''), 64);
    new.signed_at := now();
    new.signed_name := trim(new.signed_name);
    new.signed_name_2 := nullif(trim(coalesce(new.signed_name_2, '')), '');
    if jsonb_array_length(new.owners) < 2 then
      new.signed_name_2 := null;
    end if;
    if new.signed_name_2 is null then
      new.signature_image_2 := null;
    end if;
    insert into public.events (application_id, actor_user_id, kind, body, visible_to_merchant)
    values (new.application_id, auth.uid(), 'system',
            'Updated application signed by ' || new.signed_name
              || coalesce(' and ' || new.signed_name_2, ''), true);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- a signed application is final for everyone, admins included: a correction is a send-back
    -- (the merchant signs the update) or a staff note (labelled as not signed)
    if old.signed_at is not null then
      raise exception 'this application is already signed' using errcode = 'check_violation';
    end if;
    new.application_id := old.application_id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;

  -- the database stamps the signature; the browser only sends the typed name and the drawing
  if new.signed_name is not null and length(trim(new.signed_name)) >= 3
     and (tg_op = 'INSERT' or old.signed_at is null) then
    if public._has_masked(new.owners) then
      raise exception 'bad_request: masked value' using errcode = 'invalid_parameter_value';
    end if;
    if new.user_id is null then
      -- a file with no account is signed only through submit_link_application
      if not link_signing then
        raise exception 'only the merchant can sign their application' using errcode = 'insufficient_privilege';
      end if;
      new.signed_via := 'link';
    else
      -- only the merchant the row belongs to can sign it; staff and admins never sign for them
      if auth.uid() is distinct from new.user_id then
        raise exception 'only the merchant can sign their application' using errcode = 'insufficient_privilege';
      end if;
      new.signed_via := 'account';
      -- the address the request came from, as the API gateway saw it
      begin
        hdr := coalesce(
          current_setting('request.headers', true)::json ->> 'cf-connecting-ip',
          current_setting('request.headers', true)::json ->> 'x-forwarded-for');
      exception when others then
        hdr := null;
      end;
      new.signer_ip := left(nullif(trim(split_part(coalesce(hdr, ''), ',', 1)), ''), 64);
    end if;
    new.signed_at := now();
    new.signed_name := trim(new.signed_name);
    new.signed_name_2 := nullif(trim(coalesce(new.signed_name_2, '')), '');
    -- a second signer only while the application has a second owner
    if jsonb_array_length(new.owners) < 2 then
      new.signed_name_2 := null;
    end if;
    if new.signed_name_2 is null then
      new.signature_image_2 := null;
    end if;
    insert into public.events (application_id, actor_user_id, kind, body, visible_to_merchant)
    values (new.application_id, auth.uid(), 'system',
            'Application signed by ' || new.signed_name
              || coalesce(' and ' || new.signed_name_2, ''), true);
  else
    -- a draft carries no signature
    new.signed_at := null;
    new.signature_image := null;
    new.signed_name_2 := null;
    new.signature_image_2 := null;
    new.signer_ip := null;
    new.signed_via := null;
  end if;
  return new;
end;
$$;

drop trigger if exists application_details_guard on public.application_details;
create trigger application_details_guard
  before insert or update on public.application_details
  for each row execute function public.application_details_guard();

-- ---------- 7. Every signature is recorded as a version ----------
-- Fail-open: a version that can't be written here never fails the signing itself (it is written
-- the next time anything reads the file's versions, from the same signed row). Not
-- "after update of signed_at": the browser never names signed_at, the guard stamps it.
create or replace function public.application_details_record_version()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  req uuid;
begin
  begin
    begin
      req := nullif(current_setting('lamp.change_request', true), '')::uuid;
    exception when others then
      req := null;
    end;
    perform public._record_version(new.application_id, req, 'signing');
  exception when others then
    begin
      insert into public.events (application_id, kind, body, payload)
      values (new.application_id, 'system', 'Signed version not recorded at signing; recorded on next use',
              jsonb_build_object('error', left(sqlerrm, 300)));
    exception when others then
      null;
    end;
  end;
  return null;
end;
$$;

drop trigger if exists application_details_record_version_ins on public.application_details;
create trigger application_details_record_version_ins
  after insert on public.application_details
  for each row when (new.signed_at is not null)
  execute function public.application_details_record_version();
drop trigger if exists application_details_record_version_upd on public.application_details;
create trigger application_details_record_version_upd
  after update on public.application_details
  for each row when (new.signed_at is not null and new.signed_at is distinct from old.signed_at)
  execute function public.application_details_record_version();

-- ---------- 8. Versions never change ----------
-- For every role, the server included. Deleting a whole file (only possible in the SQL editor)
-- takes its versions with it: that delete arrives through the foreign key, one trigger deep.
create or replace function public.application_versions_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'signed versions are kept for good' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if coalesce(current_setting('lamp.versioning', true), '') <> 'on' then
      raise exception 'a version is written only when an application is signed'
        using errcode = 'insufficient_privilege';
    end if;
    new.created_at := now();
    return new;
  end if;
  raise exception 'a signed version never changes' using errcode = 'insufficient_privilege';
end;
$$;

create or replace function public.application_versions_no_truncate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'signed versions are kept for good' using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists application_versions_guard on public.application_versions;
create trigger application_versions_guard
  before insert or update or delete on public.application_versions
  for each row execute function public.application_versions_guard();
drop trigger if exists application_versions_no_truncate on public.application_versions;
create trigger application_versions_no_truncate
  before truncate on public.application_versions
  for each statement execute function public.application_versions_no_truncate();

-- ---------- 9. A request's ask never changes; it only closes ----------
create or replace function public.application_change_requests_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'change requests are kept' using errcode = 'insufficient_privilege';
  end if;
  -- a deleted login's ON DELETE SET NULL arrives through the foreign key, one trigger deep
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.application_id <> old.application_id
     or new.base_version_id <> old.base_version_id
     or new.base_version <> old.base_version
     or new.items is distinct from old.items
     or new.message is distinct from old.message
     or new.requested_by is distinct from old.requested_by
     or new.created_at <> old.created_at then
    raise exception 'a change request''s ask never changes' using errcode = 'insufficient_privilege';
  end if;
  if new.status <> old.status and not (old.status = 'open' and new.status in ('submitted', 'cancelled')) then
    raise exception 'a closed change request stays closed' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists application_change_requests_guard on public.application_change_requests;
create trigger application_change_requests_guard
  before update or delete on public.application_change_requests
  for each row execute function public.application_change_requests_guard();

-- ---------- 10. An update link stays an update link ----------
-- submit_link_application marks the invite it used with the new file's id; for an update link
-- that raises here, so the whole submit rolls back as "link_not_found" and no second file is made.
create or replace function public.application_invites_kind_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- deleting a file clears its links through the foreign keys
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if old.kind = 'changes'
     and (new.application_id is distinct from old.application_id
          or new.kind is distinct from old.kind
          or new.change_request_id is distinct from old.change_request_id
          or new.channel is distinct from old.channel) then
    raise exception 'link_not_found' using errcode = 'P0001';
  end if;
  if old.kind = 'new' and new.kind <> 'new' then
    raise exception 'link_not_found' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists application_invites_kind_guard on public.application_invites;
create trigger application_invites_kind_guard
  before update on public.application_invites
  for each row execute function public.application_invites_kind_guard();

-- ---------- 11. Staff notes: stamped, never edited, withdrawable ----------
create or replace function public.application_staff_additions_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  who text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'Notes aren''t deleted; withdraw it instead.' using errcode = 'insufficient_privilege';
  end if;
  -- a deleted login's ON DELETE SET NULL arrives through the foreign key, one trigger deep
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.first_name), ''), p.email)
      into who from public.profiles p where p.id = auth.uid();
    new.author_id := auth.uid();
    new.author_name := coalesce(who, 'Lamp staff');
    new.created_at := now();
    new.body := btrim(new.body);
    new.withdrawn_at := null;
    new.withdrawn_by := null;
    -- the timeline says a note was added, never what it says: reps who can't open the full
    -- application can read the timeline of an unassigned file
    insert into public.events (application_id, actor_user_id, kind, body)
    values (new.application_id, auth.uid(), 'note',
            'Added a staff note to the application (not signed by the merchant)');
    return new;
  end if;
  if old.withdrawn_at is null and new.withdrawn_at is not null
     and new.application_id = old.application_id and new.about = old.about and new.body = old.body
     and new.source = old.source and new.share_with_funders = old.share_with_funders
     and new.author_id is not distinct from old.author_id
     and new.author_name is not distinct from old.author_name and new.created_at = old.created_at then
    new.withdrawn_at := now();
    new.withdrawn_by := auth.uid();
    return new;
  end if;
  raise exception 'Notes aren''t edited; withdraw it and add a new one.' using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists application_staff_additions_guard on public.application_staff_additions;
create trigger application_staff_additions_guard
  before insert or update or delete on public.application_staff_additions
  for each row execute function public.application_staff_additions_guard();

-- ---------- 12. Nothing goes to funders while the merchant is updating ----------
-- Each submission records which signed version it carried, so an update can go to a funder that
-- already has the version before it (and only once per version).
alter table public.submissions add column if not exists application_version integer;
update public.submissions set application_version = 1 where application_version is null;
do $$
declare c text;
begin
  -- the original one-per-funder rule (20261017120200), found by what it is rather than its name
  for c in
    select conname from pg_constraint
    where conrelid = 'public.submissions'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (application_id, funder_id)'
  loop
    execute format('alter table public.submissions drop constraint %I', c);
  end loop;
  alter table public.submissions add constraint submissions_application_funder_version_key
    unique (application_id, funder_id, application_version);
exception when duplicate_object or duplicate_table then null;
end;
$$;

-- As in 20261024120000_funder_send.sql, except that "already sent" means this funder has the
-- newest signed version: one that got version 1 can be sent the update.
create or replace function public._funder_matches(_application_id uuid)
returns table (
  funder_id uuid,
  funder_name text,
  submission_email text,
  auto_send boolean,
  already_sent boolean,
  eligible boolean,
  blockers text[],
  checks text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.applications;
  d public.application_details;
  dep_lo numeric; dep_hi numeric;
  tib_lo numeric; tib_hi numeric;
  fico_lo numeric; fico_hi numeric;
  amt_lo numeric; amt_hi numeric;
  v numeric;
  st text;
  ind text;
  pos int;
  f public.funders;
  b text[];
  c text[];
  -- the signed version a send would carry now: a funder that has an older one hasn't had this
  cur_version int := coalesce(
    (select max(x.version) from public.application_versions x where x.application_id = _application_id), 1);
begin
  select * into a from public.applications where id = _application_id;
  if a.id is null then
    return;
  end if;
  select * into d from public.application_details where application_id = _application_id;

  -- Monthly deposits: the full application's figure, else the quick-apply bucket.
  v := public._num(d.business ->> 'monthly_revenue');
  if v is not null and v > 0 then
    dep_lo := v; dep_hi := v;
  else
    case a.answers ->> 'revenue'
      when 'lt-20k' then dep_lo := 0; dep_hi := 19999;
      when '20-50k' then dep_lo := 20000; dep_hi := 50000;
      when '50-100k' then dep_lo := 50000; dep_hi := 100000;
      when '100-250k' then dep_lo := 100000; dep_hi := 250000;
      when '250k-plus' then dep_lo := 250000; dep_hi := null;
      else null;
    end case;
  end if;

  -- Months in business: from the start date, else the bucket.
  if nullif(d.business ->> 'start_date', '') is not null then
    begin
      v := (extract(year from age(current_date, (d.business ->> 'start_date')::date)) * 12
            + extract(month from age(current_date, (d.business ->> 'start_date')::date)));
      tib_lo := v; tib_hi := v;
    exception when others then
      tib_lo := null; tib_hi := null;
    end;
  end if;
  if tib_lo is null then
    case a.answers ->> 'tib'
      when 'lt-6m' then tib_lo := 0; tib_hi := 5;
      when '6-12m' then tib_lo := 6; tib_hi := 12;
      when '1-2y' then tib_lo := 12; tib_hi := 24;
      when '2-5y' then tib_lo := 24; tib_hi := 60;
      when '5y-plus' then tib_lo := 60; tib_hi := null;
      else null;
    end case;
  end if;

  -- Credit: the lowest score any owner gave, else the bucket.
  select min(public._num(o ->> 'credit')) into v
  from jsonb_array_elements(coalesce(d.owners, '[]'::jsonb)) o
  where public._num(o ->> 'credit') between 300 and 850;
  if v is not null then
    fico_lo := v; fico_hi := v;
  else
    case a.answers ->> 'credit'
      when 'lt-550' then fico_lo := 300; fico_hi := 549;
      when '550-649' then fico_lo := 550; fico_hi := 649;
      when '650-699' then fico_lo := 650; fico_hi := 699;
      when '700-plus' then fico_lo := 700; fico_hi := 850;
      else null;
    end case;
  end if;

  -- Amount requested.
  v := coalesce(public._num(d.request ->> 'amount'), a.amount_requested);
  if v is not null and v > 0 then
    amt_lo := v; amt_hi := v;
  else
    case a.answers ->> 'amount'
      when 'lt-25k' then amt_lo := 0; amt_hi := 25000;
      when '25-50k' then amt_lo := 25000; amt_hi := 50000;
      when '50-100k' then amt_lo := 50000; amt_hi := 100000;
      when '100-250k' then amt_lo := 100000; amt_hi := 250000;
      when '250k-plus' then amt_lo := 250000; amt_hi := null;
      else null;
    end case;
  end if;

  st := upper(nullif(trim(d.business ->> 'state'), ''));
  ind := lower(coalesce(nullif(trim(d.business ->> 'industry'), ''), a.answers ->> 'industry'));

  -- Open positions: balances still owed on another advance.
  if d.application_id is not null then
    select count(*) into pos
    from jsonb_array_elements(coalesce(d.balances, '[]'::jsonb)) x
    where coalesce(public._num(x ->> 'current'), 0) > 0 or coalesce(public._num(x ->> 'payment'), 0) > 0;
  end if;

  for f in select * from public.funders where active order by name loop
    b := '{}';
    c := '{}';

    if f.submission_email is null or f.submission_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      b := array_append(b, ('no submission email on the funder')::text);
    end if;

    if f.min_monthly_deposits is not null then
      if dep_lo is null then
        c := array_append(c, (format('no monthly deposits on file (minimum $%s)', to_char(f.min_monthly_deposits, 'FM999,999,999')))::text);
      elsif dep_lo >= f.min_monthly_deposits then
        null;
      elsif dep_hi is not null and dep_hi < f.min_monthly_deposits then
        b := array_append(b, (format('deposits under the $%s monthly minimum', to_char(f.min_monthly_deposits, 'FM999,999,999')))::text);
      else
        c := array_append(c, (format('deposits may be under the $%s monthly minimum: check the statements', to_char(f.min_monthly_deposits, 'FM999,999,999')))::text);
      end if;
    end if;

    if f.min_months_in_business is not null then
      if tib_lo is null then
        c := array_append(c, (format('no time in business on file (minimum %s months)', f.min_months_in_business))::text);
      elsif tib_lo >= f.min_months_in_business then
        null;
      elsif tib_hi is not null and tib_hi < f.min_months_in_business then
        b := array_append(b, (format('under %s months in business', f.min_months_in_business))::text);
      else
        c := array_append(c, (format('may be under %s months in business', f.min_months_in_business))::text);
      end if;
    end if;

    if f.min_credit_score is not null then
      if fico_lo is null then
        c := array_append(c, (format('no credit score on file (minimum %s)', f.min_credit_score))::text);
      elsif fico_lo >= f.min_credit_score then
        null;
      elsif fico_hi is not null and fico_hi < f.min_credit_score then
        b := array_append(b, (format('credit under %s', f.min_credit_score))::text);
      else
        c := array_append(c, (format('credit may be under %s', f.min_credit_score))::text);
      end if;
    end if;

    if f.min_amount is not null and amt_hi is not null and amt_hi < f.min_amount then
      b := array_append(b, (format('asks for less than the $%s minimum', to_char(f.min_amount, 'FM999,999,999')))::text);
    end if;
    if f.max_amount is not null and amt_lo is not null and amt_lo > f.max_amount then
      b := array_append(b, (format('asks for more than the $%s maximum', to_char(f.max_amount, 'FM999,999,999')))::text);
    end if;

    if st is not null and exists (select 1 from unnest(f.states_excluded) s where upper(trim(s)) = st) then
      b := array_append(b, (format('does not fund in %s', st))::text);
    elsif st is null and coalesce(array_length(f.states_excluded, 1), 0) > 0 then
      c := array_append(c, ('no business state on file')::text);
    end if;

    if ind is not null and exists (
      select 1 from unnest(f.industries_excluded) x
      where length(trim(x)) > 0 and (ind like '%' || lower(trim(x)) || '%' or lower(trim(x)) like '%' || ind || '%')
    ) then
      b := array_append(b, (format('does not fund %s', ind))::text);
    end if;

    if f.max_positions is not null then
      if pos is null then
        c := array_append(c, (format('open positions unknown (maximum %s)', f.max_positions))::text);
      elsif pos > f.max_positions then
        b := array_append(b, (format('%s open positions, maximum %s', pos, f.max_positions))::text);
      end if;
    end if;

    funder_id := f.id;
    funder_name := f.name;
    submission_email := f.submission_email;
    auto_send := f.auto_send;
    already_sent := exists (
      select 1 from public.submissions s
      where s.application_id = _application_id and s.funder_id = f.id
        and coalesce(s.application_version, 1) = cur_version
    );
    eligible := coalesce(array_length(b, 1), 0) = 0;
    blockers := b;
    checks := c;
    return next;
  end loop;
end;
$$;
revoke all on function public._funder_matches(uuid) from public, anon, authenticated;
grant execute on function public._funder_matches(uuid) to service_role;

-- The send-back locks the file row; a submission waits for it, then sees the open request.
-- (FOR NO KEY UPDATE, not FOR SHARE: two first sends of one file queue instead of deadlocking on
-- submissions_stamp_application's update of the same row.)
create or replace function public.submissions_change_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.application_version := coalesce(
    (select max(v.version) from public.application_versions v where v.application_id = new.application_id),
    1);
  if coalesce(new.sent_via, 'manual') not in ('email', 'auto_email') then
    return new;
  end if;
  perform 1 from public.applications where id = new.application_id for no key update;
  if exists (select 1 from public.application_change_requests r
             where r.application_id = new.application_id and r.status = 'open') then
    raise exception 'changes_requested' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists submissions_change_guard on public.submissions;
create trigger submissions_change_guard
  before insert on public.submissions
  for each row execute function public.submissions_change_guard();

-- As in 20261024120000_funder_send.sql, plus two rules: nothing is ready while the file is sent
-- back for changes, and a file whose newest version is an update is sent by a rep, by hand,
-- after reviewing what changed (its stored PDF is the older version's).
create or replace function public.funder_package_ready(_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not exists (select 1 from public.application_change_requests r
                where r.application_id = _application_id and r.status = 'open')
    and coalesce((select max(v.version) from public.application_versions v
                  where v.application_id = _application_id), 1) < 2
    and (select count(*) from public.documents
          where application_id = _application_id and kind = 'funder_application'
            and status in ('received', 'accepted')) >= 1
    and (select count(*) from public.documents
          where application_id = _application_id and kind = 'bank_statement'
            and status in ('received', 'accepted')) >= 3;
$$;

-- ---------- 13. Sending a file back, and cancelling or reviewing it ----------

-- An admin or the file's rep sends a signed file back. Returns what the server needs to email it.
create or replace function public.request_changes(_application_id uuid, _items jsonb, _message text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  a public.applications;
  d public.application_details;
  base uuid;
  bv integer;
  msg text := nullif(btrim(coalesce(_message, '')), '');
  items jsonb := coalesce(_items, '[]'::jsonb);
  norm jsonb;
  rid uuid;
begin
  if uid is null or not public.can_see_application_details(_application_id) then
    raise exception 'not_allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into a from public.applications where id = _application_id for no key update;
  if not found then
    raise exception 'file_not_found' using errcode = 'P0001';
  end if;
  if a.rep_slug is null then
    raise exception 'unassigned' using errcode = 'P0001';
  end if;
  if a.status in ('funded', 'withdrawn', 'closed') then
    raise exception 'file_closed' using errcode = 'P0001';
  end if;
  if not public._valid_change_items(items) then
    raise exception 'bad_request: items' using errcode = 'invalid_parameter_value';
  end if;
  if msg is not null and (char_length(msg) > 1000 or public._sensitive_text(msg)) then
    raise exception 'bad_request: message' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(items) = 0 and msg is null then
    raise exception 'bad_request: empty' using errcode = 'invalid_parameter_value';
  end if;
  select * into d from public.application_details where application_id = _application_id for update;
  if not found or d.signed_at is null then
    raise exception 'not_signed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.application_change_requests r
             where r.application_id = _application_id and r.status = 'open') then
    raise exception 'already_open' using errcode = 'P0001';
  end if;
  -- the last update first: what changed in it is reviewed before anything else is asked
  if exists (select 1 from public.application_change_requests r
             where r.application_id = _application_id and r.status = 'submitted' and r.reviewed_at is null) then
    raise exception 'unreviewed' using errcode = 'P0001';
  end if;
  -- a file with no account gets its update link at the email it was signed with, and only there
  if a.user_id is null then
    if lower(btrim(coalesce(a.claim_email, ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
      raise exception 'no_email' using errcode = 'P0001';
    end if;
    if lower(btrim(a.claim_email)) like '%@getlamp.app' or exists (
         select 1 from public.profiles p join public.user_roles ur on ur.user_id = p.id
         where lower(p.email) = lower(btrim(a.claim_email)) and ur.role in ('admin', 'rep')) then
      raise exception 'lamp_address' using errcode = 'P0001';
    end if;
  end if;
  if (select count(*) from public.application_change_requests r
      where r.application_id = _application_id and r.created_at > now() - interval '1 day') >= 3 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;

  -- the signed application as it stands is the version the merchant will update
  base := public._record_version(_application_id, null, 'repair');
  if base is null then
    raise exception 'not_signed' using errcode = 'P0001';
  end if;
  select version into bv from public.application_versions where id = base;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'section', i.value ->> 'section',
           'target', nullif(btrim(coalesce(i.value ->> 'target', '')), ''),
           'label', btrim(i.value ->> 'label'),
           'note', nullif(btrim(coalesce(i.value ->> 'note', '')), ''))) order by i.ordinality), '[]'::jsonb)
    into norm
    from jsonb_array_elements(items) with ordinality as i;

  insert into public.application_change_requests (
    application_id, base_version_id, base_version, items, message, channel, requested_by)
  values (
    _application_id, base, bv, norm, msg, case when a.user_id is null then 'email' else 'account' end, uid)
  returning id into rid;

  insert into public.events (application_id, actor_user_id, kind, body, payload)
  values (_application_id, uid, 'note',
          'Sent back for changes' || coalesce(': ' || left(msg, 200), ''),
          jsonb_build_object('change_request_id', rid, 'base_version', bv, 'items', norm));
  insert into public.events (application_id, actor_user_id, kind, body, visible_to_merchant)
  values (_application_id, uid, 'system', 'Your rep asked for an update to your application', true);

  return jsonb_build_object('request_id', rid, 'base_version', bv,
                            'channel', case when a.user_id is null then 'email' else 'account' end,
                            'claimed', a.user_id is not null, 'stage', a.status);
end;
$$;

-- Lamp's server, right after request_changes and again for "Email again". For a file with no
-- account, stores a new update link (the token's sha256; the token itself goes only into the
-- email) addressed to the email on the signed application, and nowhere else. For a file in a
-- merchant's account, nothing to link: they sign in. Returns who to email.
create or replace function public.issue_change_link(_request_id uuid, _token_hash text, _actor uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  r public.application_change_requests;
  a public.applications;
  v public.application_versions;
  i public.application_invites;
  em text;
  rep_name text;
  rep_user uuid;
  iid uuid;
begin
  select * into r from public.application_change_requests where id = _request_id;
  if not found then
    raise exception 'not_open' using errcode = 'P0001';
  end if;
  select * into a from public.applications where id = r.application_id for no key update;
  select * into r from public.application_change_requests where id = _request_id for update;
  if r.status <> 'open' then
    raise exception 'not_open' using errcode = 'P0001';
  end if;
  if a.rep_slug is null then
    raise exception 'unassigned' using errcode = 'P0001';
  end if;
  if _actor is null or not (
       public.has_role('admin', _actor)
       or (public.is_staff(_actor) and a.rep_slug is not null and a.rep_slug = public.current_rep_slug(_actor))) then
    raise exception 'not_allowed' using errcode = 'insufficient_privilege';
  end if;
  if r.sends >= 5 then
    raise exception 'too_many_sends' using errcode = 'P0001';
  end if;
  select p.name, p.user_id into rep_name, rep_user from public.reps p where p.slug = a.rep_slug;
  select * into v from public.application_versions where id = r.base_version_id;

  if a.user_id is not null then
    if r.notified_at is not null and r.notified_at > now() - interval '10 minutes' then
      raise exception 'too_soon' using errcode = 'P0001';
    end if;
    select lower(email) into em from auth.users where id = a.user_id;
    update public.application_change_requests
       set channel = 'account', sends = sends + 1
     where id = r.id;
    -- an update link sent before they had an account stops working
    if r.invite_id is not null then
      update public.application_invites set cancelled_at = coalesce(cancelled_at, now())
       where id = r.invite_id and submitted_at is null;
    end if;
    return jsonb_build_object(
      'channel', 'account', 'email', em, 'invite_id', null,
      'first_name', v.owners -> 0 ->> 'first', 'business_name', v.business ->> 'legal_name',
      'rep_slug', a.rep_slug, 'rep_name', rep_name, 'rep_user_id', rep_user, 'stage', a.status);
  end if;

  if coalesce(_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'bad_request: token' using errcode = 'invalid_parameter_value';
  end if;
  em := lower(btrim(coalesce(a.claim_email, '')));
  if em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'no_email' using errcode = 'P0001';
  end if;
  if em like '%@getlamp.app' or exists (
       select 1 from public.profiles p join public.user_roles ur on ur.user_id = p.id
       where lower(p.email) = em and ur.role in ('admin', 'rep')) then
    raise exception 'lamp_address' using errcode = 'P0001';
  end if;

  if r.invite_id is not null then
    select * into i from public.application_invites where id = r.invite_id for update;
    if i.sent_at > now() - interval '10 minutes' and i.last_error is null and i.cancelled_at is null
       and i.locked_at is null then
      raise exception 'too_soon' using errcode = 'P0001';
    end if;
    -- a new token: the one emailed before stops working
    update public.application_invites
       set token_hash = _token_hash, rep_slug = a.rep_slug, sent_by = _actor, email = em,
           sent_at = now(), expires_at = now() + interval '14 days',
           opened_at = null, started_at = null, verified_at = null, cancelled_at = null,
           last_error = null, email_message_id = null, failed_checks = 0, locked_at = null
     where id = i.id;
    iid := i.id;
  else
    insert into public.application_invites (
      token_hash, rep_slug, sent_by, first_name, last_name, business_name, email, channel, kind,
      change_request_id, application_id, expires_at)
    values (
      _token_hash, a.rep_slug, _actor, v.owners -> 0 ->> 'first', v.owners -> 0 ->> 'last',
      v.business ->> 'legal_name', em, 'email', 'changes', r.id, a.id, now() + interval '14 days')
    returning id into iid;
    update public.application_change_requests set invite_id = iid where id = r.id;
  end if;
  update public.application_change_requests set channel = 'email', sends = sends + 1 where id = r.id;
  return jsonb_build_object(
    'channel', 'email', 'email', em, 'invite_id', iid,
    'first_name', v.owners -> 0 ->> 'first', 'business_name', v.business ->> 'legal_name',
    'rep_slug', a.rep_slug, 'rep_name', rep_name, 'rep_user_id', rep_user, 'stage', a.status);
end;
$$;

-- Lamp's server, after the email to a merchant with an account went out: "Email again" waits 10
-- minutes from here, not from a send that failed.
create or replace function public.change_notice_sent(_request_id uuid)
returns void
language sql volatile security definer
set search_path = public
as $$
  update public.application_change_requests set notified_at = now()
   where id = _request_id and status = 'open' and channel = 'account';
$$;

-- Setting a document's status to itself re-runs documents_queue_auto_send (after insert or update
-- of status) and its checks, without changing anything: automatic sends a send-back held up get
-- their chance once it's cancelled.
create or replace function public._poke_auto_send(_application_id uuid)
returns void
language sql volatile security definer
set search_path = public
as $$
  update public.documents set status = status
   where id = (select d.id from public.documents d
               where d.application_id = _application_id
                 and d.kind in ('funder_application', 'bank_statement')
                 and d.status in ('received', 'accepted')
               order by d.created_at desc limit 1);
$$;

-- The rep (or an admin) no longer needs the update. The signed application stands as it was.
create or replace function public.cancel_change_request(_request_id uuid, _reason text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r public.application_change_requests;
  reason text := left(nullif(btrim(coalesce(_reason, '')), ''), 300);
begin
  select * into r from public.application_change_requests where id = _request_id;
  if not found or uid is null or not public.can_see_application_details(r.application_id) then
    raise exception 'not_allowed' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.applications where id = r.application_id for no key update;
  select * into r from public.application_change_requests where id = _request_id for update;
  if r.status <> 'open' then
    raise exception 'not_open' using errcode = 'P0001';
  end if;
  update public.application_change_requests
     set status = 'cancelled', cancelled_at = now(), cancelled_by = uid, cancel_reason = reason
   where id = r.id;
  if r.invite_id is not null then
    update public.application_invites set cancelled_at = coalesce(cancelled_at, now())
     where id = r.invite_id and submitted_at is null;
  end if;
  insert into public.events (application_id, actor_user_id, kind, body)
  values (r.application_id, uid, 'note', 'Update request cancelled' || coalesce(': ' || reason, ''));
  insert into public.events (application_id, actor_user_id, kind, body, visible_to_merchant)
  values (r.application_id, uid, 'system', 'Your rep no longer needs an update. Nothing else to do.', true);
  perform public._poke_auto_send(r.application_id);
  return jsonb_build_object('request_id', r.id, 'cancelled', true);
end;
$$;

-- The rep has looked at what changed. A re-signed file can be sent to funders after this.
create or replace function public.mark_changes_reviewed(_request_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r public.application_change_requests;
begin
  select * into r from public.application_change_requests where id = _request_id;
  if not found or uid is null or not public.can_see_application_details(r.application_id) then
    raise exception 'not_allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.application_change_requests where id = _request_id for update;
  if r.status <> 'submitted' then
    raise exception 'not_submitted' using errcode = 'P0001';
  end if;
  if r.reviewed_at is not null then
    return jsonb_build_object('request_id', r.id, 'already', true);
  end if;
  update public.application_change_requests set reviewed_at = now(), reviewed_by = uid where id = r.id;
  insert into public.events (application_id, actor_user_id, kind, body)
  values (r.application_id, uid, 'note', 'Reviewed the merchant''s update');
  return jsonb_build_object('request_id', r.id, 'already', false);
end;
$$;

-- ---------- 14. The merchant's side ----------

-- Lamp's server, when an update link is opened. Never raises for the merchant: it answers with a
-- state. Before the date of birth matches it shows no more than any link does today (the rep and
-- the first name); after, the answers with SSNs and dates of birth hidden.
create or replace function public.open_change_link(_token_hash text, _dob text default null, _event text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  i public.application_invites;
  r public.application_change_requests;
  a public.applications;
  v public.application_versions;
  repj jsonb;
  base jsonb;
  bad jsonb;
begin
  if coalesce(_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('state', 'not_found');
  end if;
  select * into i from public.application_invites where token_hash = _token_hash and kind = 'changes';
  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;
  select * into a from public.applications where id = i.application_id for no key update;
  select * into i from public.application_invites where id = i.id for update;
  if i.token_hash <> _token_hash then
    return jsonb_build_object('state', 'not_found');
  end if;
  select * into r from public.application_change_requests where id = i.change_request_id;
  select * into v from public.application_versions where id = r.base_version_id;
  select jsonb_build_object('slug', p.slug, 'name', p.name, 'title', p.title)
    into repj from public.reps p where p.slug = a.rep_slug;
  base := jsonb_build_object('rep', repj, 'first_name', v.owners -> 0 ->> 'first',
                             'business_name', v.business ->> 'legal_name');

  if r.status = 'cancelled' then
    return base || jsonb_build_object('state', 'withdrawn');
  elsif r.status = 'submitted' then
    return base || jsonb_build_object('state', 'done');
  elsif a.user_id is not null then
    return base || jsonb_build_object('state', 'sign_in');
  elsif a.status in ('funded', 'withdrawn', 'closed') then
    return base || jsonb_build_object('state', 'closed');
  elsif i.cancelled_at is not null then
    return base || jsonb_build_object('state', 'stopped');
  elsif i.locked_at is not null then
    return base || jsonb_build_object('state', 'locked');
  elsif i.expires_at < now() then
    return base || jsonb_build_object('state', 'expired');
  elsif coalesce(v.owners -> 0 ->> 'dob', '') = '' then
    return base || jsonb_build_object('state', 'sign_in');
  end if;

  if _dob is null then
    update public.application_invites set opened_at = coalesce(opened_at, now()) where id = i.id;
    return base || jsonb_build_object('state', 'verify', 'tries_left', 5 - i.failed_checks);
  end if;
  bad := public._check_change_dob(i.id, v.owners -> 0 ->> 'dob', _dob);
  if bad is not null then
    return base || jsonb_build_object(
      'state', case when bad ->> 'error' = 'locked' then 'locked' else 'verify' end,
      'wrong', true, 'tries_left', (bad ->> 'tries_left')::int);
  end if;
  update public.application_invites
     set opened_at = coalesce(opened_at, now()),
         started_at = case when _event = 'start' then coalesce(started_at, now()) else started_at end
   where id = i.id;
  return base || jsonb_build_object(
    'state', 'open',
    'request', jsonb_build_object(
      'id', r.id, 'items', r.items, 'message', r.message, 'base_version', r.base_version,
      'asked_at', r.created_at, 'expires_at', i.expires_at, 'signed_before_at', v.signed_at,
      'second_signed_before', v.signed_name_2 is not null),
    'prefill', public._link_prefill(v));
end;
$$;

-- Lamp's server, when the merchant signs the update: from an update link (_token_hash and _dob)
-- or from their account (_user_id, which the server took from their sign-in, and _request_id).
-- Signs the next version in one transaction and closes the request.
create or replace function public.resubmit_change_request(
  _token_hash text,
  _dob text,
  _user_id uuid,
  _request_id uuid,
  _base_version integer,
  _details jsonb,
  _signed_name text,
  _signature_image text,
  _signed_name_2 text,
  _signature_image_2 text,
  _consent_text text,
  _consent_version text,
  _signer_agent text,
  _signer_ip text
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  link_mode boolean := _token_hash is not null;
  i public.application_invites;
  r public.application_change_requests;
  a public.applications;
  base public.application_versions;
  nv public.application_versions;
  bad jsonb;
  resolved jsonb;
  owner0 jsonb;
  biz jsonb;
  amt numeric;
  recent integer;
  ip_key text;
  s_at timestamptz;
  s_ip text;
  vid uuid;
  em text;
begin
  if (link_mode and (_user_id is not null or _request_id is not null))
     or (not link_mode and (_user_id is null or _request_id is null)) then
    raise exception 'bad_request: who' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(_details) <> 'object'
     or jsonb_typeof(_details -> 'owners') <> 'array'
     or jsonb_array_length(_details -> 'owners') not between 1 and 2
     or jsonb_typeof(coalesce(_details -> 'balances', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(_details -> 'business', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(_details -> 'request', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(_details -> 'real_estate', '{}'::jsonb)) <> 'object' then
    raise exception 'bad_request: application shape' using errcode = 'invalid_parameter_value';
  end if;
  if length(trim(coalesce(_signed_name, ''))) < 3 or _signature_image is null then
    raise exception 'bad_request: signature' using errcode = 'invalid_parameter_value';
  end if;

  -- the same per-network limit as submit_link_application: an update signed from a link counts
  -- as a link signing (it moves that row's signed_at to now)
  if link_mode and _signer_ip is not null then
    ip_key := public._ip_key(left(_signer_ip, 64));
    perform pg_advisory_xact_lock(hashtext('link_ip:' || ip_key));
    select count(*) into recent from public.application_details
    where signed_via = 'link' and signed_at > now() - interval '1 hour'
      and public._ip_key(signer_ip) = ip_key;
    if recent >= 6 then
      raise exception 'too_many' using errcode = 'P0001';
    end if;
  end if;

  if link_mode then
    if _token_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'link_not_found' using errcode = 'P0001';
    end if;
    select * into i from public.application_invites where token_hash = _token_hash and kind = 'changes';
    if not found then
      raise exception 'link_not_found' using errcode = 'P0001';
    end if;
    select * into r from public.application_change_requests where id = i.change_request_id;
  else
    select * into r from public.application_change_requests where id = _request_id;
    if not found then
      raise exception 'not_yours' using errcode = 'insufficient_privilege';
    end if;
  end if;

  select * into a from public.applications where id = r.application_id for no key update;
  perform 1 from public.application_details where application_id = a.id for update;
  select * into r from public.application_change_requests where id = r.id for update;
  if link_mode then
    select * into i from public.application_invites where id = i.id for update;
  end if;

  if r.status = 'submitted' then
    raise exception 'already_signed' using errcode = 'P0001';
  elsif r.status = 'cancelled' then
    raise exception 'request_cancelled' using errcode = 'P0001';
  end if;
  if link_mode then
    if a.user_id is not null then
      raise exception 'sign_in' using errcode = 'P0001';
    elsif i.token_hash <> _token_hash then
      raise exception 'link_not_found' using errcode = 'P0001';
    elsif i.cancelled_at is not null then
      raise exception 'link_cancelled' using errcode = 'P0001';
    elsif i.locked_at is not null then
      raise exception 'locked' using errcode = 'P0001';
    elsif i.expires_at < now() then
      raise exception 'link_expired' using errcode = 'P0001';
    end if;
  else
    if a.user_id is null or a.user_id is distinct from _user_id then
      raise exception 'not_yours' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if a.status in ('funded', 'withdrawn', 'closed') then
    raise exception 'file_closed' using errcode = 'P0001';
  end if;

  -- the version they're updating is still the newest (a stale page can't overwrite a newer one)
  vid := public._record_version(a.id, null, 'repair');
  select * into base from public.application_versions where id = vid;
  if base.id is null or base.id <> r.base_version_id or _base_version is distinct from base.version then
    raise exception 'stale' using errcode = 'P0001';
  end if;

  if link_mode then
    if coalesce(base.owners -> 0 ->> 'dob', '') = '' then
      raise exception 'sign_in' using errcode = 'P0001';
    end if;
    bad := public._check_change_dob(i.id, base.owners -> 0 ->> 'dob', _dob);
    if bad is not null then
      return bad;
    end if;
  end if;

  resolved := public._resolve_kept(_details, base.owners);

  perform set_config('lamp.resigning', 'on', true);
  perform set_config('lamp.change_request', r.id::text, true);
  update public.application_details
     set business = coalesce(resolved -> 'business', '{}'::jsonb),
         owners = resolved -> 'owners',
         balances = coalesce(resolved -> 'balances', '[]'::jsonb),
         request = coalesce(resolved -> 'request', '{}'::jsonb),
         real_estate = coalesce(resolved -> 'real_estate', '{}'::jsonb),
         signed_name = _signed_name,
         signature_image = _signature_image,
         signed_name_2 = _signed_name_2,
         signature_image_2 = _signature_image_2,
         consent_text = _consent_text,
         consent_version = _consent_version,
         signer_agent = left(_signer_agent, 300),
         signer_ip = left(_signer_ip, 64)
   where application_id = a.id
  returning signed_at, signer_ip into s_at, s_ip;
  -- the trigger recorded it; this returns that version, or writes it now if the trigger couldn't
  vid := public._record_version(a.id, r.id, 'signing');
  perform set_config('lamp.resigning', 'off', true);
  perform set_config('lamp.change_request', '', true);
  if vid is null then
    raise exception 'the update could not be recorded' using errcode = 'P0001';
  end if;
  select * into nv from public.application_versions where id = vid;

  update public.application_change_requests
     set status = 'submitted', submitted_at = now(), result_version_id = vid
   where id = r.id;
  if link_mode then
    update public.application_invites
       set submitted_at = now(), opened_at = coalesce(opened_at, now()),
           started_at = coalesce(started_at, now()), verified_at = coalesce(verified_at, now())
     where id = i.id;
  end if;

  -- the file's list columns follow the newest answers; the email and claim columns never change
  owner0 := coalesce(resolved -> 'owners' -> 0, '{}'::jsonb);
  biz := coalesce(resolved -> 'business', '{}'::jsonb);
  begin
    amt := round(public._num(resolved -> 'request' ->> 'amount'), 2);
    if amt <= 0 or amt >= 1e12 then
      amt := null;
    end if;
  exception when others then
    amt := null;
  end;
  update public.applications
     set first_name = coalesce(nullif(trim(coalesce(owner0 ->> 'first', '')), ''), first_name),
         business_name = coalesce(nullif(trim(coalesce(biz ->> 'legal_name', '')), ''), business_name),
         phone = coalesce(nullif(trim(coalesce(owner0 ->> 'mobile', biz ->> 'phone', '')), ''), phone),
         amount_requested = coalesce(amt, amount_requested)
   where id = a.id;

  insert into public.events (application_id, kind, body, payload)
  values (a.id, 'system',
          'Changes received: the merchant signed version ' || nv.version || ' of the application',
          jsonb_build_object('change_request_id', r.id, 'version', nv.version,
                             'ip', s_ip, 'via', case when link_mode then 'link' else 'account' end));

  if a.user_id is not null then
    select lower(email) into em from auth.users where id = a.user_id;
  else
    em := a.claim_email;
  end if;
  return jsonb_build_object(
    'application_id', a.id, 'request_id', r.id, 'version', nv.version, 'version_id', vid,
    'base_version_id', base.id, 'signed_at', s_at, 'signer_ip', s_ip,
    'signed_via', nv.signed_via, 'rep_slug', a.rep_slug, 'claimed', a.user_id is not null,
    'merchant_email', em, 'secret_changes', public._secret_changes(base.owners, nv.owners));
end;
$$;

-- A merchant's own file: any open request (what the rep asked for) and the dates they signed.
-- No staff columns, no addresses, no links.
create or replace function public.my_application_changes(_application_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  a public.applications;
  r public.application_change_requests;
  rep_name text;
begin
  select * into a from public.applications where id = _application_id;
  if not found or auth.uid() is null or a.user_id is distinct from auth.uid() then
    return null;
  end if;
  select p.name into rep_name from public.reps p where p.slug = a.rep_slug;
  select * into r from public.application_change_requests
   where application_id = a.id and status = 'open'
     and a.status not in ('funded', 'withdrawn', 'closed');
  return jsonb_build_object(
    'rep', jsonb_build_object('name', rep_name),
    'open', case when r.id is null then null else jsonb_build_object(
      'id', r.id, 'items', r.items, 'message', r.message, 'base_version', r.base_version,
      'asked_at', r.created_at) end,
    'versions', (select coalesce(jsonb_agg(jsonb_build_object(
                   'version', v.version, 'signed_at', v.signed_at,
                   'signer', v.signed_name, 'signer_2', v.signed_name_2) order by v.version desc), '[]'::jsonb)
                 from public.application_versions v where v.application_id = a.id));
end;
$$;

-- ---------- 15. The staff side ----------

-- Every signed version of a file, newest first, with SSNs cut to the last four and dates of
-- birth hidden (as staff_application_details does), and every change request. For an admin or
-- the file's rep.
create or replace function public.staff_application_versions(_application_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
begin
  if not public.via_lamp_server() then
    raise exception 'the full application opens only through getlamp.app'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.can_see_application_details(_application_id) then
    raise exception 'the full application is visible to admins and the assigned rep'
      using errcode = 'insufficient_privilege';
  end if;
  -- a version the signing trigger couldn't write is written now
  perform public._record_version(_application_id, null, 'repair');
  return jsonb_build_object(
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', v.id, 'version', v.version, 'signed_at', v.signed_at,
               'signed_name', v.signed_name, 'signed_name_2', v.signed_name_2,
               'signed_via', v.signed_via, 'signer_ip', v.signer_ip, 'signer_agent', v.signer_agent,
               'consent_version', v.consent_version, 'recorded_by', v.recorded_by,
               'change_request_id', v.change_request_id,
               'business', v.business,
               'owners', coalesce((select jsonb_agg(public.mask_owner(o.value) order by o.ordinality)
                                   from jsonb_array_elements(v.owners) with ordinality as o), '[]'::jsonb),
               'balances', v.balances, 'request', v.request, 'real_estate', v.real_estate,
               'secret_changes', case when p.id is null then null
                                      else public._secret_changes(p.owners, v.owners) end)
             order by v.version desc), '[]'::jsonb)
      from public.application_versions v
      left join public.application_versions p
        on p.application_id = v.application_id and p.version = v.version - 1
      where v.application_id = _application_id),
    'requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'status', r.status, 'items', r.items, 'message', r.message,
               'base_version', r.base_version, 'channel', r.channel, 'sends', r.sends,
               'notified_at', r.notified_at, 'created_at', r.created_at,
               'requested_by_name', (select coalesce(nullif(btrim(pr.full_name), ''), pr.email)
                                     from public.profiles pr where pr.id = r.requested_by),
               'submitted_at', r.submitted_at,
               'result_version', (select x.version from public.application_versions x where x.id = r.result_version_id),
               'reviewed_at', r.reviewed_at,
               'reviewed_by_name', (select coalesce(nullif(btrim(pr.full_name), ''), pr.email)
                                    from public.profiles pr where pr.id = r.reviewed_by),
               'cancelled_at', r.cancelled_at, 'cancel_reason', r.cancel_reason,
               'link', (select jsonb_build_object(
                          'email', i.email, 'sent_at', i.sent_at, 'opened_at', i.opened_at,
                          'verified_at', i.verified_at, 'started_at', i.started_at,
                          'cancelled_at', i.cancelled_at, 'expires_at', i.expires_at,
                          'last_error', i.last_error, 'failed_checks', i.failed_checks,
                          'locked_at', i.locked_at)
                        from public.application_invites i where i.id = r.invite_id))
             order by r.created_at desc), '[]'::jsonb)
      from public.application_change_requests r
      where r.application_id = _application_id));
end;
$$;

-- The signed application as staff read it, as in 20261027120000_application_links.sql, plus which
-- version it is and when the version it replaced was signed, for the PDF's signature record.
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
    'consent_version', r.consent_version,
    'version', (select v.version from public.application_versions v
                where v.application_id = _application_id and v.signed_at = r.signed_at),
    'replaces', (select p.signed_at from public.application_versions v
                 join public.application_versions p
                   on p.application_id = v.application_id and p.version = v.version - 1
                 where v.application_id = _application_id and v.signed_at = r.signed_at)
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
    'consent_version', r.consent_version,
    'version', (select v.version from public.application_versions v
                where v.application_id = _application_id and v.signed_at = r.signed_at),
    'replaces', (select p.signed_at from public.application_versions v
                 join public.application_versions p
                   on p.application_id = v.application_id and p.version = v.version - 1
                 where v.application_id = _application_id and v.signed_at = r.signed_at)
  );
end;
$$;

-- One version with the full SSNs and dates of birth, for that version's PDF. Logged first, like
-- the application PDF.
create or replace function public.reveal_application_version(_application_id uuid, _version integer)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v public.application_versions;
begin
  if not public.via_lamp_server() then
    raise exception 'the full application opens only through getlamp.app'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.can_see_application_details(_application_id) then
    raise exception 'the full application is visible to admins and the assigned rep'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v from public.application_versions
   where application_id = _application_id and version = _version;
  if not found then
    return null;
  end if;
  insert into public.sensitive_access_log (actor_user_id, actor_email, application_id, action)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          _application_id, 'version_pdf');
  return jsonb_build_object(
    'version', v.version, 'business', v.business, 'owners', v.owners, 'balances', v.balances,
    'request', v.request, 'real_estate', v.real_estate, 'signed_name', v.signed_name,
    'signed_name_2', v.signed_name_2, 'signed_at', v.signed_at, 'signed_via', v.signed_via,
    'signature_image', v.signature_image, 'signature_image_2', v.signature_image_2,
    'signer_ip', v.signer_ip, 'signer_agent', v.signer_agent, 'consent_version', v.consent_version);
end;
$$;

-- ---------- 16. Who may read and write ----------
-- Supabase grants every new table and function to anon and authenticated by default, so each
-- one is revoked here and granted back only where it's needed.
alter table public.application_versions enable row level security;
revoke all on public.application_versions from anon, authenticated, service_role;
grant select on public.application_versions to service_role;
-- no policies: staff read through staff_application_versions(), merchants through
-- my_application_changes()

alter table public.application_change_requests enable row level security;
revoke all on public.application_change_requests from anon, authenticated, service_role;
grant select on public.application_change_requests to authenticated, service_role;
drop policy if exists "Staff read change requests" on public.application_change_requests;
create policy "Staff read change requests" on public.application_change_requests
  for select to authenticated
  using (public.can_see_application_details(application_id));

alter table public.application_staff_additions enable row level security;
revoke all on public.application_staff_additions from anon, authenticated, service_role;
grant select on public.application_staff_additions to authenticated, service_role;
-- the author, the time and the withdrawal are stamped by the guard
grant insert (application_id, about, body, source, share_with_funders)
  on public.application_staff_additions to authenticated;
grant update (withdrawn_at) on public.application_staff_additions to authenticated;
drop policy if exists "Staff read notes" on public.application_staff_additions;
create policy "Staff read notes" on public.application_staff_additions
  for select to authenticated
  using (public.can_see_application_details(application_id));
drop policy if exists "Staff add notes" on public.application_staff_additions;
create policy "Staff add notes" on public.application_staff_additions
  for insert to authenticated
  with check (public.can_see_application_details(application_id));
drop policy if exists "Staff withdraw notes" on public.application_staff_additions;
create policy "Staff withdraw notes" on public.application_staff_additions
  for update to authenticated
  using (public.can_see_application_details(application_id)
         and (author_id = (select auth.uid()) or (select public.has_role('admin'))))
  with check (public.can_see_application_details(application_id));
-- merchants: no policy, no function, and the timeline never carries the note's text

-- internal helpers and trigger functions
revoke all on function public._version_snapshot(public.application_details) from public, anon, authenticated;
revoke all on function public._record_version(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public._has_masked(jsonb) from public, anon, authenticated;
revoke all on function public._same_person(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._resolve_kept(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._secret_changes(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._sensitive_text(text) from public, anon, authenticated;
revoke all on function public._valid_change_items(jsonb) from public, anon, authenticated;
revoke all on function public._link_prefill(public.application_versions) from public, anon, authenticated;
revoke all on function public._check_change_dob(uuid, text, text) from public, anon, authenticated;
revoke all on function public._poke_auto_send(uuid) from public, anon, authenticated;
revoke all on function public.application_details_guard() from public, anon, authenticated;
revoke all on function public.application_details_record_version() from public, anon, authenticated;
revoke all on function public.application_versions_guard() from public, anon, authenticated;
revoke all on function public.application_versions_no_truncate() from public, anon, authenticated;
revoke all on function public.application_change_requests_guard() from public, anon, authenticated;
revoke all on function public.application_invites_kind_guard() from public, anon, authenticated;
revoke all on function public.application_staff_additions_guard() from public, anon, authenticated;
revoke all on function public.submissions_change_guard() from public, anon, authenticated;

-- signed-in staff or merchants (each checks who is asking inside)
revoke all on function public.request_changes(uuid, jsonb, text) from public, anon;
revoke all on function public.cancel_change_request(uuid, text) from public, anon;
revoke all on function public.mark_changes_reviewed(uuid) from public, anon;
revoke all on function public.my_application_changes(uuid) from public, anon;
revoke all on function public.staff_application_versions(uuid) from public, anon;
revoke all on function public.reveal_application_version(uuid, integer) from public, anon;
grant execute on function public.request_changes(uuid, jsonb, text) to authenticated;
grant execute on function public.cancel_change_request(uuid, text) to authenticated;
grant execute on function public.mark_changes_reviewed(uuid) to authenticated;
grant execute on function public.my_application_changes(uuid) to authenticated;
grant execute on function public.staff_application_versions(uuid) to authenticated;
grant execute on function public.reveal_application_version(uuid, integer) to authenticated;

-- Lamp's server only
revoke all on function public.issue_change_link(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.open_change_link(text, text, text) from public, anon, authenticated;
revoke all on function public.resubmit_change_request(text, text, uuid, uuid, integer, jsonb, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.issue_change_link(uuid, text, uuid) to service_role;
revoke all on function public.change_notice_sent(uuid) from public, anon, authenticated;
grant execute on function public.change_notice_sent(uuid) to service_role;
grant execute on function public.open_change_link(text, text, text) to service_role;
grant execute on function public.resubmit_change_request(text, text, uuid, uuid, integer, jsonb, text, text, text, text, text, text, text, text)
  to service_role;

-- replaced, same grants as before
revoke all on function public.funder_package_ready(uuid) from public, anon;
grant execute on function public.funder_package_ready(uuid) to authenticated, service_role;
revoke all on function public.staff_application_details(uuid) from public, anon;
revoke all on function public.reveal_application_details(uuid, text) from public, anon;
grant execute on function public.staff_application_details(uuid) to authenticated;
grant execute on function public.reveal_application_details(uuid, text) to authenticated;

-- ---------- 17. Every application already signed becomes version 1 ----------
-- After the triggers exist, so an application signed while this runs is recorded once.
do $$
declare
  x uuid;
begin
  for x in
    select d.application_id from public.application_details d
    where d.signed_at is not null
      and not exists (select 1 from public.application_versions v
                      where v.application_id = d.application_id and v.signed_at = d.signed_at)
  loop
    perform public._record_version(x, null, 'backfill');
  end loop;
end;
$$;

reset lock_timeout;
