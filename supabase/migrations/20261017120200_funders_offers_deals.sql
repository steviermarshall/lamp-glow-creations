-- Lamp database v2, part 3 of 4: funders, submissions, offers, deals.
--
-- funders is the private lender table (build plan section 6). A submission is one
-- application sent to one funder. An offer is what came back, written the way funders
-- write them (amount, payback, fees, payment frequency, number of payments), the same
-- shape as src/lib/offer-check.ts. A deal is a funded offer plus the commission ledger
-- (build plan section 1: deal sheet and owed-vs-paid log).

create type public.funder_type as enum ('direct', 'iso', 'bank', 'other');
create type public.payment_frequency as enum ('daily', 'weekly', 'biweekly', 'monthly');

create table public.funders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.funder_type not null default 'direct',
  paper_grades text[] not null default '{}',
  min_amount numeric(14, 2) check (min_amount is null or min_amount >= 0),
  max_amount numeric(14, 2) check (max_amount is null or max_amount >= 0),
  min_months_in_business integer check (min_months_in_business is null or min_months_in_business >= 0),
  min_monthly_deposits numeric(14, 2) check (min_monthly_deposits is null or min_monthly_deposits >= 0),
  min_credit_score integer check (min_credit_score is null or (min_credit_score between 300 and 850)),
  max_positions integer check (max_positions is null or max_positions >= 0),
  industries_excluded text[] not null default '{}',
  states_excluded text[] not null default '{}',
  contact_name text,
  contact_email text,
  contact_phone text,
  submission_email text,
  portal_url text,
  commission_points numeric(5, 2) check (commission_points is null or commission_points >= 0),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funders_name_unique unique (name),
  constraint funders_amount_range check (min_amount is null or max_amount is null or min_amount <= max_amount)
);
create index funders_active_idx on public.funders (active, name);

create trigger update_funders_updated_at
  before update on public.funders
  for each row execute function public.update_updated_at_column();

alter table public.funders enable row level security;
grant select, insert, update, delete on public.funders to authenticated;
grant all on public.funders to service_role;

create policy "Staff read funders" on public.funders
  for select to authenticated using ((select public.is_staff()));
create policy "Admins manage funders" on public.funders
  for all to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));

-- ---------- Submissions ----------
create type public.submission_status as enum ('submitted', 'declined', 'offer', 'withdrawn', 'expired');

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  funder_id uuid not null references public.funders (id) on delete restrict,
  submitted_by uuid references auth.users (id) on delete set null,
  status public.submission_status not null default 'submitted',
  decline_reason text,
  notes text,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, funder_id)
);
create index submissions_funder_idx on public.submissions (funder_id, submitted_at desc);
create index submissions_open_idx on public.submissions (application_id) where status = 'submitted';

create trigger update_submissions_updated_at
  before update on public.submissions
  for each row execute function public.update_updated_at_column();

alter table public.submissions enable row level security;
grant select, insert, update on public.submissions to authenticated;
grant all on public.submissions to service_role;

create policy "Staff read submissions" on public.submissions
  for select to authenticated using ((select public.is_staff()));
create policy "Staff create submissions" on public.submissions
  for insert to authenticated
  with check ((select public.is_staff()) and submitted_by = (select auth.uid()));
create policy "Staff update submissions" on public.submissions
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

-- ---------- Offers ----------
create type public.offer_status as enum ('received', 'presented', 'accepted', 'declined', 'expired', 'withdrawn');

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  funder_id uuid not null references public.funders (id) on delete restrict,
  submission_id uuid references public.submissions (id) on delete set null,
  amount numeric(14, 2) not null check (amount > 0),
  payback numeric(14, 2) not null check (payback >= amount),
  fees numeric(14, 2) not null default 0 check (fees >= 0),
  frequency public.payment_frequency not null,
  payments integer not null check (payments >= 1),
  -- Derived the way the Offer Check page derives them, so the merchant sees the same numbers.
  factor_rate numeric(8, 4) generated always as (round(payback / amount, 4)) stored,
  payment numeric(14, 2) generated always as (round(payback / payments, 2)) stored,
  received_net numeric(14, 2) generated always as (amount - fees) stored,
  status public.offer_status not null default 'received',
  presented_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  notes text,
  terms jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offers_fees_lte_amount check (fees <= amount)
);
create index offers_application_idx on public.offers (application_id, created_at desc);
create index offers_funder_idx on public.offers (funder_id, created_at desc);
create unique index offers_one_accepted_per_application on public.offers (application_id) where status = 'accepted';

create trigger update_offers_updated_at
  before update on public.offers
  for each row execute function public.update_updated_at_column();

