-- Czyszczenie bazy do stanu testowego: zostaje TYLKO tabela `users`
-- (żeby dało się zalogować) oraz `settings` (jednowierszowy globalny
-- config appki — kmRate; wyczyszczenie go zepsułoby appkę, bo id jest
-- tam stałym `true`, nie danymi testowymi).
--
-- Kasuje WSZYSTKO inne, w tym `technologies` / `technology_stages` /
-- `technology_materials`, zgodnie z prośbą. RESTART IDENTITY zeruje
-- też liczniki serial (nowe rekordy znów zaczną się od id=1).
--
-- UWAGA: nieodwracalne. Zrób najpierw backup (pg_dump / snapshot
-- Supabase), zwłaszcza jeśli baza nie jest czysto testowa.
--
-- Uruchom całość jako jedną transakcję (psql -f, albo w Supabase SQL
-- Editor — tam BEGIN/COMMIT można pominąć, edytor i tak owija w
-- transakcję, ale zostawiam je jawnie dla psql/CLI).

BEGIN;

TRUNCATE TABLE
  -- kadry / brygady
  employees,
  teams,
  -- magazyn
  materials,
  material_batches,
  stock_movements,
  material_orders,
  -- budowy i ich rozliczenia
  builds,
  build_materials,
  build_material_lots,
  build_material_returns,
  build_material_plan,
  build_settlements,
  build_settlement_materials,
  -- raporty dzienne
  reports,
  report_materials,
  report_people,
  report_extra_costs,
  time_entries,
  -- technologie (receptury)
  technologies,
  technology_stages,
  technology_materials,
  build_technology_snapshot,
  -- zamówienia (moduł orders/order_items)
  orders,
  order_items
RESTART IDENTITY CASCADE;

COMMIT;
