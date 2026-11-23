-- ============================================================
-- 120: Koszt materiału w raporcie = koszt DNIA, nie różnica edycji (F12)
-- submit_daily_report zapisywał w report_materials.cost tylko to, co
-- doszło/zostało cofnięte przy OSTATNIM zapisie (v_cost). Po edycji
-- raportu Admin widział przy zatwierdzaniu np. "QA_Klej 11 kg → −12,00 zł".
-- Prawdziwy koszt dnia to suma ilość × cena z rozbicia na partie
-- (report_material_lots — zawiera zużycie, niedobór i storna korekt,
-- każde z etapem). Sumy budowy (build_materials.actualCost) były i są
-- poprawne — zmienia się tylko zapis per raport.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_report_day_cost(p_report_id integer, p_material_id integer, p_stage_name text)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  select coalesce(round(sum(quantity * "unitPrice"), 2), 0)
    from report_material_lots
   where "reportId" = p_report_id
     and "materialId" = p_material_id
     and stage_name is not distinct from p_stage_name;
$function$;
REVOKE EXECUTE ON FUNCTION fn_report_day_cost(integer, integer, text) FROM PUBLIC, anon;

-- Podmiana dwóch miejsc w submit_daily_report (reszta funkcji bez zmian).
DO $$
DECLARE
  d text := pg_get_functiondef('submit_daily_report(integer,date,jsonb,jsonb,jsonb,numeric,text,jsonb,integer)'::regprocedure);
  a text := 'values (v_report_id, v_material_id, v_daily_quantity, v_cost, v_reason, v_stage_name);';
  b text := '''cost'', v_cost';
BEGIN
  IF position(a in d) = 0 OR position(b in d) = 0 THEN
    RAISE EXCEPTION 'submit_daily_report ma inną treść niż oczekiwano — migracja 120 przerwana.';
  END IF;
  d := replace(d, a, 'values (v_report_id, v_material_id, v_daily_quantity, fn_report_day_cost(v_report_id, v_material_id, v_stage_name), v_reason, v_stage_name);');
  d := replace(d, b, '''cost'', fn_report_day_cost(v_report_id, v_material_id, v_stage_name)');
  EXECUTE d;
END $$;

-- Przelicz zapisane raporty.
UPDATE report_materials rm
   SET cost = fn_report_day_cost(rm."reportId", rm."materialId", rm.stage_name)
 WHERE cost IS DISTINCT FROM fn_report_day_cost(rm."reportId", rm."materialId", rm.stage_name);

COMMIT;
