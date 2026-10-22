-- Engine leads: the public-record lead engine's output, mirrored into Lamp's own database so
-- staff work it where they work files. Rows are written only by the engine (service_role,
-- upsert by (source, source_key)); staff read every row and may change status and notes.
-- Runs after 20261019170000_staff_scope.sql. Safe to run twice.

create table if not exists public.engine_leads (
  id            bigserial primary key,
  source        text not null,
  source_key    text not null,
  name          text,
  phone         text,
  email         text,
  city          text,
  state         text,
  industry      text,
  tier          text check (tier in ('A', 'B', 'C', 'X')),
  need          int,
  reason        text,
  signals       jsonb not null default '[]'::jsonb,
  status        text not null default 'new'
                check (status in ('new', 'called', 'no_answer', 'callback', 'qualified',
                                  'submitted', 'funded', 'dead', 'do_not_call')),
  notes         text not null default '',
  rep_slug      text references public.reps (slug) on delete set null,
  first_found   date,
  pushed_at     timestamptz not null default now(),
  worked_at     timestamptz,
  unique (source, source_key)
);

create index if not exists engine_leads_work_idx
  on public.engine_leads (tier, status, need desc, first_found desc);
create index if not exists engine_leads_phone_idx on public.engine_leads (phone);
create index if not exists engine_leads_rep_idx on public.engine_leads (rep_slug, status);

alter table public.engine_leads enable row level security;

revoke all on public.engine_leads from anon;
grant select, update on public.engine_leads to authenticated;
grant all on public.engine_leads to service_role;
grant usage, select on sequence public.engine_leads_id_seq to service_role;

drop policy if exists "Staff read engine leads" on public.engine_leads;
create policy "Staff read engine leads" on public.engine_leads
  for select to authenticated using ((select public.is_staff()));

drop policy if exists "Staff work engine leads" on public.engine_leads;
create policy "Staff work engine leads" on public.engine_leads
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

-- Staff may change only the working columns. Everything the engine owns stays as pushed.
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

drop trigger if exists engine_leads_before_update on public.engine_leads;
create trigger engine_leads_before_update
  before update on public.engine_leads
  for each row execute function public.engine_leads_before_update();
