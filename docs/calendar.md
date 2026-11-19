# Calendar (plan and how it works)

Asad, 2026-11-15: "I need everybody to have a calendar in the portal where the system automatically
schedules follow-ups and things that matter based on the context of what's been done."

## Triage

- Part A, the rules that read what the portal already records (links sent, offers, assigned calls,
  email replies, funder submissions, document requests, the engine's daily emails): **complicated**.
  The cause and effect is there but had to be found in the tables. Protocol: map each rule to a real
  column, test each rule, then a canary: after the SQL runs, open the calendar as an admin and check
  that each rule made at least one item that matches a real record.
- Part B, the rules that depend on reps logging outcomes on engine leads (Callback, No answer):
  **complex**. Reps have not been logging outcomes (the lead push paused at 0 for three weekdays),
  so these rules will make few or no items at first. Protocol: ship them, watch how many Callback and
  No answer items appear each week, and promise nothing about follow-up rates.
- Part C, the calendar itself (table, row rules, page, done and move): **complicated**, a scoped
  build with tests.
- Part D, whether people open it and work from it: **complex** (adoption). Probe: a week of use, then
  look at items done versus items that cleared on their own. Do not reward "items marked done": that
  counts clicks, not calls. The goal is links that turn into applications and offers that get an
  answer.

Two traps to design against. Delayed feedback: the rules run when someone opens the calendar, so a
rep who never opens it gets nothing scheduled and nobody notices. The admin's view syncs everyone, and
a scheduled sync is possible later (as with the chat nudge). Cobra: see Part D.

## What creates an item on day one

Each item names why it was scheduled and links to the record. Times are New York time; "business
day" skips Saturday and Sunday (holidays are not known to the portal).

| Rule | From (already recorded) | Whose calendar | When it's due | Clears on its own when |
| --- | --- | --- | --- | --- |
| Assigned call | `file_notes` call with `status = 'open'` | the rep it was assigned to | its `due_on`, or the day it was assigned when no date was set | the call is marked done |
| Email reply | `engine_leads` with source `email-reply`, newest reply not an opt-out, status still New | the lead's rep (unassigned: admins) | the moment it came in | the lead's status changes |
| Link not opened | `application_invites` sent, not opened, cancelled, expired or filed | the link's rep | 2 business days after it was sent | it is opened, cancelled, filed or expires |
| Link opened, not started | same, opened but not started | the link's rep | 2 business days after it was opened | it is started, cancelled, filed or expires |
| Application started, not finished | same, started but not submitted | the link's rep | 1 business day after the last saved step | it is submitted, cancelled or expires |
| Offer waiting | `offers` presented, not accepted or declined, on an open file | the file's rep | a day before it expires, or 3 business days after it was presented | the offer is answered, withdrawn or expires |
| Funder hasn't answered | `submissions` still `submitted` with no decision, on an open file | whoever sent it (else the file's rep) | 2 business days after it was sent | the funder's answer is recorded |
| Documents not in | `document_requests` open, nothing uploaded to it | the file's rep | 2 business days after the request | a document arrives or the request closes |
| Callback | `engine_leads` status Callback, worked in the last 30 days | the lead's rep | the next business day after it was marked | the status changes |
| No answer | `engine_leads` status No answer, worked in the last 14 days | the lead's rep | the next business day after it was marked | the status changes |
| Approve today's emails | `engine_outbox` rows still `pending` for a batch day | every admin | 8:30 that morning | nothing is pending for that day |

A file or link with no rep goes to an "Unassigned" lane only admins see. Closed files (funded,
declined, withdrawn, closed) make nothing.

## What the portal does not record (so nothing is scheduled from it)

- The day or time a merchant asked to be called back. Engine leads keep only the status Callback and
  when it was set, so a Callback item goes on the next business day and says so; the rep moves it.
- How many times a lead was tried. `worked_at` is overwritten on each change, so there is no
  "third no-answer, stop calling" rule.
- What happened on a call on a file. A logged call (`events` kind `call`) has no outcome or next
  date, so a call doesn't schedule the next one.
- Replies to a rep's own emails or texts. Only replies the War Room engine posts to
  `/api/engine/reply` are recorded.
- Meetings. `events` can say a meeting happened, never when one is planned.
- Renewals, and holidays. Not in day one.

## How it works

- Table `calendar_items` (migration `20261115120000_calendar.sql`). One row per item, keyed by
  `source_key` (rule plus the record, plus the moment for rules that can happen again, like a
  Callback set on a new day), so running the rules twice changes nothing.
- Row rules: a person reads and changes only their own items; admins read and change everyone's.
  Only Lamp's server adds items. From the browser only `status` (open or done) and `due_at` change.
- The rules are plain functions in `src/lib/calendar.ts`, tested in `tests/calendar.test.ts`.
  `GET /api/calendar` (`src/lib/calendar.server.ts`) runs them for the caller (a rep: their own
  records; an admin: everyone's), adds new items, updates who owns an item when a file changes hands,
  and clears items whose reason has passed. It never changes a due date someone moved.
- Staff > Calendar: Agenda (overdue, then the next two weeks), Day and Week, with Done and Move on
  each item. Admins can filter by person. On a phone the week is a list of days.
- The "Approve today's emails" item only points at Staff > Email engine. Approving stays there, behind
  that card's own button.

## To switch it on

1. Merge the PR and Publish (Asad's go).
2. Run `supabase/migrations/20261115120000_calendar.sql` in Lovable's SQL editor (Asad's go). Until it
   runs, the tab says the calendar isn't set up yet.
3. Canary: open Staff > Calendar as an admin, check each item's "why" against the record it links to.
