-- Lamp database v2, follow-up: a rep works only their own files and the unassigned pool.
--
-- v2 already limited a rep's applications to their own plus the unassigned pool, but
-- everything hanging off an application was readable by any staff member, and the
-- assignment rule checked only that the writer was staff. So a rep could:
--   - read the events, documents, stored files, submissions and offers of another rep's
--     files straight from the API (the staff page never showed them, the API did);
--   - read every lead, including leads tagged to another rep;
--   - hand a file to another rep, or drop their own back into the pool.
--
-- After this file, for a rep who is not an admin:
-- 1. events, documents, submissions and offers are read and written only on applications
--    the rep can see (rep_slug = current_rep_slug() or rep_slug is null). Lead events
--    follow the lead. The actor stamp on events is unchanged: actor_user_id = auth.uid().
-- 2. leads are read and updated only when they are the rep's own or untagged.
-- 3. files in the 'documents' bucket are readable only when they belong to such an
--    application. A file maps to its application through its documents row
--    (bucket + storage_path, unique). A file with no row yet (uploaded before the backfill
--    ran again, or a row insert that failed) is readable only when the folder owner has at
--    least one application and every one of them is visible to the rep, so an unindexed
--    file of another rep's merchant never shows. Admins see every file.
-- 4. rep_slug changes only from null to the rep's own slug (take). Reassigning, handing
--    over or releasing a file is admin-only. Enforced in applications_before_update, which
--    sees the old value, and in the update policy's check as a second line.
--
-- Unchanged: every merchant rule, every admin rule (admins read and write everything),
-- deals and the commission ledger (already own-only for reps), the service role.
--
-- Run after 20261017130000_documents_rules_and_backfill.sql and after the staff page
-- (PR 7) is published. Safe to run twice.

set lock_timeout = '5s';

-- ---------- Helpers ----------
-- Can the signed-in rep see this application? One primary-key lookup; runs with full
-- rights so the answer never depends on what the caller can read.
create or replace function public.rep_can_see_application(_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.applications a
    where a.id = _application_id
      and (a.rep_slug is null or a.rep_slug = public.current_rep_slug(auth.uid()))
  );
$$;
revoke all on function public.rep_can_see_application(uuid) from public, anon;
grant execute on function public.rep_can_see_application(uuid) to authenticated, service_role;

-- Can the signed-in rep read this object in the documents bucket? See rule 3 above.
create or replace function public.rep_can_read_file(_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  slug text := public.current_rep_slug(auth.uid());
  app_id uuid;
  owner_id text := split_part(_name, '/', 1);
begin
  select d.application_id into app_id
  from public.documents d
  where d.bucket = 'documents' and d.storage_path = _name;
  if found then
    return public.rep_can_see_application(app_id);
  end if;
  return exists (select 1 from public.applications a where a.user_id::text = owner_id)
     and not exists (
       select 1 from public.applications a
       where a.user_id::text = owner_id
         and a.rep_slug is not null
         and a.rep_slug is distinct from slug
     );
end;
$$;
revoke all on function public.rep_can_read_file(text) from public, anon;
grant execute on function public.rep_can_read_file(text) to authenticated, service_role;

-- ---------- Applications: assignment ----------
-- Same as 20261017130000 for merchants; adds the rep rule (4).
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
  if current_user = 'authenticated'
     and new.rep_slug is distinct from old.rep_slug
     and public.is_staff()
     and not public.has_role('admin') then
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

drop policy if exists "Staff work pipeline" on public.applications;
create policy "Staff work pipeline" on public.applications
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and (rep_slug = (select public.current_rep_slug()) or rep_slug is null)
    )
  )
  with check (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and (rep_slug = (select public.current_rep_slug()) or rep_slug is null)
    )
  );

-- ---------- Leads ----------
drop policy if exists "Staff read leads" on public.leads;
create policy "Staff read leads" on public.leads
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and (rep_slug = (select public.current_rep_slug()) or rep_slug is null)
    )
  );
drop policy if exists "Staff update leads" on public.leads;
create policy "Staff update leads" on public.leads
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and (rep_slug = (select public.current_rep_slug()) or rep_slug is null)
    )
  )
  with check (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and (rep_slug = (select public.current_rep_slug()) or rep_slug is null)
    )
  );

-- ---------- Events ----------
-- A file's events follow the file; an event on a lead alone follows the lead.
drop policy if exists "Staff read all events" on public.events;
drop policy if exists "Staff read events" on public.events;
create policy "Staff read events" on public.events
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and case
        when application_id is not null then public.rep_can_see_application(application_id)
        else lead_id in (
          select l.id from public.leads l
          where l.rep_slug = (select public.current_rep_slug()) or l.rep_slug is null
        )
      end
    )
  );
drop policy if exists "Staff log events" on public.events;
create policy "Staff log events" on public.events
  for insert to authenticated
  with check (
    (select public.is_staff())
    and actor_user_id = (select auth.uid())
    and (
      (select public.has_role('admin'))
      or case
        when application_id is not null then public.rep_can_see_application(application_id)
        else lead_id in (
          select l.id from public.leads l
          where l.rep_slug = (select public.current_rep_slug()) or l.rep_slug is null
        )
      end
    )
  );

-- ---------- Documents ----------
drop policy if exists "Staff read all documents" on public.documents;
drop policy if exists "Staff read documents" on public.documents;
create policy "Staff read documents" on public.documents
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );
drop policy if exists "Staff review documents" on public.documents;
create policy "Staff review documents" on public.documents
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  )
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );

-- ---------- Stored files ----------
drop policy if exists "Staff read all files" on storage.objects;
drop policy if exists "Staff read files" on storage.objects;
create policy "Staff read files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      (select public.has_role('admin'))
      or ((select public.is_staff()) and public.rep_can_read_file(name))
    )
  );

-- ---------- Submissions ----------
drop policy if exists "Staff read submissions" on public.submissions;
create policy "Staff read submissions" on public.submissions
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );
drop policy if exists "Staff create submissions" on public.submissions;
create policy "Staff create submissions" on public.submissions
  for insert to authenticated
  with check (
    (select public.is_staff())
    and submitted_by = (select auth.uid())
    and ((select public.has_role('admin')) or public.rep_can_see_application(application_id))
  );
drop policy if exists "Staff update submissions" on public.submissions;
create policy "Staff update submissions" on public.submissions
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  )
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );

-- ---------- Offers ----------
drop policy if exists "Staff read offers" on public.offers;
create policy "Staff read offers" on public.offers
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );
drop policy if exists "Staff add offers" on public.offers;
create policy "Staff add offers" on public.offers
  for insert to authenticated
  with check (
    (select public.is_staff())
    and created_by = (select auth.uid())
    and ((select public.has_role('admin')) or public.rep_can_see_application(application_id))
  );
drop policy if exists "Staff update offers" on public.offers;
create policy "Staff update offers" on public.offers
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  )
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );

-- Deals ("Reps read own deals": rep_slug = current_rep_slug()) and the ledger ("Reps read
-- own ledger": deals of that rep) were already own-only for reps; admin-only writes.

reset lock_timeout;
