-- ============================================================
-- Miejsce docelowe na PDF-y kart technicznych (Faza 0, Wizard Ofert).
--
-- Tworzy bucket Storage `karty-techniczne` (prywatny — RLS jak reszta
-- tabel: SELECT dla każdego zalogowanego, zapis tylko Admin) oraz małą,
-- w pełni odwracalną tabelę łączącą `technology_id` z rzeczywistym
-- plikiem w tym buckecie.
--
-- Sam UPLOAD bajtów pliku wymaga wywołania Storage API (nie samego SQL)
-- z ważną sesją zalogowanego Admina — tego nie da się zrobić z tej
-- sesji (brak service_role, brak realnego logowania). Ta migracja
-- przygotowuje wyłącznie miejsce docelowe; pliki PDF wgrywa Admin przez
-- dashboard Supabase (Storage → karty-techniczne) albo przez appkę,
-- nazywając plik dokładnie kodem technologii (np. "ST_PU_24.pdf" —
-- ukośniki w kodzie zamienione na podkreślenia, bo Storage nie lubi "/"
-- w nazwie pliku w obrębie jednego "folderu").
--
-- Cofnięcie w całości:
--   drop table if exists technology_documents;
--   delete from storage.buckets where id = 'karty-techniczne';
-- ============================================================

insert into storage.buckets (id, name, public)
values ('karty-techniczne', 'karty-techniczne', false)
on conflict (id) do nothing;

drop policy if exists "karty_techniczne_select_authenticated" on storage.objects;
create policy "karty_techniczne_select_authenticated" on storage.objects
  for select to authenticated
  using (bucket_id = 'karty-techniczne');

drop policy if exists "karty_techniczne_write_admin" on storage.objects;
create policy "karty_techniczne_write_admin" on storage.objects
  for all to authenticated
  using (bucket_id = 'karty-techniczne' and app_role() = 'Admin'::app_role)
  with check (bucket_id = 'karty-techniczne' and app_role() = 'Admin'::app_role);

create table if not exists technology_documents (
  technology_id integer primary key references technologies(id) on delete cascade,
  storage_path text not null, -- ścieżka w buckecie karty-techniczne, np. "ST_PU_24.pdf"
  original_filename text,     -- oryginalna nazwa pliku .docx z Dysku, do referencji
  uploaded_at timestamp not null default now()
);

alter table technology_documents enable row level security;

drop policy if exists "select_authenticated" on technology_documents;
create policy "select_authenticated" on technology_documents for select to authenticated using (true);
drop policy if exists "write_admin" on technology_documents;
create policy "write_admin" on technology_documents for all to authenticated using (app_role() = 'Admin'::app_role) with check (app_role() = 'Admin'::app_role);
