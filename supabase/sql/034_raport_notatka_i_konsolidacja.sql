-- ============================================================
-- Decyzja B (docs/PROCES_RAPORTOWANIE_BRYGADZISTA.md, §5): jedna,
-- dowolna notatka tekstowa na cały raport dzienny (nie formalna ścieżka
-- "odrzuć raport" — to zostaje telefonem między brygadzistą a adminem).
--
-- Przy okazji: KONSOLIDACJA submit_daily_report. 012_faza7_km_koszty.sql
-- dodał parametr `p_km` PRZEZ DROP + CREATE nowej, 6-argumentowej wersji
-- funkcji. 025_moje_raporty_autor.sql zrobił CREATE OR REPLACE z powrotem
-- na 5 argumentach (bez p_km!), ale bez uprzedniego DROP tej 6-argumentowej
-- wersji z 012 — Postgres traktuje różną liczbę argumentów jako OSOBNE
-- przeciążenie, więc od 025 w bazie istniały RÓWNOLEGLE dwie wersje tej
-- funkcji:
--   - 5-arg (025): ma submittedByProfileId, NIE MA p_km/stage_name/category,
--   - 6-arg (012, wciąż aktywna): ma p_km/stage_name/category, NIE MA
--     submittedByProfileId.
-- `lib/data/reports.ts` woła RPC zawsze z 6 argumentami (łącznie z p_km),
-- więc PostgREST wiąże wywołanie z wersją z 012 — co oznacza, że
-- "submittedByProfileId" NIGDY nie było realnie ustawiane w produkcji od
-- czasu wdrożenia 025, mimo że migracja przeszła bez błędu. Efekt:
-- "Moje raporty" (saved-reports-screen.tsx) pokazywało WSZYSTKIE raporty
-- każdemu brygadziście (fallback na "autor nieznany, pokaż wszystkim"
-- uruchamiał się zawsze, bo kolumna była zawsze null) zamiast tylko
-- własne. Ta migracja usuwa OBA stare przeciążenia i zostawia jedną,
-- kompletną wersję z wszystkimi funkcjami naraz.
--
-- Uruchom PO 025. Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

alter table reports add column if not exists note text;

drop function if exists submit_daily_report(integer, date, jsonb, jsonb, jsonb);
drop function if exists submit_daily_report(integer, date, jsonb, jsonb, jsonb, decimal);

