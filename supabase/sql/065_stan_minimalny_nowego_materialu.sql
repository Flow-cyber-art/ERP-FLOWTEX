-- ============================================================
-- Stan minimalny przy tworzeniu nowego materiału z poziomu zamówienia
-- ("Zamów materiał spoza listy" w orders-screen.tsx).
--
-- Kontekst: materiał utworzony tą ścieżką NIE istnieje jeszcze w
-- magazynie w momencie składania zamówienia — powstaje dopiero przy
-- PRZYJĘCIU dostawy (receive_material_order, patrz
-- 045_ujednolic_dopasowanie_materialu.sql), które dotąd zawsze wstawiało
-- sztywny stan minimalny = 5, bez możliwości podania własnej wartości.
-- To właśnie stan minimalny napędza alert "brak" w Zamówieniach (kolumna
-- materials.min, patrz warehouse-screen.tsx: `m.stock <= m.min`) — sztywna
-- piątka dla każdego nowego materiału była przypadkowa.
--
-- material_orders.new_material_min pozwala podać właściwą wartość PRZY
-- składaniu zamówienia (formularz), zanim materiał w ogóle powstanie;
-- receive_material_order odczytuje ją przy tworzeniu wiersza w materials.
-- null = brak wskazanej wartości -> zostaje dotychczasowy fallback 5.
--
-- Uruchom w dowolnym momencie (niezależnie od numeracji portalu klienta
-- powyżej). Bezpieczne do wielokrotnego wklejenia. Jak uruchomić:
-- Supabase Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

alter table material_orders add column if not exists new_material_min numeric;

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
as $$
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
        v_order."materialName", 'FLOW-' || v_order.id, v_order.unit, 0,
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
$$;
