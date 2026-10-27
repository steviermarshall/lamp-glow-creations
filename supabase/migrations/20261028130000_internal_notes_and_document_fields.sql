-- Two holes that were already open on main (2026-10-28).
--
-- 1. Staff notes reached merchants. applications.staff_notes, the "Staff notes (never shown to the
--    merchant)" box on a staff file, sits on the merchant's own row, and "Users read own
--    applications" lets a merchant read every column of it through the API. A column can't be
--    hidden from merchants alone (staff and merchants are both the authenticated role), so the
--    notes move to their own table, application_internal_notes, which only staff who can see the
--    file can read and write: the same people as before. The column is emptied and stays empty.
--    A page still open from before Publish that saves a note into it has the text moved into the
--    table instead: it replaces the stored note when it contains all of it (that page loaded the
--    note and added to it), and is added after it otherwise (that page shows the box empty), so
--    nothing already stored is ever lost.
-- 2. Staff could repoint a document. "Staff review documents" lets a rep update any column of a
--    document row on a file they can see. Which stored file someone may open is decided by those
--    rows (storage_object_is_mine for merchants, rep_can_read_file for reps), so changing
--    storage_path, bucket, user_id or application_id would hand out a file that isn't theirs. A
--    signed-in person may now change only the review: status, reviewed_at, review_note, and
--    reviewed_by as themselves (or cleared). Every other column, including any added later, is
--    the server's. Claiming a file and the funder auto-send still change rows: they run as the
--    function owner, which this check does not cover, as in applications_before_update.
--
-- Order: merge and Publish first (the staff file keeps using the old column until this runs),
-- then paste this. Safe to run again.
--
-- Locks: nothing here takes an exclusive lock, so staff reading files and reviewing documents
-- carry on while it runs (saves to a file wait a moment). Applications comes before documents,
-- the same order as claiming a file. If it ever stops on a lock timeout or "deadlock detected",
-- paste it again.

set lock_timeout = '5s';

do $$
begin
  perform 'public.rep_can_see_application(uuid)'::regprocedure;
  perform 'public.is_staff(uuid)'::regprocedure;
  perform 'public.has_role(public.app_role, uuid)'::regprocedure;
exception when undefined_function or undefined_object then
  raise exception 'Run 20261019160000_rep_scope.sql before this one.';
end;
$$;

-- ---------- 1. Staff notes, staff only ----------
create table if not exists public.application_internal_notes (
  application_id uuid primary key references public.applications (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 100000),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

-- Who saved it and when are stamped here, never taken from the request.
create or replace function public.application_internal_notes_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.application_id is distinct from old.application_id then
    raise exception 'a note stays on its file' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  if current_user = 'authenticated' then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
revoke all on function public.application_internal_notes_stamp() from public, anon, authenticated;

create or replace trigger application_internal_notes_stamp
  before insert or update on public.application_internal_notes
  for each row execute function public.application_internal_notes_stamp();

alter table public.application_internal_notes enable row level security;
revoke all on public.application_internal_notes from public, anon, authenticated;
grant select, insert, update, delete on public.application_internal_notes to authenticated;
grant all on public.application_internal_notes to service_role;

-- Read: who can read the file ("Staff read pipeline"). Write: who can work it ("Staff work
-- pipeline"). For both that is an admin, or staff on their own or an unassigned file.
drop policy if exists "Staff read internal notes" on public.application_internal_notes;
create policy "Staff read internal notes" on public.application_internal_notes
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );
drop policy if exists "Staff add internal notes" on public.application_internal_notes;
create policy "Staff add internal notes" on public.application_internal_notes
  for insert to authenticated
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );
drop policy if exists "Staff change internal notes" on public.application_internal_notes;
create policy "Staff change internal notes" on public.application_internal_notes
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  )
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );
drop policy if exists "Staff clear internal notes" on public.application_internal_notes;
create policy "Staff clear internal notes" on public.application_internal_notes
  for delete to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );

-- Every note written so far moves over (a re-run finds the column empty and copies nothing).
-- Creating the table above locked applications against writes until this commits, so no note
-- can be saved between this copy and the clear below.
insert into public.application_internal_notes (application_id, body, updated_by)
select a.id, a.staff_notes, null
from public.applications a
where a.staff_notes is not null and btrim(a.staff_notes) <> ''
on conflict (application_id) do nothing;

-- Clearing it runs the update triggers on those files: updated_at moves to now; nothing goes on
-- the timeline (applications_after_update only writes stage and assignment changes).
update public.applications set staff_notes = null where staff_notes is not null;

-- From now on the column stays empty. A save into it lands in the table, as the caller, so the
-- table's rules decide (merchants are stopped before this by applications_before_update, which
-- sorts first), and it never drops stored text. A new file can't arrive with a note in it.
create or replace function public.applications_staff_notes_moved()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.staff_notes is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'staff notes are kept in application_internal_notes'
      using errcode = 'check_violation';
  end if;
  if btrim(new.staff_notes) <> '' then
    insert into public.application_internal_notes as n (application_id, body)
    values (new.id, new.staff_notes)
    on conflict (application_id) do update
      set body = case
        when position(n.body in excluded.body) > 0 then excluded.body
        else n.body || E'\n\n' || excluded.body
      end;
  end if;
  new.staff_notes := null;
  return new;
end;
$$;
revoke all on function public.applications_staff_notes_moved() from public, anon, authenticated;

create or replace trigger applications_staff_notes_moved
  before insert or update of staff_notes on public.applications
  for each row execute function public.applications_staff_notes_moved();

comment on column public.applications.staff_notes is
  'Retired 2026-10-28, always empty: merchants can read this row. Staff notes live in application_internal_notes (applications_staff_notes_moved).';

-- ---------- 2. Only a document's review changes from a browser ----------
create or replace function public.documents_fields_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  review constant text[] := array['status', 'reviewed_by', 'reviewed_at', 'review_note', 'updated_at'];
begin
  -- current_user, not the role setting: claim_applications and the funder auto-send run as the
  -- function owner and must pass, and so does the server's service role.
  if current_user in ('authenticated', 'anon') then
    if (to_jsonb(new) - review) is distinct from (to_jsonb(old) - review) then
      raise exception 'only a document''s review can change here'
        using errcode = 'insufficient_privilege';
    end if;
    -- a review is recorded as whoever makes it, or cleared
    if new.reviewed_by is distinct from old.reviewed_by
       and new.reviewed_by is not null
       and new.reviewed_by is distinct from auth.uid() then
      raise exception 'a review is recorded as the person who made it'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.documents_fields_guard() from public, anon, authenticated;

create or replace trigger documents_fields_guard
  before update on public.documents
  for each row execute function public.documents_fields_guard();

reset lock_timeout;
