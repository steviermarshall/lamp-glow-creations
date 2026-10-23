-- Lamp database v2, part 4 of 4: leads, and the views the rep board reads.

-- ---------- Leads ----------
alter table public.leads
  add column rep_slug text references public.reps (slug) on delete set null,
  add column phone text,
  add column source text,
  add column converted_application_id uuid references public.applications (id) on delete set null,
  add column converted_at timestamptz;

create index leads_email_idx on public.leads (lower(email), created_at desc);
create index leads_created_idx on public.leads (created_at desc);
create index leads_rep_idx on public.leads (rep_slug, created_at desc);
create index leads_unconverted_idx on public.leads (created_at desc) where converted_application_id is null;

create or replace function public.leads_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ref_slug text := lower(new.utm ->> 'ref');
begin
  if new.rep_slug is null and ref_slug is not null
     and exists (select 1 from public.reps where slug = ref_slug and active) then
    new.rep_slug := ref_slug;
  end if;
  if new.source is null then
    new.source := coalesce(new.utm ->> 'utm_source', 'site');
  end if;
  return new;
end;
$$;

create trigger leads_before_insert
  before insert on public.leads
  for each row execute function public.leads_before_insert();

-- When a lead's email signs up and files an application, mark the lead converted.
create or replace function public.applications_after_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.email is not null then
    update public.leads
    set converted_application_id = new.id, converted_at = now()
    where lower(email) = lower(new.email) and converted_application_id is null;
  end if;
  insert into public.events (application_id, actor_user_id, kind, to_stage, visible_to_merchant)
  values (new.id, auth.uid(), 'stage_change', new.status, true);
  return new;
end;
$$;

create trigger applications_after_insert
  after insert on public.applications
  for each row execute function public.applications_after_insert();

grant select, update, delete on public.leads to authenticated;

create policy "Staff read leads" on public.leads
  for select to authenticated using ((select public.is_staff()));
create policy "Staff update leads" on public.leads
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "Admins delete leads" on public.leads
  for delete to authenticated using ((select public.has_role('admin')));

-- ---------- Rep board ----------
-- security_invoker: the view runs as the caller, so the policies above still apply and
-- a rep sees only their own pipeline. One query per board load, no N+1.
create view public.pipeline_board
with (security_invoker = true)
as
select
  a.id,
  a.status,
  a.rep_slug,
  a.source_rep_slug,
  a.user_id,
  coalesce(a.business_name, b.legal_name, b.dba) as business_name,
  a.first_name,
  a.email,
  a.phone,
  a.amount_requested,
  a.answers ->> 'amount' as amount_bucket,
  a.answers ->> 'revenue' as revenue_bucket,
  a.answers ->> 'industry' as industry,
  a.answers ->> 'timeline' as timeline,
  a.utm ->> 'utm_source' as utm_source,
  a.utm ->> 'utm_campaign' as utm_campaign,
  a.created_at,
  a.updated_at,
  a.assigned_at,
  a.submitted_at,
  a.funded_at,
  (select count(*) from public.documents d where d.application_id = a.id) as document_count,
  (select count(*) from public.documents d where d.application_id = a.id and d.status = 'received') as documents_pending_review,
  (select count(*) from public.submissions s where s.application_id = a.id) as submission_count,
  (select count(*) from public.offers o where o.application_id = a.id and o.status <> 'received') as offers_presented,
  (select max(e.occurred_at) from public.events e where e.application_id = a.id) as last_activity_at,
  (select e.body from public.events e
     where e.application_id = a.id and e.kind in ('note', 'call', 'email', 'sms', 'meeting')
     order by e.occurred_at desc limit 1) as last_touch
from public.applications a
left join public.businesses b on b.id = a.business_id;

grant select on public.pipeline_board to authenticated, service_role;

-- What the merchant's account page can read in one call: the file, its visible timeline
-- and its presented offers, each already filtered by the policies.
create view public.my_offers
with (security_invoker = true)
as
select
  o.id,
  o.application_id,
  f.name as funder_name,
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
join public.funders f on f.id = o.funder_id
where o.status <> 'received';

grant select on public.my_offers to authenticated, service_role;

-- Merchants need the funder's name on an offer they were shown, nothing else about funders.
create policy "Merchants read funder names on their offers" on public.funders
  for select to authenticated
  using (
    id in (
      select o.funder_id from public.offers o
      join public.applications a on a.id = o.application_id
      where a.user_id = (select auth.uid()) and o.status <> 'received'
    )
  );
