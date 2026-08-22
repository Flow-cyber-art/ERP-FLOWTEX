-- ============================================================
-- Faza 4 modułu Technologia — Magazyn i partie.
--
-- Uruchom PO 007 (rozszerza receive_material_order z 001 i receive_order
-- z 007). Bezpieczne do wielokrotnego wklejenia. Zero nowych tabel — sama
-- koncepcja partii z różnymi cenami już działa (FIFO w fn_consume_fifo,
-- 001_rpc_functions.sql); tu tylko rozszerzamy `material_batches` o
-- dokument dostawy i dostawcę, i dajemy klientowi możliwość realnego
-- odczytu partii (wcześniej ekran magazynu odtwarzał je z samego stanu —
-- patrz komentarz w contexts/app-data.tsx przy materialsQuery).
--
-- Rozszerzenie istniejącej tabeli = camelCase (ustalona konwencja z
-- Faza 0, patrz 004_faza0_fundament.sql) — "material_batches" samo w
-- sobie jest starą tabelą (sprzed modułu Technologia), więc dostaje
-- "documentNumber"/"supplier", nie "document_number"/"supplier".
-- ============================================================

alter table material_batches add column if not exists "documentNumber" text;
alter table material_batches add column if not exists "supplier" text;

-- ------------------------------------------------------------
-- fn_add_material_batch_ext — jak fn_add_material_batch (001), plus
-- dokument/dostawca. Osobna funkcja (nie nadpisujemy fn_add_material_batch)
-- — jej dotychczasowi wołający (create_material, adjust_material_stock)
-- nie mają skąd wziąć dokumentu/dostawcy, więc zostają na starej wersji.
-- ------------------------------------------------------------
create or replace function fn_add_material_batch_ext(
  p_material_id integer,
  p_quantity decimal,
  p_unit_price decimal,
  p_received_at date,
  p_source batch_source,
  p_document_number text default null,
  p_supplier text default null
)
returns void
language plpgsql
as $$
begin
  insert into material_batches
      ("materialId", quantity, "unitPrice", "receivedAt", source, "documentNumber", "supplier")
    values (p_material_id, p_quantity, p_unit_price, p_received_at, p_source, p_document_number, p_supplier);
  perform fn_recalc_material(p_material_id);
end;
$$;

-- ------------------------------------------------------------
-- receive_material_order (stary flow, material_orders) — dodaje
-- opcjonalny nr dokumentu/dostawcę na przyjmowanej partii. drop+recreate
-- (nie CREATE OR REPLACE), żeby zamienić sygnaturę bez dwuznacznego
-- przeciążenia; stary 3-argumentowy wariant z 001 przestaje istnieć.
-- ------------------------------------------------------------
drop function if exists receive_material_order(integer, decimal, decimal);

create or replace function receive_material_order(
  p_order_id integer,
  p_received_quantity decimal,
  p_received_unit_price decimal default null,
  p_document_number text default null,
  p_supplier text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order material_orders;
  v_material_id integer;
  v_price decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_order from material_orders where id = p_order_id for update;
  if not found then
    raise exception 'Nie znaleziono zamówienia #%.', p_order_id;
  end if;

  v_material_id := v_order."materialId";
  if v_material_id is null then
    select id into v_material_id from materials where name = v_order."materialName" limit 1;
  end if;

  v_price := p_received_unit_price;
  if v_price is null and v_material_id is not null then
    select "unitPrice" into v_price from materials where id = v_material_id;
  end if;
  v_price := coalesce(v_price, 0);

  if v_material_id is null then
    insert into materials (name, index, unit, stock, min, "unitPrice")
      values (v_order."materialName", 'AUTO-' || v_order.id, v_order.unit, 0, 5, v_price)
      returning id into v_material_id;
  end if;

  perform fn_add_material_batch_ext(
    v_material_id, p_received_quantity, v_price, current_date, 'zamówienie',
    p_document_number, p_supplier
  );

  update material_orders
    set status = 'dostarczone',
        "receivedQuantity" = p_received_quantity,
        "receivedUnitPrice" = v_price,
        "receivedAt" = now(),
        "materialId" = v_material_id
    where id = p_order_id;
end;
$$;

grant execute on function receive_material_order(integer, decimal, decimal, text, text) to authenticated;

-- ------------------------------------------------------------
-- receive_order (Faza 3, orders/order_items) — jeden dokument dostawy +
-- jeden dostawca na całe zamówienie (wiele pozycji, jedna dostawa), stąd
-- parametry na poziomie zamówienia, nie pojedynczej pozycji.
-- ------------------------------------------------------------
drop function if exists receive_order(integer, jsonb);

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

    perform fn_add_material_batch_ext(
      v_material_id, v_qty, v_price, current_date, 'zamówienie',
      p_document_number, p_supplier
    );

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
