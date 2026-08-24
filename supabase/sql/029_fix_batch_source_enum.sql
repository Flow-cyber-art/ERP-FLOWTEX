-- ============================================================
-- Fix: unassign_material_from_build (028) wstawiała do material_batches
-- wartość source = 'zwrot z budowy' — ale "source" to enum batch_source,
-- nie dowolny tekst, i taka wartość w nim nie istnieje (błąd bazy:
-- "invalid input value for enum batch_source"). Istniejące w kodzie
-- wartości to m.in. 'zamówienie' (receive_order) i 'korekta' (ręczna
-- korekta stanu, adjust_material_stock w 001_rpc_functions.sql) —
-- 'korekta' najlepiej oddaje sens "materiał wrócił, koryguje stan
-- magazynowy", więc tej używamy zamiast wymyślonej wartości.
-- Uruchom PO 028. Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

create or replace function unassign_material_from_build(p_build_id integer, p_material_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status build_status;
  v_assignment build_materials;
  v_lot record;
  v_restocked decimal := 0;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);

  select status into v_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można już zmieniać przypisań materiałów.';
  end if;

  select * into v_assignment from build_materials
    where "buildId" = p_build_id and "materialId" = p_material_id
    for update;
  if not found then
    raise exception 'Ten materiał nie jest przypisany do budowy #%.', p_build_id;
  end if;

  if not exists (
    select 1 from build_material_lots
      where "buildId" = p_build_id and "materialId" = p_material_id
  ) then
    raise exception 'Cały przydzielony materiał został już zużyty w raportach — nie ma nic do zwrócenia na magazyn.';
  end if;

  for v_lot in
    select * from build_material_lots
      where "buildId" = p_build_id and "materialId" = p_material_id
      for update
  loop
    if v_lot."sourceBatchId" is not null then
      update material_batches set quantity = quantity + v_lot.quantity where id = v_lot."sourceBatchId";
    else
      -- Oryginalna partia już nie istnieje (skasowana, bo przypisanie
      -- wyczerpało ją do zera) — zwrot trafia do nowej partii zamiast do
      -- nieistniejącego wiersza.
      insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source)
        values (p_material_id, v_lot.quantity, v_lot."unitPrice", current_date, 'korekta');
    end if;
    v_restocked := v_restocked + v_lot.quantity;
  end loop;

  perform fn_recalc_material(p_material_id);

  delete from build_material_lots where "buildId" = p_build_id and "materialId" = p_material_id;

  if v_assignment.used > 0.0001 then
    update build_materials
      set planned = greatest(planned - v_restocked, used),
          issued = greatest(issued - v_restocked, 0)
      where "buildId" = p_build_id and "materialId" = p_material_id;
  else
    delete from build_materials where "buildId" = p_build_id and "materialId" = p_material_id;
  end if;
end;
$$;

grant execute on function unassign_material_from_build(integer, integer) to authenticated;
