-- Lead profiles: notes & calls on a lead, carried onto the file when the lead signs (Asad, 2026-10-29).
--
-- A lead (someone who gave their name, phone and email on a link or the website but hasn't filed)
-- gets the same staff-only notes & calls thread as a file:
--   * a note sits on a lead (lead_id) or a file (application_id); team or admins-only as before;
--   * a call on a lead goes to a rep the same way; a rep asked to call a lead that isn't theirs gets
--     the lead (leads.rep_slug), so they can open it;
--   * when the lead files an application (applications_after_insert already marks the lead converted),
--     its notes are carried onto the new file, so the file's thread starts with what happened before
--     sign-up. Nothing is copied: the same notes now carry both ids;
--   * staff see a lead's notes on the leads they can see (their own or untagged, admins all), and only
--     team notes; merchants see nothing, as before.
-- Run once in the SQL editor after 20261029140000_file_notes_and_calls.sql. Running it again is safe
-- (only the What's new repeats).

do $$
begin
  if to_regclass('public.file_notes') is null then
    raise exception 'Run 20261029140000_file_notes_and_calls.sql before this one.';
  end if;
end $$;

-- ---------- a note on a lead ----------
alter table public.file_notes alter column application_id drop not null;
alter table public.file_notes add column if not exists lead_id uuid references public.leads (id) on delete cascade;
alter table public.file_notes drop constraint if exists file_notes_has_subject;
alter table public.file_notes add constraint file_notes_has_subject
  check (application_id is not null or lead_id is not null);
create index if not exists file_notes_lead_idx on public.file_notes (lead_id, created_at desc) where lead_id is not null;

/** Can the signed-in staff member see this lead? The same rule as the leads table: their own or untagged. */
create or replace function public.rep_can_see_lead(_lead_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.leads l
    where l.id = _lead_id
      and (l.rep_slug is null or l.rep_slug = public.current_rep_slug(auth.uid()))
  );
$$;
revoke all on function public.rep_can_see_lead(uuid) from public, anon;
grant execute on function public.rep_can_see_lead(uuid) to authenticated, service_role;

drop policy if exists "Staff read file notes" on public.file_notes;
create policy "Staff read file notes" on public.file_notes
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or (
      visibility = 'team'
      and (select public.is_staff())
      and ((application_id is not null and public.rep_can_see_application(application_id))
           or (lead_id is not null and public.rep_can_see_lead(lead_id))
           or assigned_to = (select public.current_rep_slug()))
    )
  );

drop policy if exists "Staff add file notes" on public.file_notes;
create policy "Staff add file notes" on public.file_notes
  for insert to authenticated
  with check (
    (select public.has_role('admin'))
    or (
      visibility = 'team' and assigned_to is null
      and (select public.is_staff())
      and ((application_id is not null and lead_id is null and public.rep_can_see_application(application_id))
           or (lead_id is not null and application_id is null and public.rep_can_see_lead(lead_id)))
    )
  );

-- the save check gains lead_id among the fixed columns (still runs as the caller)
create or replace function public.file_notes_before()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  from_browser boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    if from_browser then
      new.author := auth.uid();
    end if;
    new.author_name := public._staff_name(new.author);
    if from_browser then
      new.created_at := now();
    end if;
    new.body := btrim(new.body);
    new.done_at := null; new.done_by := null; new.done_by_name := null; new.outcome := null;
    if new.assigned_to is not null then
      if from_browser and not public.has_role('admin') then
        raise exception 'only an admin assigns a call' using errcode = 'insufficient_privilege';
      end if;
      if not exists (select 1 from public.reps where slug = new.assigned_to and active) then
        raise exception 'that rep is not on the team' using errcode = 'check_violation';
      end if;
      new.status := 'open';
    else
      new.status := null;
      new.due_on := null;
    end if;
    return new;
  end if;

  if not from_browser then
    return new;
  end if;
  if (
       new.application_id is distinct from old.application_id or new.lead_id is distinct from old.lead_id
    or new.visibility is distinct from old.visibility
    or new.body is distinct from old.body or new.author is distinct from old.author
    or new.author_name is distinct from old.author_name or new.assigned_to is distinct from old.assigned_to
    or new.due_on is distinct from old.due_on or new.created_at is distinct from old.created_at) then
    raise exception 'a note is kept as it was written' using errcode = 'insufficient_privilege';
  end if;
  if old.status is null then
    raise exception 'only a call can be marked done' using errcode = 'check_violation';
  end if;
  if new.status = 'done' and old.status = 'open' then
    new.done_at := now();
    new.done_by := auth.uid();
    new.done_by_name := public._staff_name(auth.uid());
  elsif new.status = 'open' and old.status = 'done' then
    new.done_at := null; new.done_by := null; new.done_by_name := null;
  else
    new.done_at := old.done_at; new.done_by := old.done_by; new.done_by_name := old.done_by_name;
  end if;
  new.outcome := nullif(btrim(coalesce(new.outcome, '')), '');
  return new;
end;
$$;
revoke all on function public.file_notes_before() from public, anon, authenticated;

-- notifications and the hand-over, for a file or a lead
create or replace function public.file_notes_after()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  a public.applications;
  l public.leads;
  biz text;
  link text;
  owner_slug text;
  rep_user uuid;
begin
  if new.application_id is not null then
    select * into a from public.applications where id = new.application_id;
    biz := coalesce(nullif(a.business_name, ''), nullif(a.first_name, ''), 'a file');
    link := '/staff?file=' || new.application_id;
    owner_slug := a.rep_slug;
  else
    select * into l from public.leads where id = new.lead_id;
    biz := coalesce(nullif(btrim(coalesce(l.first_name, '') || ' ' || coalesce(l.answers ->> 'lastName', '')), ''), 'a lead');
    link := '/staff?lead=' || new.lead_id;
    owner_slug := l.rep_slug;
  end if;
  if tg_op = 'INSERT' then
    if new.assigned_to is not null then
      -- a rep asked to call something they can't see gets it
      if owner_slug is distinct from new.assigned_to then
        if new.application_id is not null then
          update public.applications set rep_slug = new.assigned_to where id = new.application_id;
        else
          update public.leads set rep_slug = new.assigned_to where id = new.lead_id;
        end if;
      end if;
      select user_id into rep_user from public.reps where slug = new.assigned_to;
      if rep_user is distinct from new.author then
        perform public.notify(rep_user, 'call',
          coalesce(new.author_name, 'An admin') || ' asked you to call ' || biz
            || case when new.due_on is not null then ' by ' || to_char(new.due_on, 'Mon FMDD') else '' end,
          left(new.body, 400), link, new.application_id);
      end if;
    elsif new.visibility = 'team' and owner_slug is not null then
      select user_id into rep_user from public.reps where slug = owner_slug;
      if rep_user is distinct from new.author then
        perform public.notify(rep_user, 'note', 'New note on ' || biz || ' from ' || coalesce(new.author_name, 'Lamp'),
          left(new.body, 400), link, new.application_id);
      end if;
    end if;
    return new;
  end if;
  if new.status = 'done' and old.status = 'open' and new.author is distinct from new.done_by then
    perform public.notify(new.author, 'call',
      coalesce(new.done_by_name, 'The rep') || ' finished: call ' || biz,
      coalesce(new.outcome, 'Marked done.'), link, new.application_id);
  end if;
  return new;
end;
$$;
revoke all on function public.file_notes_after() from public, anon, authenticated;

-- ---------- carry a lead's notes onto its file when it converts ----------
create or replace function public.leads_carry_notes()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.converted_application_id is not null
     and new.converted_application_id is distinct from old.converted_application_id then
    update public.file_notes set application_id = new.converted_application_id
    where lead_id = new.id and application_id is null;
  end if;
  return new;
end;
$$;
revoke all on function public.leads_carry_notes() from public, anon, authenticated;
drop trigger if exists leads_carry_notes on public.leads;
create trigger leads_carry_notes
  after update of converted_application_id on public.leads
  for each row execute function public.leads_carry_notes();

-- leads already converted before this ran keep their (empty) history; nothing to carry yet

-- ---------- What's new ----------
select public.announce(
  'New: lead profiles',
  'Click a name under "Started, not signed" to open their profile: what they gave, which link and form, how far they got and what to say on the call, plus notes & calls. When they sign, the notes carry over to their file.',
  'https://claude.ai/artifact/MifSWb2LGkTtDfzTKorbLc#lead-profile', 'all');

notify pgrst, 'reload schema';
