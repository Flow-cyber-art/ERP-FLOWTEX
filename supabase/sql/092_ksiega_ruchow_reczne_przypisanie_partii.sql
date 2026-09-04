-- ============================================================
-- Luka w księdze ruchów magazynowych (stock_movements): ręczne
-- przypisanie konkretnej partii do budowy (Faza 5, "Materiały
-- dodatkowe" → wybór partii, `assign_material_batches_to_build`) NIE
-- zapisywało zdarzenia 'wydanie' — w odróżnieniu od `receive_order`
-- (materiał zamówiony wprost pod budowę), które to robi od
-- 079_ksiega_ruchow_przyjecie_zuzycie.sql.
--
-- Skutek: `stock_movements` (trwały log, planowany jako źródło "po
-- jakiej cenie faktycznie trafił materiał na tę budowę" dla panelu
-- Rozliczenie) był NIEKOMPLETNY — pokazywałby tylko materiał zamówiony
-- bezpośrednio pod budowę, całkiem pomijając materiał ręcznie pobrany z
-- istniejących partii magazynowych (czyli częstszy z dwóch sposobów
-- przypisania materiału do budowy). `build_material_lots` (żywy stan)
-- miał komplet, ale zeruje się w miarę zużycia/zamknięcia budowy — więc
-- historia by znikała właśnie wtedy, gdy jest najbardziej potrzebna.
--
-- Naprawa: `assign_material_batches_to_build` zapisuje teraz 'wydanie'
-- tak samo jak `receive_order`. Backfill niżej dopisuje brakujące
-- zdarzenia dla partii JESZCZE ISTNIEJĄCYCH w `build_material_lots`
-- (aktywne budowy) — dla już zamkniętych/zużytych/zwróconych partii
-- historii cenowej nie da się już odzyskać, bo `build_material_lots`
-- jej nie trzyma (to jedyne miejsce, gdzie te dane wcześniej żyły).
--
-- Uruchom PO 079_ksiega_ruchow_przyjecie_zuzycie.sql. Bezpieczne do
-- wielokrotnego wklejenia (backfill idempotentny — pomija partie, które
-- już mają swoje 'wydanie'). Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
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
  v_lot_id integer;
  v_actor text := auth.uid()::text;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);

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
      values (p_build_id, v_batch."materialId", v_batch_id, v_quantity, v_batch."unitPrice", now())
      returning id into v_lot_id;

    -- Trwały log — patrz duży komentarz na górze pliku, dlaczego to było
    -- tu brakującym elementem względem receive_order.
    insert into stock_movements
        ("type", "materialId", "buildId", "batchId", "lotId", quantity, "unitPrice", "createdByProfileId")
      values ('wydanie', v_batch."materialId", p_build_id, v_batch_id, v_lot_id, v_quantity, v_batch."unitPrice", v_actor);

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

-- Backfill: partie wciąż żywe (nie zużyte/zwrócone), którym brakuje
-- odpowiadającego 'wydanie' w logu — dopisz z danymi, które ta partia
-- już ma (issuedAt/unitPrice), żeby istniejące budowy (np. te założone
-- dziś, przed tą poprawką) też pokazały poprawną historię cen w
-- Rozliczeniu, nie tylko nowo przypisywane materiały.
insert into stock_movements ("type", "materialId", "buildId", "batchId", "lotId", quantity, "unitPrice", "createdAt")
select 'wydanie', bml."materialId", bml."buildId", bml."sourceBatchId", bml.id, bml.quantity, bml."unitPrice", bml."issuedAt"
from build_material_lots bml
where not exists (
  select 1 from stock_movements sm where sm."lotId" = bml.id and sm.type = 'wydanie'
);
