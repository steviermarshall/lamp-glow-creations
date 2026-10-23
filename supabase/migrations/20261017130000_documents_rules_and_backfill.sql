-- Lamp database v2, follow-up: keep merchant documents and the files behind them in step.
--
-- 1. A merchant can add a document only as unreviewed, and only for a file that exists in
--    their own folder. v2's insert rule checked who and where, not the review fields, so a
--    merchant could add a row already marked accepted.
-- 2. A merchant can remove a received or rejected document only while its application has
--    never gone to funders. Once submitted, the file's documents stay with the deal, even if
--    the stage later moves back or the file is closed.
-- 3. submitted_at now means "has gone to funders": it is stamped the first time a file
--    enters any stage from submitted onwards (a rep may skip straight to offers_ready, and
--    accept_offer and the deals trigger skip 'submitted' too), when a submission to a funder
--    is recorded, and backfilled for files already past that point. It joins the fields only
--    staff or the server may change, with funded_at, closed_at, assigned_at and the
--    phone-consent stamps, so neither rule 2 nor the consent record can be undone by a
--    merchant.
-- 4. A merchant can remove a file from their folder only when no document row points at it.
--    The site removes the row first. The check runs with full rights, so what a merchant
--    can or cannot read never changes the answer.
-- 5. Files uploaded before the site indexed uploads get a row on the application that was
--    current when they were uploaded (or the owner's first one), so the team sees them and
--    rule 4 protects them. Safe to run again: existing rows are left alone.
-- 6. The v2 helper functions and the rule-4 check are for signed-in users. v2 revoked them
--    from public, but Supabase's default privileges also grant every new function in the
--    public schema to anon, so anonymous visitors could call them. Nothing anonymous uses
--    them: no policy that applies to anon calls them.
--
-- Run after the five 20261017120* migrations. In Lovable Cloud, paste this file into the
-- SQL editor after docs/apply-database-v2.sql.

set lock_timeout = '5s';

-- 1
drop policy if exists "Users add own documents" on public.documents;
create policy "Users add own documents" on public.documents
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and bucket = 'documents'
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
    and status = 'received'
    and reviewed_by is null
    and reviewed_at is null
    and review_note is null
    and application_id in (select id from public.applications where user_id = (select auth.uid()))
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'documents' and o.name = storage_path
    )
  );

-- 2
drop policy if exists "Users remove own unreviewed documents" on public.documents;
create policy "Users remove own unreviewed documents" on public.documents
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and status in ('received', 'rejected')
    and application_id in (
      select id from public.applications
      where user_id = (select auth.uid()) and submitted_at is null
    )
  );

-- 3
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

-- A submission to a funder means the file has gone out, whatever its stage says.
create or replace function public.submissions_stamp_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.applications
     set submitted_at = coalesce(new.submitted_at, now())
   where id = new.application_id and submitted_at is null;
  return new;
end;
$$;
revoke all on function public.submissions_stamp_application() from public, anon, authenticated;
drop trigger if exists submissions_stamp_application on public.submissions;
create trigger submissions_stamp_application
  after insert on public.submissions
  for each row execute function public.submissions_stamp_application();

-- Files already past that point.
update public.applications a
   set submitted_at = coalesce(
     (select min(s.submitted_at) from public.submissions s where s.application_id = a.id),
     a.updated_at,
     now())
 where a.submitted_at is null
   and (a.status in ('submitted', 'offers_ready', 'accepted', 'closing', 'funded')
        or exists (select 1 from public.submissions s where s.application_id = a.id));

-- 4
create or replace function public.storage_object_is_indexed(_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents d where d.bucket = 'documents' and d.storage_path = _name
  );
$$;
revoke all on function public.storage_object_is_indexed(text) from public;
grant execute on function public.storage_object_is_indexed(text) to authenticated, service_role;

drop policy if exists "Users delete own files" on storage.objects;
create policy "Users delete own files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.storage_object_is_indexed(name)
  );

-- 5
insert into public.documents
  (application_id, user_id, bucket, storage_path, original_name, size_bytes, mime_type, created_at)
select
  coalesce(at_upload.id, first_app.id),
  u.id,
  'documents',
  o.name,
  regexp_replace(split_part(o.name, '/', 2), '^\d+-', ''),
  case when o.metadata ->> 'size' ~ '^\d+$' then (o.metadata ->> 'size')::bigint end,
  o.metadata ->> 'mimetype',
  coalesce(o.created_at, now())
from storage.objects o
join auth.users u on u.id::text = split_part(o.name, '/', 1)
left join lateral (
  select a.id from public.applications a
  where a.user_id = u.id and a.created_at <= coalesce(o.created_at, now())
  order by a.created_at desc
  limit 1
) at_upload on true
left join lateral (
  select a.id from public.applications a
  where a.user_id = u.id
  order by a.created_at
  limit 1
) first_app on true
where o.bucket_id = 'documents'
  and split_part(o.name, '/', 2) <> '.emptyFolderPlaceholder'
  and coalesce(at_upload.id, first_app.id) is not null
on conflict (bucket, storage_path) do nothing;

-- 6
revoke execute on function public.has_role(public.app_role, uuid) from anon;
revoke execute on function public.is_staff(uuid) from anon;
revoke execute on function public.current_rep_slug(uuid) from anon;
revoke execute on function public.accept_offer(uuid) from anon;
revoke execute on function public.storage_object_is_indexed(text) from anon;

reset lock_timeout;
