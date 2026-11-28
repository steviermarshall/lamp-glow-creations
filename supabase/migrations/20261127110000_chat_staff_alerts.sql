-- 2026-11-27: a merchant's chat message now rings the bell of the people who answer it.
--
-- Until now a merchant writing in their file's conversation only showed as unread in the Messages
-- side panel (20261110140000_chat_merchant.sql said "nothing leaves Lamp for staff"), so a rep who
-- wasn't looking at Lamp never heard. Now a merchant's text message writes a 'message' notification:
--   * a file with a rep who can open its conversation -> that rep and their team lead
--     (notify_rep_and_lead, the same people the other file alerts reach);
--   * an unassigned file, or a rep seat with no login (or no staff role) -> every admin, since
--     admins are the ones who can answer it.
-- Title "Message from <business>", no body, and a link that opens the conversation
-- (/staff?view=messages&thread=<id>). The body stays empty on purpose: notifications are DM'd to
-- Discord, and the merchant's words stay in Lamp. Only text from the merchant counts: their upload
-- lines (kind 'document') already send a 'document' bell, and staff replies alert nobody.
-- At most one alert per conversation and person while the last one is unread and under 15 minutes
-- old, so a merchant sending five lines in a row rings once. The alert never stops the message:
-- any error inside it is swallowed and the message is saved.
-- 'message' is not one of the team channel's kinds (src/lib/team-alerts.ts CHANNEL_KINDS), so it
-- goes to the person's DM only, never #deals.
--
-- Runs after 20261110140000_chat_merchant.sql. Safe to run more than once.

-- ---------- 1. the new kind ----------
-- As in 20261029140000_file_notes_and_calls.sql (the newest definition), plus 'message'.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('file', 'assigned', 'document', 'offer', 'funded', 'started', 'announcement', 'call', 'note', 'message'));

-- ---------- 2. who hears, and how often ----------

/**
 * True when this person already has an unread alert for this conversation from the last 15 minutes.
 * Reading the conversation in the side panel doesn't count as quiet on purpose: a rep who reads and
 * then leaves Lamp must still hear the merchant's next line, so a long live exchange can ring again
 * once every 15 minutes at most.
 */
create or replace function public.chat_alert_recent(_user uuid, _link text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.notifications n
    where n.user_id = _user
      and n.kind = 'message'
      and n.link = _link
      and n.read_at is null
      and n.created_at > now() - interval '15 minutes'
  );
$$;
revoke all on function public.chat_alert_recent(uuid, text) from public, anon, authenticated;

/** Tells the people who answer a file's conversation that the merchant wrote. Never says what. */
create or replace function public.chat_alert_staff(_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.chat_threads;
  a public.applications;
  v_rep uuid;
  v_lead uuid;
  rep_quiet boolean;
  lead_quiet boolean;
  biz text;
  ttl text;
  lnk text;
  adm uuid;
begin
  select * into t from public.chat_threads where id = _thread;
  if t.id is null or t.kind <> 'merchant' or t.application_id is null then return; end if;
  select * into a from public.applications where id = t.application_id;
  if a.id is null then return; end if;

  biz := coalesce(nullif(btrim(a.business_name), ''), nullif(btrim(a.first_name), ''), 'a merchant');
  ttl := 'Message from ' || biz;
  lnk := '/staff?view=messages&thread=' || t.id;

  if a.rep_slug is not null then
    select r.rep_user, r.lead_user into v_rep, v_lead from public.rep_and_lead_users(a.rep_slug) r;
  end if;

  -- the file's rep (and their team lead), when the rep can open this conversation
  if v_rep is not null and public.chat_can_use_file(a.id, v_rep) then
    rep_quiet := public.chat_alert_recent(v_rep, lnk);
    lead_quiet := v_lead is null or v_lead = v_rep or public.chat_alert_recent(v_lead, lnk);
    if rep_quiet and lead_quiet then return; end if;
    perform public.notify_rep_and_lead(
      a.rep_slug, 'message', ttl, null, lnk, a.id,
      case when rep_quiet then v_rep when lead_quiet then v_lead end);
    return;
  end if;

  -- nobody on the file to answer: every admin
  for adm in
    select distinct ur.user_id from public.user_roles ur where ur.role::text = 'admin'
  loop
    if not public.chat_alert_recent(adm, lnk) then
      perform public.notify(adm, 'message', ttl, null, lnk, a.id);
    end if;
  end loop;
end;
$$;
revoke all on function public.chat_alert_staff(uuid) from public, anon, authenticated;

-- ---------- 3. after a message ----------
-- As in 20261110120000_chat_staff.sql (the only definition until now): the conversation's clock and
-- who spoke last, then the alert for a merchant's text.
create or replace function public.chat_messages_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_threads set last_message_at = new.created_at, last_author = new.author
   where id = new.thread_id and (last_message_at is null or last_message_at <= new.created_at);
  if new.kind = 'text' and new.author_role = 'merchant' then
    begin
      perform public.chat_alert_staff(new.thread_id);
    exception when others then
      -- a merchant's message is never refused because an alert couldn't be written
      raise warning 'chat_messages_after: staff alert skipped (%)', sqlstate;
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.chat_messages_after() from public, anon, authenticated;

drop trigger if exists chat_messages_after on public.chat_messages;
create trigger chat_messages_after
  after insert on public.chat_messages
  for each row execute function public.chat_messages_after();

-- ---------- 4. tell the team ----------
select public.announce(
  'Merchant messages now ring your bell',
  'When a merchant writes in their file''s conversation, the file''s rep and team lead get "Message from <business>" under the bell, and as a Discord DM if your Discord is connected. Click it to open the conversation. Messages on unassigned files go to admins. The alert never includes what the merchant wrote; read and answer it in Lamp. If they send several messages in a row you get one alert, not one per message.',
  null,
  'all'
)
where not exists (
  select 1 from public.notifications
  where kind = 'announcement' and title = 'Merchant messages now ring your bell'
);
