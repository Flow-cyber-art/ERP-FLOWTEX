-- ============================================================
-- Faza 5 modułu Technologia — Ręczny wybór partii.
--
-- Jedyna faza, która zmienia już działający, przetestowany kod
-- (submit_daily_report) zamiast tylko dodawać nowy. Uruchom PO 008.
-- Bezpieczne do wielokrotnego wklejenia.
--
-- Zgodnie z ustaleniem: materiały TECHNOLOGICZNE (z planu, Faza 2) nie
-- potrzebują osobnego ręcznego kroku — samo przyjęcie zamówienia
-- (Faza 3/4, zawsze powiązanego z konkretną budową przez orders.build_id)
-- JEST już przypisaniem do tej budowy, więc receive_order() od teraz
-- automatycznie wpisuje przyjętą partię do build_material_lots. Ręczny
-- wybór partii (przeszukiwarka po nazwie, różne partie/ceny do wyboru)
-- dotyczy materiałów POZA planem/technologią — ekran "+ Przypisz
-- materiał" (dawniej: sam materiał + ilość planowana, bez partii).
--
-- `build_material_lots` (jeden wiersz na budowa+materiał+partia) i
-- `build_materials.issued` już istniały w schemacie, nieużywane przez
-- żadną ścieżkę — przygotowane dokładnie pod tę fazę.
-- ============================================================

