-- Two more holes that were already open on main (2026-10-28).
--
-- 1. Merchants could read the whole funders row. "Merchants read funder names on their offers"
--    let a merchant who was shown an offer read every column of that funder through the API:
--    Lamp's commission_points, the submission email, the contact's name, email and phone, the
--    portal and the notes. The account page needs only the name, which it reads from my_offers.
--    my_offers now takes the name from offer_funder_name(), which gives the name and nothing
--    else, and only for an offer the caller may see. The rule is dropped, so merchants read no
--    funders rows at all. Staff read funders as before.
-- 2. Merchants could read the rep's offer notes. "Merchants read presented offers" returns every
--    column of an offer, and offers.notes holds the "Note (optional)" from Add an offer on the
--    staff file. Offer notes move to their own table, offer_internal_notes, which only staff who
--    can see the file can read and write: the same people who work its offers. The column is
--    emptied and stays empty. A page still open from before Publish that saves an offer with a
--    note has the note moved into the table instead; it never drops a note already stored.
--    accept_offer() returned the whole offer row as well; it now returns only the offer's id,
--    file, status and when it was accepted (the account page reads none of it).
--
-- Order: merge and Publish first (the staff file keeps using the old column until this runs),
-- then paste this. Safe to run again.
--
-- It runs as three short transactions. Part 1 first waits for any change to an offer already
-- under way (a merchant accepting, a rep presenting) to finish, then holds changes to offers for
-- the few milliseconds it takes; reading offers carries on. Part 2 swaps my_offers and part 3
-- drops the funders rule, each waiting only for reads of that view or table in progress. If it
-- stops on a lock timeout, paste it again.

set lock_timeout = '5s';

do $$
begin
  perform 'public.rep_can_see_application(uuid)'::regprocedure;
  perform 'public.is_staff(uuid)'::regprocedure;
  perform 'public.has_role(public.app_role, uuid)'::regprocedure;
exception when undefined_function or undefined_object then
  raise exception 'Run 20261019160000_rep_scope.sql before this one.';
end;
$$;

-- ---------- 1. Offer notes, staff only ----------
begin;
-- Taken first, so nothing that has locked an offer's row (accept_offer) can end up waiting on
-- this part while this part waits on it.
lock table public.offers in exclusive mode;

create table if not exists public.offer_internal_notes (
  offer_id uuid primary key references public.offers (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 100000),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

-- Who saved it and when are stamped here, never taken from the request.
create or replace function public.offer_internal_notes_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.offer_id is distinct from old.offer_id then
    raise exception 'a note stays on its offer' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  if current_user = 'authenticated' then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
revoke all on function public.offer_internal_notes_stamp() from public, anon, authenticated;

create or replace trigger offer_internal_notes_stamp
  before insert or update on public.offer_internal_notes
  for each row execute function public.offer_internal_notes_stamp();

alter table public.offer_internal_notes enable row level security;
revoke all on public.offer_internal_notes from public, anon, authenticated;
grant select, insert, update, delete on public.offer_internal_notes to authenticated;
grant all on public.offer_internal_notes to service_role;

-- The same people as the offer's own rules ("Staff read offers", "Staff update offers"): an
-- admin, or staff on their own or an unassigned file.
drop policy if exists "Staff read offer notes" on public.offer_internal_notes;
create policy "Staff read offer notes" on public.offer_internal_notes
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and exists (
      select 1 from public.offers o
      where o.id = offer_internal_notes.offer_id and public.rep_can_see_application(o.application_id)))
  );
drop policy if exists "Staff add offer notes" on public.offer_internal_notes;
create policy "Staff add offer notes" on public.offer_internal_notes
  for insert to authenticated
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and exists (
      select 1 from public.offers o
      where o.id = offer_internal_notes.offer_id and public.rep_can_see_application(o.application_id)))
  );
drop policy if exists "Staff change offer notes" on public.offer_internal_notes;
create policy "Staff change offer notes" on public.offer_internal_notes
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and exists (
      select 1 from public.offers o
      where o.id = offer_internal_notes.offer_id and public.rep_can_see_application(o.application_id)))
  )
  with check (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and exists (
      select 1 from public.offers o
      where o.id = offer_internal_notes.offer_id and public.rep_can_see_application(o.application_id)))
  );
drop policy if exists "Staff clear offer notes" on public.offer_internal_notes;
create policy "Staff clear offer notes" on public.offer_internal_notes
  for delete to authenticated
  using (
    (select public.has_role('admin'))
    or ((select public.is_staff()) and exists (
      select 1 from public.offers o
      where o.id = offer_internal_notes.offer_id and public.rep_can_see_application(o.application_id)))
  );

-- Every note written so far moves over. The lock above holds every write to offers until this
-- part commits, so no note can be saved between this copy and the clear below. If a note is
-- already stored for an offer (a run interrupted half way), the two are kept together.
insert into public.offer_internal_notes as n (offer_id, body, updated_by)
select o.id, o.notes, null
from public.offers o
where o.notes is not null and btrim(o.notes) <> ''
on conflict (offer_id) do update
  set body = case
    when position(excluded.body in n.body) > 0 then n.body
    when position(n.body in excluded.body) > 0 then excluded.body
    else n.body || E'\n\n' || excluded.body
  end;

