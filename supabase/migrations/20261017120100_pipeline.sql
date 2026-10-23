-- Lamp database v2, part 2 of 4: the pipeline.
--
-- A merchant has one or more applications. An application moves through stages, is
-- assigned to a rep, carries documents, and leaves a timeline of events. Everything a
-- rep or the deals@ automation does lands in events, so the CRM board and the audit
-- trail are the same table.

-- ---------- Stages ----------
-- Superset of the five statuses the app already uses, so nothing in the site changes.
create type public.application_stage as enum (
  'new',            -- answers saved, nothing else yet
  'reviewing',      -- a rep has the file
  'docs_needed',    -- waiting on statements or ID
  'submitted',      -- sent to one or more funders
  'offers_ready',   -- at least one offer presented to the merchant
  'accepted',       -- merchant picked an offer
  'closing',        -- funder's closing tasks in progress
  'funded',         -- money out
  'declined',       -- no funder would take it
  'withdrawn',      -- merchant walked
  'closed'          -- archived
);

-- The insert policy from the first migration references status, so it is recreated
-- around the type change with the same rule.
drop policy "Users create own applications" on public.applications;
alter table public.applications
  alter column status drop default;
alter table public.applications
  drop constraint if exists applications_status_check;
alter table public.applications
  alter column status type public.application_stage using status::public.application_stage;
alter table public.applications
  alter column status set default 'new';
create policy "Users create own applications" on public.applications
  for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'new');

-- ---------- Businesses ----------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  legal_name text,
  dba text,
  entity_type text,
  industry text,
  state char(2),
  zip text check (zip ~ '^[0-9]{5}(-[0-9]{4})?$'),
  started_on date,
  monthly_deposits numeric(14, 2) check (monthly_deposits is null or monthly_deposits >= 0),
  website text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index businesses_owner_idx on public.businesses (owner_user_id);

create trigger update_businesses_updated_at
  before update on public.businesses
  for each row execute function public.update_updated_at_column();

alter table public.businesses enable row level security;
grant select, insert, update on public.businesses to authenticated;
grant all on public.businesses to service_role;

create policy "Owners read own businesses" on public.businesses
  for select to authenticated using (owner_user_id = (select auth.uid()));
create policy "Owners create own businesses" on public.businesses
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy "Owners update own businesses" on public.businesses
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy "Staff read all businesses" on public.businesses
  for select to authenticated using ((select public.is_staff()));
create policy "Staff update all businesses" on public.businesses
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

-- ---------- Applications: new columns ----------
alter table public.applications
  add column business_id uuid references public.businesses (id) on delete set null,
  add column rep_slug text references public.reps (slug) on delete set null,
  add column source_rep_slug text references public.reps (slug) on delete set null,
  add column amount_requested numeric(14, 2) check (amount_requested is null or amount_requested > 0),
  add column purpose text,
  add column phone_consent_at timestamptz,
  add column phone_consent_text text,
  add column assigned_at timestamptz,
  add column submitted_at timestamptz,
  add column funded_at timestamptz,
  add column closed_at timestamptz,
  add column decline_reason text,
  add column staff_notes text;

-- Backfill the rep tag the site already writes into utm.ref.
update public.applications a
set source_rep_slug = r.slug, rep_slug = coalesce(a.rep_slug, r.slug)
from public.reps r
where lower(a.utm ->> 'ref') = r.slug and a.source_rep_slug is null;

create index applications_rep_stage_idx on public.applications (rep_slug, status, created_at desc);
create index applications_stage_created_idx on public.applications (status, created_at desc);
create index applications_business_idx on public.applications (business_id);
create index applications_email_idx on public.applications (lower(email));
create index applications_user_created_idx on public.applications (user_id, created_at desc);

-- ---------- Events (timeline + audit + CRM activity) ----------
create type public.event_kind as enum (
  'stage_change',
  'assigned',
  'note',
  'call',
  'email',
  'sms',
  'meeting',
  'document_uploaded',
  'document_reviewed',
  'submitted_to_funder',
  'offer_received',
  'offer_presented',
  'offer_accepted',
  'offer_declined',
  'funded',
  'system'
);

