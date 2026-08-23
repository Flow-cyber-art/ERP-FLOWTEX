-- ============================================================
-- Fix: brak odświeżania materiałów na żywo po zmianie na magazynie
-- (nowa partia, przyjęcie zamówienia, korekta stanu) — widoczne np.
-- podczas przypisywania materiałów do budowy.
--
-- lib/data/use-realtime-sync.ts od dawna subskrybuje postgres_changes
-- na `material_batches` (queryKey "warehouseBatches"), ale ŻADNA
-- migracja nigdy nie dodała tej tabeli do publikacji
-- `supabase_realtime` — 002_realtime.sql objął tylko `materials`
-- (zdenormalizowany, zbiorczy stan), nie same partie. Efekt: zmiana w
-- `material_batches` u jednego admina nie budziła zapytania
-- `warehouseBatches` u innych zalogowanych klientów, dopóki ktoś ręcznie
-- nie odświeżył strony. Uruchom raz, bezpieczne do wielokrotnego
-- wklejenia.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'material_batches'
  ) then
    execute 'alter publication supabase_realtime add table material_batches';
  end if;
end $$;
