-- ============================================================
-- 122: MAGAZYN v2 — funkcje biznesowe na jednej księdze (po 121)
-- Te same nazwy i parametry co dotąd (aplikacja woła je bez zmian) +
-- nowe operacje: zwrot/strata w trakcie budowy, wyjaśnianie niedoborów,
-- weryfikacja pobrań brygadzisty. Żadna funkcja nie pisze już stanu
-- bezpośrednio — wszystko przez fn_ledger_post.
-- ============================================================
BEGIN;

ALTER TABLE build_settlements ADD COLUMN IF NOT EXISTS "kmCost" numeric NOT NULL DEFAULT 0;

-- ---------- Kartoteka i stan początkowy ----------
CREATE OR REPLACE FUNCTION public.create_material(p_name text, p_index text, p_unit text, p_initial_stock numeric, p_min numeric, p_unit_price numeric)
 RETURNS materials LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare v_material materials;
begin
  perform assert_role(array['Admin']::app_role[]);
  if exists (select 1 from materials where index = p_index) then
    raise exception 'Materiał z indeksem "%" już istnieje.', p_index;
  end if;
  insert into materials (name, index, unit, stock, min, "unitPrice")
    values (p_name, p_index, p_unit, 0, p_min, coalesce(p_unit_price, 0))
    returning * into v_material;
  if coalesce(p_initial_stock, 0) > 0 then
    perform fn_stock_receive(v_material.id, p_initial_stock, coalesce(p_unit_price, 0), null, 'stan początkowy');
  end if;
  select * into v_material from materials where id = v_material.id;
  return v_material;
end;
$$;

