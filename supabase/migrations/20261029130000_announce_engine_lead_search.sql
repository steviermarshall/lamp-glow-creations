-- What's new: search on Engine leads for everyone; for admins, a CSV of the ticked leads and
-- leads sent straight from the Board (2026-10-29). Only notifications; no schema change.
-- Run once: running it again sends the announcements again.

select public.announce(
  'New: search your engine leads',
  'Engine leads has a search box: type a business name, part of a phone number, an email, a city or an industry. It searches within the tier and status picked.',
  'https://claude.ai/artifact/MifSWb2LGkTtDfzTKorbLc#engine-search',
  'all');

select public.announce(
  'New for admins: lead CSVs and leads from the Board',
  'Tick leads on Engine leads and press Download CSV for a spreadsheet of them; reps don''t get this button. Asad can also send leads from the Board straight to your Engine leads page: they show up in Hand out leads, and you press Upload.',
  'https://claude.ai/artifact/MifSWb2LGkTtDfzTKorbLc#engine-search',
  'admin');
