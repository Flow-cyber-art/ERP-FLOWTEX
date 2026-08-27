-- ============================================================
-- Ujednolić dopasowanie materiału po nazwie — docs/AUDYT_BEZPIECZENSTWO_
-- WYDAJNOSC_ERP.md, punkt C1.
--
-- Problem: dopasowanie "ten sam materiał po nazwie" było liczone na TRZY
-- różne sposoby w różnych miejscach:
--   - receive_order/receive_material_order (SQL, ta migracja) — dokładne
--     porównanie `name = ...`, wrażliwe na wielkość liter i spacje.
--   - contexts/app-data.tsx (stageNameForMaterial) — `.trim().toLowerCase()`,
--     bez usuwania polskich znaków diakrytycznych.
--   - lib/material-name-match.ts (normalizeMaterialName, używane w
--     podpowiedziach magazynu/zamówień i w innych miejscach app-data.tsx/
--     settlement-screen.tsx) — pełna normalizacja: NFD + usunięcie
--     kombinujących znaków diakrytycznych (ą/ć/ę/ń/ó/ś/ź/ż) + jedna spacja
--     + trim.
-- Ten sam materiał mógł się więc dopasować w jednym miejscu, a w drugim
-- nie — dokładnie ta klasa błędu, którą łatano w kilku ostatnich commitach
-- (linked_material_id, Rozliczenie budowy).
--
-- Naprawa (strona SQL): `normalize_material_name()` — odpowiednik
-- `normalizeMaterialName()` z lib/material-name-match.ts, PRZENIESIONY 1:1
-- (łącznie z tym, że świadomie NIE rusza "ł"/"Ł" — te nie mają
-- kanonicznej dekompozycji NFD w Unicode, więc JS-owy `.normalize("NFD")`
-- też ich nie rusza; użycie rozszerzenia `unaccent` byłoby TU akurat
-- niezgodne z JS-em, bo ono usunęłoby też "ł", psując spójność, o którą
-- chodzi w tej migracji). `receive_order`/`receive_material_order` używają
-- jej teraz zamiast surowego `name = ...`.
--
-- Naprawa (strona JS): osobny, mały commit zamienia `.trim().toLowerCase()`
-- w contexts/app-data.tsx i settlement-screen.tsx na wywołanie tej samej
-- `normalizeMaterialName()`, którą już mają podpowiedzi magazynu — patrz
-- historia commitów.
--
-- Wyłącznie ROZLUŹNIA dopasowanie względem `name = ...` (każdy string
-- pasujący dokładnie nadal pasuje po normalizacji) — bezpieczne, wstecznie
-- kompatybilne, nie wymaga żadnej zmiany po stronie klienta w tym samym
-- momencie. Uruchom PO 038_archiwizacja_materialow.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

create or replace function normalize_material_name(p_name text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      lower(
        translate(
          coalesce(p_name, ''),
          'ĄąĆćĘęŃńÓóŚśŹźŻż',
          'AaCcEeNnOoSsZzZz'
        )
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

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
    select count(*) into v_match_count from materials
      where normalize_material_name(name) = normalize_material_name(v_order."materialName");
    if v_match_count > 1 then
      raise exception 'Materiał "%" występuje w magazynie więcej niż raz — połącz tę pozycję zamówienia z konkretnym materiałem ręcznie przed przyjęciem dostawy.', v_order."materialName";
    end if;
    select id into v_material_id from materials
      where normalize_material_name(name) = normalize_material_name(v_order."materialName")
      limit 1;
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
  else
    update materials set active = true where id = v_material_id and active = false;
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