create table public.events (
  id bigint generated always as identity primary key,
  application_id uuid references public.applications (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  kind public.event_kind not null,
  from_stage public.application_stage,
  to_stage public.application_stage,
  body text,
  payload jsonb not null default '{}'::jsonb,
  visible_to_merchant boolean not null default false,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint events_has_subject check (application_id is not null or lead_id is not null)
);
create index events_application_idx on public.events (application_id, occurred_at desc);
create index events_lead_idx on public.events (lead_id, occurred_at desc);
create index events_actor_idx on public.events (actor_user_id, occurred_at desc);
create index events_kind_idx on public.events (kind, occurred_at desc);

alter table public.events enable row level security;
grant select, insert on public.events to authenticated;
grant all on public.events to service_role;

create policy "Merchants read visible events on own applications" on public.events
  for select to authenticated
  using (
    visible_to_merchant
    and application_id in (
      select id from public.applications where user_id = (select auth.uid())
    )
  );
create policy "Staff read all events" on public.events
  for select to authenticated using ((select public.is_staff()));
create policy "Staff log events" on public.events
  for insert to authenticated
  with check ((select public.is_staff()) and actor_user_id = (select auth.uid()));

-- ---------- Application triggers ----------
-- Before insert: tag the rep from the link, auto-assign to that rep.
create or replace function public.applications_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ref_slug text := lower(new.utm ->> 'ref');
begin
  if new.source_rep_slug is null and ref_slug is not null
     and exists (select 1 from public.reps where slug = ref_slug and active) then
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

create trigger applications_before_insert
  before insert on public.applications
  for each row execute function public.applications_before_insert();

-- Before update: merchants may only edit their own answers and contact details.
-- Stage, assignment and staff notes move only by staff or the server.
create or replace function public.applications_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- current_user, not the role setting: inside a security definer function such as
  -- accept_offer the function owner is acting, and the guard must step aside.
  if current_user = 'authenticated' and not public.is_staff() then
    if new.status is distinct from old.status
       or new.rep_slug is distinct from old.rep_slug
       or new.source_rep_slug is distinct from old.source_rep_slug
       or new.staff_notes is distinct from old.staff_notes
       or new.decline_reason is distinct from old.decline_reason
       or new.user_id is distinct from old.user_id then
      raise exception 'merchants cannot change stage, assignment or staff fields'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.rep_slug is distinct from old.rep_slug then
    new.assigned_at := case when new.rep_slug is null then null else now() end;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'submitted' and new.submitted_at is null then new.submitted_at := now(); end if;
    if new.status = 'funded' and new.funded_at is null then new.funded_at := now(); end if;
    if new.status in ('declined', 'withdrawn', 'closed') and new.closed_at is null then new.closed_at := now(); end if;
  end if;
  return new;
end;
$$;

create trigger applications_before_update
  before update on public.applications
  for each row execute function public.applications_before_update();

-- After update: every stage change and reassignment lands on the timeline.
create or replace function public.applications_after_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.events (application_id, actor_user_id, kind, from_stage, to_stage, visible_to_merchant)
    values (new.id, auth.uid(), 'stage_change', old.status, new.status, true);
  end if;
  if new.rep_slug is distinct from old.rep_slug then
    insert into public.events (application_id, actor_user_id, kind, payload)
    values (new.id, auth.uid(), 'assigned', jsonb_build_object('from', old.rep_slug, 'to', new.rep_slug));
  end if;
  return new;
end;
$$;

create trigger applications_after_update
  after update on public.applications
  for each row execute function public.applications_after_update();

-- ---------- Applications: policies for staff and merchant updates ----------
grant update on public.applications to authenticated;

-- Reps see what is theirs plus the unassigned pool; admins see everything.
create policy "Staff read pipeline" on public.applications
  for select to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and (rep_slug = (select public.current_rep_slug()) or rep_slug is null)
    )
  );
create policy "Staff work pipeline" on public.applications
  for update to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_staff())
      and (rep_slug = (select public.current_rep_slug()) or rep_slug is null)
    )
  )
  with check ((select public.is_staff()));
-- Merchants may edit their own file; the before-update trigger limits which columns.
create policy "Users update own applications" on public.applications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- Documents ----------
-- Files stay in the private "documents" bucket under <user_id>/<file>; this table is
-- the index the rep board and the deals@ automation read.
create type public.document_kind as enum ('bank_statement', 'id', 'voided_check', 'tax_return', 'other');
create type public.document_status as enum ('received', 'accepted', 'rejected');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null default 'documents',
  storage_path text not null,
  kind public.document_kind not null default 'other',
  status public.document_status not null default 'received',
  original_name text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  mime_type text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, storage_path)
);
create index documents_application_idx on public.documents (application_id, created_at desc);
create index documents_user_idx on public.documents (user_id);
create index documents_status_idx on public.documents (status) where status = 'received';

create trigger update_documents_updated_at
  before update on public.documents
  for each row execute function public.update_updated_at_column();

alter table public.documents enable row level security;
grant select, insert, update, delete on public.documents to authenticated;
grant all on public.documents to service_role;

create policy "Users read own documents" on public.documents
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users add own documents" on public.documents
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
    and application_id in (select id from public.applications where user_id = (select auth.uid()))
  );
create policy "Users remove own unreviewed documents" on public.documents
  for delete to authenticated
  using (user_id = (select auth.uid()) and status = 'received');
create policy "Staff read all documents" on public.documents
  for select to authenticated using ((select public.is_staff()));
create policy "Staff review documents" on public.documents
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

-- Staff can open any file in the documents bucket; merchants keep their own folder.
create policy "Staff read all files" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (select public.is_staff()));
