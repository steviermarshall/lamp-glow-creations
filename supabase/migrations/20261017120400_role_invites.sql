-- Lamp database v2, part 5 of 5: roles granted ahead of the first sign-in.
--
-- Nobody on the Lamp team has signed in yet, so there is no auth user to attach the
-- admin role to. role_invites pre-grants by email: when that address signs in for the
-- first time, handle_new_user grants the listed role, links the rep slug, and marks the
-- invite claimed. Admins manage the list; the service role can too.

create table public.role_invites (
  email text primary key check (email = lower(email) and char_length(email) <= 254),
  roles public.app_role[] not null default '{rep}',
  rep_slug text references public.reps (slug) on delete set null,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_by uuid references auth.users (id) on delete set null,
  claimed_at timestamptz
);

alter table public.role_invites enable row level security;
grant select, insert, update, delete on public.role_invites to authenticated;
grant all on public.role_invites to service_role;

create policy "Admins manage role invites" on public.role_invites
  for all to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  inv public.role_invites;
  r public.app_role;
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

  select * into inv from public.role_invites
  where email = lower(new.email) and claimed_at is null;
  if inv.email is not null then
    foreach r in array inv.roles loop
      insert into public.user_roles (user_id, role) values (new.id, r) on conflict do nothing;
    end loop;
    if inv.rep_slug is not null then
      update public.reps set user_id = new.id where slug = inv.rep_slug and user_id is null;
    end if;
    update public.role_invites set claimed_by = new.id, claimed_at = now() where email = inv.email;
  end if;
  return new;
end;
$$;

-- The Lamp team as it stands. Stevie owns the shop; Asad owns the code and operates it;
-- Zeus has a rep seat. Each claims on first sign-in with that address.
insert into public.role_invites (email, roles, rep_slug) values
  ('stevie@getlamp.app', '{admin,rep}', 'stevie'),
  ('asad@getlamp.app', '{admin,rep}', 'asad'),
  ('zeus@getlamp.app', '{rep}', 'zeus')
on conflict (email) do nothing;
