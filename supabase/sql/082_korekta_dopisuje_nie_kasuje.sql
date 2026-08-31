-- ============================================================
-- R7 (katalog ruchów magazynowych): "korekta nigdy nie modyfikuje
-- rekordu historycznego — dopisuje ruchy" (storno + nowy ruch, wzorzec
-- księgowy: nic się nie kasuje, wszystko się donotowuje).
--
-- submit_daily_report (055_stawka_zamrozona_w_godzinach.sql), gałąź
-- korekty w dół (v_delta < 0): cofała zużycie w kolejności LIFO,
-- FIZYCZNIE kasując/nadpisując wcześniejsze wiersze report_material_lots
-- (`delete from report_material_lots` / `update ... set quantity = ...`).
-- Skutek: po korekcie nie da się odtworzyć, że w ogóle się wydarzyła,
-- ani jaka była wartość przed nią — dla sporu z inwestorem/podwykonawcą
-- o realne zużycie, albo pytania "dlaczego koszt tej budowy jest inny
-- niż się spodziewaliśmy", nie ma czego pokazać.
--
-- Naprawa: report_material_lots staje się append-only. Nowa kolumna
-- "reversalOfId" (samoreferencja) — wpis korekty to ZAWSZE nowy wiersz
-- z UJEMNĄ ilością, wskazujący, KTÓRY oryginalny wpis odwraca. Oryginalne
-- wiersze (fn_consume_build_lot_fifo, 079_ksiega_ruchow_przyjecie_zuzycie.sql)
-- nigdy nie są ruszane. Ile z danego oryginalnego wpisu jeszcze "stoi"
-- (nie zostało cofnięte) liczymy na bieżąco: oryginał + suma jego
-- dotychczasowych storn — to pozwala też na WIELOKROTNE korekty tego
-- samego raportu w czasie (kolejna edycja kontynuuje LIFO tam, gdzie
-- poprzednia skończyła), bo nic nie zostaje nadpisane.
--
-- Cache stanu (build_material_lots.quantity) nadal jest inkrementowany w
-- miejscu — to bieżący stan podmagazynu, nie historia (patrz N1, osobna,
-- większa sprawa, świadomie NIE ruszana tutaj). Tu naprawiamy wyłącznie
-- to, że HISTORIA (kto co zrobił, kiedy) ma zostać nietknięta.
--
-- Przy okazji: korekta w dół dostaje też wpis w stock_movements
-- ('korekta') — wcześniej (079) księga obejmowała tylko przyjęcie i
-- zwykłe zużycie, korekta nie zostawiała żadnego śladu w ogóle.
--
-- Uruchom po 081_tozsamosc_partii_scalanie.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

