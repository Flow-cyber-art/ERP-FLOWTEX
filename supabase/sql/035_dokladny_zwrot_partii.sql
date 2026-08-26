-- ============================================================
-- Decyzja A (docs/PROCES_RAPORTOWANIE_BRYGADZISTA.md, §4): korekta
-- raportu w dół (brygadzista wpisuje mniejsze zużycie niż poprzednio,
-- przed zatwierdzeniem raportu) ma zwracać materiał DOKŁADNIE do tej
-- partii budowy (build_material_lots), z której zeszła — po tej samej,
-- realnej cenie, bez uśredniania — i odpowiednio zmniejszać
-- build_materials."actualCost". Dziś (034 i wcześniej) taka korekta
-- tylko nadpisywała `used`, nic nie oddając ani do puli budowy, ani do
-- kosztu.
--
-- Żeby to zrobić bez uśredniania, trzeba wiedzieć Z JAKIEGO KONKRETNIE
-- lota (i po jakiej cenie) zeszła dana ilość w danym raporcie — stąd
-- nowa tabela `report_material_lots`, rozbicie "z jakiego lota ile" per
-- wywołanie submit_daily_report (fn_consume_build_lot_fifo już i tak
-- idzie partia po partii, tylko dotąd sumowała wyłącznie koszt).
--
-- Korekta w dół cofa ten rozkład w kolejności LIFO (od najnowszego wpisu
-- TEGO raportu wstecz) — to znaczy: cofa to, co TEN raport sam dołożył
-- jako ostatnie, niezależnie od tego, co się działo z materiałem na
-- budowie skądinąd. Jeśli oryginalny lot w międzyczasie zniknął (w pełni
-- zużyty przez INNY, późniejszy raport tej samej budowy), odtwarzamy go
-- jako nowy wiersz build_material_lots z tą samą ceną — materiał i tak
-- wraca na budowę, tylko jako "nowy" wiersz zamiast doliczenia do
-- starego (identyczny wzorzec jak przy zwrocie na magazyn w
-- 028_fix_zwrot_do_usunietej_partii.sql i 013/033 przy zamykaniu budowy).
--
-- Uruchom PO 034. Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

create table if not exists report_material_lots (
  id serial primary key,
  "reportId" integer not null references reports(id) on delete cascade,
  "materialId" integer not null references materials(id) on delete restrict,
  -- Referencja do lota, z którego to konkretnie zeszło — może z czasem
  -- zniknąć (ON DELETE SET NULL, gdy lot w pełni się wyczerpie gdzie
  -- indziej), stąd DENORMALIZOWANE "sourceBatchId"/"unitPrice" obok, żeby
  -- korekta w dół zawsze miała skąd odtworzyć realną cenę, nawet gdy
  -- oryginalny wiersz build_material_lots już nie istnieje.
  "lotId" integer references build_material_lots(id) on delete set null,
  "sourceBatchId" integer references material_batches(id) on delete set null,
  quantity decimal(12, 3) not null,
  "unitPrice" decimal(12, 2) not null,
  "createdAt" timestamp not null default now()
);

alter table report_material_lots enable row level security;
drop policy if exists "select_authenticated" on report_material_lots;
create policy "select_authenticated" on report_material_lots
  for select to authenticated using (true);
revoke all on report_material_lots from anon;

-- ------------------------------------------------------------
-- fn_consume_build_lot_fifo — identyczne jak w 009, plus nowy parametr
-- p_report_id: zapisuje rozkład "z jakiego lota ile" dla TEGO
-- konkretnego wywołania (raportu), do ewentualnego dokładnego zwrotu
-- przy późniejszej korekcie w dół tego samego raportu.
-- ------------------------------------------------------------
drop function if exists fn_consume_build_lot_fifo(integer, integer, decimal);

create or replace function fn_consume_build_lot_fifo(
  p_build_id integer,
  p_material_id integer,
  p_amount decimal,
  p_report_id integer default null
)
returns decimal
language plpgsql
as $$
declare
  v_remaining decimal := p_amount;
  v_cost decimal := 0;
  v_row record;
  v_take decimal;
  v_left decimal;
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
    v_remaining := v_remaining - v_take;
    v_left := v_row.quantity - v_take;
    if v_left > 0.0001 then
      update build_material_lots set quantity = v_left where id = v_row.id;
    else
      delete from build_material_lots where id = v_row.id;
    end if;

    if p_report_id is not null then
      insert into report_material_lots
        ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice")
        values (p_report_id, p_material_id, v_row.id, v_row."sourceBatchId", v_take, v_row."unitPrice");
    end if;
  end loop;

  if v_remaining > 0.0001 then
    raise exception 'Za mało materiału #% przypisanego do budowy #%: brakuje %', p_material_id, p_build_id, round(v_remaining, 3);
  end if;

  return v_cost;
end;
$$;

-- ------------------------------------------------------------
-- submit_daily_report — identyczne jak w 034, plus dokładny zwrot do
-- lota przy korekcie w dół (delta < 0). Sygnatura BEZ ZMIAN względem
-- 034 (wciąż 7 argumentów), więc to zwykły CREATE OR REPLACE, bez
-- potrzeby dropowania starej wersji.
-- ------------------------------------------------------------
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
  -- Korekta w dół (Decyzja A) — zmienne pomocnicze do dokładnego zwrotu.
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
      v_cost := fn_consume_build_lot_fifo(p_build_id, v_material_id, v_delta, v_report_id);
      update build_materials
        set used = v_used_quantity, "actualCost" = "actualCost" + v_cost
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
      -- zdarzyć (delta liczona względem `used` tego samego raportu), więc
      -- celowo bez twardego błędu: reszta po prostu zostaje niecofnięta
      -- zamiast blokować zapis całego raportu z tego powodu.

      v_cost := -v_returned_cost;
      update build_materials
        set used = v_used_quantity, "actualCost" = greatest("actualCost" - v_returned_cost, 0)
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
