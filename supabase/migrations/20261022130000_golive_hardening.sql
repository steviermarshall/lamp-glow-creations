-- Go-live hardening (2026-10-22), from the pre-flight review of the five go-live migrations.
--
-- 1. A file's owner (applications.user_id) moves only by an admin or the server. Before this, any
--    staff member could repoint a file at another account through the API (applications_before_update
--    checks user_id only for non-staff). With the full application and its SSNs and signature
--    hanging off that owner, a rep could have signed in a merchant's name or shown one merchant
--    another's SSN. The staff screens never write user_id, so nothing in the app changes.
-- 2. engine_leads keeps only the privileges its policies use: anon loses the sequence Supabase's
--    defaults grant it, and authenticated keeps select and update (no insert, delete, truncate).
-- Safe to run again.

create or replace function public.applications_owner_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'authenticated'
     and new.user_id is distinct from old.user_id
     and not public.has_role('admin') then
    raise exception 'only an admin can move a file to another account'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.applications_owner_guard() from public, anon;

drop trigger if exists applications_owner_guard on public.applications;
create trigger applications_owner_guard
  before update on public.applications
  for each row execute function public.applications_owner_guard();

revoke all on sequence public.engine_leads_id_seq from anon, authenticated;
revoke all on public.engine_leads from authenticated;
grant select, update on public.engine_leads to authenticated;