create or replace function submit_daily_report(
  p_build_id integer,
  p_date date,
  p_people jsonb,
  p_materials jsonb,
  p_extra_costs jsonb,
  p_km decimal default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_build_status build_status;
  v_report_id integer;
  v_existing_status report_status;
  v_item jsonb;
  v_material_id integer;
  v_used_quantity decimal;
  v_reason text;
  v_stage_name text;
  v_assignment build_materials;
  v_delta decimal;
  v_cost decimal;
  v_employee_id integer;
  v_start text;
  v_end text;
  v_km_rate decimal;
  v_km_rate_applied decimal;
  v_km_cost decimal;
  v_result_materials jsonb := '[]'::jsonb;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);

  select status into v_build_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_build_status = 'zamknięta' then
    raise exception 'Ta budowa jest zamknięta — nie można już dodawać raportów.';
  end if;

  select id, status into v_report_id, v_existing_status
    from reports where "buildId" = p_build_id and date = p_date;
  if v_report_id is not null and v_existing_status = 'approved' then
    raise exception 'Zatwierdzonego raportu nie można już edytować.';
  end if;

  -- Stawka zamrażana przy KAŻDYM zapisie raportu (nie tylko przy
  -- pierwszym), tak samo jak ceny partii w FIFO: brygadzista może
  -- poprawiać roboczy raport kilka razy tego samego dnia, ma dostać
  -- aktualną stawkę z każdym zapisem, dopóki raport nie jest approved
  -- (a approved i tak nie da się już edytować, patrz wyżej).
  if p_km is not null then
    select km_rate into v_km_rate from settings where id = true;
    v_km_rate_applied := coalesce(v_km_rate, 0);
    v_km_cost := p_km * v_km_rate_applied;
  else
    v_km_rate_applied := null;
    v_km_cost := null;
  end if;

  if v_report_id is null then
    insert into reports ("buildId", date, status, km, "kmRateApplied", "kmCost", note, "submittedByProfileId")
      values (p_build_id, p_date, 'submitted', p_km, v_km_rate_applied, v_km_cost, p_note, auth.uid())
      returning id into v_report_id;
  else
    -- "submittedByProfileId" celowo NIE jest tu nadpisywane — patrz
    -- 025_moje_raporty_autor.sql: autor raportu to ten, kto go pierwszy
    -- utworzył, nawet jeśli ktoś inny (np. Admin) później go poprawia.
    -- "note" ZA TO jest nadpisywane przy każdej edycji — to bieżąca
    -- notatka brygadzisty do tego dnia, nie historyczny ślad.
    update reports set
      status = 'submitted',
      "updatedAt" = now(),
      km = p_km,
      "kmRateApplied" = v_km_rate_applied,
      "kmCost" = v_km_cost,
      note = p_note
      where id = v_report_id;
    delete from report_people where "reportId" = v_report_id;
    delete from report_materials where "reportId" = v_report_id;
    delete from report_extra_costs where "reportId" = v_report_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_materials)
  loop
    v_material_id := (v_item->>'materialId')::integer;
    v_used_quantity := (v_item->>'usedQuantity')::decimal;
    v_reason := v_item->>'reason';
    v_stage_name := v_item->>'stageName';

    select * into v_assignment from build_materials
      where "buildId" = p_build_id and "materialId" = v_material_id
      for update;
    if not found then
      continue; -- materiał nieprzypisany do budowy — pomiń, jak lokalnie
    end if;

    v_delta := v_used_quantity - v_assignment.used;
    v_cost := 0;
    if v_delta > 0.0001 then
      v_cost := fn_consume_build_lot_fifo(p_build_id, v_material_id, v_delta);
      update build_materials
        set used = v_used_quantity, "actualCost" = "actualCost" + v_cost
        where "buildId" = p_build_id and "materialId" = v_material_id;
    elsif v_delta < -0.0001 then
      -- Korekta w dół: od 035_dokladny_zwrot_partii.sql zwraca dokładnie
      -- do lota, z którego zeszło (patrz tam) — tu zostaje tylko zapis
      -- nowej wartości `used`, resztę robi ta późniejsza migracja.
      update build_materials
        set used = v_used_quantity
        where "buildId" = p_build_id and "materialId" = v_material_id;
    end if;

    insert into report_materials ("reportId", "materialId", "usedQuantity", cost, reason, stage_name)
      values (v_report_id, v_material_id, v_used_quantity, v_cost, v_reason, v_stage_name);

    v_result_materials := v_result_materials || jsonb_build_object(
      'materialId', v_material_id,
      'usedQuantity', v_used_quantity,
      'cost', v_cost
    );
  end loop;

  if jsonb_array_length(p_people) > 0 then
    delete from time_entries where date = p_date and "buildId" = p_build_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_people)
  loop
    v_employee_id := (v_item->>'employeeId')::integer;
    v_start := v_item->>'start';
    v_end := v_item->>'end';

    insert into report_people ("reportId", "employeeId", start, "end")
      values (v_report_id, v_employee_id, v_start::time, v_end::time);
    insert into time_entries ("employeeId", "buildId", date, hours, start, "end")
      values (
        v_employee_id, p_build_id, p_date,
        greatest(0, extract(epoch from (v_end::time - v_start::time)) / 3600.0),
        v_start::time, v_end::time
      );
  end loop;

  for v_item in select * from jsonb_array_elements(p_extra_costs)
  loop
    insert into report_extra_costs ("reportId", label, amount, note, category)
      values (v_report_id, v_item->>'label', (v_item->>'amount')::decimal, v_item->>'note', v_item->>'category');
  end loop;

  return jsonb_build_object(
    'reportId', v_report_id,
    'materials', v_result_materials,
    'km', p_km,
    'kmRateApplied', v_km_rate_applied,
    'kmCost', v_km_cost
  );
end;
$$;

grant execute on function submit_daily_report(integer, date, jsonb, jsonb, jsonb, decimal, text) to authenticated;
