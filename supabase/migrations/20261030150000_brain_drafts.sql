-- Lamp Brain, slice 2: follow-up drafts (Asad, 2026-10-30).
--
-- Each line on Today gets a Draft button: a text, an email and call notes for that file or link,
-- which the rep edits and sends from their own phone or mail app. Lamp sends nothing. Lamp's own
-- wording is always there; when the switch is on (ANTHROPIC_API_KEY in the server's secrets)
-- Claude rewrites it from the same allowlisted facts as Today, with placeholders where names go,
-- and Lamp fills the names in afterwards. Texts are only offered when the merchant's consent to
-- texts is on record (the lead form's phone consent, or signing). Mark sent / Mark called adds a
-- line to the file's timeline.
--   * brain_drafts keeps each Claude-written draft and what it cost, one per person, item,
--     situation and day, so opening it again doesn't pay twice; Lamp's server only.
-- Run once in the SQL editor. Running it again is safe (only the What's new repeats).

create table if not exists public.brain_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('file', 'link')),
  item_id uuid not null,
  signal text not null,
  day date not null,
  docs boolean not null default false,
  -- { text, email_subject, email_body, call[] } with {first_name} / {rep_name} placeholders
  draft jsonb,
  written text[] not null default '{}',
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  error text check (error is null or char_length(error) <= 300),
  created_at timestamptz not null default now(),
  unique (user_id, kind, item_id, signal, day, docs)
);
create index if not exists brain_drafts_day_idx on public.brain_drafts (user_id, day);
create index if not exists brain_drafts_month_idx on public.brain_drafts (created_at);

alter table public.brain_drafts enable row level security;
revoke all on public.brain_drafts from anon, authenticated;
grant all on public.brain_drafts to service_role;

-- ---------- What's new ----------
select public.announce(
  'New: follow-up drafts on Today',
  'Press Draft on any line in Today for a ready text, email and call notes for that file. Edit it, then send it from your own phone or email with one tap, and press Mark sent so it shows on the file. Texts only appear when the merchant has agreed to texts. For a just-signed file, Add a documents link puts a statements link straight into the message.',
  'https://claude.ai/artifact/MifSWb2LGkTtDfzTKorbLc#drafts',
  'all');

notify pgrst, 'reload schema';
