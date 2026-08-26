-- ------------------------------------------------------------
-- Bezpieczniejsze dopasowanie materiału przy przyjęciu dostawy
-- (docs/PROCES_ZARZADZANIE_MATERIALEM.md, Ryzyko 6).
--
-- Dotyczy tylko pozycji zamówienia BEZ powiązania z materiałem
-- (linked_material_id / materialId is null) — czyli "zamówień wolnych"
-- (poza planem technologii), gdzie front (od teraz) wymusza jawny wybór
-- z listy albo jawne potwierdzenie "to nowy materiał" (orders-screen.tsx,
-- addToOrderCart w contexts/app-data.tsx). Dwie zmiany:
--
-- 1. Jeśli dopasowań PO NAZWIE jest więcej niż jedno (dwa materiały o tej
--    samej nazwie w kartotece), funkcja dotąd cicho brała pierwszy z
--    brzegu (`limit 1`) — od teraz odrzuca operację czytelnym błędem,
--    zamiast zgadywać, do którego wiersza magazynowego ma trafić dostawa.
-- 2. Materiał tworzony automatycznie (gdy naprawdę nie ma dopasowania)
--    dostaje indeks z prefiksem "FLOW-" zamiast "AUTO-" — spójne z nazwą
--    aplikacji, bez zmiany znaczenia (to nadal tylko czytelny,
--    wygenerowany indeks, nie prawdziwy SKU dostawcy).
--
-- create or replace — sygnatury obu funkcji bez zmian względem
-- 008_faza4_magazyn_partie.sql (receive_material_order) i
-- 009_faza5_reczny_wybor_partii.sql (receive_order, ostatnia wersja).
-- ------------------------------------------------------------

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
  v_match_count integer;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_order from material_orders where id = p_order_id for update;
  if not found then
    raise exception 'Nie znaleziono zamówienia #%.', p_order_id;
  end if;

  v_material_id := v_order."materialId";
  if v_material_id is null then
    select count(*) into v_match_count from materials where name = v_order."materialName";
    if v_match_count > 1 then
      raise exception 'Materiał "%" występuje w magazynie więcej niż raz — połącz tę pozycję zamówienia z konkretnym materiałem ręcznie przed przyjęciem dostawy.', v_order."materialName";
    end if;
    select id into v_material_id from materials where name = v_order."materialName" limit 1;
  end if;

  v_price := p_received_unit_price;
  if v_price is null and v_material_id is not null then
    select "unitPrice" into v_price from materials where id = v_material_id;
  end if;
  v_price := coalesce(v_price, 0);

  if v_material_id is null then
    insert into materials (name, index, unit, stock, min, "unitPrice")
      values (v_order."materialName", 'FLOW-' || v_order.id, v_order.unit, 0, 5, v_price)
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
  v_match_count integer;
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
      select count(*) into v_match_count from materials where name = v_row.material_name;
      if v_match_count > 1 then
        raise exception 'Materiał "%" występuje w magazynie więcej niż raz — połącz tę pozycję zamówienia z konkretnym materiałem ręcznie przed przyjęciem dostawy.', v_row.material_name;
      end if;
      select id into v_material_id from materials where name = v_row.material_name limit 1;
    end if;

    v_price := nullif(v_item->>'receivedUnitPrice', '')::decimal;
    if v_price is null and v_material_id is not null then
      select "unitPrice" into v_price from materials where id = v_material_id;
    end if;
    v_price := coalesce(v_price, 0);

    if v_material_id is null then
      insert into materials (name, index, unit, stock, min, "unitPrice")
        values (v_row.material_name, 'FLOW-OI-' || v_row.id, v_row.unit, 0, 0, v_price)
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
