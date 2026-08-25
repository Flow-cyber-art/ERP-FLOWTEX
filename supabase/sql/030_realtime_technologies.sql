-- ============================================================
-- Włącza Supabase Realtime (postgres_changes) na tabeli `technologies`.
--
-- Brakowało tego od czasu wdrożenia modułu Technologia (nie było osobnej
-- migracji realtime przy tamtej fazie, w odróżnieniu od materials/
-- employees/builds w 002_realtime.sql) — efekt: po dodaniu nowej
-- technologii w zakładce Technologie, picker przypisywania technologii
-- do budowy (Budowy → Przypisz) dalej pokazywał "Brak technologii",
-- dopóki ktoś nie zrobił pełnego przeładowania strony. Patrz
-- lib/data/use-realtime-sync.ts, który po tej migracji zacznie
-- nasłuchiwać zmian na tej tabeli i odświeżać cache React Query.
--
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej -> Run.
-- Bezpieczne do wielokrotnego uruchomienia.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'technologies'
  ) then
    execute 'alter publication supabase_realtime add table technologies';
  end if;
end $$;
