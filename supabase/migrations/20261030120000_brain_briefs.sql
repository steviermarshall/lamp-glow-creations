-- Lamp Brain, slice 1: the Today list (Asad, 2026-10-30).
--
-- Each staff member's Today list is worked out by rules in Lamp's server (src/lib/brain.ts): an
-- offer running out, a merchant on their file right now, documents that came in, a signed file
-- ready for funders, an offer waiting, a file gone quiet, a link nobody opened. When the switch is
-- on (ANTHROPIC_API_KEY set in the server's secrets), Claude writes the day's headline and one
-- next step per item, once per person per day, from an allowlist of facts only (business name,
-- stage, the signal, day counts, a rounded amount; never people's names, emails, phones, tax IDs,
-- bank details, notes or documents). Without the key the list still works on the rules alone.
--   * brain_briefs keeps each day's written brief and what it cost, one row per person per day;
--   * only Lamp's server reads or writes it (service role); nobody else has any access.
-- Run once in the SQL editor. Running it again is safe (only the What's new repeats).

create table if not exists public.brain_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  state text not null default 'pending' check (state in ('pending', 'ai', 'failed')),
  -- { headline, items: [{ id, kind, next }] } as checked by the server; ids are Lamp's own
  brief jsonb,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  error text check (error is null or char_length(error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists brain_briefs_month_idx on public.brain_briefs (created_at);

alter table public.brain_briefs enable row level security;
revoke all on public.brain_briefs from anon, authenticated;
grant all on public.brain_briefs to service_role;

-- ---------- What's new ----------
select public.announce(
  'New: Today, your list for the day',
  'The top of your Board now shows Today: the files and links that need you most, best first, each with the next step. An offer running out, a merchant on their file right now, documents that came in, a signed file ready for funders, an offer waiting, a file gone quiet, a link nobody opened. Press a line to open the file.',
  'https://claude.ai/artifact/MifSWb2LGkTtDfzTKorbLc#today',
  'all');

notify pgrst, 'reload schema';
