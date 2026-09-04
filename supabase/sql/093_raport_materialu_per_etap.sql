-- ============================================================
-- Materiał raportowany OSOBNO na każdy etap technologii, w którym
-- występuje — nie jedną, zbiorczą liczbą.
--
-- Zgłoszony problem: technologia potrafi używać tego samego materiału w
-- dwóch różnych etapach (np. piasek jako zasyp po gruntowaniu I pod
-- warstwą zamykającą). Ekran brygadzisty pokazywał ten materiał w OBU
-- sekcjach etapów, ale oba pola pisały do tego samego jednego wiersza
-- `report_materials` (PRIMARY KEY (reportId, materialId) — baza fizycznie
-- nie pozwalała na dwa wiersze tego samego materiału w jednym raporcie).
-- Efekt: jeden numer, przypisany zawsze do PIERWSZEGO etapu, w którym
-- materiał występuje w planie (`.find()` w app-data.tsx/report-screen.tsx)
-- — drugi etap nigdy nie widział żadnego zużycia, mimo że materiał tam
-- faktycznie trafił. To bezpośrednio psuło procent postępu etapu
-- (089/090_portal_klienta_*) i rozbicie kosztów w Rozliczeniu dla
-- każdego materiału powtarzającego się w więcej niż jednym etapie.
--
-- Naprawa (razem z odpowiadającymi zmianami we froncie — report-screen.tsx,
-- contexts/app-data.tsx, components/report-ui.tsx, lib/material-report-key.ts):
--   1. report_materials: PRIMARY KEY (reportId, materialId) zastąpiony
--      surogatowym `id` + UNIQUE (reportId, materialId, stage_name)
--      NULLS NOT DISTINCT (Postgres 15+) — pozwala na wiele wierszy tego
--      samego materiału w jednym raporcie, o ile mają różny stage_name;
--      materiał pomocniczy (stage_name = null) nadal ograniczony do
--      JEDNEGO wiersza (nulle traktowane jak każda inna, równa sobie
--      wartość, nie "każdy null inny" jak w domyślnym unique index).
--   2. report_material_lots: dopisana kolumna stage_name — bez niej
--      korekta raportu w dół (storno, patrz submit_daily_report niżej)
--      przy materiale rozbitym na dwa etapy w TYM SAMYM raporcie cofałaby
--      zużycie z partii bez rozróżnienia, któremu etapowi ono
--      odpowiadało (dopasowanie po reportId+materialId, teraz +stage_name).
--   3. fn_consume_build_lot_fifo: nowy parametr p_stage_name, stemplowany
--      na report_material_lots przy zdejmowaniu partii.
--   4. submit_daily_report: p_materials może teraz zawierać WIĘCEJ NIŻ
--      JEDEN wpis dla tego samego materialId (różny stageName) — delta
--      "co ten raport zmienił od poprzedniej wersji" liczona jest per
--      (materialId, stageName), nie per sam materialId; storno przy
--      korekcie w dół dopasowuje partie po (reportId, materialId,
--      stage_name), nie tylko (reportId, materialId).
--
-- Uruchom PO 072_czytelny_komunikat_braku_materialu.sql i
-- 082_korekta_dopisuje_nie_kasuje.sql. Wymaga Postgres 15+ (NULLS NOT
-- DISTINCT) — projekt jest na 17.6, więc OK. Bezpieczne do wielokrotnego
-- wklejenia. Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej
-- całość -> Run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. report_materials: surogatowy PK + unique (nulls not distinct)
-- ------------------------------------------------------------
alter table report_materials add column if not exists id serial;
alter table report_materials drop constraint if exists report_materials_pkey;
do $$ begin
  alter table report_materials add constraint report_materials_pkey primary key (id);
exception when invalid_table_definition then null; end $$;

drop index if exists report_materials_report_material_stage_uq;
create unique index report_materials_report_material_stage_uq
  on report_materials ("reportId", "materialId", stage_name) nulls not distinct;

