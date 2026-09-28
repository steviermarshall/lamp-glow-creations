create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'offers_ready', 'funded', 'closed')),
  answers jsonb not null default '{}'::jsonb,
  utm jsonb not null default '{}'::jsonb,
  first_name text,
  business_name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists applications_user_id_idx on public.applications (user_id);
grant select, insert on public.applications to authenticated;
grant all on public.applications to service_role;
alter table public.applications enable row level security;
create policy "Users read own applications" on public.applications for select to authenticated using (auth.uid() = user_id);
create policy "Users create own applications" on public.applications for insert to authenticated with check (auth.uid() = user_id and status = 'new');

create or replace function public.update_updated_at_column() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;
create trigger update_applications_updated_at before update on public.applications for each row execute function public.update_updated_at_column();

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) <= 254),
  first_name text,
  answers jsonb not null default '{}'::jsonb,
  utm jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant insert on public.leads to anon, authenticated;
grant all on public.leads to service_role;
alter table public.leads enable row level security;
create policy "Anyone can submit a lead" on public.leads for insert to anon, authenticated with check (true);

create policy "Users upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users read own files" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);