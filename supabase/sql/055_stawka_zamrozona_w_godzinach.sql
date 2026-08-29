-- ============================================================
-- "Zmiana stawki pracownika idzie w przód, nie wstecz" — dotąd nie było
-- to prawdą: koszt robocizny (close_build) i wypłata (payroll-screen.tsx)
-- liczyły się jako godziny/dni × employees."hourlyRate" CZYTANE NA
-- BIEŻĄCO, a nie stawka obowiązująca w dniu, w którym te godziny
-- faktycznie przepracowano. Podniesienie stawki dziś przeliczało też
-- (jeszcze nierozliczone) godziny sprzed tygodni. To ten sam problem,
-- jaki dla cen materiałów rozwiązuje "unitPrice" zamrożone w
-- build_material_lots w momencie przypisania — teraz robimy analogicznie
-- dla stawek: "hourlyRate"/"costRate" zamrożone w time_entries w
-- momencie zapisania godzin (submit_daily_report), nie doczytywane z
-- employees przy każdym wyliczeniu kosztu.
--
-- Bezpieczeństwo: stawka jest wrażliwa tak samo jak employees."hourlyRate"
-- (044_ukryj_stawki_pracownikow.sql, 048_stawka_kosztowa_pracownika.sql)
-- — REVOKE tych dwóch kolumn z `authenticated` + funkcja `get_time_entries`
-- (ten sam wzorzec co `get_employees`), zwracająca realną wartość tylko
-- dla Admina.
--
-- Uruchom PO 048_stawka_kosztowa_pracownika.sql i
-- 053_zwrot_do_usunietej_partii_przy_zamknieciu.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

alter table time_entries add column if not exists "hourlyRate" decimal(10, 2);
alter table time_entries add column if not exists "costRate" decimal(10, 2);

-- Wpisy sprzed tej migracji nie mają jak znać stawki "z dnia" — jedyny
-- rozsądny backfill to aktualna stawka pracownika w chwili uruchomienia
-- tej migracji (lepsze niż null/0, ale to jednorazowe przybliżenie —
-- WSZYSTKIE wpisy od teraz są już poprawnie zamrożone przy zapisie).
update time_entries te
  set "hourlyRate" = e."hourlyRate", "costRate" = e."costRate"
  from employees e
  where e.id = te."employeeId" and te."hourlyRate" is null;

revoke select ("hourlyRate", "costRate") on time_entries from authenticated;

create or replace function get_time_entries()
returns table (
  id integer,
  date date,
  "buildId" integer,
  "employeeId" integer,
  hours decimal,
  start time,
  "end" time,
  "hourlyRate" decimal,
  "costRate" decimal
)
language sql
security definer
stable
set search_path = public
as $$
  select
    t.id, t.date, t."buildId", t."employeeId", t.hours, t.start, t."end",
    case when app_role() = 'Admin' then t."hourlyRate" else null end as "hourlyRate",
    case when app_role() = 'Admin' then t."costRate" else null end as "costRate"
  from time_entries t
  order by t.date desc;
$$;

grant execute on function get_time_entries() to authenticated;

