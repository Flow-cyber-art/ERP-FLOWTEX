-- ============================================================
-- DP2 (rejestr decyzji, D14.3 "każdy ruch materiału -> wpis w księdze
-- ruchów z created_by"): `stock_movements` była zaprojektowana jako
-- jedna wspólna księga ruchów, ale żadna funkcja nigdy do niej nic nie
-- wstawiała — historia magazynu jest dziś rozproszona po
-- material_batches / build_material_lots / report_material_lots /
-- build_material_returns, bez wspólnego dziennika.
--
-- Ten plik podłącza księgę do dwóch najważniejszych operacji:
--   1. PRZYJĘCIE — fn_add_material_batch_ext (magazyn główny) oraz
--      receive_order (przyjęcie zamówienia budowy: materiał "przelatuje"
--      przez magazyn główny prosto na budowę w jednej transakcji, więc
--      zostawia DWA wpisy — przyjęcie do magazynu + wydanie na budowę).
--   2. ZUŻYCIE — fn_consume_build_lot_fifo (raport brygadzisty), w tym
--      niedobór wprowadzony w 078_zuzycie_ponad_stan_nie_blokowane.sql.
-- Reszta operacji (zwrot, utylizacja, transfer, ręczne przypisanie
-- partii) zostaje dopięta w kolejnych krokach.
--
-- Dwie zmiany w samej tabeli, zanim cokolwiek do niej wstawimy:
--
-- a) `type` był enumem stock_movement_type = wydanie/zuzycie/zwrot/
--    korekta — bez wartości na PRZYJĘCIE w ogóle (nie dało się w niej
--    zapisać przyjęcia dostawy). Tabela była pusta i nieużywana nigdzie
--    w kodzie, więc zamiast dowlekać enum wartością 'przyjecie' (co przy
--    ALTER TYPE ... ADD VALUE bywa kłopotliwe w tej samej transakcji, co
--    jej pierwsze użycie), typ zamieniamy na zwykły text + CHECK — łatwiej
--    dodać kolejny typ ruchu w przyszłości bez migracji enuma.
--
-- b) `createdByUserId` wskazywał na tabelę `users` (integer, stary,
--    sprzed przejścia na Supabase Auth) — `users` nigdy nie jest
--    zasilana (potwierdzone grepem), więc to pole i tak zawsze
--    zostawałoby puste. Realna tożsamość w tym repo to `profiles.id`
--    (uuid = auth.uid()), jak w `technologies.createdBy` (patrz
--    drizzle/schema.ts). Dodajemy analogiczne `createdByProfileId` text
--    i to na nim będziemy polegać — stara kolumna zostaje (nullable,
--    nieszkodliwa), żeby nie kasować niczego bez potrzeby.
--
-- Uruchom po 078_zuzycie_ponad_stan_nie_blokowane.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

alter table stock_movements alter column "type" type text;
alter table stock_movements drop constraint if exists stock_movements_type_check;
alter table stock_movements add constraint stock_movements_type_check
  check ("type" in ('przyjecie', 'wydanie', 'zuzycie', 'zwrot', 'korekta'));
alter table stock_movements add column if not exists "createdByProfileId" text;

-- ------------------------------------------------------------
-- 1a. Przyjęcie do magazynu głównego (fn_add_material_batch_ext —
-- jedyne miejsce insertujące partię ze starego flow receive_material_order).
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
declare
  v_batch_id integer;
begin
  insert into material_batches
      ("materialId", quantity, "unitPrice", "receivedAt", source, "documentNumber", "supplier")
    values (p_material_id, p_quantity, p_unit_price, p_received_at, p_source, p_document_number, p_supplier)
    returning id into v_batch_id;

  insert into stock_movements
      ("type", "materialId", "batchId", quantity, "unitPrice", note, "createdByProfileId")
    values ('przyjecie', p_material_id, v_batch_id, p_quantity, p_unit_price,
            case when p_document_number is not null then 'Dok. ' || p_document_number else null end,
            auth.uid()::text);

  perform fn_recalc_material(p_material_id);
end;
$$;

-- ------------------------------------------------------------
-- 1b. Przyjęcie zamówienia budowy (receive_order, Faza 3 orders/order_items)
-- — materiał trafia i od razu opuszcza magazyn główny w tej samej
-- transakcji (patrz insert do material_batches + delete niżej), więc
-- księga dostaje DWA wpisy: przyjęcie do magazynu i wydanie na budowę.
-- Reszta funkcji identyczna jak w 076_zabezpieczenia_przyjecia_zamowienia_budowy.sql.
-- ------------------------------------------------------------
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
    delete from material_batches where id = v_batch_id;
    perform fn_recalc_material(v_material_id);

    insert into stock_movements
        ("type", "materialId", "buildId", "batchId", "lotId", quantity, "unitPrice", "createdByProfileId")
      values ('wydanie', v_material_id, v_order.build_id, v_batch_id, v_lot_id, v_qty, v_price, v_actor);

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

-- ------------------------------------------------------------
-- 2. Zużycie (raport brygadzisty, FIFO na build_material_lots) —
-- jeden wpis w księdze per zeszła partia, plus wpis dla niedoboru
-- wprowadzonego w 078 (widoczny jako 'zuzycie' z notatką, żeby admin
-- widział zarówno w build_material_lots, jak i w księdze, że to jest
-- ten "stan ujemny do naprawy").
-- ------------------------------------------------------------
drop function if exists fn_consume_build_lot_fifo(integer, integer, decimal, integer);

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
        ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice")
        values (p_report_id, p_material_id, v_row.id, v_row."sourceBatchId", v_take, v_row."unitPrice");
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
        ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice")
        values (p_report_id, p_material_id, v_deficit_lot_id, null, v_remaining, v_last_price);
    end if;

    insert into stock_movements
        ("type", "materialId", "buildId", "lotId", "reportId", quantity, "unitPrice", note, "createdByProfileId")
      values ('zuzycie', p_material_id, p_build_id, v_deficit_lot_id, p_report_id, v_remaining, v_last_price,
              'Niedobór — brak pokrycia w przypisanym stanie, wymaga korekty/transferu admina', v_actor);
  end if;

  return v_cost;
end;
$$;
