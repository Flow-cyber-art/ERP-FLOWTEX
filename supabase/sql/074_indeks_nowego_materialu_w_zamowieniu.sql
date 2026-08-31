-- ============================================================
-- "Zamów materiał spoza listy" (orders-screen.tsx) dla materiału, którego
-- jeszcze nie ma w magazynie, pytał tylko o nazwę, jednostkę i stan
-- minimalny — bez indeksu materiałowego. Przy przyjęciu dostawy
-- (receive_material_order) nowy wiersz w `materials` dostawał wtedy
-- automatyczny, nic nie mówiący indeks 'FLOW-' || id zamówienia, którego
-- nikt nie mógł zmienić z poziomu formularza zamówienia.
--
-- Naprawa: nowa kolumna `new_material_index` na `material_orders`
-- (analogicznie do `new_material_min`, 065_stan_minimalny_nowego_materialu.sql)
-- — jeśli Admin coś wpisał w formularzu, to trafia jako indeks nowego
-- materiału; pusta wartość = fallback do starego 'FLOW-'||id, żeby
-- przyjęcie dostawy nigdy nie wywaliło się brakiem indeksu.
--
-- Uruchom PO 073_edycja_technologii_bez_nowej_wersji.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

alter table material_orders add column if not exists new_material_index text;

create or replace function receive_material_order(
  p_order_id integer,
  p_received_quantity numeric,
  p_received_unit_price numeric default null,
  p_document_number text default null,
  p_supplier text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order material_orders;
  v_material_id integer;
  v_price numeric;
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
      values (
        v_order."materialName",
        coalesce(nullif(trim(v_order.new_material_index), ''), 'FLOW-' || v_order.id),
        v_order.unit, 0,
        coalesce(v_order.new_material_min, 5), v_price
      )
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
$function$;