-- Stamp the status dates and keep the timeline in step.
create or replace function public.offers_status_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  k public.event_kind;
begin
  if tg_op = 'INSERT' then
    insert into public.events (application_id, actor_user_id, kind, payload)
    values (new.application_id, auth.uid(), 'offer_received',
            jsonb_build_object('offer_id', new.id, 'funder_id', new.funder_id, 'amount', new.amount));
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'presented' and new.presented_at is null then new.presented_at := now(); end if;
    if new.status = 'accepted' and new.accepted_at is null then new.accepted_at := now(); end if;
    if new.status = 'declined' and new.declined_at is null then new.declined_at := now(); end if;
    k := case new.status
      when 'presented' then 'offer_presented'::public.event_kind
      when 'accepted' then 'offer_accepted'::public.event_kind
      when 'declined' then 'offer_declined'::public.event_kind
      else null end;
    if k is not null then
      insert into public.events (application_id, actor_user_id, kind, payload, visible_to_merchant)
      values (new.application_id, auth.uid(), k,
              jsonb_build_object('offer_id', new.id, 'funder_id', new.funder_id, 'amount', new.amount),
              new.status <> 'declined');
    end if;
  end if;
  return new;
end;
$$;

create trigger offers_after_insert
  after insert on public.offers
  for each row execute function public.offers_status_change();
create trigger offers_before_update
  before update on public.offers
  for each row execute function public.offers_status_change();

alter table public.offers enable row level security;
grant select, insert, update on public.offers to authenticated;
grant all on public.offers to service_role;

-- Merchants see an offer once a rep has presented it; never the raw 'received' ones.
create policy "Merchants read presented offers" on public.offers
  for select to authenticated
  using (
    status <> 'received'
    and application_id in (select id from public.applications where user_id = (select auth.uid()))
  );
create policy "Staff read offers" on public.offers
  for select to authenticated using ((select public.is_staff()));
create policy "Staff add offers" on public.offers
  for insert to authenticated
  with check ((select public.is_staff()) and created_by = (select auth.uid()));
create policy "Staff update offers" on public.offers
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

-- The one thing a merchant may do to an offer: accept it. A function, not an update
-- policy, so the rules (presented, not expired, one accepted per file) live in one place.
create or replace function public.accept_offer(_offer_id uuid)
returns public.offers
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
     and not public.is_staff(uid) then
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
  return o;
end;
$$;
revoke all on function public.accept_offer(uuid) from public;
grant execute on function public.accept_offer(uuid) to authenticated, service_role;

-- ---------- Deals and the commission ledger ----------
create type public.deal_status as enum ('funded', 'paid_off', 'renewed', 'defaulted');

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications (id) on delete restrict,
  offer_id uuid not null unique references public.offers (id) on delete restrict,
  funder_id uuid not null references public.funders (id) on delete restrict,
  rep_slug text references public.reps (slug) on delete set null,
  funded_on date not null default current_date,
  funded_amount numeric(14, 2) not null check (funded_amount > 0),
  payback numeric(14, 2) not null check (payback >= funded_amount),
  commission_points numeric(5, 2) check (commission_points is null or commission_points >= 0),
  commission_due numeric(14, 2) check (commission_due is null or commission_due >= 0),
  status public.deal_status not null default 'funded',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deals_rep_idx on public.deals (rep_slug, funded_on desc);
create index deals_funder_idx on public.deals (funder_id, funded_on desc);
create index deals_funded_on_idx on public.deals (funded_on desc);

create trigger update_deals_updated_at
  before update on public.deals
  for each row execute function public.update_updated_at_column();

-- Funding a deal moves the application to funded and logs it.
create or replace function public.deals_after_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update public.applications set status = 'funded' where id = new.application_id and status <> 'funded';
  insert into public.events (application_id, actor_user_id, kind, payload, visible_to_merchant)
  values (new.application_id, auth.uid(), 'funded',
          jsonb_build_object('deal_id', new.id, 'funded_amount', new.funded_amount), true);
  return new;
end;
$$;

create trigger deals_after_insert
  after insert on public.deals
  for each row execute function public.deals_after_insert();

alter table public.deals enable row level security;
grant select, insert, update on public.deals to authenticated;
grant all on public.deals to service_role;

create policy "Admins read all deals" on public.deals
  for select to authenticated using ((select public.has_role('admin')));
create policy "Reps read own deals" on public.deals
  for select to authenticated using (rep_slug = (select public.current_rep_slug()));
create policy "Admins manage deals" on public.deals
  for all to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));

create type public.ledger_kind as enum ('owed', 'paid', 'clawback', 'adjustment');

create table public.commission_entries (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  kind public.ledger_kind not null,
  amount numeric(14, 2) not null,
  entry_date date not null default current_date,
  counterparty text,
  reference text,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index commission_entries_deal_idx on public.commission_entries (deal_id, entry_date desc);

alter table public.commission_entries enable row level security;
grant select, insert, update, delete on public.commission_entries to authenticated;
grant all on public.commission_entries to service_role;

create policy "Admins manage ledger" on public.commission_entries
  for all to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));
create policy "Reps read own ledger" on public.commission_entries
  for select to authenticated
  using (deal_id in (select id from public.deals where rep_slug = (select public.current_rep_slug())));
