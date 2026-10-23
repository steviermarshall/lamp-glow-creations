-- SSN access and the who-looked log (2026-10-23, security baseline L-001 and L-002).
--
-- Before: every rep could read the full application (SSN and date of birth included) of every
-- file they could see, which includes every unassigned file, and the staff screen masked the
-- SSN only in the browser, after the full number had arrived. Nothing recorded who looked.
--
-- After:
--   * staff no longer read application_details directly. Merchants still read and edit their own
--     row exactly as before.
--   * staff_application_details(file) returns the full application with SSNs cut to the last
--     four and dates of birth hidden, for an admin or the rep the file is assigned to. Anyone
--     else, including a rep looking at an unassigned file, is refused.
--   * reveal_application_details(file, purpose) returns the full numbers to the same people and
--     writes one row to sensitive_access_log first: who, which file, when, and why ("reveal_ssn"
--     for Show SSN, "application_pdf" for the PDF download).
--   * sensitive_access_log is append-only: admins read it, nobody can edit or delete it through
--     the app, and rows outlive the file they point at.
-- Admin corrections to a signed application are made in the SQL editor, as before.
-- Safe to run again.

create table if not exists public.sensitive_access_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_email text,
  application_id uuid references public.applications (id) on delete set null,
  action text not null check (action in ('reveal_ssn', 'application_pdf'))
);
create index if not exists sensitive_access_log_application_idx
  on public.sensitive_access_log (application_id, occurred_at desc);

alter table public.sensitive_access_log enable row level security;
revoke all on public.sensitive_access_log from anon, authenticated;
grant select on public.sensitive_access_log to authenticated;
grant all on public.sensitive_access_log to service_role;

drop policy if exists "Admins read the access log" on public.sensitive_access_log;
create policy "Admins read the access log" on public.sensitive_access_log
  for select to authenticated
  using ((select public.has_role('admin')));

-- An admin, or the rep the file is assigned to. Unassigned files are admin-only.
create or replace function public.can_see_application_details(_application_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.has_role('admin')
    or (
      public.is_staff()
      and exists (
        select 1 from public.applications a
        where a.id = _application_id
          and a.rep_slug is not null
          and a.rep_slug = public.current_rep_slug()
      )
    );
$$;

-- One owner with the SSN cut to its last four and the date of birth hidden. An SSN that is not
-- nine digits yet comes back empty, so the staff screen still lists it as missing.
create or replace function public.mask_owner(_owner jsonb)
returns jsonb
language sql immutable
set search_path = public
as $$
  select _owner || jsonb_build_object(
    'ssn', case
      when length(regexp_replace(coalesce(_owner ->> 'ssn', ''), '\D', '', 'g')) = 9
        then '***-**-' || right(regexp_replace(_owner ->> 'ssn', '\D', '', 'g'), 4)
      else '' end,
    'dob', case when coalesce(_owner ->> 'dob', '') <> '' then '**/**/****' else '' end
  );
$$;

create or replace function public.staff_application_details(_application_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  r public.application_details;
begin
  if not public.can_see_application_details(_application_id) then
    raise exception 'the full application is visible to admins and the assigned rep'
      using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.application_details where application_id = _application_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'business', r.business,
    'owners', coalesce(
      (select jsonb_agg(public.mask_owner(o.value) order by o.ordinality)
       from jsonb_array_elements(r.owners) with ordinality as o),
      '[]'::jsonb),
    'balances', r.balances,
    'request', r.request,
    'signed_name', r.signed_name,
    'signed_at', r.signed_at
  );
end;
$$;

create or replace function public.reveal_application_details(
  _application_id uuid,
  _purpose text default 'reveal_ssn'
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  r public.application_details;
begin
  if _purpose is null or _purpose not in ('reveal_ssn', 'application_pdf') then
    raise exception 'unknown purpose' using errcode = 'invalid_parameter_value';
  end if;
  if not public.can_see_application_details(_application_id) then
    raise exception 'the full application is visible to admins and the assigned rep'
      using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.application_details where application_id = _application_id;
  if not found then
    return null;
  end if;
  insert into public.sensitive_access_log (actor_user_id, actor_email, application_id, action)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          _application_id, _purpose);
  return jsonb_build_object(
    'business', r.business,
    'owners', r.owners,
    'balances', r.balances,
    'request', r.request,
    'signed_name', r.signed_name,
    'signed_at', r.signed_at
  );
end;
$$;

-- Supabase grants every new function to public and anon; these are for signed-in staff only.
revoke all on function public.can_see_application_details(uuid) from public, anon;
revoke all on function public.mask_owner(jsonb) from public, anon, authenticated;
revoke all on function public.staff_application_details(uuid) from public, anon;
revoke all on function public.reveal_application_details(uuid, text) from public, anon;
grant execute on function public.can_see_application_details(uuid) to authenticated;
grant execute on function public.staff_application_details(uuid) to authenticated;
grant execute on function public.reveal_application_details(uuid, text) to authenticated;

-- Staff stop reading the table itself; the two functions above are now the only staff way in.
drop policy if exists "Staff read application details" on public.application_details;
