-- Dashboard numbers that measure what they say (2026-11-27).
--
-- 1. site_events may hold a third kind, 'action': something a visitor did on a page, by name only.
--    The names are a fixed list (Offer Check: worked out an offer, saved one, copied the share
--    link, pressed "Get a second offer"). An action row never has a step number, and its question
--    column holds only a name from the list, so no amount or anything typed in can be stored. The
--    site's server checks the same list (SITE_ACTIONS in src/lib/tracking.ts).
-- 2. A signed application on the website's own link was counted as /application/null/signed,
--    because the website has no rep. From now on it is /application/signed; old rows are relabelled
--    here, so the website's signed count over past months changes (it was never paired with its
--    opens before).
-- 3. 'signed', 'pdf' and 'null' can't be rep slugs any more: /application/signed and
--    /application/pdf are pages, and a rep with one of those slugs would mix with them. If a rep
--    already has one, this stops with an error and changes nothing; rename that rep first.
--
-- Run once in the SQL editor; running it again is safe. The site works before it is run (actions
-- are simply not stored until then).

-- 3 first, so nothing changes if a rep holds a reserved slug
do $$
declare
  taken text;
begin
  select string_agg(slug, ', ' order by slug) into taken
  from public.reps where slug in ('signed', 'pdf', 'null');
  if taken is not null then
    raise exception 'A rep already has the slug %, which is now reserved. Rename that rep, then run this again.', taken
      using errcode = '23514';
  end if;
end;
$$;
alter table public.reps drop constraint if exists reps_slug_not_reserved;
alter table public.reps add constraint reps_slug_not_reserved
  check (slug not in ('signed', 'pdf', 'null'));

-- 1. the kind check, as 20261027180000_site_and_activity_tracking.sql made it, plus 'action'
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.site_events'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%page_view%'
  loop
    execute format('alter table public.site_events drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.site_events add constraint site_events_kind_check
  check (kind in ('page_view', 'apply_step', 'action'));

alter table public.site_events drop constraint if exists site_events_action_ok;
alter table public.site_events add constraint site_events_action_ok
  check (
    kind <> 'action'
    or (step is null
        -- "is not null" first: null IN (...) is null, and a check that comes out null passes
        and question is not null
        and question in ('oc_calculated', 'oc_saved', 'oc_shared', 'oc_second_offer'))
  );

-- 2. the website's signed files, under the path they're counted at now
update public.site_events
   set path = '/application/signed'
 where path = '/application/null/signed';

select public.announce(
  'Admins: the Dashboard''s speed rows and signed counts changed',
  'Dashboard > How long it takes now counts a deal from when its file turned funded, so deals logged the same day as their first offer are no longer left out, and the medians may read lower than before. It shows business days, all time and the last 90 days, with how many files each figure rests on, and a new row, Offer accepted to funded. Times are when staff logged them in Lamp. Under Website, a new Application links table shows, for the website and each rep, how many people opened the link and how many signed. The website''s past signed files are now counted under /application/signed, so its history changed. The drop-off is split into the website and reps'' public links, and a new Offer Check card counts visits, people who worked out their own offer, saves, shares and second-offer clicks (never the numbers anyone typed).',
  '/staff?view=dashboard',
  'admin'
)
where not exists (
  select 1 from public.notifications
  where kind = 'announcement' and title = 'Admins: the Dashboard''s speed rows and signed counts changed'
);
