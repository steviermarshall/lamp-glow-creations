-- Dashboard part 2: Lamp's own record of site visits and of who signs in and what staff do.
--
-- site_events: one row per page view or /apply step, keyed by a random id the visitor's browser
-- keeps (no name, email or IP). activity_log: sign-ins (with IP, rough place and device) and staff
-- actions on files. The site's server routes write both with the service role; only admins read.
-- Safe to run twice.

create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  visitor text not null check (visitor ~ '^[0-9a-f-]{16,40}$'),
  kind text not null check (kind in ('page_view', 'apply_step')),
  path text not null check (char_length(path) <= 200),
  step int check (step between 0 and 50),
  question text check (char_length(question) <= 40),
  referrer_host text check (char_length(referrer_host) <= 120),
  utm_source text check (char_length(utm_source) <= 80),
  utm_medium text check (char_length(utm_medium) <= 80),
  utm_campaign text check (char_length(utm_campaign) <= 120),
  device text check (device in ('mobile', 'tablet', 'desktop')),
  country text check (char_length(country) <= 2),
  region text check (char_length(region) <= 80),
  city text check (char_length(city) <= 80)
);
create index if not exists site_events_occurred_idx on public.site_events (occurred_at desc);

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  email text check (char_length(email) <= 254),
  action text not null check (
    action in ('sign_in', 'open_file', 'change_stage', 'download_pdf', 'send_to_funders', 'send_application')
  ),
  application_id uuid references public.applications (id) on delete set null,
  detail text check (char_length(detail) <= 200),
  ip text check (char_length(ip) <= 64),
  country text check (char_length(country) <= 2),
  region text check (char_length(region) <= 80),
  city text check (char_length(city) <= 80),
  device text check (device in ('mobile', 'tablet', 'desktop')),
  browser text check (char_length(browser) <= 60)
);
create index if not exists activity_log_occurred_idx on public.activity_log (occurred_at desc);
create index if not exists activity_log_user_idx on public.activity_log (user_id, occurred_at desc);

alter table public.site_events enable row level security;
alter table public.activity_log enable row level security;
revoke all on public.site_events from anon, authenticated;
revoke all on public.activity_log from anon, authenticated;
grant select on public.site_events to authenticated;
grant select on public.activity_log to authenticated;
grant all on public.site_events to service_role;
grant all on public.activity_log to service_role;

drop policy if exists "Admins read site events" on public.site_events;
create policy "Admins read site events" on public.site_events
  for select to authenticated
  using ((select public.has_role('admin')));

drop policy if exists "Admins read the activity log" on public.activity_log;
create policy "Admins read the activity log" on public.activity_log
  for select to authenticated
  using ((select public.has_role('admin')));