alter table report_material_lots add column if not exists "reversalOfId"
  integer references report_material_lots(id) on delete set null;

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
  v_daily_quantity decimal;
  v_prev_daily decimal;
  v_prev_materials jsonb;
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
  v_qty_to_return decimal;
  v_returned_cost decimal;
  v_lot_row record;
  v_take decimal;
  v_updated integer;
  v_hourly_rate decimal;
  v_cost_rate decimal;
  v_actor text;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);
  v_actor := auth.uid()::text;

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

  if v_report_id is not null then
    select coalesce(jsonb_object_agg("materialId"::text, "usedQuantity"), '{}'::jsonb)
      into v_prev_materials
      from report_materials where "reportId" = v_report_id;
  else
    v_prev_materials := '{}'::jsonb;
  end if;

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
    -- report_material_lots NIE jest tu kasowane — to trwały, append-only
    -- rozkład "z jakiego lota ile" (patrz nagłówek pliku).
  end if;

  for v_item in select * from jsonb_array_elements(p_materials)
  loop
    v_material_id := (v_item->>'materialId')::integer;
    v_daily_quantity := (v_item->>'usedQuantity')::decimal;
    v_reason := v_item->>'reason';
    v_stage_name := v_item->>'stageName';

    select * into v_assignment from build_materials
      where "buildId" = p_build_id and "materialId" = v_material_id
      for update;
    if not found then
      continue;
    end if;

    v_prev_daily := coalesce((v_prev_materials ->> v_material_id::text)::decimal, 0);
    v_delta := v_daily_quantity - v_prev_daily;
    v_cost := 0;

    if v_delta > 0.0001 then
      v_cost := fn_consume_build_lot_fifo(p_build_id, v_material_id, v_delta, v_report_id);
      update build_materials
        set used = v_assignment.used + v_delta, "actualCost" = "actualCost" + v_cost
        where "buildId" = p_build_id and "materialId" = v_material_id;

    elsif v_delta < -0.0001 then
      -- Korekta w dół: cofnij DOKŁADNIE tyle, ile ten raport sam dołożył
      -- (i jeszcze nie cofnął wcześniejszą korektą), w kolejności LIFO
      -- (od ostatniego ORYGINALNEGO wpisu tego raportu dla tego materiału
      -- wstecz), po realnej cenie każdego kawałka. Append-only: żaden
      -- wiersz report_material_lots nie jest tu kasowany ani nadpisywany
      -- — cofnięcie to nowy wiersz z ujemną ilością, powiązany przez
      -- "reversalOfId" z oryginałem, którego dotyczy.
      v_qty_to_return := -v_delta;
      v_returned_cost := 0;

      for v_lot_row in
        select
          rml.id, rml."lotId", rml."sourceBatchId", rml."unitPrice",
          rml.quantity + coalesce(rev.reversed, 0) as outstanding
        from report_material_lots rml
        left join (
          select "reversalOfId", sum(quantity) as reversed
            from report_material_lots
            where "reversalOfId" is not null
            group by "reversalOfId"
        ) rev on rev."reversalOfId" = rml.id
        where rml."reportId" = v_report_id and rml."materialId" = v_material_id
          and rml."reversalOfId" is null
        order by rml.id desc
        for update of rml
      loop
        exit when v_qty_to_return <= 0.0001;
        if v_lot_row.outstanding <= 0.0001 then
          continue; -- ten oryginalny wpis już w pełni cofnięty wcześniejszą korektą
        end if;
        v_take := least(v_lot_row.outstanding, v_qty_to_return);

        if v_lot_row."lotId" is not null then
          update build_material_lots set quantity = quantity + v_take
            where id = v_lot_row."lotId";
          get diagnostics v_updated = row_count;
        else
          v_updated := 0;
        end if;
        if v_updated = 0 then
          -- Oryginalny lot już nie istnieje (w pełni zużyty przez inny,
          -- późniejszy raport tej samej budowy) — odtwórz go jako nowy
          -- wiersz, tą samą ceną (bez uśredniania).
          insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
            values (p_build_id, v_material_id, v_lot_row."sourceBatchId", v_take, v_lot_row."unitPrice", now());
        end if;

        v_returned_cost := v_returned_cost + v_take * v_lot_row."unitPrice";

        -- STORNO — nowy wiersz, ujemna ilość, wskazuje oryginał. Oryginał
        -- (v_lot_row) pozostaje nietknięty.
        insert into report_material_lots
            ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice", "reversalOfId")
          values (v_report_id, v_material_id, v_lot_row."lotId", v_lot_row."sourceBatchId", -v_take, v_lot_row."unitPrice", v_lot_row.id);

        insert into stock_movements
            ("type", "materialId", "buildId", "batchId", "lotId", "reportId", quantity, "unitPrice", note, "createdByProfileId")
          values ('korekta', v_material_id, p_build_id, v_lot_row."sourceBatchId", v_lot_row."lotId", v_report_id, v_take, v_lot_row."unitPrice",
                  'Korekta w dół — storno zużycia z raportu', v_actor);

        v_qty_to_return := v_qty_to_return - v_take;
      end loop;
      -- v_qty_to_return > 0 tu oznaczałoby, że cofamy więcej niż ten
      -- raport kiedykolwiek zapisał dla tego materiału — nie powinno się
      -- zdarzyć, więc celowo bez twardego błędu: reszta po prostu
      -- zostaje niecofnięta zamiast blokować zapis całego raportu.

      v_cost := -v_returned_cost;
      update build_materials
        set used = greatest(v_assignment.used + v_delta, 0), "actualCost" = greatest("actualCost" - v_returned_cost, 0)
        where "buildId" = p_build_id and "materialId" = v_material_id;
    end if;

    insert into report_materials ("reportId", "materialId", "usedQuantity", cost, reason, stage_name)
      values (v_report_id, v_material_id, v_daily_quantity, v_cost, v_reason, v_stage_name);

    v_result_materials := v_result_materials || jsonb_build_object(
      'materialId', v_material_id,
      'usedQuantity', v_daily_quantity,
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

    select "hourlyRate", "costRate" into v_hourly_rate, v_cost_rate
      from employees where id = v_employee_id;

    insert into report_people ("reportId", "employeeId", start, "end")
      values (v_report_id, v_employee_id, v_start::time, v_end::time);
    insert into time_entries ("employeeId", "buildId", date, hours, start, "end", "hourlyRate", "costRate")
      values (
        v_employee_id, p_build_id, p_date,
        greatest(0, extract(epoch from (v_end::time - v_start::time)) / 3600.0),
        v_start::time, v_end::time,
        v_hourly_rate, v_cost_rate
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
