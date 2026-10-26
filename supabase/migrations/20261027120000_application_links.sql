-- Application links (2026-10-27).
--
-- Staff send a merchant a personal link to the full application, by email from Lamp's mailbox or
-- by copying it into a text. The merchant fills it in, signs it on the page and submits, with no
-- account needed first. The signed file lands with the staff member who sent the link. Then the
-- merchant creates a login to follow it, and the file moves into that account. Each rep also has
-- a public link, getlamp.app/application/<slug>, that works the same way without the
-- personal details filled in.
--
-- What changes:
--   * applications, application_details and documents may have no account yet (user_id NULL)
--     while a file submitted from a link waits for its merchant to sign in. Every merchant rule
--     compares user_id with auth.uid(), and NULL never matches, so nobody sees those rows through
--     their own account in the meantime. Staff see them through the rep rules, as before.
--   * application_invites records every link sent: who it went to, from which rep, how it was
--     delivered, and when it was opened, started and signed. Only the server writes it, using
--     the sha256 of a random token. The token itself exists only in the link.
--   * submit_link_application() is the only way a file with no account gets signed. It is
--     callable by the server's service role alone, and it does everything in one transaction:
--     the file, the signed application and the timeline. The application_details guard lets a
--     row with no account be signed only while that function is running.
--   * claim_applications() moves those files into the merchant's account once they sign in with
--     a confirmed email. Two things can prove the file is theirs:
--       - the claim token their browser kept when they submitted, or
--       - Lamp's server emailed the link to exactly that address (staff never see that token).
--     Staff accounts never take merchant files.
--   * application_details gains:
--       - the real estate schedule,
--       - the drawn signatures (owner and second owner),
--       - the signer's IP address,
--       - how it was signed (from the account page or from a link).
--   * Merchants may download files indexed to them, wherever they are stored, so a statement
--     uploaded before they had an account is still theirs afterwards.
-- Safe to run again.

-- ---------- 1. Files that have no account yet ----------
alter table public.applications alter column user_id drop not null;
alter table public.application_details alter column user_id drop not null;
alter table public.documents alter column user_id drop not null;

alter table public.applications
  add column if not exists claim_email text,
  add column if not exists claim_token_hash text,
  add column if not exists invite_id uuid;

create index if not exists applications_unclaimed_idx
  on public.applications (claim_email) where user_id is null;

-- ---------- 2. Real estate, drawn signatures, how it was signed ----------
alter table public.application_details
  add column if not exists real_estate jsonb not null default '{}'::jsonb,
  add column if not exists signature_image text,
  add column if not exists signed_name_2 text,
  add column if not exists signature_image_2 text,
  add column if not exists signer_ip text,
  add column if not exists signed_via text;

do $$
begin
  alter table public.application_details add constraint application_details_real_estate_object
    check (jsonb_typeof(real_estate) = 'object');
exception when duplicate_object then null;
end;
$$;
do $$
begin
  alter table public.application_details add constraint application_details_signature_images
    check (
      (signature_image is null
        or (signature_image like 'data:image/png;base64,%' and length(signature_image) <= 400000))
      and (signature_image_2 is null
        or (signature_image_2 like 'data:image/png;base64,%' and length(signature_image_2) <= 400000))
    );
exception when duplicate_object then null;
end;
$$;
do $$
begin
  alter table public.application_details add constraint application_details_signed_via
    check (signed_via is null or signed_via in ('account', 'link'));
exception when duplicate_object then null;
end;
$$;

-- ---------- 3. The links staff send ----------
create table if not exists public.application_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  rep_slug text not null references public.reps (slug),
  sent_by uuid references auth.users (id) on delete set null,
  engine_lead_id bigint references public.engine_leads (id) on delete set null,
  first_name text,
  last_name text,
  business_name text,
  email text check (email is null or (email = lower(email) and char_length(email) <= 254)),
  phone text,
  -- 'email': Lamp's server emailed the link and no person saw it; 'link': staff copied it to send
  channel text not null check (channel in ('email', 'link')),
  note text check (note is null or char_length(note) <= 2000),
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days',
  application_id uuid references public.applications (id) on delete set null,
  email_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists application_invites_rep_idx
  on public.application_invites (rep_slug, sent_at desc);
