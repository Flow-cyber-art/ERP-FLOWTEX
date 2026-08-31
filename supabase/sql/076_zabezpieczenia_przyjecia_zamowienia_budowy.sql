-- ============================================================
-- Dwie poprawki w `receive_order` (przyjęcie dostawy zamówienia z
-- wizarda technologii, `orders`/`order_items`, zawsze dla JEDNEJ
-- konkretnej budowy):
--
-- 1. RYZYKO KSIĘGOWE: funkcja nigdy nie sprawdzała statusu budowy.
--    Zamknięcie budowy (`close_build`) zamraża rozliczenie
--    (`build_settlement_materials`) w danym momencie — jeśli ktoś
--    przyjmie dostawę PO zamknięciu, materiał cicho doleci do
--    `build_material_lots` zamkniętej budowy, ale nigdy nie trafi do
--    zamrożonego rozliczenia (koszt przepada). Teraz: blokada, tak samo
--    jak w `assign_material_batches_to_build`.
--
-- 2. Dopasowanie materiału po nazwie (gdy pozycja zamówienia nie ma
--    `linked_material_id` — patrz "Powiązany materiał magazynowy" w
--    ekranie Technologie) szukało DOKŁADNEGO tekstu (`name = ...`),
--    podczas gdy cała reszta aplikacji (receive_material_order,
--    get_public_build, raport brygadzisty) dopasowuje po
--    znormalizowanej nazwie (`normalize_material_name`, ignoruje
--    wielkość liter/drobne różnice). Literówka/spacja w nazwie
--    materiału w recepturze względem magazynu cicho tworzyła DUPLIKAT
--    materiału zamiast dopisać do istniejącego. Teraz spójne z resztą
--    systemu.
--
-- Uruchom PO 075_napraw_podwojne_liczenie_zamowien_budowy.sql. Bezpieczne
-- do wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
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
  v_avg_qty decimal;
  v_avg_value decimal;
  v_match_count integer;
  v_is_new_material boolean;
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

    insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
      values (v_order.build_id, v_material_id, v_batch_id, v_qty, v_price, now());
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