-- Korekta inwentaryzacyjna magazynu: + nowa partia „korekta”, − zdjęcie FEFO→FIFO.
-- Zmiana ceny dotyczy tylko kartoteki (cena domyślna nowych dostaw) — ceny
-- istniejących partii są stałe (N3).
CREATE OR REPLACE FUNCTION public.correct_material(p_material_id integer, p_new_stock numeric, p_new_price numeric, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  v_material materials;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_old_stock numeric;
  v_old_price numeric;
  v_delta numeric;
  v_op uuid;
  v_batch integer;
  a record;
begin
  perform assert_role(array['Admin']::app_role[]);
  if length(v_reason) < 3 then raise exception 'Podaj powód korekty (min. 3 znaki).'; end if;
  if p_new_stock is not null and p_new_stock < 0 then raise exception 'Stan magazynowy nie może być ujemny.'; end if;
  if p_new_price is not null and p_new_price < 0 then raise exception 'Cena nie może być ujemna.'; end if;

  select * into v_material from materials where id = p_material_id for update;
  if not found then raise exception 'Nie znaleziono materiału #%.', p_material_id; end if;
  v_old_stock := coalesce(v_material.stock, 0);
  v_old_price := coalesce(v_material."unitPrice", 0);

  if p_new_price is not null and abs(p_new_price - v_old_price) >= 0.005 then
    update materials set "unitPrice" = p_new_price, "updatedAt" = now() where id = p_material_id;
    v_op := fn_op_begin('korekta_inwentaryzacyjna', null, null, null, v_reason);
    perform fn_ledger_post(v_op, 'korekta_inwentaryzacyjna', p_material_id, null, null, 0, 0, p_new_price,
      p_note => format('Cena w kartotece: było %s → jest %s (partie bez zmian). Powód: %s',
                       round(v_old_price, 2), round(p_new_price, 2), v_reason));
  end if;

  if p_new_stock is not null then
    v_delta := p_new_stock - v_old_stock;
    if abs(v_delta) >= 0.0001 then
      if v_delta > 0 then
        v_batch := fn_stock_receive(p_material_id, v_delta, coalesce(p_new_price, v_old_price), null, 'korekta',
          p_note => format('Korekta stanu: było %s → jest %s %s. Powód: %s', v_old_stock, p_new_stock, v_material.unit, v_reason));
        update stock_ledger set op_type = 'korekta_inwentaryzacyjna'
          where batch_id = v_batch and op_type = 'przyjecie';
        update stock_operations set op_type = 'korekta_inwentaryzacyjna'
          where id = (select operation_id from stock_ledger where batch_id = v_batch limit 1);
      else
        v_op := fn_op_begin('korekta_inwentaryzacyjna', null, null, null, v_reason);
        for a in select * from fn_alloc(p_material_id, null, -v_delta) loop
          perform fn_ledger_post(v_op, 'korekta_inwentaryzacyjna', p_material_id, a.batch_id, null, -a.take, 0, a.unit_price,
            p_note => format('Korekta stanu: było %s → jest %s %s. Powód: %s', v_old_stock, p_new_stock, v_material.unit, v_reason));
        end loop;
      end if;
    end if;
  end if;
end;
$$;

-- ---------- Przyjęcia (jeden mechanizm, dwa wejścia) ----------
CREATE OR REPLACE FUNCTION public.receive_material_order(p_order_id integer, p_received_quantity numeric,
  p_received_unit_price numeric DEFAULT NULL, p_document_number text DEFAULT NULL, p_supplier text DEFAULT NULL,
  p_producer_lot_no text DEFAULT NULL, p_expiry_date date DEFAULT NULL, p_quality_docs text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  v_order material_orders;
  v_material_id integer;
  v_match_count integer;
begin
  perform assert_role(array['Admin']::app_role[]);
  select * into v_order from material_orders where id = p_order_id for update;
  if not found then raise exception 'Nie znaleziono zamówienia #%.', p_order_id; end if;
  if v_order.status = 'dostarczone' then raise exception 'Zamówienie #% jest już przyjęte.', p_order_id; end if;

  v_material_id := v_order."materialId";
  if v_material_id is null then
    select count(*) into v_match_count from materials
      where normalize_material_name(name) = normalize_material_name(v_order."materialName");
    if v_match_count > 1 then
      raise exception 'Materiał "%" występuje w magazynie więcej niż raz — połącz pozycję z konkretnym materiałem przed przyjęciem.', v_order."materialName";
    end if;
    select id into v_material_id from materials
      where normalize_material_name(name) = normalize_material_name(v_order."materialName") limit 1;
  end if;
  if p_received_unit_price is null then
    raise exception 'Podaj cenę dostawy — bez ceny nie da się przyjąć partii.';
  end if;
  if v_material_id is null then
    insert into materials (name, index, unit, stock, min, "unitPrice")
      values (v_order."materialName", coalesce(nullif(trim(v_order.new_material_index), ''), 'FLOW-' || v_order.id),
              v_order.unit, 0, coalesce(v_order.new_material_min, 5), p_received_unit_price)
      returning id into v_material_id;
  end if;

  perform fn_stock_receive(v_material_id, p_received_quantity, p_received_unit_price, null, 'zamówienie',
    p_document_number, p_supplier, p_producer_lot_no, p_expiry_date, p_quality_docs);

  update material_orders
     set status = 'dostarczone', "receivedQuantity" = p_received_quantity,
         "receivedUnitPrice" = p_received_unit_price, "receivedAt" = now(), "materialId" = v_material_id
   where id = p_order_id;
end;
$$;
DROP FUNCTION IF EXISTS receive_material_order(integer, numeric, numeric, text, text);

-- Zamówienie z planu: dostawa wprost NA BUDOWĘ (przyjęcie w lokalizacji budowy).
-- Pozycja może nieść: receivedQuantity, receivedUnitPrice, producerLotNo, expiryDate, qualityDocs.
CREATE OR REPLACE FUNCTION public.receive_order(p_order_id integer, p_items jsonb, p_document_number text DEFAULT NULL, p_supplier text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  v_order orders;
  v_build_status build_status;
  v_item jsonb;
  v_row order_items;
  v_material_id integer;
  v_price numeric;
  v_qty numeric;
  v_match_count integer;
begin
  perform assert_role(array['Admin']::app_role[]);
  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Nie znaleziono zamówienia #%.', p_order_id; end if;
  if v_order.status = 'przyjęte' then raise exception 'Zamówienie #% jest już przyjęte.', p_order_id; end if;
  if v_order.status = 'anulowane' then raise exception 'Zamówienie #% jest anulowane.', p_order_id; end if;
  select status into v_build_status from builds where id = v_order.build_id;
  if v_build_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można już przyjmować dla niej dostaw.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_row from order_items where id = (v_item->>'itemId')::integer and order_id = p_order_id for update;
    if not found then raise exception 'Pozycja #% nie należy do zamówienia #%.', v_item->>'itemId', p_order_id; end if;
    v_qty := nullif(v_item->>'receivedQuantity', '')::numeric;
    continue when v_qty is null or v_qty <= 0;
    v_price := nullif(v_item->>'receivedUnitPrice', '')::numeric;
    if v_price is null then
      raise exception 'Podaj cenę dostawy dla „%”.', v_row.material_name;
    end if;

    v_material_id := v_row.linked_material_id;
    if v_material_id is null then
      select count(*) into v_match_count from materials
        where normalize_material_name(name) = normalize_material_name(v_row.material_name);
      if v_match_count > 1 then
        raise exception 'Materiał "%" występuje w magazynie więcej niż raz — połącz pozycję z konkretnym materiałem przed przyjęciem.', v_row.material_name;
      end if;
      select id into v_material_id from materials
        where normalize_material_name(name) = normalize_material_name(v_row.material_name) limit 1;
    end if;
    if v_material_id is null then
      insert into materials (name, index, unit, stock, min, "unitPrice")
        values (v_row.material_name, 'FLOW-OI-' || v_row.id, v_row.unit, 0, 0, v_price)
        returning id into v_material_id;
    end if;

    perform fn_stock_receive(v_material_id, v_qty, v_price, v_order.build_id, 'zamówienie',
      p_document_number, p_supplier, v_item->>'producerLotNo', nullif(v_item->>'expiryDate', '')::date,
      v_item->>'qualityDocs');

    update order_items set linked_material_id = v_material_id, received_quantity = v_qty, received_unit_price = v_price
      where id = v_row.id;
  end loop;
  update orders set status = 'przyjęte' where id = p_order_id;
end;
$$;

-- ---------- Wydania magazyn → budowa ----------
CREATE OR REPLACE FUNCTION public.apply_order_item_free_stock(p_order_item_id integer)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  v_item order_items;
  v_order orders;
  v_build_status build_status;
  v_want numeric;
  v_applied numeric;
  v_op uuid;
begin
  perform assert_role(array['Admin']::app_role[]);
  select * into v_item from order_items where id = p_order_item_id for update;
  if not found then raise exception 'Nie znaleziono pozycji zamówienia #%.', p_order_item_id; end if;
  select * into v_order from orders where id = v_item.order_id for update;
  if v_order.status <> 'robocze' then raise exception 'Można uwzględnić wolny magazyn tylko w zamówieniu roboczym.'; end if;
  select status into v_build_status from builds where id = v_order.build_id;
  if v_build_status = 'zamknięta' then raise exception 'Budowa jest zamknięta — nie można już przypisywać materiału.'; end if;
  if v_item.linked_material_id is null then
    raise exception 'Pozycja #% nie jest powiązana z żadnym materiałem magazynowym.', p_order_item_id;
  end if;

  v_want := least(coalesce(v_item.available_free_quantity, 0), coalesce(v_item.ordered_quantity, 0),
                  fn_available(v_item.linked_material_id, null));
  if v_want <= 0.00001 then
    update order_items set available_free_quantity = 0 where id = p_order_item_id;
    return 0;
  end if;
  v_op := fn_op_begin('wydanie', v_order.build_id, null, null, 'Z wolnego magazynu do zamówienia ' || v_order.order_number);
  perform fn_stock_move(v_op, 'wydanie', v_item.linked_material_id, null, v_order.build_id, v_want);
  perform fn_settle_shortages(v_order.build_id, v_item.linked_material_id, 'wydanie');
  v_applied := v_want;

  update order_items
     set ordered_quantity = greatest(0, coalesce(ordered_quantity, 0) - v_applied),
         available_free_quantity = greatest(0, coalesce(available_free_quantity, 0) - v_applied)
   where id = p_order_item_id;
  return v_applied;
end;
$$;

-- Wydanie wskazanych partii. Brygadzista (D3) — ruch od razu, do weryfikacji Admina.
CREATE OR REPLACE FUNCTION public.assign_material_batches_to_build(p_build_id integer, p_items jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  v_status build_status;
  v_item jsonb;
  v_batch batches;
  v_qty numeric;
  v_op uuid;
  v_materials integer[] := '{}';
  v_m integer;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);
  select status into v_status from builds where id = p_build_id for update;
  if not found then raise exception 'Nie znaleziono budowy #%.', p_build_id; end if;
  if v_status = 'zamknięta' then raise exception 'Budowa jest zamknięta — nie można już przypisywać materiałów.'; end if;

  v_op := fn_op_begin('wydanie', p_build_id, null, null,
    case when app_role() = 'Brygadzista' then 'Pobranie z magazynu przez brygadzistę' else 'Wydanie z magazynu' end,
    app_role() = 'Brygadzista');
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    continue when v_qty is null or v_qty <= 0;
    select * into v_batch from batches where id = (v_item->>'batchId')::integer;
    if not found then raise exception 'Nie znaleziono partii #%.', v_item->>'batchId'; end if;
    perform fn_stock_move(v_op, 'wydanie', v_batch.material_id, null, p_build_id, v_qty, v_batch.id);
    v_materials := array_append(v_materials, v_batch.material_id);
  end loop;
  foreach v_m in array v_materials loop
    perform fn_settle_shortages(p_build_id, v_m, 'wydanie');
  end loop;
end;
$$;

-- Odpięcie materiału pomocniczego = zwrot CAŁEGO salda na magazyn (te same partie).
CREATE OR REPLACE FUNCTION public.unassign_material_from_build(p_build_id integer, p_material_id integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  v_status build_status;
  v_avail numeric;
  v_op uuid;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);
  select status into v_status from builds where id = p_build_id for update;
  if not found then raise exception 'Nie znaleziono budowy #%.', p_build_id; end if;
  if v_status = 'zamknięta' then raise exception 'Budowa jest zamknięta — nie można już zmieniać przypisań materiałów.'; end if;
  v_avail := fn_available(p_material_id, p_build_id);
  if v_avail <= 0.00001 then
    raise exception 'Cały przydzielony materiał został już zużyty w raportach — nie ma nic do zwrócenia na magazyn.';
  end if;
  v_op := fn_op_begin('zwrot', p_build_id, null, null, 'Odpięcie materiału od budowy — zwrot na magazyn');
  perform fn_stock_move(v_op, 'zwrot', p_material_id, p_build_id, null, v_avail, null, true, 'Odpięcie materiału — zwrot na magazyn');
end;
$$;

-- NOWE: częściowy zwrot budowa → magazyn w trakcie prac (Admin).
CREATE OR REPLACE FUNCTION public.return_material_to_warehouse(p_build_id integer, p_material_id integer,
  p_quantity numeric, p_note text DEFAULT NULL)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare v_op uuid; v_status build_status;
begin
  perform assert_role(array['Admin']::app_role[]);
  select status into v_status from builds where id = p_build_id for update;
  if not found then raise exception 'Nie znaleziono budowy #%.', p_build_id; end if;
  v_op := fn_op_begin('zwrot', p_build_id, null, null, coalesce(nullif(trim(p_note), ''), 'Zwrot na magazyn'));
  return fn_stock_move(v_op, 'zwrot', p_material_id, p_build_id, null, p_quantity, null, true,
    coalesce(nullif(trim(p_note), ''), 'Zwrot na magazyn'));
end;
$$;

-- Transfer budowa → budowa (Admin) + automatyczne wyjaśnienie niedoborów budowy docelowej.
CREATE OR REPLACE FUNCTION public.transfer_material_between_builds(p_source_build_id integer, p_target_build_id integer,
  p_material_id integer, p_quantity numeric, p_note text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  v_op uuid;
  v_b record;
  v_note text := nullif(trim(p_note), '');
begin
  perform assert_role(array['Admin']::app_role[]);
  if p_source_build_id = p_target_build_id then raise exception 'Budowa źródłowa i docelowa muszą być różne.'; end if;
  if length(coalesce(v_note, '')) > 500 then raise exception 'Uwaga do transferu może mieć maksymalnie 500 znaków.'; end if;
  for v_b in select id, status from builds where id in (p_source_build_id, p_target_build_id) order by id for update loop
    if v_b.status = 'zamknięta' then raise exception 'Budowa #% jest zamknięta — transfer niemożliwy.', v_b.id; end if;
  end loop;
  v_op := fn_op_begin('transfer', p_source_build_id, p_target_build_id, null, coalesce(v_note, 'Transfer między budowami'));
  perform fn_stock_move(v_op, 'transfer', p_material_id, p_source_build_id, p_target_build_id, p_quantity, null, false,
    coalesce(v_note, 'Transfer między budowami'));
  perform fn_settle_shortages(p_target_build_id, p_material_id, 'transfer');
  return v_op;
end;
$$;

-- ---------- Straty (D5) ----------
CREATE OR REPLACE FUNCTION fn_post_loss(p_build integer, p_material integer, p_qty numeric, p_reason text)
 RETURNS uuid LANGUAGE plpgsql SET search_path TO 'public'
AS $$
declare v_op uuid; a record; v_avail numeric;
begin
  v_avail := fn_available(p_material, p_build);
  if v_avail < p_qty - 0.00001 then
    raise exception 'Za mało „%” na budowie, żeby zgłosić stratę (jest %, zgłoszono %).',
      fn_material_name(p_material), round(v_avail, 3), round(p_qty, 3);
  end if;
  v_op := fn_op_begin('strata', p_build, null, null, p_reason);
  for a in select * from fn_alloc(p_material, p_build, p_qty) loop
    perform fn_ledger_post(v_op, 'strata', p_material, a.batch_id, p_build, -a.take, 0, a.unit_price,
      p_build, 'strata', a.take * a.unit_price, p_note => p_reason);
  end loop;
  return v_op;
end;
$$;
REVOKE EXECUTE ON FUNCTION fn_post_loss(integer, integer, numeric, text) FROM PUBLIC, anon, authenticated;

-- Admin księguje stratę od razu; Brygadzista zgłasza (czeka na zatwierdzenie).
CREATE OR REPLACE FUNCTION public.report_material_loss(p_build_id integer, p_material_id integer, p_quantity numeric, p_reason text)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare v_reason text := btrim(coalesce(p_reason, '')); v_id integer; v_status build_status;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);
  if length(v_reason) < 3 then raise exception 'Podaj powód straty (min. 3 znaki).'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Ilość straty musi być większa od zera.'; end if;
  select status into v_status from builds where id = p_build_id;
  if v_status is null then raise exception 'Nie znaleziono budowy #%.', p_build_id; end if;
  if v_status = 'zamknięta' then raise exception 'Budowa jest zamknięta.'; end if;
  insert into material_loss_requests (build_id, material_id, qty, reason)
    values (p_build_id, p_material_id, p_quantity, v_reason) returning id into v_id;
  if app_role() = 'Admin' then
    perform approve_material_loss(v_id, true);
  end if;
  return v_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.approve_material_loss(p_request_id integer, p_approve boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare r material_loss_requests; v_op uuid;
begin
  perform assert_role(array['Admin']::app_role[]);
  select * into r from material_loss_requests where id = p_request_id for update;
  if not found then raise exception 'Nie znaleziono zgłoszenia straty #%.', p_request_id; end if;
  if r.status <> 'oczekuje' then raise exception 'Zgłoszenie #% zostało już rozpatrzone.', p_request_id; end if;
  if p_approve then
    v_op := fn_post_loss(r.build_id, r.material_id, r.qty, r.reason);
  end if;
  update material_loss_requests
     set status = case when p_approve then 'zatwierdzona' else 'odrzucona' end,
         operation_id = v_op, decided_by = auth.uid(), decided_at = now()
   where id = p_request_id;
end;
$$;

-- ---------- Niedobory: wyjaśnienie ręczne (różnica inwentaryzacyjna) ----------
CREATE OR REPLACE FUNCTION public.resolve_shortage(p_shortage_id integer, p_as_loss boolean, p_note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare s shortages; v_op uuid; v_note text := btrim(coalesce(p_note, ''));
begin
  perform assert_role(array['Admin']::app_role[]);
  if length(v_note) < 3 then raise exception 'Opisz wyjaśnienie niedoboru (min. 3 znaki).'; end if;
  select * into s from shortages where id = p_shortage_id for update;
  if not found then raise exception 'Nie znaleziono niedoboru #%.', p_shortage_id; end if;
  if s.status <> 'do_wyjasnienia' then raise exception 'Niedobór #% jest już wyjaśniony.', p_shortage_id; end if;
  v_op := fn_op_begin('rozliczenie_niedoboru', s.build_id, null, s.report_id, 'Różnica inwentaryzacyjna: ' || v_note);
  if p_as_loss then
    -- Materiał nie został wbudowany — koszt przechodzi ze zużycia do strat.
    perform fn_ledger_post(v_op, 'rozliczenie_niedoboru', s.material_id, null, s.build_id, 0, -s.qty_open, s.provisional_price,
      s.build_id, 'zuzycie', -s.qty_open * s.provisional_price, s.report_id, s.stage_name, s.id,
      p_note => 'Różnica inwentaryzacyjna — przeniesienie do strat: ' || v_note);
    perform fn_ledger_post(v_op, 'strata', s.material_id, null, s.build_id, 0, 0, s.provisional_price,
      s.build_id, 'strata', s.qty_open * s.provisional_price, s.report_id, s.stage_name, s.id,
      p_note => 'Różnica inwentaryzacyjna — strata: ' || v_note);
    if s.report_id is not null then
      update report_materials set cost = fn_report_day_cost(s.report_id, s.material_id, s.stage_name)
       where "reportId" = s.report_id and "materialId" = s.material_id and stage_name is not distinct from s.stage_name;
    end if;
  end if;
  update shortages set qty_open = 0, status = 'wyjasniony', resolution = 'roznica_inwentaryzacyjna',
         resolved_by = auth.uid(), resolved_at = now(), note = v_note
   where id = p_shortage_id;
end;
$$;

-- ---------- Weryfikacja pobrań brygadzisty (D3) ----------
CREATE OR REPLACE FUNCTION public.verify_stock_operation(p_operation_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
begin
  perform assert_role(array['Admin']::app_role[]);
  update stock_operations set reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_operation_id and needs_review and reviewed_at is null;
  if not found then raise exception 'Operacja nie istnieje albo została już zweryfikowana.'; end if;
end;
$$;

-- ---------- Zamknięcie budowy ----------
CREATE OR REPLACE FUNCTION public.close_build(p_build_id integer, p_returns jsonb DEFAULT '[]'::jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  v_build builds;
  v_pending integer;
  v_ret jsonb;
  v_bal batch_balances;
  v_qty numeric;
  v_decision text;
  v_reason text;
  v_op_ret uuid;
  v_list text;
  v_hours numeric; v_labor numeric; v_mat numeric; v_extra numeric; v_waste numeric; v_sub numeric; v_km numeric;
begin
  perform assert_role(array['Admin']::app_role[]);
  select * into v_build from builds where id = p_build_id for update;
  if not found then raise exception 'Nie znaleziono budowy #%.', p_build_id; end if;
  if v_build.status = 'zamknięta' then return; end if;

  select count(*) into v_pending from reports where "buildId" = p_build_id and status <> 'approved';
  if v_pending > 0 then
    raise exception 'Nie wszystkie raporty tej budowy są zatwierdzone — zatwierdź je przed zamknięciem.';
  end if;

  for v_ret in select * from jsonb_array_elements(p_returns) loop
    v_qty := (v_ret->>'quantity')::numeric;
    continue when v_qty is null or v_qty <= 0;
    v_decision := v_ret->>'decision';
    v_reason := nullif(trim(v_ret->>'reason'), '');
    if v_decision not in ('zwrot', 'wyrzucenie') then
      raise exception 'Nieprawidłowa decyzja rozliczenia: %', v_decision;
    end if;
    select * into v_bal from batch_balances
      where id = (v_ret->>'lotId')::integer and location_build_id = p_build_id and qty >= v_qty - 0.00001;
    if not found then
      raise exception 'Partia #% nie leży na tej budowie albo ilość przekracza jej saldo.', v_ret->>'lotId';
    end if;
    if v_decision = 'zwrot' then
      if v_op_ret is null then
        v_op_ret := fn_op_begin('zwrot', p_build_id, null, null, 'Zamknięcie budowy — zwrot na magazyn');
      end if;
      perform fn_stock_move(v_op_ret, 'zwrot', v_bal.material_id, p_build_id, null, v_qty, v_bal.batch_id, false,
        coalesce(v_reason, 'Zamknięcie budowy — zwrot na magazyn'));
    else
      if v_reason is null then raise exception 'Podaj powód wyrzucenia materiału.'; end if;
      perform fn_ledger_post(fn_op_begin('strata', p_build_id, null, null, v_reason), 'strata', v_bal.material_id,
        v_bal.batch_id, p_build_id, -v_qty, 0, v_bal.unit_price, p_build_id, 'strata', v_qty * v_bal.unit_price,
        p_note => v_reason);
    end if;
  end loop;

  select string_agg(fn_material_name(material_id) || ': ' || round(qty_open, 3), ', ') into v_list
    from shortages where build_id = p_build_id and status = 'do_wyjasnienia';
  if v_list is not null then
    raise exception 'Nie można zamknąć budowy — są niedobory do wyjaśnienia: %. Wyjaśnij je na karcie budowy (dostawa, transfer, korekta raportu albo różnica inwentaryzacyjna).', v_list;
  end if;
  select string_agg(fn_material_name(material_id) || ': ' || round(s, 3), ', ') into v_list
    from (select material_id, sum(qty) s from batch_balances where location_build_id = p_build_id group by 1 having sum(qty) > 0.00001) x;
  if v_list is not null then
    raise exception 'Nie można zamknąć budowy — na budowie zostały materiały: %. Zdecyduj: zwrot na magazyn albo do wyrzucenia.', v_list;
  end if;

  -- Rozliczenie końcowe: robocizna stawką KOSZTOWĄ (F20), kilometrówka w koszcie (F21).
  select coalesce(sum(t.hours), 0),
         coalesce(sum(t.hours * coalesce(t."costRate", e."costRate", t."hourlyRate", e."hourlyRate", 0)), 0)
    into v_hours, v_labor
    from time_entries t join employees e on e.id = t."employeeId" where t."buildId" = p_build_id;
  select coalesce(sum(cost_value) filter (where cost_effect = 'zuzycie'), 0),
         coalesce(sum(cost_value) filter (where cost_effect = 'strata'), 0)
    into v_mat, v_waste from stock_ledger where cost_build_id = p_build_id;
  select coalesce(sum(rec.amount), 0) into v_extra
    from report_extra_costs rec join reports r on r.id = rec."reportId" where r."buildId" = p_build_id;
  select coalesce(sum("kmCost"), 0) into v_km from reports where "buildId" = p_build_id;
  select coalesce(sum(i.amount), 0) into v_sub
    from subcontract_acceptance_items i join subcontract_acceptances a on a.id = i.acceptance_id where a.build_id = p_build_id;

  insert into build_settlements ("buildId", "totalHours", "totalExtraCosts", "materialsCost", "laborCost",
      "wasteCost", "subcontractCost", "kmCost", "totalCost")
    values (p_build_id, v_hours, v_extra, v_mat, v_labor, v_waste, v_sub, v_km, v_mat + v_labor + v_extra + v_waste + v_sub + v_km)
    on conflict ("buildId") do update set "closedAt" = now(), "totalHours" = excluded."totalHours",
      "totalExtraCosts" = excluded."totalExtraCosts", "materialsCost" = excluded."materialsCost",
      "laborCost" = excluded."laborCost", "wasteCost" = excluded."wasteCost",
      "subcontractCost" = excluded."subcontractCost", "kmCost" = excluded."kmCost", "totalCost" = excluded."totalCost";

  delete from build_settlement_materials where "buildId" = p_build_id;
  insert into build_settlement_materials ("buildId", "materialId", planned, used, "unitPrice", "actualCost")
    select "buildId", "materialId", planned, used, "unitPrice", "actualCost" from build_materials where "buildId" = p_build_id;

  update builds set status = 'zamknięta', "updatedAt" = now() where id = p_build_id;
end;
$$;

-- ---------- Raport dzienny: zużycie i korekty przez księgę ----------
DO $$
DECLARE
  d text := pg_get_functiondef('submit_daily_report(integer,date,jsonb,jsonb,jsonb,numeric,text,jsonb,integer)'::regprocedure);
  a_start text := '    select * into v_assignment from build_materials';
  a_end   text := '    insert into report_materials ("reportId", "materialId", "usedQuantity", cost, reason, stage_name)';
  p1 integer; p2 integer;
  new_block text := $blk$    if not exists (select 1 from materials where id = v_material_id) then
      continue;
    end if;
    if v_op is null then
      v_op := fn_op_begin('zuzycie', p_build_id, null, v_report_id, 'Raport dzienny ' || p_date);
    end if;

    v_prev_daily := coalesce((v_prev_materials ->> v_key)::decimal, 0);
    v_delta := v_daily_quantity - v_prev_daily;
    if v_delta > 0.0001 then
      perform fn_stock_consume(v_op, p_build_id, v_material_id, v_delta, v_report_id, v_stage_name);
    elsif v_delta < -0.0001 then
      perform fn_stock_reverse(v_op, p_build_id, v_material_id, -v_delta, v_report_id, v_stage_name);
    end if;

$blk$;
BEGIN
  p1 := position(a_start in d);
  p2 := position(a_end in d);
  IF p1 = 0 OR p2 = 0 OR p2 < p1 THEN
    RAISE EXCEPTION 'submit_daily_report ma inną treść niż oczekiwano — migracja 122 przerwana.';
  END IF;
  d := substr(d, 1, p1 - 1) || new_block || substr(d, p2);
  d := replace(d, '  v_progress_qty decimal;', E'  v_progress_qty decimal;\n  v_op uuid;');
  EXECUTE d;
END $$;

-- ---------- Uprawnienia nowych funkcji ----------
REVOKE EXECUTE ON FUNCTION return_material_to_warehouse(integer, integer, numeric, text),
  report_material_loss(integer, integer, numeric, text), approve_material_loss(integer, boolean),
  resolve_shortage(integer, boolean, text), verify_stock_operation(uuid),
  receive_material_order(integer, numeric, numeric, text, text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION return_material_to_warehouse(integer, integer, numeric, text),
  report_material_loss(integer, integer, numeric, text), approve_material_loss(integer, boolean),
  resolve_shortage(integer, boolean, text), verify_stock_operation(uuid),
  receive_material_order(integer, numeric, numeric, text, text, text, date, text) TO authenticated;

-- ---------- Realtime i nocna kontrola ----------
ALTER PUBLICATION supabase_realtime ADD TABLE stock_ledger, shortages, material_loss_requests, stock_operations;

COMMIT;
