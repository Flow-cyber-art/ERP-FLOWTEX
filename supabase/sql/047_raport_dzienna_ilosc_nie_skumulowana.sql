-- ============================================================
-- Zmiana modelu wejścia w `submit_daily_report`: dotąd brygadzista musiał
-- wpisywać NOWY STAN CAŁKOWITY (skumulowany od początku budowy) dla
-- każdego materiału — czyli musiał pamiętać/doliczać ręcznie to, co
-- zużył wcześniej, żeby dopisać dzisiejszą ilość na wierzchu. To
-- nienaturalne: brygadzista wie, ile zużył DZISIAJ, nie zna (i nie
-- powinien musieć pamiętać) sumy od początku budowy.
--
-- Od teraz `p_materials[].usedQuantity` to DZISIEJSZE zużycie tego
-- konkretnego raportu (to, co brygadzista faktycznie wpisuje w polu —
-- zaczynając od zera), a nie nowy stan całkowity. Baza sama dolicza to
-- do `build_materials.used` (życiowy licznik budowy) — dokładnie to,
-- o co chodziło w "do rozliczenia wartości powinien dodawać".
--
-- Konsekwencje:
--   - Nowy raport: `usedQuantity` = to, co brygadzista wpisał (dzisiejsze
--     zużycie), delta do zastosowania = ta wartość wprost.
--   - Edycja NIEZATWIERDZONEGO raportu (ten sam dzień, przed wysłaniem
--     ostatecznym / poprawka): trzeba znać, ile TEN SAM raport już
--     wcześniej wpisał dla danego materiału, żeby policzyć różnicę do
--     zastosowania (a nie całą nową wartość jeszcze raz) — stąd
--     odczyt poprzednich `report_materials` w jeden jsonb PRZED
--     kasowaniem starych wierszy (dotychczasowy kod i tak je kasował na
--     starcie, tylko nigdy wcześniej nie musiał pamiętać, co było).
--   - `report_materials.usedQuantity` też zaczyna oznaczać DZISIEJSZĄ
--     ilość tego raportu, nie skumulowaną — spójne z `report_materials
--     .cost`, który OD ZAWSZE (patrz `fn_consume_build_lot_fifo`) był
--     kosztem TYLKO delty tego wywołania, nigdy kosztem skumulowanym.
--     Ta niespójność (ilość skumulowana obok kosztu tylko-dzisiejszego)
--     była realnym błędem projektowym — ta migracja go usuwa.
--   - `build_materials.used` dalej jest skumulowany (życiowy licznik
--     budowy) — zmienia się z `used = <wpisana wartość>` na
--     `used = used + delta`, bo wejście już nie jest stanem całkowitym.
--   - Front (contexts/app-data.tsx, report-screen.tsx): pole formularza
--     przestaje startować od `assignment.used`, startuje od zera; przy
--     otwarciu istniejącego (niezatwierdzonego) raportu do edycji nadal
--     pokazuje dokładnie to, co ten raport wcześniej zapisał — bo to
--     teraz i tak jest wartość dzienna, bez przeliczeń.
--
-- fn_consume_build_lot_fifo (046) BEZ ZMIAN — i tak już przyjmuje samą
-- deltę do zdjęcia, niezależnie skąd ta delta pochodzi.
--
-- Uruchom po 046. Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

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
