-- ============================================================
-- Fix: "insert or update on table build_material_lots violates foreign
-- key constraint build_material_lots_sourceBatchId_fkey" przy ręcznym
-- przypisywaniu CAŁEJ partii do budowy (Faza 5, 009).
--
-- Przyczyna: assign_material_batches_to_build najpierw usuwała
-- w pełni zużytą partię z material_batches (gdy quantity - v_quantity
-- <= 0.0001), a DOPIERO POTEM wstawiała do build_material_lots wiersz
-- odwołujący się przez "sourceBatchId" do już nieistniejącego id —
-- prosty foreign key violation, nie race condition. Fix: wstaw najpierw
-- build_material_lots (partia jeszcze istnieje), dopiero potem
-- zmniejsz/usuń material_batches — przy usunięciu "sourceBatchId" tej
-- świeżo wstawionej pozycji zostaje ustawione na null (on delete set
-- null, patrz drizzle/schema.ts), dokładnie tak jak przy zejściu do
-- zera w fn_consume_fifo (001) — utrata referencji do w pełni zużytej
-- partii jest tu świadomym, już istniejącym w projekcie kompromisem.
-- Uruchom PO 009. Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

create or replace function assign_material_batches_to_build(p_build_id integer, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status build_status;
  v_item jsonb;
  v_batch material_batches;
  v_batch_id integer;
  v_quantity decimal;
  v_avg_qty decimal;
  v_avg_value decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select status into v_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można już przypisywać materiałów.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_batch_id := (v_item->>'batchId')::integer;
    v_quantity := (v_item->>'quantity')::decimal;
    if v_quantity is null or v_quantity <= 0 then
      continue;
    end if;

    select * into v_batch from material_batches where id = v_batch_id for update;
    if not found then
      raise exception 'Nie znaleziono partii #%.', v_batch_id;
    end if;
    if v_batch.quantity < v_quantity - 0.0001 then
      raise exception 'Za mało towaru w partii #% (dostępne %, żądane %).',
        v_batch_id, v_batch.quantity, v_quantity;
    end if;

    -- Wstaw NAJPIERW, dopóki partia jeszcze istnieje w material_batches —
    -- inaczej foreign key na "sourceBatchId" odwołuje się do usuniętego id.
    insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
      values (p_build_id, v_batch."materialId", v_batch_id, v_quantity, v_batch."unitPrice", now());

    if v_batch.quantity - v_quantity > 0.0001 then
      update material_batches set quantity = quantity - v_quantity where id = v_batch_id;
    else
      delete from material_batches where id = v_batch_id;
    end if;
    perform fn_recalc_material(v_batch."materialId");

    select sum(quantity), sum(quantity * "unitPrice")
      into v_avg_qty, v_avg_value
      from build_material_lots
      where "buildId" = p_build_id and "materialId" = v_batch."materialId";

    insert into build_materials ("buildId", "materialId", planned, used, "unitPrice", issued)
      values (p_build_id, v_batch."materialId", v_quantity, 0, v_batch."unitPrice", v_quantity)
      on conflict ("buildId", "materialId") do update
        set planned = build_materials.planned + excluded.planned,
            issued = build_materials.issued + excluded.issued,
            "unitPrice" = case when v_avg_qty > 0 then v_avg_value / v_avg_qty else build_materials."unitPrice" end;
  end loop;
end;
$$;

grant execute on function assign_material_batches_to_build(integer, jsonb) to authenticated;
