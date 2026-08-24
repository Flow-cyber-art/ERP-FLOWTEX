-- ============================================================
-- Fix: unassign_material_from_build (026/027) blokowała zwrot za KAŻDYM
-- razem, gdy "sourceBatchId" lota było null — a to był w praktyce
-- NAJCZĘSTSZY przypadek, nie rzadki wyjątek: assign_material_batches_to_build
-- (009/018/024) kasuje wiersz material_batches, gdy przypisywana ilość
-- wyczerpuje całą partię (co przy wyborze "dostępne X" z wyszukiwarki
-- zdarza się bardzo często) — a foreign key na material_batches ma
-- ON DELETE SET NULL, więc "sourceBatchId" lota zerował się od razu przy
-- samym przypisaniu, jeszcze zanim ktokolwiek próbował cokolwiek
-- "skonsumować gdzie indziej". Efekt: "Usuń" na materiale pomocniczym
-- niemal zawsze kończyło się błędem "partia źródłowa już nie istnieje".
--
-- Poprawka: gdy oryginalna partia już nie istnieje, zwrot tworzy NOWĄ
-- partię (tą samą ilość i cenę) zamiast doliczać do starej — materiał
-- i tak wraca na stan, tylko jako świeży wiersz w material_batches.
-- Uruchom PO 027. Bezpieczne do wielokrotnego wklejenia.
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
        values (p_material_id, v_lot.quantity, v_lot."unitPrice", current_date, 'zwrot z budowy');
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
