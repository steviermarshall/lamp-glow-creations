-- Signed files and starts with no rep reach a person.
--
-- 1. The new-file email is sent once per try (src/lib/notice-retry.ts): each try first writes a
--    claim on the file's timeline, an events row with payload {notice_claim, attempt}. This index
--    lets only one such row exist per file and attempt, so when the signing browser, a second tab
--    and the finish-reminders job (every 10 minutes) all try at once, one of them sends.
-- 2. The bell (and through it Discord, 20261105160000_discord.sql) for work nobody owns yet:
--      a new file with no rep              -> every admin (kind 'file')
--      someone starts with no rep          -> every admin (kind 'started')
--      a rep seat with no login (user_id)  -> every admin, in place of the rep
--    Several admin 'file' rows for one file still make one #deals post (channelKey keys on the
--    file). 'started' rows carry no file, so they stay DMs, as before.
--
-- notifications_on_application and notifications_on_lead are copied from their only definition,
-- 20261029090000_notifications.sql, and changed only where they find no one to tell.
-- Safe to run more than once.

-- ---------- 1. one claim per file and attempt ----------

create unique index if not exists events_notice_claim_once
  on public.events (application_id, (payload ->> 'notice_claim'), (coalesce(payload ->> 'attempt', '0')))
  where payload ? 'notice_claim';

-- ---------- 2. admins hear what no rep can ----------

/** Notifies every admin once (skipping _skip, for example the admin who did the thing). */
create or replace function public.notify_admins(
  _kind text, _title text, _body text, _link text, _app uuid, _skip uuid default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  u uuid;
begin
  for u in
    select distinct ur.user_id from public.user_roles ur
    where ur.role::text = 'admin' and ur.user_id is distinct from _skip
  loop
    perform public.notify(u, _kind, _title, _body, _link, _app);
  end loop;
end;
$$;
revoke all on function public.notify_admins(text, text, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.notifications_on_application()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  biz text := coalesce(nullif(new.business_name, ''), nullif(new.first_name, ''), 'a new merchant');
  link text := '/staff?file=' || new.id;
  rep_name text;
  u record;
begin
  if tg_op = 'INSERT' then
    if new.rep_slug is not null then
      perform public.notify_rep_and_lead(
        new.rep_slug, 'file', 'New file: ' || biz,
        case when new.invite_id is not null or new.utm ->> 'source' = 'application_link'
             then 'Signed from an application link.' else 'Came in from the website.' end,
        link, new.id);
      -- a rep seat with no login hears nothing: the admins do, once each (not again for the one
      -- the rep reports to, who already heard)
      select * into u from public.rep_and_lead_users(new.rep_slug);
      if u.rep_user is null then
        perform public.notify_admins(
          'file', 'New file: ' || biz,
          'For ' || coalesce((select name from public.reps where slug = new.rep_slug), new.rep_slug)
            || ', who has no Lamp login yet.',
          link, new.id, u.lead_user);
      end if;
    else
      -- nobody owns it yet: every admin hears (not the admin who made it)
      perform public.notify_admins(
        'file', 'New file: ' || biz, 'Came in from the website with no rep yet.',
        link, new.id, auth.uid());
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
-- the triggers themselves are unchanged (20261029090000_notifications.sql)

create or replace function public.notifications_on_lead()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  who text := coalesce(nullif(new.first_name, ''), 'someone');
  rep_user uuid;
begin
  if coalesce(new.answers ->> 'source', '') <> 'application_link' then
    return new;
  end if;
  if new.rep_slug is null then
    perform public.notify_admins(
      'started', 'Started on the website: ' || who,
      'They gave their name and number. No rep yet. Call while they''re on the page.',
      '/staff?view=sent', null);
    return new;
  end if;
  rep_user := (select user_id from public.reps where slug = new.rep_slug);
  if rep_user is null then
    perform public.notify_admins(
      'started', 'Started on ' || coalesce((select name from public.reps where slug = new.rep_slug), new.rep_slug)
        || '''s link: ' || who,
      'They gave their name and number. The rep has no Lamp login yet. Call while they''re on the page.',
      '/staff?view=sent', null);
    return new;
  end if;
  perform public.notify(
    rep_user, 'started',
    'Started on your link: ' || who,
    'They gave their name and number. Call while they''re on the page.',
    '/staff?view=sent', null);
  return new;
end;
$$;

-- ---------- What's new ----------

select public.announce(
  'Website files now alert admins',
  'A file or a start that comes in from the website with no rep now rings every admin''s bell (and Discord), and so does one on the link of a rep who has no Lamp login yet. A signed file whose email never went out is now sent again automatically, about 10 minutes after its last statement lands.',
  null, 'admin')
where not exists (
  select 1 from public.notifications
  where kind = 'announcement' and title = 'Website files now alert admins'
);

notify pgrst, 'reload schema';
