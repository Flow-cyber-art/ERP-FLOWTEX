-- Czyszczenie bazy do stanu "pustego", z zachowaniem KADR, KONT
-- LOGOWANIA i TECHNOLOGII (receptur) — wariant scripts/reset-data-keep-
-- employees.sql, który kasował też technologie. Tu zostają nietknięte:
--   employees, teams, team_members       (kadry / brygady)
--   profiles                             (role kont logowania: Admin/
--                                         Brygadzista/Pracownik)
--   auth.users                           (loginy/hasła — nieruszane)
--   settings                             (globalny config appki, np. km_rate)
--   technologies, technology_stages,
--   technology_materials                 (receptury/etapy technologii)
--
-- Kasuje WSZYSTKO inne: magazyn, budowy i ich rozliczenia (razem z
-- przypisaną do budowy technologią — build_technology_snapshot i
-- build_material_plan to PLAN KONKRETNEJ BUDOWY, nie sama receptura,
-- więc znika razem z budową; sama technologia w bazie receptur
-- zostaje), raporty dzienne, zamówienia, urlopy, zdjęcia budów, status
-- etapów, portal klienta (kolumny w `builds`, więc znika razem z
-- budowami).
--
-- Bezpieczeństwo kluczy obcych: technologies/technology_stages/
-- technology_materials są WSKAZYWANE przez kasowane tabele
-- (build_technology_snapshot, build_material_plan przez technology_id/
-- linked_material_id), nigdy odwrotnie — TRUNCATE strony kasowanej nie
-- wymaga CASCADE w stronę technologii i ich nie rusza. To samo dotyczy
-- employees/teams/team_members/profiles (patrz reset-data-keep-
-- employees.sql).
--
-- RESTART IDENTITY zeruje liczniki serial (nowe budowy/materiały itd.
-- znów zaczną się od id=1) — NIE dotyczy employees/teams/technologies
-- (nie są w TRUNCATE), ich liczniki zostają tam, gdzie są.
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
  -- znika razem z całą budową; plan/snapshot technologii PRZYPISANEJ DO
  -- BUDOWY też znika, ale sama technologia w bazie receptur zostaje)
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
  -- zamówienia
  orders,
  order_items,
  -- urlopy
  leave_requests
RESTART IDENTITY CASCADE;

COMMIT;
