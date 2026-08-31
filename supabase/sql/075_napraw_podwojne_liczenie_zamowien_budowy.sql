-- ============================================================
-- Przyjęcie zamówienia wygenerowanego wizardem technologii (`orders` z
-- `build_id` — ZAWSZE dla jednej, konkretnej budowy, bez możliwości
-- rozbicia na kilka budów) liczyło dostarczoną ilość PODWÓJNIE:
--
--   1. wstawiało partię do `material_batches` (ogólny wolny magazyn) i
--      przeliczało `materials.stock` o PEŁNĄ dostarczoną ilość,
--   2. i OD RAZU w 100% księgowało tę samą ilość jako już zużytą/
--      przypisaną do budowy w `build_material_lots` —
--      ALE NIGDY nie odejmowało jej z `material_batches`.
--
-- Efekt: ta sama fizyczna ilość widniała jednocześnie jako "wolna w
-- magazynie" i jako "już na budowie". Potwierdzone na żywych danych:
-- 5 materiałów budowy #1 (Piasek kwarcowy x2, Flowfresh Primer/MF/
-- Coating Matt) miało dokładnie ten błąd.
--
-- Naprawa logiki: zamówienie z wizarda jest w CAŁOŚCI dla tej budowy,
-- więc świeżo przyjęta partia od razu w 100% "wychodzi" z ogólnego
-- magazynu na budowę — insert do `build_material_lots`, po czym
-- USUNIĘCIE właśnie wstawionej partii z `material_batches` (ten sam
-- wzorzec "insert lota PRZED usunięciem partii" co w
-- `assign_material_batches_to_build`/`fn_consume_build_lot_fifo` — FK
-- "sourceBatchId" sprawdzany natychmiast). `build_material_lots.
-- "sourceBatchId"` zostaje wtedy NULL (ON DELETE SET NULL) — to nie
-- przeszkadza w zwrocie materiału przy zamknięciu budowy (`close_build`
-- ma już gotową ścieżkę na brak partii źródłowej: tworzy nową partię
-- "zwrot z budowy").
--
-- Naprawa danych: dla 5 już dotkniętych pozycji budowy #1 usuwamy
-- osierocone partie (całość i tak jest już policzona w
-- build_material_lots tej budowy) i przeliczamy stan materiału.
--
-- Uruchom PO 074_indeks_nowego_materialu_w_zamowieniu.sql. Bezpieczne do
-- wielokrotnego wklejenia (poprawka funkcji zawsze; poprawka danych ma
-- warunek "tylko jeśli faktycznie zdublowane", więc drugi przebieg nic
-- nie zmienia). Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej
-- całość -> Run.
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
      v_is_new_material := true;
    end if;
    if not v_is_new_material then
      update materials set active = true where id = v_material_id and active = false;
    end if;

    insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source, "documentNumber", "supplier")
      values (v_material_id, v_qty, v_price, current_date, 'zamówienie', p_document_number, p_supplier)
      returning id into v_batch_id;

    -- Zamówienie z wizarda technologii jest w CAŁOŚCI dla TEJ budowy —
    -- świeżo przyjęta partia od razu w 100% "wychodzi" na budowę
    -- (insert do build_material_lots), więc NIE zostaje w ogólnym wolnym
    -- magazynie. Insert PRZED usunięciem partii — FK "sourceBatchId" nie
    -- jest deferred, musi widzieć jeszcze żywy wiersz.
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

-- Naprawa już zdublowanych danych: partie z 'zamówienie' dla materiałów,
-- których CAŁA ilość partii pokrywa się dokładnie z ilością już
-- zaksięgowaną na jakiejś budowie w build_material_lots (czyli dokładnie
-- ten przypadek podwójnego liczenia opisany wyżej) — usuń partię i
-- przelicz stan. Warunek dopasowania "1:1" celowo wąski, żeby nie
-- ruszyć niczego, co nie jest tym konkretnym błędem.
do $$
declare
  v_batch record;
  v_lot_qty numeric;
begin
  for v_batch in
    select id, "materialId", quantity from material_batches where source = 'zamówienie'
  loop
    select coalesce(sum(quantity), 0) into v_lot_qty
      from build_material_lots
      where "materialId" = v_batch."materialId" and "sourceBatchId" = v_batch.id;
    if v_lot_qty >= v_batch.quantity - 0.0001 then
      update build_material_lots
        set "sourceBatchId" = null
        where "materialId" = v_batch."materialId" and "sourceBatchId" = v_batch.id;
      delete from material_batches where id = v_batch.id;
      perform fn_recalc_material(v_batch."materialId");
    end if;
  end loop;
end $$;