-- ------------------------------------------------------------
-- 2. report_material_lots: stage_name — do precyzyjnego stornowania
--    (patrz punkt 4 komentarza na górze pliku)
-- ------------------------------------------------------------
alter table report_material_lots add column if not exists stage_name text;

-- ------------------------------------------------------------
-- 3. fn_consume_build_lot_fifo + p_stage_name
-- ------------------------------------------------------------
-- Nowy parametr zmienia sygnaturę (Postgres identyfikuje funkcję razem z
-- listą parametrów) — bez tego DROP zostałaby osierocona stara, 4-argu-
-- mentowa wersja obok nowej (tak jak wcześniej przy close_build).
drop function if exists fn_consume_build_lot_fifo(integer, integer, numeric, integer);

create or replace function fn_consume_build_lot_fifo(
  p_build_id integer,
  p_material_id integer,
  p_amount numeric,
  p_report_id integer default null,
  p_stage_name text default null
)
returns numeric
language plpgsql
as $$
declare
  v_remaining decimal := p_amount;
  v_cost decimal := 0;
  v_row record;
  v_take decimal;
  v_left decimal;
  v_last_price decimal;
  v_deficit_lot_id integer;
  v_actor text := auth.uid()::text;
begin
  if p_amount <= 0 then
    return 0;
  end if;

  for v_row in
    select id, quantity, "unitPrice", "sourceBatchId"
      from build_material_lots
      where "buildId" = p_build_id and "materialId" = p_material_id
      order by "issuedAt" asc, id asc
      for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_row.quantity, v_remaining);
    v_cost := v_cost + v_take * v_row."unitPrice";
    v_last_price := v_row."unitPrice";
    v_remaining := v_remaining - v_take;
    v_left := v_row.quantity - v_take;

    if p_report_id is not null then
      insert into report_material_lots
        ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice", stage_name)
        values (p_report_id, p_material_id, v_row.id, v_row."sourceBatchId", v_take, v_row."unitPrice", p_stage_name);
    end if;

    insert into stock_movements
        ("type", "materialId", "buildId", "batchId", "lotId", "reportId", quantity, "unitPrice", "createdByProfileId")
      values ('zuzycie', p_material_id, p_build_id, v_row."sourceBatchId", v_row.id, p_report_id, v_take, v_row."unitPrice", v_actor);

    if v_left > 0.0001 then
      update build_material_lots set quantity = v_left where id = v_row.id;
    else
      delete from build_material_lots where id = v_row.id;
    end if;
  end loop;

  if v_remaining > 0.0001 then
    if v_last_price is null then
      select "unitPrice" into v_last_price
        from material_batches
        where "materialId" = p_material_id
        order by "receivedAt" desc, id desc
        limit 1;
    end if;
    if v_last_price is null then
      select "unitPrice" into v_last_price from materials where id = p_material_id;
    end if;
    v_last_price := coalesce(v_last_price, 0);

    v_cost := v_cost + v_remaining * v_last_price;

    insert into build_material_lots
      ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice")
      values (p_build_id, p_material_id, null, -v_remaining, v_last_price)
      returning id into v_deficit_lot_id;

    if p_report_id is not null then
      insert into report_material_lots
        ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice", stage_name)
        values (p_report_id, p_material_id, v_deficit_lot_id, null, v_remaining, v_last_price, p_stage_name);
    end if;

    insert into stock_movements
        ("type", "materialId", "buildId", "lotId", "reportId", quantity, "unitPrice", note, "createdByProfileId")
      values ('zuzycie', p_material_id, p_build_id, v_deficit_lot_id, p_report_id, v_remaining, v_last_price,
              'Niedobór — brak pokrycia w przypisanym stanie, wymaga korekty/transferu admina', v_actor);
  end if;

  return v_cost;
end;
$$;

