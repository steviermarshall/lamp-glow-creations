-- Email review (2026-11-13): the day's outgoing emails wait here until an admin approves them.
--
-- The War Room email engine writes each day's emails and offers them to the portal instead of putting
-- them in Gmail Drafts. An admin reads them on Staff > Email engine and presses one button. The engine
-- then asks which ones were approved, sends those from each person's own mailbox, and reports back.
--
-- One row is one email to one business. The engine's own id for it (engine_id) is the key, so offering
-- the same email twice changes nothing. An approval is a write only this server makes, after checking
-- the caller is an admin: status goes from 'pending' to 'approved' with who and when. The engine never
-- sends a row that is not 'approved', and it checks the text it holds against body_hash first, so what
-- was read is what goes out.
--
-- Closed to everyone but the server (service role), like engine_status: no browser reads this table.
-- It holds the business's name and email address and the email's words, for admins only.
--
-- Safe to run more than once. Nothing existing is changed.

create table if not exists public.engine_outbox (
  id uuid primary key default gen_random_uuid(),
  engine_id text not null unique check (engine_id ~ '^[A-Za-z0-9_-]{4,80}$'),
  batch_date date not null,
  sender_email text not null check (length(sender_email) between 3 and 200),
  sender_name text not null default '' check (length(sender_name) <= 120),
  to_email text not null check (length(to_email) between 3 and 200),
  business text not null default '' check (length(business) <= 200),
  stage smallint not null default 1 check (stage between 1 and 9),
  list text not null default '' check (length(list) <= 80),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 8000),
  body_hash text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'skipped', 'sent', 'failed', 'withdrawn')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_name text not null default '' check (length(decided_name) <= 120),
  decided_at timestamptz,
  sent_at timestamptz,
  error text not null default '' check (length(error) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists engine_outbox_status_idx on public.engine_outbox (status, batch_date);

alter table public.engine_outbox enable row level security;
revoke all on public.engine_outbox from anon, authenticated;
grant all on public.engine_outbox to service_role;

-- An email that was sent, skipped or withdrawn never goes back to waiting, whoever asks.
create or replace function public.engine_outbox_before()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if old.status in ('sent', 'withdrawn') and new.status is distinct from old.status then
      raise exception 'This email is already % and cannot change.', old.status;
    end if;
    if new.status = 'approved' and old.status not in ('pending', 'failed', 'approved') then
      raise exception 'Only a waiting email can be approved.';
    end if;
    if new.engine_id is distinct from old.engine_id then
      raise exception 'An email keeps its id.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists engine_outbox_before on public.engine_outbox;
create trigger engine_outbox_before
  before insert or update on public.engine_outbox
  for each row execute function public.engine_outbox_before();

revoke all on function public.engine_outbox_before() from public, anon, authenticated;

select public.announce(
  'Approve the day''s emails in one place',
  'Staff > Email engine now shows every email the engine wants to send today, from each mailbox. Read them, leave out any you don''t want, and press Send. Nothing goes out until an admin approves it.',
  '/staff?view=autopilot',
  'admin'
)
where not exists (
  select 1 from public.notifications
  where kind = 'announcement' and title = 'Approve the day''s emails in one place'
);

notify pgrst, 'reload schema';