create index if not exists application_invites_email_idx
  on public.application_invites (email) where email is not null;
create index if not exists application_invites_lead_idx
  on public.application_invites (engine_lead_id) where engine_lead_id is not null;

drop trigger if exists update_application_invites_updated_at on public.application_invites;
create trigger update_application_invites_updated_at
  before update on public.application_invites
  for each row execute function public.update_updated_at_column();

do $$
begin
  alter table public.applications add constraint applications_invite_id_fkey
    foreign key (invite_id) references public.application_invites (id) on delete set null;
exception when duplicate_object then null;
end;
$$;

alter table public.application_invites enable row level security;
revoke all on public.application_invites from anon, authenticated;
grant select on public.application_invites to authenticated;
grant all on public.application_invites to service_role;

drop policy if exists "Staff read their sent links" on public.application_invites;
create policy "Staff read their sent links" on public.application_invites
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and rep_slug = (select public.current_rep_slug())
    )
  );

-- ---------- 4. The application_details guard, now aware of links and claims ----------
create or replace function public.application_details_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  is_admin boolean := public.has_role('admin');
  -- set, transaction-local, only by submit_link_application and claim_applications below;
  -- nothing a signed-in user can call sets them
  link_signing boolean := coalesce(current_setting('lamp.link_signing', true), '') = 'on';
  claiming boolean := coalesce(current_setting('lamp.claiming', true), '') = 'on';
  hdr text;
  kept public.application_details;
begin
  -- a claim moves a link-signed row into the merchant's new account and changes nothing else
  if tg_op = 'UPDATE' and claiming and old.user_id is null and new.user_id is not null then
    kept := old;
    kept.user_id := new.user_id;
    return kept;
  end if;

  if tg_op = 'UPDATE' then
    -- a signed application is final for everyone except an admin correcting it
    if old.signed_at is not null and not is_admin then
      raise exception 'this application is already signed' using errcode = 'check_violation';
    end if;
    new.application_id := old.application_id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;

  -- the database stamps the signature; the browser only sends the typed name and the drawing
  if new.signed_name is not null and length(trim(new.signed_name)) >= 3
     and (tg_op = 'INSERT' or old.signed_at is null) then
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
    if new.signed_name_2 is null then
      new.signature_image_2 := null;
    end if;
    insert into public.events (application_id, actor_user_id, kind, body, visible_to_merchant)
    values (new.application_id, auth.uid(), 'system',
            'Application signed by ' || new.signed_name
              || coalesce(' and ' || new.signed_name_2, ''), true);
  elsif tg_op = 'INSERT' or old.signed_at is null then
    -- a draft carries no signature
    new.signed_at := null;
    new.signature_image := null;
    new.signed_name_2 := null;
    new.signature_image_2 := null;
    new.signer_ip := null;
    new.signed_via := null;
  else
    -- an admin correction keeps who signed, when, how and what they agreed to
    new.signed_at := old.signed_at;
    new.signed_name := old.signed_name;
    new.signed_name_2 := old.signed_name_2;
    new.signature_image := old.signature_image;
    new.signature_image_2 := old.signature_image_2;
    new.signer_ip := old.signer_ip;
    new.signed_via := old.signed_via;
    new.consent_text := old.consent_text;
    new.consent_version := old.consent_version;
    new.signer_agent := old.signer_agent;
  end if;
  return new;
end;
$$;

drop trigger if exists application_details_guard on public.application_details;
create trigger application_details_guard
  before insert or update on public.application_details
  for each row execute function public.application_details_guard();

