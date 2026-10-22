-- Document kinds: what a file is, so the account page can show the merchant a checklist
-- and the staff page can see what is still missing.
--
-- v2 gave documents.kind an enum (bank_statement, id, voided_check, tax_return, other) that
-- the site never wrote. This turns it into plain text with a check constraint, matching the
-- list in src/lib/documents.ts, so adding a kind later is one constraint change rather than
-- an enum migration:
--
--   bank_statement       one of the last 3 months of business bank statements
--   voided_check         voided business check or bank letter
--   drivers_license      the owner's driver's license, front
--   funder_application   the funder's application PDF, signed by the merchant
--   other                anything else
--
-- Existing rows: 'id' becomes 'drivers_license'; 'tax_return' becomes 'other'; the rest keep
-- their value. Every policy on documents stays as it is: a merchant may still add a row only
-- as received, only for a file in their own folder, and may not change a row afterwards; the
-- kind they write must be one of the five. Safe to run again: each step checks first.

set lock_timeout = '5s';

do $$
declare
  kind_type text;
begin
  select c.udt_name into kind_type
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'documents' and c.column_name = 'kind';

  if kind_type is null then
    alter table public.documents add column kind text not null default 'other';
  elsif kind_type <> 'text' then
    alter table public.documents alter column kind drop default;
    alter table public.documents alter column kind type text
      using (case kind::text
               when 'id' then 'drivers_license'
               when 'tax_return' then 'other'
               else kind::text
             end);
    alter table public.documents alter column kind set default 'other';
    alter table public.documents alter column kind set not null;
  end if;
end
$$;

alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('bank_statement', 'voided_check', 'drivers_license', 'funder_application', 'other'));

create index if not exists documents_application_kind_idx
  on public.documents (application_id, kind);

-- Nothing else used the enum.
drop type if exists public.document_kind;

reset lock_timeout;