-- Clearing it runs the update triggers on those offers: updated_at moves to now; nothing goes
-- on the timeline (offers_status_change only writes status changes).
update public.offers set notes = null where notes is not null;

-- From now on the column stays empty. A note saved into it lands in the table, as the caller,
-- so the table's rules decide (merchants can't add or change offers at all), and it never drops
-- stored text: it replaces the stored note when it contains all of it, is dropped when the
-- stored note already contains it, and is added after it otherwise. A new offer's note moves
-- once the offer is in (after insert: the note's row points at the offer).
create or replace function public.offers_notes_moved()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  moved integer;
begin
  if new.notes is null then
    return new;
  end if;
  if btrim(new.notes) <> '' then
    insert into public.offer_internal_notes as n (offer_id, body)
    values (new.id, new.notes)
    on conflict (offer_id) do update
      set body = case
        when position(excluded.body in n.body) > 0 then n.body
        when position(n.body in excluded.body) > 0 then excluded.body
        else n.body || E'\n\n' || excluded.body
      end;
  end if;
  if tg_op = 'INSERT' then
    update public.offers set notes = null where id = new.id;
    get diagnostics moved = row_count;
    if moved <> 1 then
      raise exception 'the offer''s note could not be moved to offer_internal_notes'
        using errcode = 'insufficient_privilege';
    end if;
    return null;
  end if;
  new.notes := null;
  return new;
end;
$$;
revoke all on function public.offers_notes_moved() from public, anon, authenticated;

create or replace trigger offers_notes_moved_on_insert
  after insert on public.offers
  for each row when (new.notes is not null)
  execute function public.offers_notes_moved();
create or replace trigger offers_notes_moved
  before update of notes on public.offers
  for each row execute function public.offers_notes_moved();

comment on column public.offers.notes is
  'Retired 2026-10-28, always empty: merchants can read this row. Offer notes live in offer_internal_notes (offers_notes_moved).';

-- Same rules as 20261019170000 (the merchant who owns the file, or an admin; presented and not
-- expired; the others on the file declined). Only the return changes, which needs a new function.
drop function if exists public.accept_offer(uuid);
create function public.accept_offer(_offer_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  o public.offers;
  uid uuid := auth.uid();
begin
  select * into o from public.offers where id = _offer_id for update;
  if o.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.applications where id = o.application_id and user_id = uid)
     and not public.has_role('admin', uid) then
    raise exception 'not your offer' using errcode = 'insufficient_privilege';
  end if;
  if o.status <> 'presented' then
    raise exception 'offer is % and cannot be accepted', o.status using errcode = 'check_violation';
  end if;
  if o.expires_at is not null and o.expires_at < now() then
    raise exception 'offer has expired' using errcode = 'check_violation';
  end if;

  update public.offers set status = 'declined'
  where application_id = o.application_id and id <> o.id and status = 'presented';
  update public.offers set status = 'accepted' where id = o.id returning * into o;
  update public.applications set status = 'accepted' where id = o.application_id and status <> 'accepted';
  return jsonb_build_object(
    'id', o.id, 'application_id', o.application_id, 'status', o.status, 'accepted_at', o.accepted_at);
end;
$$;
revoke all on function public.accept_offer(uuid) from public, anon;
grant execute on function public.accept_offer(uuid) to authenticated, service_role;
commit;

-- ---------- 2. The funder's name, and nothing else, on the merchant's offers ----------
begin;
-- my_offers runs as the caller, so this runs as its owner to read the name. It answers only for
-- an offer the caller may see: the merchant whose file it is once it is presented, or staff.
-- The server (service role) and the SQL editor get every name, as they did before.
create or replace function public.offer_funder_name(_offer_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select f.name
  from public.offers o
  join public.funders f on f.id = o.funder_id
  where o.id = _offer_id
    and (
      current_setting('role') in ('service_role', 'none')
      or public.is_staff()
      or (o.status <> 'received'
          and exists (select 1 from public.applications a
                      where a.id = o.application_id and a.user_id = auth.uid()))
    )
$$;
revoke all on function public.offer_funder_name(uuid) from public, anon;
grant execute on function public.offer_funder_name(uuid) to authenticated, service_role;

-- The same columns as 20261017120300, in the same order; only where the name comes from changes.
create or replace view public.my_offers
with (security_invoker = true)
as
select
  o.id,
  o.application_id,
  public.offer_funder_name(o.id) as funder_name,
  o.amount,
  o.payback,
  o.fees,
  o.received_net,
  o.factor_rate,
  o.frequency,
  o.payments,
  o.payment,
  o.status,
  o.presented_at,
  o.accepted_at,
  o.expires_at,
  o.terms
from public.offers o
where o.status <> 'received';
commit;

-- ---------- 3. Merchants read no funders rows ----------
-- Only after my_offers stops needing it.
begin;
drop policy if exists "Merchants read funder names on their offers" on public.funders;
commit;

reset lock_timeout;
