-- ============================================================
-- Faza 3 modułu Technologia — Zamówienia jako nagłówek + pozycje.
--
-- Uruchom PO 004/005/006 (używa `assert_role()` z 003 i tabeli
-- `build_material_plan` z 006). Bezpieczne do wielokrotnego wklejenia.
--
-- Zastępuje (dla NOWYCH budów w module Technologia) dzisiejszy
-- `material_orders` (jeden materiał = jedno zamówienie, patrz
-- 001_rpc_functions.sql / lib/data/orders.ts) — ten flow zostaje bez
-- zmian, działa równolegle, dla budów bez przypisanej technologii albo
-- dla zamówień spoza planu. `orders`/`order_items` to jedno zamówienie
-- z wieloma pozycjami, generowane wprost z `build_material_plan`
-- (Faza 2) — tak jak realny dokument od dostawcy.
--
-- Nowe tabele = snake_case (kolumny), poza "createdAt"/"createdBy",
-- które z premedytacją zostają camelCase — ta sama konwencja co
-- `technologies` w 005_faza1_technologie.sql.
-- ============================================================

-- Nazwa NIE może być "order_status" — ten typ już istnieje (status
-- starego material_orders.status: 'do realizacji'/'zamówione'/
-- 'dostarczone', patrz drizzle/schema.ts orderStatusEnum). Gdyby
-- kolidowała, `create type ... exception when duplicate_object`
-- po cichu nic by nie zrobił i tabela `orders` dostałaby STARY enum
-- bez wartości 'robocze'/'przyjęte'/'anulowane' — stąd osobna nazwa.
do $$ begin
  create type order_header_status as enum ('robocze', 'zamówione', 'przyjęte', 'anulowane');
exception when duplicate_object then null; end $$;

create table if not exists orders (
  id serial primary key,
  build_id integer not null references builds(id) on delete cascade,
  order_number text not null unique,
  status order_header_status not null default 'robocze',
  notes text,
  "createdAt" timestamp not null default now(),
  "createdBy" uuid references auth.users(id) on delete set null
);

create index if not exists orders_build_id_idx on orders(build_id);

create table if not exists order_items (
  id serial primary key,
  order_id integer not null references orders(id) on delete cascade,
  material_name text not null,
  linked_material_id integer references materials(id) on delete set null,
  planned_quantity decimal(12, 3) not null default 0,
  ordered_quantity decimal(12, 3) not null default 0,
  unit text not null default 'kg',
  received_quantity decimal(12, 3),
  received_unit_price decimal(12, 2)
);

create index if not exists order_items_order_id_idx on order_items(order_id);

-- ------------------------------------------------------------
-- Generowanie zamówienia z planu materiałowego budowy (Faza 2).
-- Agreguje `build_material_plan` po (materialName, unit,
-- linkedMaterialId) — plan jest per etap, zamówienie nie dzieli się na
-- etapy (dostawca dostaje jedną listę materiałów, nie etapów).
-- `orderedQuantity` startuje równa `plannedQuantity`, edytowalna potem
-- wprost z klienta (zaokrąglenia do opakowań) dopóki zamówienie jest
-- w statusie 'robocze'.
-- ------------------------------------------------------------
create or replace function generate_order_from_plan(p_build_id integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_build builds;
  v_order_id integer;
  v_seq integer;
  v_order_number text;
begin
  perform assert_role(array['Admin']);

  select * into v_build from builds where id = p_build_id;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;

  if not exists (select 1 from build_material_plan where build_id = p_build_id) then
    raise exception 'Budowa nie ma jeszcze planu materiałowego (przypisz technologię).';
  end if;

  select count(*) + 1 into v_seq from orders where build_id = p_build_id;
  v_order_number := 'ZAM/' || v_build.number || '/' || v_seq;

  insert into orders (build_id, order_number, status, "createdBy")
    values (p_build_id, v_order_number, 'robocze', auth.uid())
    returning id into v_order_id;

  insert into order_items (order_id, material_name, linked_material_id, planned_quantity, ordered_quantity, unit)
    select
      v_order_id,
      material_name,
      linked_material_id,
      sum(planned_quantity),
      sum(planned_quantity),
      unit
    from build_material_plan
    where build_id = p_build_id
    group by material_name, linked_material_id, unit;

  return v_order_id;
end;
$$;

-- ------------------------------------------------------------
-- Przyjęcie dostawy: jedno zamówienie, wiele pozycji naraz — każda
-- pozycja dopisuje własną partię (własna cena, tak jak
-- `receive_material_order` dla pojedynczego materiału w starym flow).
-- p_items: [{"itemId": 1, "receivedQuantity": 100, "receivedUnitPrice": 30}, ...]
-- Pozycja bez podanej ceny bierze aktualną cenę materiału z magazynu
-- (tak jak stary flow) — 0, jeśli materiał dopiero teraz powstaje.
-- ------------------------------------------------------------
create or replace function receive_order(p_order_id integer, p_items jsonb)
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
  perform assert_role(array['Admin']);

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

    perform fn_add_material_batch(v_material_id, v_qty, v_price, current_date, 'zamówienie');

    update order_items
      set linked_material_id = v_material_id,
          received_quantity = v_qty,
          received_unit_price = v_price
      where id = v_row.id;
  end loop;

  update orders set status = 'przyjęte' where id = p_order_id;
end;
$$;

grant execute on function generate_order_from_plan(integer) to authenticated;
grant execute on function receive_order(integer, jsonb) to authenticated;

-- ------------------------------------------------------------
-- RLS — odczyt: każdy zalogowany (jak reszta operacyjnych danych, patrz
-- 003_auth_rls.sql). Zapis bezpośredni z klienta (bez RPC powyżej) tylko
-- dla Admina: zmiana statusu nagłówka ('robocze'->'zamówione'/
-- 'anulowane', ten sam wzorzec co `markOrderOrdered` dla
-- `material_orders`) i edycja `ordered_quantity` pozycji przed wysyłką
-- do dostawcy.
-- ------------------------------------------------------------
alter table orders enable row level security;
alter table order_items enable row level security;

grant select, update on orders to authenticated;
grant select, update on order_items to authenticated;

drop policy if exists "select_authenticated" on orders;
create policy "select_authenticated" on orders
  for select to authenticated using (true);

drop policy if exists "select_authenticated" on order_items;
create policy "select_authenticated" on order_items
  for select to authenticated using (true);

drop policy if exists "orders_update_admin" on orders;
create policy "orders_update_admin" on orders
  for update to authenticated
  using (app_role() = 'Admin') with check (app_role() = 'Admin');

drop policy if exists "order_items_update_admin" on order_items;
create policy "order_items_update_admin" on order_items
  for update to authenticated
  using (app_role() = 'Admin') with check (app_role() = 'Admin');

-- ------------------------------------------------------------
-- Realtime — tak jak reszta danych operacyjnych (magazyn, budowy).
-- ------------------------------------------------------------
do $$
declare
  tbl text;
begin
  for tbl in select unnest(array['orders', 'order_items'])
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table %I', tbl);
    end if;
  end loop;
end $$;
