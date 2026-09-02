-- ============================================================
-- "Uwzględnij?" przy podpowiedzi "Na magazynie (wolne)" dotąd TYLKO
-- pomniejszał ordered_quantity w zamówieniu — materiał fizycznie
-- zostawał na magazynie głównym, nieprzypisany do budowy. Efekt: "Plan"
-- w Rozliczeniu budowy (settlement-screen.tsx) rozjeżdżał się z
-- "Przypisano" o dokładnie tę ilość, dopóki ktoś ręcznie nie użył
-- "+ Przypisz materiał" — druga, osobna czynność, łatwa do pominięcia.
--
-- Naprawa: apply_order_item_free_stock() robi w JEDNEJ transakcji to,
-- co dotąd wymagało dwóch ręcznych kroków — dobiera partie z
-- material_batches metodą FIFO (najstarsza "receivedAt" pierwsza, ten
-- sam wzorzec co fn_consume_build_lot_fifo/receive_order), realnie
-- przenosi je na podmagazyn budowy (build_material_lots +
-- build_materials.planned — dokładnie to, co robi istniejące
-- assign_material_batches_to_build, 024_brygadzista_przypisanie_materialu.sql,
-- tylko z automatycznym doborem partii zamiast jednej wskazanej ręcznie),
-- i dopiero na końcu pomniejsza ordered_quantity oraz zeruje
-- available_free_quantity na pozycji zamówienia.
--
-- Ilość do zastosowania = least(available_free_quantity, ordered_quantity)
-- — na wypadek gdyby Admin już ręcznie zmniejszył ordered_quantity
-- poniżej podpowiedzianej wolnej ilości; nigdy nie próbujemy przypisać
-- więcej, niż wciąż faktycznie zamawiane.
--
-- Uruchom po 087_wolny_magazyn_tylko_biezacy_stan.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

create or replace function apply_order_item_free_stock(p_order_item_id integer)
returns decimal
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item order_items;
  v_order orders;
  v_build_status build_status;
  v_material_id integer;
  v_want decimal;
  v_remaining decimal;
  v_applied decimal := 0;
  v_row record;
  v_take decimal;
  v_avg_qty decimal;
  v_avg_value decimal;
  v_new_price decimal;
  v_fallback_price decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_item from order_items where id = p_order_item_id for update;
  if not found then
    raise exception 'Nie znaleziono pozycji zamówienia #%.', p_order_item_id;
  end if;

  select * into v_order from orders where id = v_item.order_id for update;
  if not found then
    raise exception 'Nie znaleziono zamówienia dla pozycji #%.', p_order_item_id;
  end if;
  if v_order.status <> 'robocze' then
    raise exception 'Można uwzględnić wolny magazyn tylko w zamówieniu roboczym.';
  end if;

  select status into v_build_status from builds where id = v_order.build_id;
  if v_build_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można już przypisywać materiału.';
  end if;

  v_material_id := v_item.linked_material_id;
  if v_material_id is null then
    raise exception 'Pozycja #% nie jest powiązana z żadnym materiałem magazynowym.', p_order_item_id;
  end if;

  v_want := least(coalesce(v_item.available_free_quantity, 0), coalesce(v_item.ordered_quantity, 0));
  if v_want <= 0.0001 then
    return 0;
  end if;

  v_remaining := v_want;

  for v_row in
    select id, quantity, "unitPrice"
      from material_batches
      where "materialId" = v_material_id
      order by "receivedAt" asc, id asc
      for update
  loop
    exit when v_remaining <= 0.0001;
    v_take := least(v_row.quantity, v_remaining);
    if v_take <= 0.0001 then
      continue;
    end if;

    insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
      values (v_order.build_id, v_material_id, v_row.id, v_take, v_row."unitPrice", now());

    if v_row.quantity - v_take > 0.0001 then
      update material_batches set quantity = quantity - v_take where id = v_row.id;
    else
      delete from material_batches where id = v_row.id;
    end if;

    v_remaining := v_remaining - v_take;
    v_applied := v_applied + v_take;
  end loop;

  -- Wolny stan mógł się zmienić między wygenerowaniem podpowiedzi a
  -- kliknięciem (patrz ryzyko, o którym już rozmawialiśmy) — jeśli w
  -- międzyczasie ktoś inny zabrał ten materiał, przypisujemy tyle, ile
  -- faktycznie jeszcze jest, nie tyle, ile podpowiedź obiecywała.
  if v_applied <= 0.0001 then
    update order_items set available_free_quantity = 0 where id = p_order_item_id;
    return 0;
  end if;

  perform fn_recalc_material(v_material_id);

  select sum(quantity), sum(quantity * "unitPrice")
    into v_avg_qty, v_avg_value
    from build_material_lots
    where "buildId" = v_order.build_id and "materialId" = v_material_id;

  select "unitPrice" into v_fallback_price from materials where id = v_material_id;
  v_new_price := case when v_avg_qty > 0 then v_avg_value / v_avg_qty else coalesce(v_fallback_price, 0) end;

  insert into build_materials ("buildId", "materialId", planned, used, "unitPrice", issued)
    values (v_order.build_id, v_material_id, v_applied, 0, v_new_price, v_applied)
    on conflict ("buildId", "materialId") do update
      set planned = build_materials.planned + excluded.planned,
          issued = build_materials.issued + excluded.issued,
          "unitPrice" = v_new_price;

  update order_items
    set ordered_quantity = greatest(0, coalesce(ordered_quantity, 0) - v_applied),
        available_free_quantity = greatest(0, coalesce(available_free_quantity, 0) - v_applied)
    where id = p_order_item_id;

  return v_applied;
end;
$$;

grant execute on function apply_order_item_free_stock(integer) to authenticated;
