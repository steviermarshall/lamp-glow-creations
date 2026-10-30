-- Document requests: a link a merchant drops files into (Stevie + Asad, 2026-10-29).
--
-- At closing (or any time) staff ask a merchant for documents: a voided check, a photo ID, more
-- bank statements, anything else. Lamp's server makes a request with a secret link the rep copies
-- into a text or an email. The merchant opens it without signing in, sees what's asked, and drags
-- files in; each lands in the file's documents with the request it answered, so the file shows what
-- came in on which day and for what.
--   * the database keeps only a hash of the link's secret (like application links); a lost link is
--     replaced with a new one, which retires the old;
--   * requests are written only by Lamp's server (service role); staff read the requests on files
--     they can see (admins all), merchants read nothing here;
--   * documents gain request_id; the existing document trigger still tells the file's rep.
-- Run once in the SQL editor. Running it again is safe (only the What's new repeats).

create table if not exists public.document_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  token_hash text not null unique,
  title text not null default 'Documents' check (char_length(title) between 1 and 120),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 12),
  note text check (note is null or char_length(note) <= 600),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  closed_at timestamptz
);
create index if not exists document_requests_file_idx on public.document_requests (application_id, created_at desc);

alter table public.document_requests enable row level security;
revoke all on public.document_requests from anon, authenticated;
grant select on public.document_requests to authenticated;
grant all on public.document_requests to service_role;

drop policy if exists "Staff read document requests" on public.document_requests;
create policy "Staff read document requests" on public.document_requests
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and public.rep_can_see_application(application_id))
  );

alter table public.documents add column if not exists request_id uuid
  references public.document_requests (id) on delete set null;
create index if not exists documents_request_idx on public.documents (request_id) where request_id is not null;

-- ---------- What's new ----------
select public.announce(
  'New: request documents with a link',
  'On a file, press Request documents, tick what you need (voided check, ID, statements, anything else) and copy the link into a text or email. The merchant drags their files in without signing in; each one lands on the file with the date and the request it answered.',
  'https://claude.ai/artifact/MifSWb2LGkTtDfzTKorbLc#doc-requests', 'all');

notify pgrst, 'reload schema';
