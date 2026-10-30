# Lamp database v2

The schema behind getlamp.app, designed to carry many merchants, several reps and a growing
funder list at once. Everything here is defined in `supabase/migrations/20261017*.sql` and
applies unchanged to Lovable Cloud or to a Supabase project Lamp owns.

Interactive map (flow, schema, who may do what): https://claude.ai/artifact/EAaUcVNh3f8eh219UgEarP

## The model in one paragraph

A visitor arrives through a rep link, leaves an email (`leads`), signs up (Supabase Auth,
which creates `profiles` and the `merchant` role by trigger) and files an `applications` row.
The row is auto-assigned to the rep whose link it came through, its phone consent is
stamped, and every later stage change lands in `events`, which is also the CRM activity log.
Merchants attach `documents` (indexing files in the private bucket). Staff send the file to
`funders` as `submissions`; what comes back is an `offers` row in the funder's own terms. The
merchant sees an offer only after a rep presents it, accepts it through `accept_offer()`,
and an admin records the `deals` row and the `commission_entries` ledger.

## Who may do what

Roles live in `user_roles` (merchant, rep, admin; a user may hold several) and are checked by
`has_role()`, `is_staff()` and `current_rep_slug()`: SECURITY DEFINER, STABLE, one indexed
lookup, wrapped in `(select ...)` inside every policy so Postgres evaluates them once per
statement rather than once per row. Rows that hang off an application (events, documents,
submissions, offers) are checked per row by `rep_can_see_application()`, one primary-key
lookup, profiles and businesses by `rep_can_see_user()` (the owner has a file the rep can
see), and stored files by `rep_can_read_file()`; all three are SECURITY DEFINER, so the
answer never depends on what the caller can read.

