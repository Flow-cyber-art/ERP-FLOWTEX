-- ============================================================
-- Kasuje dane BUDÓW i MATERIAŁÓW (magazyn, zamówienia, raporty,
-- rozliczenia, zdjęcia), ZOSTAWIA technologie i całą resztę.
--
-- ZOSTAJE (nie ruszane):
--   technologies, technology_stages, technology_materials,
--   technology_documents (podpięte karty PDF), offer_* (oferty i pilotaż),
--   employees, teams, team_members, profiles, auth.users, settings,
--   leave_requests (urlopy to dane kadrowe, nie budów/materiałów).
--
-- KASUJE:
--   magazyn:   materials, material_batches, stock_movements, material_orders
--   budowy:    builds, build_materials, build_material_lots,
--              build_material_returns, build_material_plan,
--              build_settlements, build_settlement_materials,
--              build_technology_snapshot, build_photos, build_stage_status
--   raporty:   reports, report_materials, report_people,
--              report_extra_costs, report_material_lots, time_entries
--   zamówienia: orders, order_items
--
-- PUŁAPKA, którą ten skrypt omija (inaczej niż scripts/reset-data-keep-
-- technologies...): technology_materials.linked_material_id wskazuje na
-- materials. TRUNCATE materials ... CASCADE ZGASIŁBY przez to także
-- technology_materials (receptury technologii bez materiałów!). Dlatego:
--   1) odpinamy technology_materials od magazynu (linked_material_id = NULL),
--   2) TRUNCATE listy bez `materials` i BEZ CASCADE (jeśli istnieje jakaś
--      nieznana tabela zależna, Postgres przerwie zamiast kasować po cichu),
--   3) materials kasujemy zwykłym DELETE (FK z technologii to SET NULL),
--   4) na końcu strażnik porównuje liczności technologii/etapów/materiałów
--      technologii/pracowników z tymi sprzed — jeśli coś się różni, cała
--      transakcja się cofa (RAISE EXCEPTION).
--
-- Nowe budowy/materiały znów zaczną numerację id od 1 (RESTART IDENTITY).
--
-- UWAGA: NIEODWRACALNE. Najpierw backup (Supabase Dashboard -> Database ->
-- Backups). Uruchom w SQL Editorze (jedna transakcja).
-- ============================================================

BEGIN;

CREATE TEMP TABLE _guard ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM technologies)          AS tech,
  (SELECT count(*) FROM technology_stages)     AS stages,
  (SELECT count(*) FROM technology_materials)  AS tech_materials,
  (SELECT count(*) FROM employees)             AS employees;

-- 1) odepnij receptury od magazynu
UPDATE technology_materials SET linked_material_id = NULL WHERE linked_material_id IS NOT NULL;

-- 2) wszystko oprócz `materials`, bez CASCADE
TRUNCATE TABLE
  material_batches,
  stock_movements,
  material_orders,
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
  reports,
  report_materials,
  report_people,
  report_extra_costs,
  report_material_lots,
  time_entries,
  orders,
  order_items
RESTART IDENTITY;

-- 3) magazyn: zwykły DELETE (technology_materials ma FK ON DELETE SET NULL)
DELETE FROM materials;
DO $$
DECLARE seq text := pg_get_serial_sequence('materials', 'id');
BEGIN
  IF seq IS NOT NULL THEN EXECUTE format('ALTER SEQUENCE %s RESTART WITH 1', seq); END IF;
END $$;

-- 4) strażnik: technologie i kadry muszą być nietknięte
DO $$
DECLARE g record;
BEGIN
  SELECT * INTO g FROM _guard;
  IF (SELECT count(*) FROM technologies)         <> g.tech
  OR (SELECT count(*) FROM technology_stages)    <> g.stages
  OR (SELECT count(*) FROM technology_materials) <> g.tech_materials
  OR (SELECT count(*) FROM employees)            <> g.employees THEN
    RAISE EXCEPTION 'Strażnik: zmieniła się liczność technologii/etapów/materiałów technologii/pracowników — wycofuję całą transakcję.';
  END IF;
END $$;

COMMIT;

-- Kontrola po uruchomieniu (powinno: budowy i materiały = 0, technologie bez zmian):
--   select (select count(*) from builds) builds, (select count(*) from materials) materials,
--          (select count(*) from technologies) technologies,
--          (select count(*) from technology_materials) technology_materials;
