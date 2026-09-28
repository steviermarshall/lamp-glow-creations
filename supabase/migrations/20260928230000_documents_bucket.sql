-- Private bucket for bank statements and IDs (one folder per user: <user_id>/<file>).
-- Access policies on storage.objects were added in the previous migration.
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 20971520)
on conflict (id) do nothing;