-- ------------------------------------------------------------
-- Ręczne przypisanie wybranych partii do budowy (materiały spoza planu
-- technologii — wyszukiwarka po nazwie pokazuje WSZYSTKIE partie, różne
-- ceny/daty, admin wybiera konkretną i ile z niej). Jedno wywołanie może
-- objąć wiele pozycji (różne materiały/partie) naraz — tak jak dawny
-- koszyk "+ Dodaj do listy" / "Zatwierdź".
-- p_items: [{"batchId": 5, "quantity": 12.5}, ...]
-- ------------------------------------------------------------
create or replace function assign_material_batches_to_build(p_build_id integer, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status build_status;
  v_item jsonb;
  v_batch material_batches;
  v_batch_id integer;
  v_quantity decimal;
  v_avg_qty decimal;
  v_avg_value decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select status into v_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można już przypisywać materiałów.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_batch_id := (v_item->>'batchId')::integer;
    v_quantity := (v_item->>'quantity')::decimal;
    if v_quantity is null or v_quantity <= 0 then
      continue;
    end if;

    select * into v_batch from material_batches where id = v_batch_id for update;
    if not found then
      raise exception 'Nie znaleziono partii #%.', v_batch_id;
    end if;
    if v_batch.quantity < v_quantity - 0.0001 then
      raise exception 'Za mało towaru w partii #% (dostępne %, żądane %).',
        v_batch_id, v_batch.quantity, v_quantity;
    end if;

    if v_batch.quantity - v_quantity > 0.0001 then
      update material_batches set quantity = quantity - v_quantity where id = v_batch_id;
    else
      delete from material_batches where id = v_batch_id;
    end if;
    perform fn_recalc_material(v_batch."materialId");

    insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
      values (p_build_id, v_batch."materialId", v_batch_id, v_quantity, v_batch."unitPrice", now());

    select sum(quantity), sum(quantity * "unitPrice")
      into v_avg_qty, v_avg_value
      from build_material_lots
      where "buildId" = p_build_id and "materialId" = v_batch."materialId";

    insert into build_materials ("buildId", "materialId", planned, used, "unitPrice", issued)
      values (p_build_id, v_batch."materialId", v_quantity, 0, v_batch."unitPrice", v_quantity)
      on conflict ("buildId", "materialId") do update
        set planned = build_materials.planned + excluded.planned,
            issued = build_materials.issued + excluded.issued,
            "unitPrice" = case when v_avg_qty > 0 then v_avg_value / v_avg_qty else build_materials."unitPrice" end;
  end loop;
end;
$$;

grant execute on function assign_material_batches_to_build(integer, jsonb) to authenticated;

-- ------------------------------------------------------------
-- receive_order (Faza 3/4) — od teraz przyjęta partia trafia OD RAZU do
-- build_material_lots tej budowy (orders.build_id jest not null, więc
-- każde zamówienie z tego flow zawsze należy do dokładnie jednej
-- budowy). Zastępuje poprzednią wersję z 008 (tam partia trafiała tylko
-- do ogólnego magazynu, bez powiązania z budową).
-- ------------------------------------------------------------
drop function if exists receive_order(integer, jsonb, text, text);

create or replace function receive_order(
  p_order_id integer,
  p_items jsonb,
  p_document_number text default null,
  p_supplier text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_item jsonb;
  v_row order_items;
  v_material_id integer;
  v_price decimal;
  v_qty decimal;
  v_batch_id integer;
  v_avg_qty decimal;
  v_avg_value decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'Nie znaleziono zamówienia #%.', p_order_id;
  end if;
  if v_order.status = 'przyjęte' then
    raise exception 'Zamówienie #% jest już przyjęte.', p_order_id;
  end if;
  if v_order.status = 'anulowane' then
    raise exception 'Zamówienie #% jest anulowane.', p_order_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_row from order_items
      where id = (v_item->>'itemId')::integer and order_id = p_order_id
      for update;
    if not found then
      raise exception 'Pozycja #% nie należy do zamówienia #%.', v_item->>'itemId', p_order_id;
    end if;

    v_qty := (v_item->>'receivedQuantity')::decimal;
    if v_qty is null or v_qty <= 0 then
      continue;
    end if;

    v_material_id := v_row.linked_material_id;
    if v_material_id is null then
      select id into v_material_id from materials where name = v_row.material_name limit 1;
    end if;

    v_price := nullif(v_item->>'receivedUnitPrice', '')::decimal;
    if v_price is null and v_material_id is not null then
      select "unitPrice" into v_price from materials where id = v_material_id;
    end if;
    v_price := coalesce(v_price, 0);

    if v_material_id is null then
      insert into materials (name, index, unit, stock, min, "unitPrice")
        values (v_row.material_name, 'AUTO-OI-' || v_row.id, v_row.unit, 0, 0, v_price)
        returning id into v_material_id;
    end if;

    insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source, "documentNumber", "supplier")
      values (v_material_id, v_qty, v_price, current_date, 'zamówienie', p_document_number, p_supplier)
      returning id into v_batch_id;
    perform fn_recalc_material(v_material_id);

    insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
      values (v_order.build_id, v_material_id, v_batch_id, v_qty, v_price, now());

    select sum(quantity), sum(quantity * "unitPrice")
      into v_avg_qty, v_avg_value
      from build_material_lots
      where "buildId" = v_order.build_id and "materialId" = v_material_id;

    insert into build_materials ("buildId", "materialId", planned, used, "unitPrice", issued)
      values (v_order.build_id, v_material_id, v_qty, 0, v_price, v_qty)
      on conflict ("buildId", "materialId") do update
        set planned = build_materials.planned + excluded.planned,
            issued = build_materials.issued + excluded.issued,
            "unitPrice" = case when v_avg_qty > 0 then v_avg_value / v_avg_qty else build_materials."unitPrice" end;

    update order_items
      set linked_material_id = v_material_id,
          received_quantity = v_qty,
          received_unit_price = v_price
      where id = v_row.id;
  end loop;

  update orders set status = 'przyjęte' where id = p_order_id;
end;
$$;

grant execute on function receive_order(integer, jsonb, text, text) to authenticated;

-- ------------------------------------------------------------
-- fn_consume_build_lot_fifo — jak fn_consume_fifo (001), ale zdejmuje z
-- partii PRZYPISANYCH DO TEJ BUDOWY (build_material_lots), nie z całego
-- magazynu. To jest właściwa zmiana Fazy 5: raport dzienny rozlicza
-- materiał tylko z tego, co administrator wcześniej świadomie przypisał
-- do budowy (ręcznie albo automatycznie przez przyjęcie zamówienia z
-- planu) — nie może "pożyczyć" z partii należącej do innej budowy.
-- ------------------------------------------------------------
create or replace function fn_consume_build_lot_fifo(p_build_id integer, p_material_id integer, p_amount decimal)
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
    select id, quantity, "unitPrice"
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
  end loop;

  if v_remaining > 0.0001 then
    raise exception 'Za mało materiału #% przypisanego do budowy #%: brakuje %', p_material_id, p_build_id, round(v_remaining, 3);
  end if;

  return v_cost;
end;
$$;

-- ------------------------------------------------------------
-- submit_daily_report — identyczne jak w 001_rpc_functions.sql, poza
-- JEDNĄ linią: fn_consume_fifo(materiał, delta) [magazyn ogólny] →
-- fn_consume_build_lot_fifo(budowa, materiał, delta) [partie przypisane
-- do TEJ budowy]. Reszta funkcji (idempotencja po buildId+date, obsługa
-- osób/kosztów dodatkowych) bez zmian.
-- ------------------------------------------------------------
create or replace function submit_daily_report(
  p_build_id integer,
  p_date date,
  p_people jsonb,
  p_materials jsonb,
  p_extra_costs jsonb
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
  v_assignment build_materials;
  v_delta decimal;
  v_cost decimal;
  v_employee_id integer;
  v_start text;
  v_end text;
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

  if v_report_id is null then
    insert into reports ("buildId", date, status)
      values (p_build_id, p_date, 'submitted')
      returning id into v_report_id;
  else
    update reports set status = 'submitted', "updatedAt" = now() where id = v_report_id;
    delete from report_people where "reportId" = v_report_id;
    delete from report_materials where "reportId" = v_report_id;
    delete from report_extra_costs where "reportId" = v_report_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_materials)
  loop
    v_material_id := (v_item->>'materialId')::integer;
    v_used_quantity := (v_item->>'usedQuantity')::decimal;
    v_reason := v_item->>'reason';

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
      -- Korekta w dół: nie oddaje partii ani kosztu (jak lokalnie) — tylko
      -- zapisuje nową, niższą wartość `used`.
      update build_materials
        set used = v_used_quantity
        where "buildId" = p_build_id and "materialId" = v_material_id;
    end if;

    insert into report_materials ("reportId", "materialId", "usedQuantity", cost, reason)
      values (v_report_id, v_material_id, v_used_quantity, v_cost, v_reason);

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
    insert into report_extra_costs ("reportId", label, amount, note)
      values (v_report_id, v_item->>'label', (v_item->>'amount')::decimal, v_item->>'note');
  end loop;

  return jsonb_build_object('reportId', v_report_id, 'materials', v_result_materials);
end;
$$;

grant execute on function submit_daily_report(integer, date, jsonb, jsonb, jsonb) to authenticated;

-- ------------------------------------------------------------
-- Realtime na build_material_lots — patrz lib/data/use-realtime-sync.ts
-- (build_materials ma to już z 002_realtime.sql).
-- ------------------------------------------------------------
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'build_material_lots'
  ) then
    execute 'alter publication supabase_realtime add table build_material_lots';
  end if;
end $$;
