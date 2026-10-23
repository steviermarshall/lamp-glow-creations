-- Engine leads, handed out one rep at a time (2026-10-23).
--
-- The lead engine stays outside Lamp. An admin picks leads there, downloads them as a CSV with
-- the rep each one goes to, and uploads that CSV on the Engine leads page while signed in. No
-- key into this database is kept anywhere else.
--
-- Before: every staff member read every engine lead and could work any of them, and only the
-- service role could add rows.
-- After:
--   * admins read, add, reassign and delete every engine lead;
--   * a rep reads and works only the leads assigned to them, and cannot hand a lead to anyone
--     else or take an unassigned one;
--   * the columns the engine found (name, phone, signals...) stay as uploaded, for admins too,
--     because a re-upload of the same lead only updates who it is assigned to.
-- Safe to run again.

grant insert, delete on public.engine_leads to authenticated;
grant usage on sequence public.engine_leads_id_seq to authenticated;

drop policy if exists "Staff read engine leads" on public.engine_leads;
create policy "Staff read engine leads" on public.engine_leads
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and rep_slug is not null
      and rep_slug = (select public.current_rep_slug())
    )
  );

drop policy if exists "Staff work engine leads" on public.engine_leads;
create policy "Staff work engine leads" on public.engine_leads
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and rep_slug is not null
      and rep_slug = (select public.current_rep_slug())
    )
  )
  with check (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and rep_slug is not null
      and rep_slug = (select public.current_rep_slug())
    )
  );

drop policy if exists "Admins add engine leads" on public.engine_leads;
create policy "Admins add engine leads" on public.engine_leads
  for insert to authenticated
  with check ((select public.has_role('admin')));

drop policy if exists "Admins delete engine leads" on public.engine_leads;
create policy "Admins delete engine leads" on public.engine_leads
  for delete to authenticated
  using ((select public.has_role('admin')));

-- Signed-in staff change only the working columns; only an admin changes who a lead belongs to.
create or replace function public.engine_leads_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'authenticated' then
    new.source      := old.source;
    new.source_key  := old.source_key;
    new.name        := old.name;
    new.phone       := old.phone;
    new.email       := old.email;
    new.city        := old.city;
    new.state       := old.state;
    new.industry    := old.industry;
    new.tier        := old.tier;
    new.need        := old.need;
    new.reason      := old.reason;
    new.signals     := old.signals;
    new.first_found := old.first_found;
    new.pushed_at   := old.pushed_at;
    if not public.has_role('admin') then
      new.rep_slug := old.rep_slug;
    end if;
    if new.status is distinct from old.status then
      new.worked_at := now();
      if new.rep_slug is null then
        new.rep_slug := (select slug from public.reps where user_id = auth.uid() limit 1);
      end if;
    end if;
  end if;
  return new;
end;
$$;
