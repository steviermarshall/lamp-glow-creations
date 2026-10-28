-- Rep teams: a rep can report to an admin (reps.admin_slug, the admin's own rep seat).
--
-- Merchant-facing names follow it: the application emails go out as "<admin> at Lamp", the
-- application page and the signed PDF's "Lamp rep" box show the admin, and replies reach both
-- the admin and the rep. The file itself still lands with the rep who sent it (rep_slug and
-- source_rep_slug as before), so the rep works the deal and the admin sees who sent what.
-- Admins add and edit reps on the staff Team tab (the existing "Admins manage reps" policy).

alter table public.reps
  add column if not exists admin_slug text references public.reps (slug) on delete set null;

alter table public.reps drop constraint if exists reps_admin_not_self;
alter table public.reps
  add constraint reps_admin_not_self check (admin_slug is null or admin_slug <> slug);

create index if not exists reps_admin_slug_idx on public.reps (admin_slug) where admin_slug is not null;
