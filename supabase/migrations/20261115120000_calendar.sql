-- Calendar (Asad, 2026-11-15). Plan and rules: docs/calendar.md.
--
-- Every staff member gets a calendar of follow-ups Lamp schedules from what already happened: a link
-- that wasn't opened, an offer waiting on an answer, a call an admin assigned, an email reply, the
-- day's engine emails waiting for approval, and so on.
--   * one row is one item for one person (owner). owner is null for a file or lead nobody owns yet:
--     only admins see those, in an "Unassigned" lane;
--   * only Lamp's server (service role) adds items, from the rules in src/lib/calendar.ts. Each item
--     has a source_key naming the rule and the record, so running the rules twice adds nothing;
--   * a person reads and changes only their own items. Admins read and change everyone's;
--   * from the browser only two things change: status (open or done) and due_at (moving it). Who
--     finished it and when is stamped here. 'cleared' (the reason passed on its own) is the server's;
--   * merchants and signed-out visitors read and write nothing.
--
-- Nothing existing is changed. Run once in the SQL editor; running it again is safe (only the
-- What's new repeats).

create table if not exists public.calendar_items (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users (id) on delete cascade,
  rule text not null check (rule ~ '^[a-z_]{2,40}$'),
  source_key text not null unique check (char_length(source_key) between 3 and 200),
  title text not null check (char_length(title) between 1 and 200),
  why text not null check (char_length(why) between 1 and 600),
  link text check (link is null or (link like '/staff%' and char_length(link) <= 300)),
  rep_slug text,
  application_id uuid references public.applications (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  engine_lead_id bigint references public.engine_leads (id) on delete cascade,
  invite_id uuid references public.application_invites (id) on delete cascade,
  due_at timestamptz not null,
  all_day boolean not null default true,
  scheduled_at timestamptz not null, -- the due time the rule first set; due_at differs once moved
  status text not null default 'open' check (status in ('open', 'done', 'cleared')),
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  cleared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists calendar_items_owner_idx on public.calendar_items (owner, due_at);
create index if not exists calendar_items_open_idx on public.calendar_items (status, due_at) where status = 'open';

alter table public.calendar_items enable row level security;
revoke all on public.calendar_items from anon, authenticated;
grant select on public.calendar_items to authenticated;
grant update (status, due_at) on public.calendar_items to authenticated;
grant all on public.calendar_items to service_role;

drop policy if exists "Staff read their calendar" on public.calendar_items;
create policy "Staff read their calendar" on public.calendar_items
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and owner = (select auth.uid()))
  );

drop policy if exists "Staff work their calendar" on public.calendar_items;
create policy "Staff work their calendar" on public.calendar_items
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and owner = (select auth.uid()))
  )
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and owner = (select auth.uid()))
  );

-- runs as the caller (not security definer), so current_user tells a browser from the server
create or replace function public.calendar_items_before()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_op <> 'UPDATE' or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  -- the column grants already stop other columns; this keeps the meaning of the two that change
  if new.status not in ('open', 'done') then
    raise exception 'An item is open or done.' using errcode = 'check_violation';
  end if;
  if old.status = 'cleared' and new.status is distinct from old.status then
    raise exception 'This item cleared on its own.' using errcode = 'check_violation';
  end if;
  if new.due_at is distinct from old.due_at
     and (new.due_at < now() - interval '1 day' or new.due_at > now() + interval '366 days') then
    raise exception 'Move it to a day from today to a year out.' using errcode = 'check_violation';
  end if;
  if new.status = 'done' and old.status = 'open' then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif new.status = 'open' and old.status = 'done' then
    new.done_at := null;
    new.done_by := null;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  return new;
end;
$$;
revoke all on function public.calendar_items_before() from public, anon, authenticated;
drop trigger if exists calendar_items_before on public.calendar_items;
create trigger calendar_items_before
  before insert or update on public.calendar_items
  for each row execute function public.calendar_items_before();

-- ---------- What's new ----------
select public.announce(
  'New: your calendar',
  'Staff > Calendar lists the follow-ups Lamp schedules for you from what already happened: links not opened, applications started and not finished, offers waiting, funders who haven''t answered, document requests, calls assigned to you, email replies and leads you marked Callback or No answer. Each one says why it''s there. Mark it done or move it to another day.',
  null, 'all');

notify pgrst, 'reload schema';
