-- Full application and e-signature (2026-10-22).
--
-- The quick apply flow collects eleven answers. Funders need the full Lamp Working Capital
-- Application: business identity and address, EIN, owners with home address, date of birth and
-- SSN, current advances, the request, and the owner's signature on the authorization. This table
-- holds exactly that, one row per application.
--
-- Who can do what:
--   * the merchant who owns the application reads, creates and edits their row, and signs it;
--     once signed (signed_at set) the merchant can no longer change it;
--   * staff read rows for applications they can see (the subquery runs under the applications
--     table's own policies, so a rep sees only their own and unassigned files once rep scoping
--     is live) and admins may correct a signed row; reps cannot edit;
--   * anonymous has no access.
-- signed_at is set by the database, never by the browser, and signing logs a timeline event the
-- merchant can see. SSN and date of birth live only here, never in applications or events.
-- Safe to run again.

create table if not exists public.application_details (
  application_id uuid primary key references public.applications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  business jsonb not null default '{}'::jsonb,
  owners jsonb not null default '[]'::jsonb,
  balances jsonb not null default '[]'::jsonb,
  request jsonb not null default '{}'::jsonb,
  signed_name text,
  signed_at timestamptz,
  consent_text text,
  consent_version text,
  signer_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_details_owners_array check (jsonb_typeof(owners) = 'array'),
  constraint application_details_balances_array check (jsonb_typeof(balances) = 'array'),
  constraint application_details_signed_name check (signed_at is null or length(trim(coalesce(signed_name, ''))) >= 3)
);

drop trigger if exists update_application_details_updated_at on public.application_details;
create trigger update_application_details_updated_at
  before update on public.application_details
  for each row execute function public.update_updated_at_column();

create or replace function public.application_details_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  is_admin boolean := public.has_role('admin');
begin
  if tg_op = 'UPDATE' then
    -- a signed application is final for everyone except an admin correcting it
    if old.signed_at is not null and not is_admin then
      raise exception 'this application is already signed' using errcode = 'check_violation';
    end if;
    new.application_id := old.application_id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;

  -- the database stamps the signature; the browser only sends the typed name
  if new.signed_name is not null and length(trim(new.signed_name)) >= 3
     and (tg_op = 'INSERT' or old.signed_at is null) then
    new.signed_at := now();
    new.signed_name := trim(new.signed_name);
    insert into public.events (application_id, actor_user_id, kind, body, visible_to_merchant)
    values (new.application_id, auth.uid(), 'system',
            'Application signed by ' || new.signed_name, true);
  elsif tg_op = 'INSERT' then
    new.signed_at := null;
  elsif old.signed_at is null then
    new.signed_at := null;
  else
    -- an admin correction keeps who signed and when
    new.signed_at := old.signed_at;
    new.signed_name := old.signed_name;
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

alter table public.application_details enable row level security;
revoke all on public.application_details from anon;
grant select, insert, update on public.application_details to authenticated;
grant all on public.application_details to service_role;

drop policy if exists "Merchants read own application details" on public.application_details;
create policy "Merchants read own application details" on public.application_details
  for select to authenticated
  using (application_id in (select id from public.applications where user_id = (select auth.uid())));

drop policy if exists "Merchants start own application details" on public.application_details;
create policy "Merchants start own application details" on public.application_details
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and application_id in (select id from public.applications where user_id = (select auth.uid()))
  );

drop policy if exists "Merchants edit own unsigned application details" on public.application_details;
create policy "Merchants edit own unsigned application details" on public.application_details
  for update to authenticated
  using (
    signed_at is null
    and application_id in (select id from public.applications where user_id = (select auth.uid()))
  )
  with check (application_id in (select id from public.applications where user_id = (select auth.uid())));

drop policy if exists "Staff read application details" on public.application_details;
create policy "Staff read application details" on public.application_details
  for select to authenticated
  using (
    (select public.is_staff())
    and exists (select 1 from public.applications a where a.id = application_details.application_id)
  );

drop policy if exists "Admins correct application details" on public.application_details;
create policy "Admins correct application details" on public.application_details
  for update to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));
