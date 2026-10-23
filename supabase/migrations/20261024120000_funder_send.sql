-- Sending files to funders by email (2026-10-24).
--
-- What this adds:
--   1. funder_matches(): which active funders a file fits, from each funder's criteria. A rule
--      the file plainly fails is a blocker; a rule the file can't be judged on yet (a range
--      that straddles the minimum, a missing value) is a check for the rep, not a blocker.
--   2. The package and send record on submissions: how it went out, to which address, the
--      Gmail message id and the attachment names.
--   3. mailer_connections: the Gmail mailbox submissions go out from (partners@getlamp.app).
--      The refresh token is readable by the service role only (edge functions). Staff see
--      whether a mailbox is connected through mailer_status(), never the token.
--   4. funders.auto_send and a trigger that, once a file's package is ready, asks the
--      send-to-funders edge function to send it to every matched funder with auto_send on.
--      It does nothing until both Vault secrets below exist, and no funder starts with
--      auto_send on, so applying this migration sends nothing.
--
-- Run after 20261023120000_ssn_access_and_log.sql (PR 14): sending reuses its
-- can_see_application_details() rule, so only admins and the assigned rep can send a file.

do $$
begin
  perform 'public.can_see_application_details(uuid)'::regprocedure;
exception when undefined_function then
  raise exception 'Apply 20261023120000_ssn_access_and_log.sql (PR 14) before this migration.';
end;
$$;

-- 1. Funders: automatic sending is off until an admin turns it on per funder.
alter table public.funders add column if not exists auto_send boolean not null default false;

-- 2. Submissions: how each one went out.
alter table public.submissions
  add column if not exists sent_via text not null default 'manual',
  add column if not exists sent_to text,
  add column if not exists email_message_id text,
  add column if not exists attachments jsonb not null default '[]'::jsonb;

do $$
begin
  alter table public.submissions
    add constraint submissions_sent_via_check check (sent_via in ('manual', 'email', 'auto_email'));
exception when duplicate_object then null;
end;
$$;

-- 3. The sending mailbox. No policies: authenticated and anon get nothing at all.
create table if not exists public.mailer_connections (
  mailbox text primary key check (mailbox = lower(mailbox)),
  refresh_token text not null,
  scope text,
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now()
);
alter table public.mailer_connections enable row level security;
revoke all on public.mailer_connections from anon, authenticated;
grant all on public.mailer_connections to service_role;

-- One-time state values for the Google sign-in that connects the mailbox (10-minute life).
create table if not exists public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;
grant all on public.oauth_states to service_role;

create or replace function public.mailer_status()
returns table (mailbox text, connected_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.mailbox, m.connected_at
  from public.mailer_connections m
  where public.is_staff();
$$;
revoke all on function public.mailer_status() from public, anon;
grant execute on function public.mailer_status() to authenticated;

-- 4. Matching.
create or replace function public._num(_t text)
returns numeric
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(_t, ''), '[^0-9.]', '', 'g'), '')::numeric;
$$;
revoke all on function public._num(text) from public, anon, authenticated;

