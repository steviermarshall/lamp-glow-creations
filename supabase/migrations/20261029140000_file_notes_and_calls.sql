-- Notes & calls on a file (Asad, 2026-10-29).
--
-- A running thread of staff notes on each file, in place of the single shared notes box:
--   * every note is either 'team' (the file's rep and admins) or 'admins' (admins only; reps never
--     read it, whatever they ask the API for);
--   * an admin can make a note an instruction to a rep ("call them by Friday about the March
--     statements"), with an optional due date. The rep is notified, and marks it done with an
--     outcome; the admin who asked is notified of that. Assigning a call to a rep who can't see the
--     file also makes the file theirs (the trigger does it), so the rep can open what they were
--     asked to work;
--   * notes are never rewritten: the body, who wrote it, when and its visibility are fixed once
--     saved. Only an instruction's done state and outcome change, and only an admin removes a note;
--   * merchants read and write nothing here.
-- The old single note (application_internal_notes) is copied in as each file's first team note;
-- that table stays as it was.
--
-- Run once in the SQL editor; running it again is safe (the copy skips files already copied).

-- ---------- table ----------
create table if not exists public.file_notes (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.applications (id) on delete cascade,
  visibility text not null default 'team' check (visibility in ('team', 'admins')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  author uuid references auth.users (id) on delete set null default auth.uid(),
  author_name text,
  assigned_to text references public.reps (slug) on delete set null,
  due_on date,
  status text check (status is null or status in ('open', 'done')),
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  done_by_name text,
  outcome text check (outcome is null or char_length(outcome) <= 2000),
  created_at timestamptz not null default now(),
  constraint file_notes_call_shape check ((assigned_to is null) = (status is null))
);
create index if not exists file_notes_file_idx on public.file_notes (application_id, created_at desc);
create index if not exists file_notes_open_idx on public.file_notes (assigned_to, due_on) where status = 'open';

alter table public.file_notes enable row level security;
revoke all on public.file_notes from anon, authenticated;
grant select, insert, delete on public.file_notes to authenticated;
grant update (status, outcome) on public.file_notes to authenticated;
grant all on public.file_notes to service_role;

drop policy if exists "Staff read file notes" on public.file_notes;
create policy "Staff read file notes" on public.file_notes
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or (
      visibility = 'team'
      and (select public.is_staff())
      and (public.rep_can_see_application(application_id)
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
      and public.rep_can_see_application(application_id)
    )
  );

drop policy if exists "Staff finish their calls" on public.file_notes;
create policy "Staff finish their calls" on public.file_notes
  for update to authenticated
  using (
    status is not null
    and ((select public.has_role('admin')) or assigned_to = (select public.current_rep_slug()))
  )
  with check (
    status is not null
    and ((select public.has_role('admin')) or assigned_to = (select public.current_rep_slug()))
  );

drop policy if exists "Admins remove file notes" on public.file_notes;
create policy "Admins remove file notes" on public.file_notes
  for delete to authenticated
  using ((select public.has_role('admin')));

-- ---------- who wrote it, and what may change ----------
create or replace function public._staff_name(_user uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  -- staff names only, and only for staff callers (or the server): a merchant learns nothing here
  -- (inside this security definer function current_user is its owner, so read the request's role)
  select case when coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon') or public.is_staff() then coalesce(
    (select r.name from public.reps r where r.user_id = _user order by r.active desc limit 1),
    (select coalesce(nullif(p.full_name, ''), nullif(p.first_name, ''), p.email) from public.profiles p where p.id = _user),
    'Lamp') end;
$$;
revoke all on function public._staff_name(uuid) from public, anon;
grant execute on function public._staff_name(uuid) to authenticated;

-- runs as the caller (not security definer), so current_user tells a browser from the server
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

  -- UPDATE: from a browser only a call's status and outcome change; who finished it is stamped here
  if not from_browser then
    return new;
  end if;
  if (
       new.application_id is distinct from old.application_id or new.visibility is distinct from old.visibility
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
drop trigger if exists file_notes_before on public.file_notes;
create trigger file_notes_before
  before insert or update on public.file_notes
  for each row execute function public.file_notes_before();

-- ---------- notifications ----------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('file', 'assigned', 'document', 'offer', 'funded', 'started', 'announcement', 'call', 'note'));

create or replace function public.file_notes_after()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  a public.applications;
  biz text;
  link text;
  rep_user uuid;
begin
  select * into a from public.applications where id = new.application_id;
  biz := coalesce(nullif(a.business_name, ''), nullif(a.first_name, ''), 'a file');
  link := '/staff?file=' || new.application_id;
  if tg_op = 'INSERT' then
    if new.assigned_to is not null then
      -- a rep asked to call a file they can't see gets the file
      if a.rep_slug is distinct from new.assigned_to then
        update public.applications set rep_slug = new.assigned_to where id = new.application_id;
      end if;
      select user_id into rep_user from public.reps where slug = new.assigned_to;
      if rep_user is distinct from new.author then
        perform public.notify(rep_user, 'call',
          coalesce(new.author_name, 'An admin') || ' asked you to call ' || biz
            || case when new.due_on is not null then ' by ' || to_char(new.due_on, 'Mon FMDD') else '' end,
          left(new.body, 400), link, new.application_id);
      end if;
    elsif new.visibility = 'team' and a.rep_slug is not null then
      -- a team note from someone else tells the file's rep
      select user_id into rep_user from public.reps where slug = a.rep_slug;
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
drop trigger if exists file_notes_after on public.file_notes;
create trigger file_notes_after
  after insert or update of status on public.file_notes
  for each row execute function public.file_notes_after();

-- ---------- the old single note becomes the first team note ----------
insert into public.file_notes (application_id, visibility, body, author, author_name, created_at)
select n.application_id, 'team', n.body, n.updated_by, public._staff_name(n.updated_by), coalesce(n.updated_at, now())
from public.application_internal_notes n
where btrim(coalesce(n.body, '')) <> ''
  and not exists (select 1 from public.file_notes f where f.application_id = n.application_id);

-- ---------- What's new ----------
select public.announce(
  'New: notes & calls on every file',
  'Each file now keeps a running thread of notes. Admins can make a note admins-only, or assign it to a rep as a call with a due date; the rep is notified and marks it done with what happened. Your open calls are listed at the top of Files.',
  'https://claude.ai/artifact/MifSWb2LGkTtDfzTKorbLc#notes-calls', 'all');

notify pgrst, 'reload schema';
