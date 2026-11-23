-- ============================================================
-- Czyszczenie z 23.11.2026: kasuje WSZYSTKIE budowy, raporty, zamówienia
-- i magazyn + dane testów QA. ZOSTAWIA technologie (etapy, receptury,
-- karty PDF), pracowników, konta, brygady, podwykonawców, oferty, ustawienia.
--
-- Uruchom w Supabase Dashboard -> SQL Editor (całość naraz).
-- Jedna transakcja: na końcu strażnik porównuje liczności technologii,
-- pracowników, kont i ofert — przy rozbieżności wszystko się cofa.
-- NIEODWRACALNE — najpierw backup (Database -> Backups).
-- ============================================================

BEGIN;

CREATE TEMP TABLE _guard ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM technologies WHERE name <> 'QA_Technologia')  AS tech,
  (SELECT count(*) FROM technology_stages s JOIN technologies t ON t.id=s.technology_id WHERE t.name <> 'QA_Technologia') AS stages,
  (SELECT count(*) FROM technology_materials m JOIN technology_stages s ON s.id=m.stage_id JOIN technologies t ON t.id=s.technology_id WHERE t.name <> 'QA_Technologia') AS tech_materials,
  (SELECT count(*) FROM employees WHERE name NOT LIKE 'QA\_%') AS employees,
  (SELECT count(*) FROM auth.users WHERE email NOT LIKE 'qa-%@flowtex-qa.test') AS users,
  (SELECT count(*) FROM offers WHERE ref IS DISTINCT FROM 'QA-OF-1') AS offers;

-- 1) odepnij receptury technologii od magazynu (materiały znikną)
UPDATE technology_materials SET linked_material_id = NULL WHERE linked_material_id IS NOT NULL;

-- 2) budowy + wszystko zależne, raporty, godziny, zamówienia, magazyn
TRUNCATE TABLE
  subcontract_acceptance_items, subcontract_acceptances, build_subcontracts, build_teams,
  report_stage_progress, report_material_lots, report_materials, report_people, report_extra_costs, reports,
  stock_movements, time_entries,
  build_material_lots, build_material_returns, build_material_plan, build_materials,
  build_settlement_materials, build_settlements, build_technology_snapshot, build_photos, build_stage_status,
  order_items, orders, material_orders, material_batches,
  builds
RESTART IDENTITY;

DELETE FROM materials;
DO $$ DECLARE seq text := pg_get_serial_sequence('materials','id');
BEGIN IF seq IS NOT NULL THEN EXECUTE format('ALTER SEQUENCE %s RESTART WITH 1', seq); END IF; END $$;

-- 3) dane testów QA (konta qa-*, pracownicy/brygady QA_*, podwykonawca, technologia, oferta, urlopy)
DELETE FROM offers WHERE ref = 'QA-OF-1';
DELETE FROM technologies WHERE name = 'QA_Technologia';
DELETE FROM leave_requests WHERE "employeeId" IN (SELECT id FROM employees WHERE name LIKE 'QA\_%');
DELETE FROM superadmins WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'qa-%@flowtex-qa.test');
DELETE FROM profiles WHERE id IN (SELECT id FROM auth.users WHERE email LIKE 'qa-%@flowtex-qa.test');
DELETE FROM auth.users WHERE email LIKE 'qa-%@flowtex-qa.test';
DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE name LIKE 'QA\_%');
DELETE FROM teams WHERE name LIKE 'QA\_%';
DELETE FROM subcontractors WHERE name = 'QA_Podwykonawca';
DELETE FROM employees WHERE name LIKE 'QA\_%';

-- 4) strażnik
DO $$ DECLARE g record;
BEGIN
  SELECT * INTO g FROM _guard;
  IF (SELECT count(*) FROM technologies) <> g.tech
  OR (SELECT count(*) FROM technology_stages) <> g.stages
  OR (SELECT count(*) FROM technology_materials) <> g.tech_materials
  OR (SELECT count(*) FROM employees) <> g.employees
  OR (SELECT count(*) FROM auth.users) <> g.users
  OR (SELECT count(*) FROM offers) <> g.offers THEN
    RAISE EXCEPTION 'Strażnik: niezgodne liczności — wycofuję całą transakcję.';
  END IF;
END $$;

COMMIT;

-- Kontrola (budowy/raporty/materiały/zamówienia = 0, technologie bez zmian):
SELECT (SELECT count(*) FROM builds) builds, (SELECT count(*) FROM reports) reports, (SELECT count(*) FROM materials) materials,
       (SELECT count(*) FROM orders) orders, (SELECT count(*) FROM time_entries) time_entries,
       (SELECT count(*) FROM technologies) technologies, (SELECT count(*) FROM technology_materials) tech_materials,
       (SELECT count(*) FROM employees) employees, (SELECT count(*) FROM auth.users) users;
