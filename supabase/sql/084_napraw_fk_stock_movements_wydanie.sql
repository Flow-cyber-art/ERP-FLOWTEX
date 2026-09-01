-- ============================================================
-- Naprawa: "insert or update on table stock_movements violates
-- foreign key constraint stock_movement_batchid_fkey" przy
-- potwierdzaniu przyjęcia zamówienia budowy (receive_order,
-- 079_ksiega_ruchow_przyjecie_zuzycie.sql).
--
-- Przyczyna: receive_order tworzy partię w material_batches, od razu
-- ją KASUJE (materiał "przelatuje" przez magazyn główny prosto na
-- budowę w jednej transakcji), a DOPIERO POTEM wstawiał drugi wpis do
-- stock_movements (typ 'wydanie') z "batchId" wskazującym na tę już
-- skasowaną partię — FK na material_batches(id) odrzucał insert,
-- bo wiersz, na który wskazywał, już nie istniał.
--
-- Naprawa: insert 'wydanie' do stock_movements przenosi się PRZED
-- delete z material_batches, żeby batchId wciąż istniał w chwili
-- wstawiania. Reszta funkcji bez zmian (identyczna jak w 079).
--
-- Bezpieczne do wielokrotnego wklejenia. Jak uruchomić: Supabase
-- Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

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
as $function$
declare
  v_order orders;
  v_build_status build_status;
  v_item jsonb;
  v_row order_items;
  v_material_id integer;
  v_price decimal;
  v_qty decimal;
  v_batch_id integer;
  v_lot_id integer;
  v_avg_qty decimal;
  v_avg_value decimal;
  v_match_count integer;
  v_is_new_material boolean;
  v_actor text;
begin
  perform assert_role(array['Admin']::app_role[]);
  v_actor := auth.uid()::text;

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

  select status into v_build_status from builds where id = v_order.build_id;
  if v_build_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można już przyjmować dla niej dostaw.';
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
    v_is_new_material := false;
    if v_material_id is null then
      select count(*) into v_match_count from materials
        where normalize_material_name(name) = normalize_material_name(v_row.material_name);
      if v_match_count > 1 then
        raise exception 'Materiał "%" występuje w magazynie więcej niż raz — połącz tę pozycję zamówienia z konkretnym materiałem ręcznie przed przyjęciem dostawy.', v_row.material_name;
      end if;
      select id into v_material_id from materials
        where normalize_material_name(name) = normalize_material_name(v_row.material_name)
        limit 1;
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
      v_is_new_material := true;
    end if;
    if not v_is_new_material then
      update materials set active = true where id = v_material_id and active = false;
    end if;

    insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source, "documentNumber", "supplier")
      values (v_material_id, v_qty, v_price, current_date, 'zamówienie', p_document_number, p_supplier)
      returning id into v_batch_id;

    insert into stock_movements
        ("type", "materialId", "buildId", "batchId", quantity, "unitPrice", note, "createdByProfileId")
      values ('przyjecie', v_material_id, v_order.build_id, v_batch_id, v_qty, v_price,
              case when p_document_number is not null then 'Dok. ' || p_document_number else null end,
              v_actor);

    insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
      values (v_order.build_id, v_material_id, v_batch_id, v_qty, v_price, now())
      returning id into v_lot_id;

    -- Wpis 'wydanie' MUSI powstać przed usunięciem partii niżej —
    -- inaczej "batchId" wskazuje na już nieistniejący wiersz i FK
    -- odrzuca insert (patrz komentarz na górze pliku).
    insert into stock_movements
        ("type", "materialId", "buildId", "batchId", "lotId", quantity, "unitPrice", "createdByProfileId")
      values ('wydanie', v_material_id, v_order.build_id, v_batch_id, v_lot_id, v_qty, v_price, v_actor);

    delete from material_batches where id = v_batch_id;
    perform fn_recalc_material(v_material_id);

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
$function$;

grant execute on function receive_order(integer, jsonb, text, text) to authenticated;
