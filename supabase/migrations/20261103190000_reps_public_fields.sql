-- Visitors and merchants see only a rep's public fields (2026-11-03).
--
-- "Anyone reads active reps" gave visitors (anon) and everyone signed in (authenticated, which
-- merchants are too) the whole row of every active rep. With the public key alone,
-- /rest/v1/reps?select=slug,user_id,admin_slug listed each rep's sign-in id and who they report
-- to. The site never needs that outside the staff portal: rep links use the list in
-- src/lib/site.ts, and the server reads reps with the service role. From now on:
--   * visitors read slug, name, title, photo_url and active of active reps, and nothing else;
--   * merchants don't read reps directly. The account page gets the rep's name on the
--     application they're completing from rep_card(), which returns those same public fields of
--     one active rep;
--   * staff read every row and column as before ("Staff read all reps", "Admins manage reps"),
--     so the Dashboard, Team and the rest of the staff portal don't change;
--   * applications_before_insert() and leads_before_insert() check a link's ref through
--     rep_card() instead of reading reps as whoever is inserting. A merchant who signs up from a
--     rep's link still lands on that rep's book; without this they would land in the pool.
--
-- Order: merge, paste this, then Publish (the account page calls rep_card()). Either order is
-- safe: until both are done the account page just has no rep name, which it never prints. Safe
-- to run again.
--
-- Two short transactions, in this order so a sign-up running during the paste still lands with
-- its rep. Part 1 adds rep_card() and points the two triggers at it; it waits for no one and
-- changes nothing anyone sees. Part 2 changes who reads reps: it waits only for queries reading
-- reps right now (staff screens read it through current_rep_slug()) and holds new ones for the
-- few milliseconds it takes. If it stops on a lock timeout, paste the whole file again.

set lock_timeout = '5s';

-- ---------- 1. A rep's public card, and crediting the rep from a link ----------
begin;
-- Runs as its owner so a merchant (and the two triggers below, whoever inserts) can read the
-- public fields of an active rep without a rule on reps that would show them the whole row.
create or replace function public.rep_card(_slug text)
returns table (slug text, name text, title text, photo_url text)
language sql
stable
security definer
set search_path = public
as $$
  select r.slug, r.name, r.title, r.photo_url from public.reps r where r.slug = _slug and r.active;
$$;
revoke all on function public.rep_card(text) from public;
grant execute on function public.rep_card(text) to anon, authenticated, service_role;

-- As in 20261017120100, except the ref is checked through rep_card().
create or replace function public.applications_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ref_slug text := lower(new.utm ->> 'ref');
begin
  if new.source_rep_slug is null and ref_slug is not null
     and exists (select 1 from public.rep_card(ref_slug)) then
    new.source_rep_slug := ref_slug;
  end if;
  if new.rep_slug is null and new.source_rep_slug is not null then
    new.rep_slug := new.source_rep_slug;
    new.assigned_at := now();
  end if;
  if new.phone_consent_at is null and (new.answers ->> 'phoneConsent') is not null then
    new.phone_consent_at := now();
    new.phone_consent_text := new.answers ->> 'phoneConsent';
  end if;
  return new;
end;
$$;

-- As in 20261017120300, except the ref is checked through rep_card().
create or replace function public.leads_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ref_slug text := lower(new.utm ->> 'ref');
begin
  if new.rep_slug is null and ref_slug is not null
     and exists (select 1 from public.rep_card(ref_slug)) then
    new.rep_slug := ref_slug;
  end if;
  if new.source is null then
    new.source := coalesce(new.utm ->> 'utm_source', 'site');
  end if;
  return new;
end;
$$;
commit;

-- ---------- 2. Who reads reps ----------
begin;
lock table public.reps in access exclusive mode;
-- Only select changes. Revoking it table-wide also drops the column rights, so a second run ends
-- the same way. Signed-in people keep table-wide select: staff screens read user_id and
-- admin_slug, and the rules below decide which rows anyone else gets (none, for a merchant).
revoke select on public.reps from anon;
grant select (slug, name, title, photo_url, active) on public.reps to anon;

drop policy if exists "Anyone reads active reps" on public.reps;
drop policy if exists "Visitors read active reps" on public.reps;
create policy "Visitors read active reps" on public.reps
  for select to anon
  using (active);
commit;

reset lock_timeout;
notify pgrst, 'reload schema';