-- ------------------------------------------------------------
-- 4. submit_daily_report: delta i storno per (materialId, stageName)
-- ------------------------------------------------------------
create or replace function submit_daily_report(
  p_build_id integer,
  p_date date,
  p_people jsonb,
  p_materials jsonb,
  p_extra_costs jsonb,
  p_km numeric default null,
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
  v_key text;
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
    -- Klucz "materialId:stageName" (pusty string zamiast null — jsonb
    -- object nie akceptuje null jako klucza) — musi dokładnie odpowiadać
    -- kluczowi liczonemu niżej w pętli dla v_item, inaczej delta wyszłaby
    -- względem złego (albo żadnego) poprzedniego wiersza.
    select coalesce(
             jsonb_object_agg("materialId"::text || ':' || coalesce(stage_name, ''), "usedQuantity"),
             '{}'::jsonb
           )
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
    v_key := v_material_id::text || ':' || coalesce(v_stage_name, '');

    select * into v_assignment from build_materials
      where "buildId" = p_build_id and "materialId" = v_material_id
      for update;
    if not found then
      continue;
    end if;

    v_prev_daily := coalesce((v_prev_materials ->> v_key)::decimal, 0);
    v_delta := v_daily_quantity - v_prev_daily;
    v_cost := 0;

    if v_delta > 0.0001 then
      v_cost := fn_consume_build_lot_fifo(p_build_id, v_material_id, v_delta, v_report_id, v_stage_name);
      update build_materials
        set used = v_assignment.used + v_delta, "actualCost" = "actualCost" + v_cost
        where "buildId" = p_build_id and "materialId" = v_material_id;

    elsif v_delta < -0.0001 then
      -- Korekta w dół: cofnij DOKŁADNIE tyle, ile TEN WPIS (materiał +
      -- ETAP) sam dołożył, w kolejności LIFO, po realnej cenie każdego
      -- kawałka. Dopasowanie po stage_name — bez tego korekta jednego
      -- etapu potrafiłaby cofnąć zużycie zapisane dla DRUGIEGO etapu tego
      -- samego materiału w tym samym raporcie.
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
          and rml.stage_name is not distinct from v_stage_name
          and rml."reversalOfId" is null
        order by rml.id desc
        for update of rml
      loop
        exit when v_qty_to_return <= 0.0001;
        if v_lot_row.outstanding <= 0.0001 then
          continue;
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
          insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
            values (p_build_id, v_material_id, v_lot_row."sourceBatchId", v_take, v_lot_row."unitPrice", now());
        end if;

        v_returned_cost := v_returned_cost + v_take * v_lot_row."unitPrice";

        insert into report_material_lots
            ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice", "reversalOfId", stage_name)
          values (v_report_id, v_material_id, v_lot_row."lotId", v_lot_row."sourceBatchId", -v_take, v_lot_row."unitPrice", v_lot_row.id, v_stage_name);

        insert into stock_movements
            ("type", "materialId", "buildId", "batchId", "lotId", "reportId", quantity, "unitPrice", note, "createdByProfileId")
          values ('korekta', v_material_id, p_build_id, v_lot_row."sourceBatchId", v_lot_row."lotId", v_report_id, v_take, v_lot_row."unitPrice",
                  'Korekta w dół — storno zużycia z raportu', v_actor);

        v_qty_to_return := v_qty_to_return - v_take;
      end loop;

      v_cost := -v_returned_cost;
      update build_materials
        set used = greatest(v_assignment.used + v_delta, 0), "actualCost" = greatest("actualCost" - v_returned_cost, 0)
        where "buildId" = p_build_id and "materialId" = v_material_id;
    end if;

    insert into report_materials ("reportId", "materialId", "usedQuantity", cost, reason, stage_name)
      values (v_report_id, v_material_id, v_daily_quantity, v_cost, v_reason, v_stage_name);

    v_result_materials := v_result_materials || jsonb_build_object(
      'materialId', v_material_id,
      'stageName', v_stage_name,
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

grant execute on function submit_daily_report(integer, date, jsonb, jsonb, jsonb, numeric, text) to authenticated;
grant execute on function fn_consume_build_lot_fifo(integer, integer, numeric, integer, text) to authenticated;