-- submit_daily_report (047_raport_dzienna_ilosc_nie_skumulowana.sql) —
-- IDENTYCZNA logika, jedyna zmiana: insert do time_entries dogrywa
-- stawki pracownika z MOMENTU zapisu godzin, nie zostawia ich pustych.
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

  -- Ile TEN raport (jeśli już istnieje) wcześniej zapisał per materiał —
  -- potrzebne PRZED skasowaniem starych report_materials niżej, żeby przy
  -- edycji policzyć różnicę względem poprzedniej wersji tego samego
  -- raportu, a nie względem całego życiowego licznika budowy.
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
    -- report_material_lots NIE jest tu kasowane jak reszta powyżej — to
    -- trwały rozkład "z jakiego lota ile", nie treść samego raportu; musi
    -- przetrwać między zapisami, żeby korekta w dół miała co cofać.
  end if;

  for v_item in select * from jsonb_array_elements(p_materials)
  loop
    v_material_id := (v_item->>'materialId')::integer;
    -- DZISIEJSZE zużycie z formularza brygadzisty (od zera), NIE nowy
    -- stan całkowity — patrz nagłówek pliku.
    v_daily_quantity := (v_item->>'usedQuantity')::decimal;
    v_reason := v_item->>'reason';
    v_stage_name := v_item->>'stageName';

    select * into v_assignment from build_materials
      where "buildId" = p_build_id and "materialId" = v_material_id
      for update;
    if not found then
      continue; -- materiał nieprzypisany do budowy — pomiń, jak lokalnie
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
      -- Korekta w dół: cofnij DOKŁADNIE tyle, ile ten raport sam dołożył,
      -- w kolejności LIFO (od ostatnio zapisanego wpisu tego raportu dla
      -- tego materiału wstecz), po realnej cenie każdego kawałka.
      v_qty_to_return := -v_delta;
      v_returned_cost := 0;

      for v_lot_row in
        select id, "lotId", "sourceBatchId", quantity, "unitPrice"
          from report_material_lots
          where "reportId" = v_report_id and "materialId" = v_material_id
          order by id desc
          for update
      loop
        exit when v_qty_to_return <= 0.0001;
        v_take := least(v_lot_row.quantity, v_qty_to_return);

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
          -- wiersz, tą samą ceną (bez uśredniania, patrz nagłówek pliku).
          insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
            values (p_build_id, v_material_id, v_lot_row."sourceBatchId", v_take, v_lot_row."unitPrice", now());
        end if;

        v_returned_cost := v_returned_cost + v_take * v_lot_row."unitPrice";

        if v_take >= v_lot_row.quantity - 0.0001 then
          delete from report_material_lots where id = v_lot_row.id;
        else
          update report_material_lots set quantity = v_lot_row.quantity - v_take where id = v_lot_row.id;
        end if;

        v_qty_to_return := v_qty_to_return - v_take;
      end loop;
      -- v_qty_to_return > 0 tu oznaczałoby, że cofamy więcej niż ten
      -- raport kiedykolwiek zapisał dla tego materiału — nie powinno się
      -- zdarzyć (delta liczona względem poprzedniej wersji TEGO SAMEGO
      -- raportu), więc celowo bez twardego błędu: reszta po prostu
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

    -- Stawka ZAMROŻONA w chwili zapisu godzin (patrz nagłówek pliku) —
    -- kolejna zmiana employees."hourlyRate"/"costRate" nie rusza już
    -- tego wiersza.
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

