-- Czyszczenie bazy do stanu "pustego", ale z zachowaniem KADR i KONT
-- LOGOWANIA — wariant scripts/reset-test-data.sql, który kasował też
-- pracowników. Tu zostają nietknięte:
--   employees, teams, team_members  (kadry / brygady)
--   profiles                        (role kont logowania: Admin/
--                                    Brygadzista/Pracownik)
--   auth.users                      (loginy/hasła — w ogóle nieruszane)
--   settings                        (globalny config appki, np. km_rate)
--
-- Kasuje WSZYSTKO inne: magazyn, budowy i ich rozliczenia, raporty
-- dzienne, technologie/receptury, zamówienia, urlopy, zdjęcia budów,
-- status etapów, portal klienta (kolumny w `builds`, więc znika razem
-- z budowami).
--
-- Bezpieczeństwo kluczy obcych: żadna z zachowanych tabel (employees/
-- teams/team_members/profiles) nie jest REFERENCED przez kasowane
-- tabele w sposób, który wymagałby CASCADE w ich stronę — kasowane
-- tabele tylko WSKAZUJĄ na employees/teams (np. builds."teamId",
-- reports/time_entries/leave_requests."employeeId"), więc ich
-- wyczyszczenie nie rusza wierszy w employees/teams/profiles. Sprawdzone
-- względem pełnej listy tabel w drizzle/schema.ts i supabase/sql/*.sql.
--
-- RESTART IDENTITY zeruje liczniki serial (nowe budowy/materiały itd.
-- znów zaczną się od id=1) — NIE dotyczy employees/teams (nie są w
-- TRUNCATE), ich liczniki zostają tam, gdzie są.
--
-- UWAGA: nieodwracalne. Zrób najpierw backup (pg_dump / snapshot
-- Supabase Dashboard -> Database -> Backups), zwłaszcza jeśli baza nie
-- jest czysto testowa.
--
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej całość -> Run
-- (edytor sam owija zapytanie w transakcję; BEGIN/COMMIT zostają jawnie
-- dla uruchomienia przez psql/CLI).

BEGIN;

TRUNCATE TABLE
  -- magazyn
  materials,
  material_batches,
  stock_movements,
  material_orders,
  -- budowy i ich rozliczenia (portal klienta to kolumny w builds, więc
  -- znika razem z całą budową)
  builds,
  build_materials,
  build_material_lots,
  build_material_returns,
  build_material_plan,
  build_settlements,
  build_settlement_materials,
  build_technology_snapshot,
  build_photos,
  build_stage_status,
  -- raporty dzienne
  reports,
  report_materials,
  report_people,
  report_extra_costs,
  report_material_lots,
  time_entries,
  -- technologie (receptury)
  technologies,
  technology_stages,
  technology_materials,
  -- zamówienia
  orders,
  order_items,
  -- urlopy
  leave_requests
RESTART IDENTITY CASCADE;

COMMIT;
