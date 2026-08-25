-- ============================================================
-- Włącza Supabase Realtime (postgres_changes) na tabeli `time_entries`.
--
-- `time_entries` nigdy wcześniej nie było czytane z powrotem przez
-- appkę (patrz lib/data/time-entries.ts — nowy plik) — koszt robocizny
-- w Rozliczeniu (settlement-screen.tsx) żył wyłącznie z lokalnego stanu
-- klienta (AsyncStorage / optymistyczna aktualizacja przy wysyłce
-- raportu), więc na innym urządzeniu albo po odświeżeniu strony zawsze
-- wychodził pusty, mimo że `submit_daily_report` (RPC) faktycznie
-- wstawia tam wiersze przy każdej wysyłce raportu. Ta migracja + nowe
-- zapytanie w app-data.tsx (timeEntriesQuery) to naprawiają; ten wpis w
-- publikacji Realtime dodatkowo pozwala innym otwartym sesjom (np.
-- Admin patrzący na Rozliczenie) zobaczyć nowe godziny bez ręcznego
-- odświeżania.
--
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej -> Run.
-- Bezpieczne do wielokrotnego uruchomienia.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'time_entries'
  ) then
    execute 'alter publication supabase_realtime add table time_entries';
  end if;
end $$;