| Role | Reads | Writes |
|---|---|---|
| anonymous | active reps | leads (insert only, through the site's server) |
| merchant | own profile, businesses, applications, documents in own folder, visible events, presented offers (`my_offers`, with the funder's name only) | own profile and businesses; own application answers and contact fields; own documents until reviewed; `accept_offer()` |
| rep | own files plus the unassigned pool (`pipeline_board`), and only on those files: events, documents, stored files, submissions, offers, and the owner's profile and businesses; own profile; own and untagged leads (and their events); funders; own deals and ledger entries | on own or unassigned files only: stage and staff notes (`application_internal_notes`), take an unassigned file for themselves (never assign, hand over or release, never change `source_rep_slug`); events as themselves; submissions; offers and their notes (`offer_internal_notes`); document review; own and untagged leads. No business edits, no `accept_offer()` |
| admin | everything | everything, plus reps, roles, funders, deals, the ledger |
| service role (server functions, cron) | bypasses RLS | bypasses RLS |

Guardrails the database enforces whatever the app sends:

- a merchant cannot change `status`, `rep_slug`, `staff_notes`, `user_id`, `assigned_at`, the phone-consent stamps or the `submitted_at`, `funded_at` and `closed_at` stamps (`applications_before_update` raises);
- `submitted_at` means the file has gone to funders: it is stamped on the first move to any stage from `submitted` on, and when a `submissions` row is recorded;
- an offer with status `received` is invisible to the merchant;
- a merchant reads no `funders` rows: `my_offers` takes the funder's name from `offer_funder_name()`, which gives only the name, and only for an offer the caller may see (the merchant once it is presented, or staff; the service role and the SQL editor always);
- offer notes live in `offer_internal_notes`, which only admins and staff on their own or unassigned files can read or write. `offers.notes` is retired and always empty, because merchants read their presented offers' rows: a page still open from before the move that saves an offer with a note has it moved into the table (`offers_notes_moved`). `accept_offer()` returns only the offer's id, file, status and `accepted_at`;
- at most one accepted offer per application (partial unique index), and `accept_offer()` refuses anything not `presented` or past `expires_at`, and any caller other than the merchant who owns the file or an admin;
- deals and the commission ledger are admin-only writes;
- a rep changes `rep_slug` only from null to their own slug; reassigning, handing over or releasing a file, and changing `source_rep_slug` (link attribution), are admin-only (`applications_before_update` raises);
- a rep reads a stored file only when it belongs to a file they can see: through its `documents` row (bucket + storage_path), or, for a file with no row yet, when every application of the folder's owner is theirs or unassigned (`rep_can_read_file()`);
- notes & calls (`file_notes`, 2026-10-29) are a thread per file: each note is `team` (the file's rep and admins) or `admins` (admins only; reps never read it). Only admins add admins-only notes or calls (a note with `assigned_to` and an optional `due_on`); a call to a rep who can't see the file makes it theirs. From a browser a note is kept as written: only a call's `status` and `outcome` change, by the rep it's for or an admin, and the database stamps the author, times and who finished it (`file_notes_before`, `file_notes_after`, which also sends the `call` and `note` notifications). Only admins delete. Merchants read nothing. The older single note below was copied in as each file's first note;
- staff notes live in `application_internal_notes`, which only admins and staff on their own or unassigned files can read or write; the database stamps who saved a note and when. `applications.staff_notes` is retired and always empty, because merchants can read their own application row: a page still open from before the move that saves into it has its text moved into the table, added after the stored note unless it already contains it, and a new row can't carry one (`applications_staff_notes_moved`);
- from a browser, only a document's review changes: `status`, `review_note`, `reviewed_at`, and `reviewed_by` as the reviewer (or cleared). Its file (`bucket`, `storage_path`), owner, application, `kind` and every other column change only through the server or an owner-run function such as claiming a file (`documents_fields_guard`), because those columns decide who may open the stored file;
- a merchant can add a document only as `received`, only for a file that exists under `<own user id>/`, and only with a `kind` from the list below; a merchant cannot change a row afterwards (to relabel a file they remove it and upload it again);
- a merchant can remove a `received` or `rejected` document only while its application has never been submitted, and can remove a file from storage only when no document row points at it (`storage_object_is_indexed()`), so documents sent to funders stay with the deal;
- `engine_leads` is written only by the engine (service role, upsert by `(source, source_key)`); staff read every row and may change only `status`, `notes` and `rep_slug` (`engine_leads_before_update` resets everything else, stamps `worked_at` and fills `rep_slug` with the caller's slug on a status change). Anonymous has no access.

## Through the site's server

The browser signs in with Supabase Auth (email link, Google through Lovable's broker), so it
always holds a key the database accepts. Since `20261027190000_server_stamp.sql` the database
also refuses that key, on its own, for the sensitive parts, which go through the site's server
routes instead (`src/routes/api.*.ts`, code in `src/lib/*.server.ts`):

| Part | Browser straight to the database | Through the site's server |
|---|---|---|
| files in the `documents` bucket (statements, IDs, signed copies) | refused: no upload, list, link or remove | `/api/documents/upload`, `/api/documents` (folder, remove, open) |
| `documents` rows | reading the list still works (the board counts them); add, review, remove refused | `/api/documents` (review), upload, remove |
| `staff_application_details()`, `reveal_application_details()` | refused | `/api/application-details` |
| `leads` (the public form) | refused; only email, first name, phone, answers and utm may be set at all | `/api/leads`, at most 10 an hour from one network |

The server proves a request came through it with the `x-lamp-server` header (its secret is
`LAMP_SERVER_STAMP` in Lovable Cloud's secrets). The database keeps only the secret's SHA-256 in
`lamp_private.server_stamp`, and `via_lamp_server()` checks it in one restrictive rule per table,
on top of the per-person rules above, which still decide who sees what for the server's
requests too. Opening a document writes an `open_document` row to `sensitive_access_log`, like
Show SSN. Nothing is refused while `lamp_private.server_stamp.enforce` is false; switch it with
`update lamp_private.server_stamp set enforce = true` (or `false` to go back at once), after
`/api/server-check` shows `"received": true`.

New code that reads or writes those parts must call the server routes, not the Supabase
client; anything else gets nothing back once the switch is on. The merchant's own
`application_details` (the account page's application) and every other table still go straight
from the browser, under the rules above. `tests/server-stamp.local.ts` checks both sides
against a local Supabase stack.

## Tables

| Table | Purpose | Key indexes |
|---|---|---|
| profiles | one row per auth user, made by trigger | lower(email) |
| user_roles | role grants | role |
| role_invites | roles pre-granted by email, claimed on first sign-in | pk email |
| reps | slug = public link, optional login | pk slug |
| businesses | the merchant's company facts | owner |
| applications | the file; 11 stages | (user_id, created_at), (rep_slug, status, created_at), (status, created_at), business_id, lower(email) |
| events | timeline, audit trail and rep activity in one | (application_id, occurred_at), (lead_id, occurred_at), actor, kind |
| documents | index of the storage bucket, with review state and what each file is (`kind`) | (application_id, created_at), (application_id, kind), user_id, pending-review partial |
| application_internal_notes | the staff notes on a file, one per file; staff only | pk application_id |
| file_notes | notes & calls on a file: team or admins-only notes, calls assigned to a rep with a due date and an outcome | (application_id, created_at), open calls by (assigned_to, due_on) |
| brain_briefs | Today (Lamp Brain): the day's written brief per staff member, its token counts and cost; only Lamp's server reads or writes it | unique (user_id, day), created_at |
| brain_drafts | follow-up drafts (Lamp Brain): each Claude-written text/email/call notes for a Today item, with placeholders for names, and what it cost; only Lamp's server reads or writes it | unique (user_id, kind, item_id, signal, day, docs), (user_id, day), created_at |
| offer_internal_notes | the rep's note on an offer, one per offer; staff only | pk offer_id |
| leads | email before sign-up, converted on application | lower(email), created_at, rep_slug, unconverted partial |
| funders | the private lender table with criteria and commission points | active |
| submissions | one application sent to one funder | unique (application_id, funder_id), funder, open partial |
| offers | funder terms as written: amount, payback, fees, frequency, payments; generated factor_rate, payment, received_net | application, funder, one-accepted partial unique |
| deals | the funded offer, one per application | rep, funder, funded_on |
| commission_entries | owed, paid, clawback, adjustment per deal | deal |
| engine_leads | the lead engine's output (public-record businesses, tiered A/B/C/X), mirrored in by the engine; staff set status and notes | unique (source, source_key), (tier, status, need, first_found), phone, (rep_slug, status) |

Views (`security_invoker`, so policies still apply): `pipeline_board` for the rep Kanban
(one row per file with counts and last touch, one query per load) and `my_offers` for the
account page.

Stages: new, reviewing, docs_needed, submitted, offers_ready, accepted, closing, funded,
declined, withdrawn, closed. The five the site already used are unchanged, so the account
page keeps working.

Document kinds (`documents.kind`, text with a check constraint, default `other`): what
funders need from every merchant, in the order the account page's "What we need" checklist
shows them. `src/lib/documents.ts` holds the same list with labels, required counts and the
plain-English line per item, so the account page and the staff page read one source.

| kind | What it is | Complete at |
|---|---|---|
| bank_statement | one month of business bank statements | 3 files received or accepted |
| voided_check | voided business check or bank letter | 1 |
| drivers_license | the owner's driver's license, front | 1 |
| funder_application | the funder's application PDF, signed by the merchant | 1 |
| other | anything else; never counts toward the checklist | — |

A `rejected` file does not count and shows as "please re-upload" under its item. The site
never asks for a Social Security number or a date of birth; nothing here stores either.
`20261019180000_document_kinds.sql` replaced v2's unused `document_kind` enum with this text
column (`id` became `drivers_license`, `tax_return` became `other`) and is safe to run twice.

## Load behaviour

Measured on a Supabase Postgres 17 container (`public.ecr.aws/supabase/postgres:17.6.1.131`)
after seeding 2,000 merchants, 20,000 applications, 110,000 events, 40,000 documents,
10,000 submissions and 10,000 offers.

| Query | Plan | Time |
|---|---|---|
| merchant account page (`where user_id = me order by created_at desc limit 1`) | index scan on (user_id, created_at) | 0.19 ms |
| merchant `my_offers` | index scans | 1.2 ms |
| rep board, 50 newest open files for one rep | index on rep_slug + per-row index lookups | 6 to 8 ms |
| admin count by stage over 20,000 rows | sequential scan | 20 ms |

pgbench, same seed, 15 s each, zero failed transactions:

| Scenario | Clients | Throughput | Mean latency |
|---|---|---|---|
| account page load (filtered query) | 50 | 3,111 tx/s | 16 ms |
| rep board reload | 20 | 380 tx/s | 53 ms |

Two findings from the probe are already in this change:

1. The account page now filters `.eq("user_id", user.id)` explicitly. The policy already
   limited rows to the user, but without the filter Postgres cannot use the index when the
   staff policies are OR-ed in (7.3 ms scan became 0.19 ms).
2. Any staff board query should filter `rep_slug` explicitly for the same reason.

## Capacity checklist

- Compute: Supabase's smallest tier (Lovable Cloud "Tiny", 0.5 GB RAM) handles the numbers above with room. Upgrade when `pg_stat_statements` shows the board query above 100 ms or the database passes 1 GB.
- Connections: the browser goes through PostgREST, which pools. Server functions should use the pooler (port 6543, transaction mode), never a direct connection per request. The local run hit the 100-connection ceiling at 200 raw clients; the pooler is what removes that ceiling.
- Backups: Lovable Cloud takes daily backups (seen in the project); an own Supabase project should turn on point-in-time recovery once real applicants exist.
- Realtime: not enabled; nothing here needs it.
- Never put a service-role key in the browser bundle. `client.server.ts` is the only place it belongs.

## Applying it

Lovable Cloud (Stevie's project): Lovable does not run SQL files that arrive from GitHub.
Paste each of the four files, in order, into the Lovable chat as "apply this migration",
or run them from the SQL editor under Cloud → Database → Manage → SQL editor.
`docs/apply-database-v2.sql` holds the five 20261017120* files in one paste. Then run
`supabase/migrations/20261017130000_documents_rules_and_backfill.sql` the same way: it
tightens the document rules and indexes any file uploaded before the site did. Publish the
account page that indexes uploads first, then run it straight after: the older page deletes
files from storage directly, which the new rules refuse once a file is indexed. Running it
again later is safe and indexes anything uploaded in between. Then run
`supabase/migrations/20261019180000_document_kinds.sql`: it turns `documents.kind` into the
checked text column the checklist reads. Publish the account page that writes `kind` after
it has run (the page's insert names the new values, which the old enum refuses).

Then `supabase/migrations/20261019160000_rep_scope.sql`, the same way, once the staff page
(`/staff`) is published: it limits a rep to their own and unassigned files everywhere
(events, documents, stored files, submissions, offers, leads) and stops a rep handing a file
to someone else. Admin and merchant rules are unchanged. Safe to run again. Straight after
it, `supabase/migrations/20261019170000_staff_scope.sql`: profiles and businesses limited
the same way, no business edits by reps, `accept_offer()` for the owning merchant or an
admin only, and attribution (`source_rep_slug`) admin-only. Also safe to run again. A rep
opening a file now sees "Staff" rather than a name for timeline entries by admins or other
reps, since their profiles are not readable to the rep.

Then `supabase/migrations/20261020120000_engine_leads.sql`: the `engine_leads` table the
staff page's "Engine leads" view reads. Safe to run again. The rows come from the lead
engine in Asad's war room (`lamp/push_supabase.py`, upsert by source key, service role),
which is pointed at this project with its URL and secret key; until it is, the view is
empty and says so.

Own Supabase project: `supabase link --project-ref <ref>` then `supabase db push`, or paste
the files into the SQL editor in order. Both existing migrations must have run first (they
have on Lovable Cloud).

Roles are pre-granted by email in `role_invites` (stevie@ and asad@ as admin and rep,
zeus@ as rep, all on getlamp.app). The first sign-in with that address claims the invite:
the roles are granted, the rep slug is linked, the invite is marked claimed. To add someone
later, an admin inserts a row there; to grant a role to an existing login, insert into
`user_roles` directly.

## What the app still has to learn

The account page indexes every upload in `documents` with its `kind`, shows the "What we
need" checklist and review status, and maps all eleven stages. These are the follow-ups
that use the rest of the new tables:

- ~~a rep board page reading `pipeline_board` and writing stage changes and `events`~~ (`/staff`: list, file view, stage, assignment, notes, document review), still to show the
  same checklist per file from `src/lib/documents.ts` (what is still missing, what to reject);
- the account page listing `my_offers` with an accept button calling `accept_offer`;
- funder and deal admin screens;
- the deals@ email and PDF (server function with the service role).