-- close_build (053_zwrot_do_usunietej_partii_przy_zamknieciu.sql) —
-- IDENTYCZNA logika, jedyna zmiana: koszt robocizny liczy się z zamrożonej
-- stawki na time_entries, nie z aktualnej employees."hourlyRate"
-- (fallback na employees tylko dla wpisów sprzed backfillu wyżej, gdyby
-- go pominięto).
create or replace function close_build(p_build_id integer, p_returns jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_build builds;
  v_pending_count integer;
  v_total_hours decimal;
  v_labor_cost decimal;
  v_materials_cost decimal;
  v_total_extra_costs decimal;
  v_waste_cost decimal := 0;
  v_total_cost decimal;
  v_ret jsonb;
  v_material_id integer;
  v_batch_id integer;
  v_qty decimal;
  v_decision text;
  v_reason text;
  v_lot_price decimal;
  v_lot_id integer;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_build from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_build.status = 'zamknięta' then
    return;
  end if;

  select count(*) into v_pending_count from reports
    where "buildId" = p_build_id and status <> 'approved';
  if v_pending_count > 0 then
    raise exception 'Nie wszystkie raporty tej budowy są zatwierdzone — zatwierdź je przed zamknięciem.';
  end if;

  -- Pozostałość materiałowa: zwrot na magazyn albo do wyrzucenia.
  for v_ret in select * from jsonb_array_elements(p_returns)
  loop
    v_material_id := (v_ret->>'materialId')::integer;
    v_batch_id := nullif(v_ret->>'batchId', '')::integer;
    v_qty := (v_ret->>'quantity')::decimal;
    v_decision := v_ret->>'decision';
    v_reason := v_ret->>'reason';

    if v_qty is null or v_qty <= 0 then
      continue;
    end if;
    if v_decision not in ('zwrot', 'wyrzucenie') then
      raise exception 'Nieprawidłowa decyzja rozliczenia materiału #%: %', v_material_id, v_decision;
    end if;

    select id into v_lot_id
      from build_material_lots
      where "buildId" = p_build_id and "materialId" = v_material_id
        and "sourceBatchId" is not distinct from v_batch_id and quantity >= v_qty - 0.0001
      order by id asc
      limit 1
      for update;
    if v_lot_id is null then
      raise exception 'Ilość do rozliczenia (materiał #%, partia #%) przekracza pozostałość na budowie.',
        v_material_id, v_batch_id;
    end if;

    update build_material_lots set quantity = quantity - v_qty
      where id = v_lot_id
      returning "unitPrice" into v_lot_price;
    delete from build_material_lots where id = v_lot_id and quantity <= 0.0001;

    if v_decision = 'zwrot' then
      if v_batch_id is not null then
        update material_batches set quantity = quantity + v_qty where id = v_batch_id;
      else
        insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source)
          values (v_material_id, v_qty, v_lot_price, current_date, 'zwrot z budowy');
      end if;
      perform fn_recalc_material(v_material_id);
    else
      v_waste_cost := v_waste_cost + v_qty * v_lot_price;
    end if;

    insert into build_material_returns ("buildId", "materialId", "batchId", quantity, decision, reason, "unitPrice")
      values (p_build_id, v_material_id, v_batch_id, v_qty, v_decision::return_decision, v_reason, v_lot_price);
  end loop;

  -- Robocizna: stawka zamrożona na TYM konkretnym wpisie godzin
  -- (time_entries."hourlyRate") — nie aktualna stawka pracownika. Fallback
  -- na employees."hourlyRate" tylko dla wierszy bez zamrożonej wartości
  -- (nie powinno się zdarzać po backfillu w 055, ale bez tego stare/
  -- pominięte wiersze liczyłyby się jako 0 zamiast najlepszego przybliżenia).
  select coalesce(sum(t.hours), 0),
         coalesce(sum(t.hours * coalesce(t."hourlyRate", e."hourlyRate", 0)), 0)
    into v_total_hours, v_labor_cost
    from time_entries t
    join employees e on e.id = t."employeeId"
    where t."buildId" = p_build_id;

  select coalesce(sum("actualCost"), 0) into v_materials_cost from build_materials
    where "buildId" = p_build_id;

  select coalesce(sum(rec.amount), 0) into v_total_extra_costs
    from report_extra_costs rec
    join reports r on r.id = rec."reportId"
    where r."buildId" = p_build_id;

  v_total_cost := v_materials_cost + v_labor_cost + v_total_extra_costs + v_waste_cost;

  insert into build_settlements (
    "buildId", "totalHours", "totalExtraCosts", "materialsCost", "laborCost", "wasteCost", "totalCost"
  ) values (
    p_build_id, v_total_hours, v_total_extra_costs, v_materials_cost, v_labor_cost, v_waste_cost, v_total_cost
  )
  on conflict ("buildId") do update set
    "closedAt" = now(),
    "totalHours" = excluded."totalHours",
    "totalExtraCosts" = excluded."totalExtraCosts",
    "materialsCost" = excluded."materialsCost",
    "laborCost" = excluded."laborCost",
    "wasteCost" = excluded."wasteCost",
    "totalCost" = excluded."totalCost";

  delete from build_settlement_materials where "buildId" = p_build_id;
  insert into build_settlement_materials ("buildId", "materialId", planned, used, "unitPrice", "actualCost")
    select "buildId", "materialId", planned, used, "unitPrice", "actualCost"
      from build_materials where "buildId" = p_build_id;

  update builds set status = 'zamknięta', "updatedAt" = now() where id = p_build_id;
end;
$$;

grant execute on function close_build(integer, jsonb) to authenticated;
