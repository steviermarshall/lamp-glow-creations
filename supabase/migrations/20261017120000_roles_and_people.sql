-- Lamp database v2, part 1 of 4: who is who.
--
-- Roles live in their own table and every policy checks them through a SECURITY DEFINER
-- function, so row-level security never reads the table it protects (no recursion, one
-- indexed lookup per policy). Policies wrap auth.uid() and these helpers in (select ...)
-- so Postgres evaluates them once per statement instead of once per row.
--
-- Roles: merchant (default for every sign-up), rep (works a pipeline), admin (sees and
-- changes everything). A user can hold more than one.

create type public.app_role as enum ('merchant', 'rep', 'admin');

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
create index user_roles_role_idx on public.user_roles (role);

create or replace function public.has_role(_role public.app_role, _user_id uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  );
$$;

create or replace function public.is_staff(_user_id uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role in ('rep', 'admin')
  );
$$;

revoke all on function public.has_role(public.app_role, uuid) from public;
revoke all on function public.is_staff(uuid) from public;
grant execute on function public.has_role(public.app_role, uuid) to authenticated, service_role;
grant execute on function public.is_staff(uuid) to authenticated, service_role;

alter table public.user_roles enable row level security;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

create policy "Users read own roles" on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Admins read all roles" on public.user_roles
  for select to authenticated
  using ((select public.has_role('admin')));
create policy "Admins grant roles" on public.user_roles
  for insert to authenticated
  with check ((select public.has_role('admin')));
create policy "Admins revoke roles" on public.user_roles
  for delete to authenticated
  using ((select public.has_role('admin')));

-- One profile row per auth user, created by trigger so the app never races to make it.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text check (char_length(email) <= 254),
  full_name text,
  first_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, first_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(
      new.raw_user_meta_data ->> 'first_name',
      split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1)
    )
  )
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  values (new.id, 'merchant')
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for users who signed up before this migration (none expected, but cheap).
insert into public.profiles (id, email, full_name)
select id, email, coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name')
from auth.users
on conflict (id) do nothing;
insert into public.user_roles (user_id, role)
select id, 'merchant' from auth.users
on conflict do nothing;

create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at_column();

alter table public.profiles enable row level security;
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

create policy "Users read own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));
create policy "Staff read all profiles" on public.profiles
  for select to authenticated
  using ((select public.is_staff()));
create policy "Users update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Reps. The slug is the public link (/apply/<slug>); user_id links the rep's login once
-- they have one. This replaces the hard-coded REPS array in src/lib/site.ts over time.
create table public.reps (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  user_id uuid unique references auth.users (id) on delete set null,
  name text not null,
  title text,
  photo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.reps (slug, name, title) values
  ('stevie', 'Stevie Marshall', 'Founder'),
  ('zeus', 'Zeus', null),
  ('asad', 'Asad', null);

create trigger update_reps_updated_at
  before update on public.reps
  for each row execute function public.update_updated_at_column();

-- The signed-in user's rep slug, or null. Used by pipeline policies.
create or replace function public.current_rep_slug(_user_id uuid default auth.uid())
returns text
language sql stable security definer
set search_path = public
as $$
  select slug from public.reps where user_id = _user_id and active limit 1;
$$;
revoke all on function public.current_rep_slug(uuid) from public;
grant execute on function public.current_rep_slug(uuid) to authenticated, service_role;

alter table public.reps enable row level security;
grant select on public.reps to anon, authenticated;
grant insert, update, delete on public.reps to authenticated;
grant all on public.reps to service_role;

-- Rep pages are public, so anyone may read active reps (slug, name, title, photo).
create policy "Anyone reads active reps" on public.reps
  for select to anon, authenticated
  using (active);
create policy "Staff read all reps" on public.reps
  for select to authenticated
  using ((select public.is_staff()));
create policy "Admins manage reps" on public.reps
  for all to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));
