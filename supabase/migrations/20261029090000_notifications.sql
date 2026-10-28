-- Notifications: each staff member's own feed, shown under the bell on /staff.
--
-- Rows are written only by the database (triggers below and announce()), never by the browser.
-- A person reads and marks read only their own rows. Who hears what:
--   a new file with a rep            -> that rep, and the admin the rep reports to
--   a file given to a rep            -> that rep
--   a document added to a file       -> the file's rep (not when the rep uploaded it)
--   an offer accepted                -> the file's rep and their admin
--   a file marked funded             -> the file's rep and their admin
--   someone starts on a rep's link   -> that rep
--   announce(...) "What's new"       -> every rep and admin, or admins only

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('file', 'assigned', 'document', 'offer', 'funded', 'started', 'announcement')),
  title text not null check (char_length(title) <= 200),
  body text check (body is null or char_length(body) <= 1000),
  link text check (link is null or char_length(link) <= 500),
  application_id uuid references public.applications (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;

drop policy if exists "People read their own notifications" on public.notifications;
create policy "People read their own notifications" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "People mark their own notifications read" on public.notifications;
create policy "People mark their own notifications read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- helpers ----------

/** The login behind a rep seat, and the login of the admin that rep reports to. */
create or replace function public.rep_and_lead_users(_slug text)
returns table (rep_user uuid, lead_user uuid)
language sql stable security definer
set search_path = public
as $$
  select r.user_id, l.user_id
  from public.reps r
  left join public.reps l on l.slug = r.admin_slug and l.active
  where r.slug = _slug;
$$;
revoke all on function public.rep_and_lead_users(text) from public, anon, authenticated;

create or replace function public.notify(
  _user uuid, _kind text, _title text, _body text, _link text, _app uuid
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if _user is null then return; end if;
  insert into public.notifications (user_id, kind, title, body, link, application_id)
  values (_user, _kind, left(_title, 200), left(_body, 1000), _link, _app);
end;
$$;
revoke all on function public.notify(uuid, text, text, text, text, uuid) from public, anon, authenticated;

/** Notifies a rep and (when different) the admin they report to. */
create or replace function public.notify_rep_and_lead(
  _slug text, _kind text, _title text, _body text, _link text, _app uuid, _skip uuid default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  u record;
begin
  if _slug is null then return; end if;
  select * into u from public.rep_and_lead_users(_slug);
  if u.rep_user is distinct from _skip then
    perform public.notify(u.rep_user, _kind, _title, _body, _link, _app);
  end if;
  if u.lead_user is not null and u.lead_user is distinct from u.rep_user and u.lead_user is distinct from _skip then
    perform public.notify(u.lead_user, _kind, _title, _body, _link, _app);
  end if;
end;
$$;
revoke all on function public.notify_rep_and_lead(text, text, text, text, text, uuid, uuid) from public, anon, authenticated;

-- ---------- triggers ----------

create or replace function public.notifications_on_application()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  biz text := coalesce(nullif(new.business_name, ''), nullif(new.first_name, ''), 'a new merchant');
  link text := '/staff?file=' || new.id;
  rep_name text;
begin
  if tg_op = 'INSERT' then
    if new.rep_slug is not null then
      perform public.notify_rep_and_lead(
        new.rep_slug, 'file', 'New file: ' || biz,
        case when new.invite_id is not null or new.utm ->> 'source' = 'application_link'
             then 'Signed from an application link.' else 'Came in from the website.' end,
        link, new.id);
    end if;
    return new;
  end if;
  -- given to a rep (or moved to another rep)
  if new.rep_slug is not null and new.rep_slug is distinct from old.rep_slug then
    perform public.notify(
      (select user_id from public.reps where slug = new.rep_slug), 'assigned',
      'Assigned to you: ' || biz, null, link, new.id);
  end if;
  -- funded
  if new.status::text = 'funded' and old.status::text is distinct from 'funded' then
    select name into rep_name from public.reps where slug = new.rep_slug;
    perform public.notify_rep_and_lead(
      new.rep_slug, 'funded', 'Funded: ' || biz,
      case when rep_name is not null then rep_name || '''s file is funded.' end, link, new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists notifications_on_application_insert on public.applications;
create trigger notifications_on_application_insert
  after insert on public.applications
  for each row execute function public.notifications_on_application();
drop trigger if exists notifications_on_application_update on public.applications;
create trigger notifications_on_application_update
  after update of rep_slug, status on public.applications
  for each row execute function public.notifications_on_application();

create or replace function public.notifications_on_document()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  a public.applications;
begin
  select * into a from public.applications where id = new.application_id;
  if a.id is null or a.rep_slug is null then return new; end if;
  perform public.notify(
    (select user_id from public.reps where slug = a.rep_slug and user_id is distinct from new.user_id),
    'document',
    'New document on ' || coalesce(nullif(a.business_name, ''), 'a file'),
    coalesce(new.original_name, new.kind::text),
    '/staff?file=' || a.id, a.id);
  return new;
end;
$$;
drop trigger if exists notifications_on_document on public.documents;
create trigger notifications_on_document
  after insert on public.documents
  for each row execute function public.notifications_on_document();

create or replace function public.notifications_on_offer()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  a public.applications;
begin
  if new.status::text <> 'accepted' or old.status::text = 'accepted' then return new; end if;
  select * into a from public.applications where id = new.application_id;
  if a.id is null then return new; end if;
  perform public.notify_rep_and_lead(
    a.rep_slug, 'offer',
    'Offer accepted: ' || coalesce(nullif(a.business_name, ''), 'a file'),
    'The merchant accepted ' || to_char(new.amount, 'FM$999,999,990') || '. Time to close.',
    '/staff?file=' || a.id, a.id);
  return new;
end;
$$;
drop trigger if exists notifications_on_offer on public.offers;
create trigger notifications_on_offer
  after update of status on public.offers
  for each row execute function public.notifications_on_offer();

create or replace function public.notifications_on_lead()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.rep_slug is null or coalesce(new.answers ->> 'source', '') <> 'application_link' then
    return new;
  end if;
  perform public.notify(
    (select user_id from public.reps where slug = new.rep_slug), 'started',
    'Started on your link: ' || coalesce(nullif(new.first_name, ''), 'someone'),
    'They gave their name and number. Call while they''re on the page.',
    '/staff?view=sent', null);
  return new;
end;
$$;
drop trigger if exists notifications_on_lead on public.leads;
create trigger notifications_on_lead
  after insert on public.leads
  for each row execute function public.notifications_on_lead();

-- ---------- What's new ----------

/**
 * Tells every rep and admin (or admins only) about a change that affects them. Admins can call
 * it from the browser; the migration that ships a change calls it too.
 */
create or replace function public.announce(_title text, _body text, _link text default null, _audience text default 'all')
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  n integer;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only admins announce' using errcode = '42501';
  end if;
  insert into public.notifications (user_id, kind, title, body, link)
  select distinct ur.user_id, 'announcement', left(_title, 200), left(_body, 1000), _link
  from public.user_roles ur
  where ur.role::text = case when _audience = 'admin' then 'admin' else ur.role::text end
    and ur.role::text in ('rep', 'admin');
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.announce(text, text, text, text) from public, anon;
grant execute on function public.announce(text, text, text, text) to authenticated;

-- today's changes, for everyone on staff
select public.announce(
  'New: notifications',
  'This bell now tells you when a file comes in on your link, a merchant uploads a document, an offer is accepted or a file funds. Click one to open the file.',
  null, 'all');
select public.announce(
  'New: Team tab and how each file came in',
  'Admins add reps on Staff > Team and pick who they report to; a rep''s applications then go out in that admin''s name. Every file now says which rep''s link it came from, who sent it and when it was opened and signed.',
  'https://claude.ai/artifact/MifSWb2LGkTtDfzTKorbLc#team', 'all');

notify pgrst, 'reload schema';