-- ---------- 5. Submitting from a link (the server's service role only) ----------
create or replace function public.submit_link_application(
  _token_hash text,
  _rep_slug text,
  _details jsonb,
  _signed_name text,
  _signature_image text,
  _signed_name_2 text,
  _signature_image_2 text,
  _consent_text text,
  _consent_version text,
  _signer_agent text,
  _signer_ip text,
  _claim_email text,
  _claim_token_hash text
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  inv public.application_invites;
  rep text;
  rep_name text;
  app_id uuid;
  owner0 jsonb := coalesce(_details -> 'owners' -> 0, '{}'::jsonb);
  biz jsonb := coalesce(_details -> 'business', '{}'::jsonb);
  recent int;
begin
  if _claim_token_hash is null or _claim_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad_request: claim token' using errcode = 'invalid_parameter_value';
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

  -- the same network can't sign more than a handful of applications an hour
  if _signer_ip is not null then
    select count(*) into recent from public.application_details
    where signer_ip = _signer_ip and signed_via = 'link' and signed_at > now() - interval '1 hour';
    if recent >= 6 then
      raise exception 'too_many' using errcode = 'P0001';
    end if;
  end if;

  if _token_hash is not null then
    select * into inv from public.application_invites where token_hash = _token_hash for update;
    if not found then
      raise exception 'link_not_found' using errcode = 'P0001';
    end if;
    if inv.submitted_at is not null then
      raise exception 'already_signed' using errcode = 'P0001';
    end if;
    if inv.cancelled_at is not null then
      raise exception 'link_cancelled' using errcode = 'P0001';
    end if;
    if inv.expires_at < now() then
      raise exception 'link_expired' using errcode = 'P0001';
    end if;
    rep := inv.rep_slug;
  else
    select slug into rep from public.reps where slug = lower(trim(coalesce(_rep_slug, ''))) and active;
    if rep is null then
      raise exception 'unknown_rep' using errcode = 'P0001';
    end if;
  end if;
  select name into rep_name from public.reps where slug = rep;

  insert into public.applications (
    user_id, rep_slug, source_rep_slug, answers, utm, first_name, business_name, phone, email,
    amount_requested, phone_consent_at, phone_consent_text, claim_email, claim_token_hash, invite_id
  ) values (
    null, rep, rep, '{}'::jsonb,
    jsonb_build_object('ref', rep, 'source', 'application_link')
      || case when inv.id is not null then jsonb_build_object('invite', inv.id) else '{}'::jsonb end,
    nullif(trim(coalesce(owner0 ->> 'first', '')), ''),
    nullif(trim(coalesce(biz ->> 'legal_name', '')), ''),
    nullif(trim(coalesce(owner0 ->> 'mobile', biz ->> 'phone', '')), ''),
    lower(nullif(trim(coalesce(_claim_email, '')), '')),
    public._num(_details -> 'request' ->> 'amount'),
    case when coalesce(owner0 ->> 'mobile', '') <> '' then now() end,
    case when coalesce(owner0 ->> 'mobile', '') <> ''
      then 'Signed application, ' || coalesce(_consent_version, '') || ': contact consent clause' end,
    lower(nullif(trim(coalesce(_claim_email, '')), '')),
    _claim_token_hash,
    inv.id
  )
  returning id into app_id;

  perform set_config('lamp.link_signing', 'on', true);
  insert into public.application_details (
    application_id, user_id, business, owners, balances, request, real_estate,
    signed_name, signature_image, signed_name_2, signature_image_2,
    consent_text, consent_version, signer_agent, signer_ip
  ) values (
    app_id, null,
    coalesce(_details -> 'business', '{}'::jsonb),
    _details -> 'owners',
    coalesce(_details -> 'balances', '[]'::jsonb),
    coalesce(_details -> 'request', '{}'::jsonb),
    coalesce(_details -> 'real_estate', '{}'::jsonb),
    _signed_name, _signature_image, _signed_name_2, _signature_image_2,
    _consent_text, _consent_version, left(_signer_agent, 300), left(_signer_ip, 64)
  );
  perform set_config('lamp.link_signing', 'off', true);

  insert into public.events (application_id, kind, body, payload)
  values (
    app_id, 'system',
    case when inv.id is not null
      then 'Submitted from the application link ' || coalesce(rep_name, rep) || ' sent'
        || coalesce(' to ' || inv.email, '')
      else 'Submitted from ' || coalesce(rep_name, rep) || '''s public application link' end,
    jsonb_build_object('invite_id', inv.id, 'ip', _signer_ip, 'agent', left(_signer_agent, 300))
  );

  if inv.id is not null then
    update public.application_invites
       set submitted_at = now(), application_id = app_id,
           started_at = coalesce(started_at, now()), opened_at = coalesce(opened_at, now())
     where id = inv.id;
    if inv.engine_lead_id is not null then
      update public.engine_leads
         set status = 'submitted', worked_at = now()
       where id = inv.engine_lead_id
         and status in ('new', 'called', 'no_answer', 'callback', 'qualified');
    end if;
  end if;

  return jsonb_build_object('application_id', app_id, 'rep_slug', rep, 'rep_name', rep_name,
                            'invite_id', inv.id);
end;
$$;
revoke all on function public.submit_link_application(text, text, jsonb, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_link_application(text, text, jsonb, text, text, text, text, text, text, text, text, text, text)
  to service_role;

-- ---------- 6. Moving link-signed files into the merchant's account ----------
create or replace function public.claim_applications(_tokens text[] default '{}')
returns integer
language plpgsql volatile security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  em text;
  ids uuid[];
begin
  if uid is null then
    return 0;
  end if;
  -- staff accounts never take merchant files
  if public.is_staff(uid) then
    return 0;
  end if;
  select lower(email) into em from auth.users
  where id = uid and email_confirmed_at is not null;
  if em is null then
    return 0;
  end if;

  select coalesce(array_agg(a.id), '{}') into ids
  from public.applications a
  left join public.application_invites i on i.id = a.invite_id
  where a.user_id is null
    and (
      a.claim_token_hash in (
        select encode(sha256(convert_to(t, 'UTF8')), 'hex')
        from unnest(coalesce(_tokens, '{}')) as t
        where length(t) between 20 and 128
      )
      or (i.channel = 'email' and i.email = em)
    );
  if cardinality(ids) = 0 then
    return 0;
  end if;

  perform set_config('lamp.claiming', 'on', true);
  update public.applications set user_id = uid, claim_token_hash = null
   where id = any (ids) and user_id is null;
  update public.application_details set user_id = uid
   where application_id = any (ids) and user_id is null;
  update public.documents set user_id = uid
   where application_id = any (ids) and user_id is null;
  perform set_config('lamp.claiming', 'off', true);

  insert into public.events (application_id, actor_user_id, kind, body, visible_to_merchant)
  select x, uid, 'system', 'Merchant signed in to their Lamp account (' || em || ')', true
  from unnest(ids) as x;
  return cardinality(ids);
end;
$$;
revoke all on function public.claim_applications(text[]) from public, anon;
grant execute on function public.claim_applications(text[]) to authenticated;

-- ---------- 7. Staff read the new parts of the application ----------
create or replace function public.staff_application_details(_application_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  r public.application_details;
begin
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
    'signer_agent', r.signer_agent
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
    'signer_agent', r.signer_agent
  );
end;
$$;
revoke all on function public.staff_application_details(uuid) from public, anon;
revoke all on function public.reveal_application_details(uuid, text) from public, anon;
grant execute on function public.staff_application_details(uuid) to authenticated;
grant execute on function public.reveal_application_details(uuid, text) to authenticated;

-- ---------- 8. Merchants download files indexed to them ----------
-- Statements uploaded from a link sit under link/<file>/ until the merchant has an account; once
-- the file is theirs, the documents index says so and they can open them like any other upload.
create or replace function public.storage_object_is_mine(_name text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents d
    where d.bucket = 'documents' and d.storage_path = _name and d.user_id = auth.uid()
  );
$$;
revoke all on function public.storage_object_is_mine(text) from public, anon;
grant execute on function public.storage_object_is_mine(text) to authenticated;

drop policy if exists "Users read own indexed files" on storage.objects;
create policy "Users read own indexed files" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and public.storage_object_is_mine(name));