-- The matching itself, without an access check. Called by funder_matches() for staff and by
-- the service role (the edge function and the auto-send trigger).
create or replace function public._funder_matches(_application_id uuid)
returns table (
  funder_id uuid,
  funder_name text,
  submission_email text,
  auto_send boolean,
  already_sent boolean,
  eligible boolean,
  blockers text[],
  checks text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.applications;
  d public.application_details;
  dep_lo numeric; dep_hi numeric;
  tib_lo numeric; tib_hi numeric;
  fico_lo numeric; fico_hi numeric;
  amt_lo numeric; amt_hi numeric;
  v numeric;
  st text;
  ind text;
  pos int;
  f public.funders;
  b text[];
  c text[];
begin
  select * into a from public.applications where id = _application_id;
  if a.id is null then
    return;
  end if;
  select * into d from public.application_details where application_id = _application_id;

  -- Monthly deposits: the full application's figure, else the quick-apply bucket.
  v := public._num(d.business ->> 'monthly_revenue');
  if v is not null and v > 0 then
    dep_lo := v; dep_hi := v;
  else
    case a.answers ->> 'revenue'
      when 'lt-20k' then dep_lo := 0; dep_hi := 19999;
      when '20-50k' then dep_lo := 20000; dep_hi := 50000;
      when '50-100k' then dep_lo := 50000; dep_hi := 100000;
      when '100-250k' then dep_lo := 100000; dep_hi := 250000;
      when '250k-plus' then dep_lo := 250000; dep_hi := null;
      else null;
    end case;
  end if;

  -- Months in business: from the start date, else the bucket.
  if nullif(d.business ->> 'start_date', '') is not null then
    begin
      v := (extract(year from age(current_date, (d.business ->> 'start_date')::date)) * 12
            + extract(month from age(current_date, (d.business ->> 'start_date')::date)));
      tib_lo := v; tib_hi := v;
    exception when others then
      tib_lo := null; tib_hi := null;
    end;
  end if;
  if tib_lo is null then
    case a.answers ->> 'tib'
      when 'lt-6m' then tib_lo := 0; tib_hi := 5;
      when '6-12m' then tib_lo := 6; tib_hi := 12;
      when '1-2y' then tib_lo := 12; tib_hi := 24;
      when '2-5y' then tib_lo := 24; tib_hi := 60;
      when '5y-plus' then tib_lo := 60; tib_hi := null;
      else null;
    end case;
  end if;

  -- Credit: the lowest score any owner gave, else the bucket.
  select min(public._num(o ->> 'credit')) into v
  from jsonb_array_elements(coalesce(d.owners, '[]'::jsonb)) o
  where public._num(o ->> 'credit') between 300 and 850;
  if v is not null then
    fico_lo := v; fico_hi := v;
  else
    case a.answers ->> 'credit'
      when 'lt-550' then fico_lo := 300; fico_hi := 549;
      when '550-649' then fico_lo := 550; fico_hi := 649;
      when '650-699' then fico_lo := 650; fico_hi := 699;
      when '700-plus' then fico_lo := 700; fico_hi := 850;
      else null;
    end case;
  end if;

  -- Amount requested.
  v := coalesce(public._num(d.request ->> 'amount'), a.amount_requested);
  if v is not null and v > 0 then
    amt_lo := v; amt_hi := v;
  else
    case a.answers ->> 'amount'
      when 'lt-25k' then amt_lo := 0; amt_hi := 25000;
      when '25-50k' then amt_lo := 25000; amt_hi := 50000;
      when '50-100k' then amt_lo := 50000; amt_hi := 100000;
      when '100-250k' then amt_lo := 100000; amt_hi := 250000;
      when '250k-plus' then amt_lo := 250000; amt_hi := null;
      else null;
    end case;
  end if;

  st := upper(nullif(trim(d.business ->> 'state'), ''));
  ind := lower(coalesce(nullif(trim(d.business ->> 'industry'), ''), a.answers ->> 'industry'));

  -- Open positions: balances still owed on another advance.
  if d.application_id is not null then
    select count(*) into pos
    from jsonb_array_elements(coalesce(d.balances, '[]'::jsonb)) x
    where coalesce(public._num(x ->> 'current'), 0) > 0 or coalesce(public._num(x ->> 'payment'), 0) > 0;
  end if;

  for f in select * from public.funders where active order by name loop
    b := '{}';
    c := '{}';

    if f.submission_email is null or f.submission_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      b := array_append(b, ('no submission email on the funder')::text);
    end if;

    if f.min_monthly_deposits is not null then
      if dep_lo is null then
        c := array_append(c, (format('no monthly deposits on file (minimum $%s)', to_char(f.min_monthly_deposits, 'FM999,999,999')))::text);
      elsif dep_lo >= f.min_monthly_deposits then
        null;
      elsif dep_hi is not null and dep_hi < f.min_monthly_deposits then
        b := array_append(b, (format('deposits under the $%s monthly minimum', to_char(f.min_monthly_deposits, 'FM999,999,999')))::text);
      else
        c := array_append(c, (format('deposits may be under the $%s monthly minimum: check the statements', to_char(f.min_monthly_deposits, 'FM999,999,999')))::text);
      end if;
    end if;

    if f.min_months_in_business is not null then
      if tib_lo is null then
        c := array_append(c, (format('no time in business on file (minimum %s months)', f.min_months_in_business))::text);
      elsif tib_lo >= f.min_months_in_business then
        null;
      elsif tib_hi is not null and tib_hi < f.min_months_in_business then
        b := array_append(b, (format('under %s months in business', f.min_months_in_business))::text);
      else
        c := array_append(c, (format('may be under %s months in business', f.min_months_in_business))::text);
      end if;
    end if;

    if f.min_credit_score is not null then
      if fico_lo is null then
        c := array_append(c, (format('no credit score on file (minimum %s)', f.min_credit_score))::text);
      elsif fico_lo >= f.min_credit_score then
        null;
      elsif fico_hi is not null and fico_hi < f.min_credit_score then
        b := array_append(b, (format('credit under %s', f.min_credit_score))::text);
      else
        c := array_append(c, (format('credit may be under %s', f.min_credit_score))::text);
      end if;
    end if;

    if f.min_amount is not null and amt_hi is not null and amt_hi < f.min_amount then
      b := array_append(b, (format('asks for less than the $%s minimum', to_char(f.min_amount, 'FM999,999,999')))::text);
    end if;
    if f.max_amount is not null and amt_lo is not null and amt_lo > f.max_amount then
      b := array_append(b, (format('asks for more than the $%s maximum', to_char(f.max_amount, 'FM999,999,999')))::text);
    end if;

    if st is not null and exists (select 1 from unnest(f.states_excluded) s where upper(trim(s)) = st) then
      b := array_append(b, (format('does not fund in %s', st))::text);
    elsif st is null and coalesce(array_length(f.states_excluded, 1), 0) > 0 then
      c := array_append(c, ('no business state on file')::text);
    end if;

    if ind is not null and exists (
      select 1 from unnest(f.industries_excluded) x
      where length(trim(x)) > 0 and (ind like '%' || lower(trim(x)) || '%' or lower(trim(x)) like '%' || ind || '%')
    ) then
      b := array_append(b, (format('does not fund %s', ind))::text);
    end if;

    if f.max_positions is not null then
      if pos is null then
        c := array_append(c, (format('open positions unknown (maximum %s)', f.max_positions))::text);
      elsif pos > f.max_positions then
        b := array_append(b, (format('%s open positions, maximum %s', pos, f.max_positions))::text);
      end if;
    end if;

    funder_id := f.id;
    funder_name := f.name;
    submission_email := f.submission_email;
    auto_send := f.auto_send;
    already_sent := exists (
      select 1 from public.submissions s where s.application_id = _application_id and s.funder_id = f.id
    );
    eligible := coalesce(array_length(b, 1), 0) = 0;
    blockers := b;
    checks := c;
    return next;
  end loop;
end;
$$;
revoke all on function public._funder_matches(uuid) from public, anon, authenticated;
grant execute on function public._funder_matches(uuid) to service_role;

-- What staff call. Only admins and the rep assigned to the file, the same people who may
-- read the full application that goes out with it.
create or replace function public.funder_matches(_application_id uuid)
returns table (
  funder_id uuid,
  funder_name text,
  submission_email text,
  auto_send boolean,
  already_sent boolean,
  eligible boolean,
  blockers text[],
  checks text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_see_application_details(_application_id) then
    raise exception 'Only an admin or the rep assigned to this file can send it to funders.'
      using errcode = '42501';
  end if;
  return query select * from public._funder_matches(_application_id);
end;
$$;
revoke all on function public.funder_matches(uuid) from public, anon;
grant execute on function public.funder_matches(uuid) to authenticated;

-- Is the package ready? The signed application plus three bank statements, none turned down.
create or replace function public.funder_package_ready(_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.documents
      where application_id = _application_id and kind = 'funder_application'
        and status in ('received', 'accepted')) >= 1
    and
    (select count(*) from public.documents
      where application_id = _application_id and kind = 'bank_statement'
        and status in ('received', 'accepted')) >= 3;
$$;
revoke all on function public.funder_package_ready(uuid) from public, anon;
grant execute on function public.funder_package_ready(uuid) to authenticated, service_role;

-- 5. Automatic sending. Off until both Vault secrets exist:
--      funder_send_url     https://<project-ref>.supabase.co/functions/v1/send-to-funders
--      funder_send_secret  the same value as the edge function's FUNDER_SEND_SECRET
--    and off per funder until an admin turns auto_send on. A failure here is written to the
--    file's timeline and never blocks the upload that triggered it.
create or replace function public.queue_auto_send()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_app public.applications;
begin
  if new.kind not in ('funder_application', 'bank_statement') or new.status = 'rejected' then
    return new;
  end if;
  select * into v_app from public.applications where id = new.application_id;
  if v_app.id is null or v_app.status in ('declined', 'withdrawn', 'closed', 'funded') then
    return new;
  end if;
  if not public.funder_package_ready(new.application_id) then
    return new;
  end if;
  if not exists (
    select 1 from public._funder_matches(new.application_id) m
    where m.auto_send and m.eligible and not m.already_sent
  ) then
    return new;
  end if;

  begin
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'funder_send_url'$q$ into v_url;
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'funder_send_secret'$q$ into v_secret;
  exception when others then
    v_url := null;
  end;
  if v_url is null or v_secret is null then
    return new;
  end if;

  begin
    execute 'select net.http_post(url := $1, headers := $2, body := $3)'
      using v_url,
            jsonb_build_object('Content-Type', 'application/json', 'x-funder-send-secret', v_secret),
            jsonb_build_object('application_id', new.application_id, 'mode', 'auto');
  exception when others then
    insert into public.events (application_id, kind, body, payload)
    values (new.application_id, 'system', 'Automatic send to funders could not be queued.',
            jsonb_build_object('error', sqlerrm));
  end;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.queue_auto_send() from public, anon, authenticated;

drop trigger if exists documents_queue_auto_send on public.documents;
create trigger documents_queue_auto_send
  after insert or update of status on public.documents
  for each row execute function public.queue_auto_send();

comment on column public.funders.auto_send is
  'Send matched files to this funder automatically once the package is ready. Off by default.';
comment on table public.mailer_connections is
  'The Gmail mailbox submissions go out from. Service role only; staff see mailer_status().';

-- 6. Sending a file to funders reads the full application (SSN included) to build the signed
--    application PDF, so it is logged like Show SSN, under its own reason.
do $$
declare c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.sensitive_access_log'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%reveal_ssn%';
  if c is not null then
    execute format('alter table public.sensitive_access_log drop constraint %I', c);
  end if;
  alter table public.sensitive_access_log add constraint sensitive_access_log_action_check
    check (action in ('reveal_ssn', 'application_pdf', 'funder_submission'));
exception when duplicate_object then null;
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
  if _purpose is null or _purpose not in ('reveal_ssn', 'application_pdf', 'funder_submission') then
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
revoke all on function public.reveal_application_details(uuid, text) from public, anon;
grant execute on function public.reveal_application_details(uuid, text) to authenticated;
