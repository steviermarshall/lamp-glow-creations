-- Lamp database v2, follow-up to 20261019160000_rep_scope.sql: the last three places a rep
-- could reach past their own and unassigned files.
--
-- 1. profiles and businesses: a rep (not admin) reads them only for owners of files the rep
--    can see (an application with rep_slug = theirs or null). Reps no longer update
--    businesses at all; admins still read and update every business, merchants keep their
--    own. A rep still reads their own profile ("Users read own profile").
-- 2. accept_offer(): only the merchant who owns the application, or an admin. v2 let any
--    staff member accept any offer whose id they had. The presented and expiry checks and
--    the decline-the-others step are unchanged; anon stays revoked.
-- 3. source_rep_slug (the link the merchant came through, i.e. attribution) is admin-only
--    for staff, enforced in applications_before_update. Merchants already could not.
--
-- Run after 20261019160000_rep_scope.sql. Safe to run twice.

set lock_timeout = '5s';

-- ---------- Helper ----------
-- Does the signed-in rep have a file of this user's in view? Runs with full rights.
create or replace function public.rep_can_see_user(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.applications a
    where a.user_id = _user_id
      and (a.rep_slug is null or a.rep_slug = public.current_rep_slug(auth.uid()))
  );
$$;
revoke all on function public.rep_can_see_user(uuid) from public, anon;
grant execute on function public.rep_can_see_user(uuid) to authenticated, service_role;

-- ---------- 1. Profiles ----------
drop policy if exists "Staff read all profiles" on public.profiles;
drop policy if exists "Staff read profiles" on public.profiles;
create policy "Staff read profiles" on public.profiles
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_user(id))
  );

-- ---------- 1. Businesses ----------
drop policy if exists "Staff read all businesses" on public.businesses;
drop policy if exists "Staff read businesses" on public.businesses;
create policy "Staff read businesses" on public.businesses
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_user(owner_user_id))
  );
drop policy if exists "Staff update all businesses" on public.businesses;
drop policy if exists "Admins update all businesses" on public.businesses;
create policy "Admins update all businesses" on public.businesses
  for update to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));

-- ---------- 2. accept_offer ----------
-- Same as 20261017120200 except the caller check: owner of the application, or an admin.
create or replace function public.accept_offer(_offer_id uuid)
returns public.offers
language plpgsql security definer
set search_path = public
as $$
declare
  o public.offers;
  uid uuid := auth.uid();
begin
  select * into o from public.offers where id = _offer_id for update;
  if o.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.applications where id = o.application_id and user_id = uid)
     and not public.has_role('admin', uid) then
    raise exception 'not your offer' using errcode = 'insufficient_privilege';
  end if;
  if o.status <> 'presented' then
    raise exception 'offer is % and cannot be accepted', o.status using errcode = 'check_violation';
  end if;
  if o.expires_at is not null and o.expires_at < now() then
    raise exception 'offer has expired' using errcode = 'check_violation';
  end if;

  update public.offers set status = 'declined'
  where application_id = o.application_id and id <> o.id and status = 'presented';
  update public.offers set status = 'accepted' where id = o.id returning * into o;
  update public.applications set status = 'accepted' where id = o.application_id and status <> 'accepted';
  return o;
end;
$$;
revoke all on function public.accept_offer(uuid) from public, anon;
grant execute on function public.accept_offer(uuid) to authenticated, service_role;

-- ---------- 3. Attribution ----------
-- Same as 20261019160000 plus the source_rep_slug rule for staff who are not admins.
create or replace function public.applications_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- current_user, not the role setting: inside a security definer function such as
  -- accept_offer the function owner is acting, and the guard must step aside.
  if current_user = 'authenticated' and not public.is_staff() then
    if new.status is distinct from old.status
       or new.rep_slug is distinct from old.rep_slug
       or new.source_rep_slug is distinct from old.source_rep_slug
       or new.staff_notes is distinct from old.staff_notes
       or new.decline_reason is distinct from old.decline_reason
       or new.user_id is distinct from old.user_id
       or new.submitted_at is distinct from old.submitted_at
       or new.funded_at is distinct from old.funded_at
       or new.closed_at is distinct from old.closed_at
       or new.assigned_at is distinct from old.assigned_at
       or new.phone_consent_at is distinct from old.phone_consent_at
       or new.phone_consent_text is distinct from old.phone_consent_text then
      raise exception 'merchants cannot change stage, assignment or staff fields'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- A rep may take an unassigned file for themselves; anything else is an admin's call.
  -- The same goes for the link attribution.
  if current_user = 'authenticated'
     and (new.rep_slug is distinct from old.rep_slug
          or new.source_rep_slug is distinct from old.source_rep_slug)
     and public.is_staff()
     and not public.has_role('admin') then
    if new.source_rep_slug is distinct from old.source_rep_slug then
      raise exception 'only an admin can change where a file came from'
        using errcode = 'insufficient_privilege';
    end if;
    if not (old.rep_slug is null and new.rep_slug = public.current_rep_slug()) then
      raise exception 'a rep can only take an unassigned file for themselves'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.rep_slug is distinct from old.rep_slug then
    new.assigned_at := case when new.rep_slug is null then null else now() end;
  end if;
  if new.status is distinct from old.status then
    if new.status in ('submitted', 'offers_ready', 'accepted', 'closing', 'funded')
       and new.submitted_at is null then
      new.submitted_at := now();
    end if;
    if new.status = 'funded' and new.funded_at is null then new.funded_at := now(); end if;
    if new.status in ('declined', 'withdrawn', 'closed') and new.closed_at is null then new.closed_at := now(); end if;
  end if;
  return new;
end;
$$;

reset lock_timeout;
