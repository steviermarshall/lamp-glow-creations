-- Offers a rep never showed stay hidden from the merchant (2026-11-03).
--
-- "Merchants read presented offers" let a merchant read every offer on their file that wasn't
-- 'received'. An offer a rep withdrew (or marked declined or expired) without ever showing it is
-- not 'received' either, so the merchant could read it through the API: the amount, the terms,
-- and through my_offers and offer_funder_name() the funder. The account page lists only presented
-- and accepted offers, so it never showed them; the API did. From now on a merchant sees an offer
-- once a rep has shown it: it is presented or accepted, or it was presented before (presented_at,
-- stamped by offers_status_change) and has since been declined, withdrawn or expired. The offers
-- rule, my_offers and offer_funder_name() all use that test.
--
-- Also:
--   * add_offer() saves an offer and its note in one go, so Add an offer can no longer save the
--     offer and lose its note. It runs as the caller: the offers and offer_internal_notes rules
--     decide, exactly as for the two writes it replaces.
--   * my_offers keeps only read rights. It became writable through when 20261029120100 stopped
--     joining funders (writes still met the offers rules); visitors now have no rights on it.
--
-- Order: merge, paste this, then Publish (the staff page calls add_offer()). The page live now
-- keeps working before and after. Safe to run again.
--
-- Two short transactions. Part 1 swaps my_offers and waits only for reads of it in progress.
-- Part 2 changes the offers rule: it waits for reads and changes of offers already under way and
-- holds new ones for the few milliseconds it takes. If it stops on a lock timeout, paste it again.

set lock_timeout = '5s';

do $$
begin
  perform 'public.offer_funder_name(uuid)'::regprocedure;
  perform 'public.offer_internal_notes'::regclass;
exception when undefined_function or undefined_table then
  raise exception 'Run 20261029120100_funder_names_and_offer_notes.sql before this one.';
end;
$$;

-- ---------- 1. my_offers, the funder's name and adding an offer ----------
begin;
-- The same columns as 20261029120100, in the same order; only which offers it lists changes.
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
where o.status in ('presented', 'accepted') or (o.status <> 'received' and o.presented_at is not null);

-- (revoke all, then select back, keeps the word Lovable's editor stops on out of the paste)
revoke all on public.my_offers from anon, authenticated;
grant select on public.my_offers to authenticated, service_role;

-- As in 20261029120100, except the merchant gets the name only for an offer they were shown.
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
      or ((o.status in ('presented', 'accepted') or (o.status <> 'received' and o.presented_at is not null))
          and exists (select 1 from public.applications a
                      where a.id = o.application_id and a.user_id = auth.uid()))
    )
$$;
revoke all on function public.offer_funder_name(uuid) from public, anon;
grant execute on function public.offer_funder_name(uuid) to authenticated, service_role;

-- The offer and its note in one transaction, as the caller. A blank note saves no note.
create or replace function public.add_offer(
  _application_id uuid,
  _funder_id uuid,
  _submission_id uuid,
  _amount numeric,
  _payback numeric,
  _fees numeric,
  _frequency public.payment_frequency,
  _payments integer,
  _expires_at timestamptz,
  _note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.offers (application_id, funder_id, submission_id, amount, payback, fees,
                             frequency, payments, expires_at, created_by)
  values (_application_id, _funder_id, _submission_id, _amount, _payback, coalesce(_fees, 0),
          _frequency, _payments, _expires_at, auth.uid())
  returning id into new_id;
  if btrim(coalesce(_note, '')) <> '' then
    insert into public.offer_internal_notes (offer_id, body) values (new_id, _note);
  end if;
  return new_id;
end;
$$;
revoke all on function public.add_offer(uuid, uuid, uuid, numeric, numeric, numeric, public.payment_frequency, integer, timestamptz, text)
  from public, anon;
grant execute on function public.add_offer(uuid, uuid, uuid, numeric, numeric, numeric, public.payment_frequency, integer, timestamptz, text)
  to authenticated, service_role;
commit;

-- ---------- 2. The offers rule ----------
begin;
alter policy "Merchants read presented offers" on public.offers
  using (
    (status in ('presented', 'accepted') or (status <> 'received' and presented_at is not null))
    and application_id in (select id from public.applications where user_id = (select auth.uid()))
  );
commit;

reset lock_timeout;
