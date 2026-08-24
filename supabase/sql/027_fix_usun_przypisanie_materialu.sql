-- ============================================================
-- Fix: unassign_material_from_build (026) blokowała usunięcie CAŁEGO
-- przypisania, gdy build_materials.used > 0 — ale "used" jest wartością
-- SKUMULOWANĄ dla całej budowy (submit_daily_report ustawia ją na
-- bieżącą wartość z raportu, nie zeruje między raportami), więc
-- materiał zużyty choć trochę w KTÓRYMKOLWIEK wcześniejszym raporcie
-- blokował usunięcie na zawsze — nawet gdy w bieżącym, nowym raporcie
-- pole pokazywało "0" (bo to tylko pusty draft tego raportu, nie stan z
-- bazy).
--
-- Poprawka: build_material_lots trzyma DOKŁADNIE tę część przydziału,
-- która jeszcze nie została zużyta (fn_consume_build_lot_fifo zmniejsza/
-- usuwa loty w miarę zużycia w raportach) — więc zwrot na magazyn i tak
-- zawsze dotyczył tylko nieużytej reszty, blokada była zbyt szeroka.
-- Teraz: zwracamy nieużytą resztę (loty), a jeśli materiał ma już jakąś
-- historię zużycia (used > 0), NIE kasujemy wiersza build_materials —
-- tylko zmniejszamy planned/issued o zwróconą ilość, żeby zachować
-- rozliczenie kosztów. Pełne odpięcie (usunięcie wiersza) następuje
-- tylko, gdy used = 0. Blokujemy wyłącznie przypadek, gdy nie ma już
-- żadnych lotów do zwrócenia (cały przydział został zużyty).
-- Uruchom PO 026. Bezpieczne do wielokrotnego wklejenia.
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
    if v_lot."sourceBatchId" is null then
      raise exception 'Partia źródłowa tego materiału już nie istnieje (skonsumowana gdzie indziej) — nie można automatycznie cofnąć przypisania. Skontaktuj się z administratorem.';
    end if;
    update material_batches set quantity = quantity + v_lot.quantity where id = v_lot."sourceBatchId";
    v_restocked := v_restocked + v_lot.quantity;
  end loop;

  perform fn_recalc_material(p_material_id);

  delete from build_material_lots where "buildId" = p_build_id and "materialId" = p_material_id;

  if v_assignment.used > 0.0001 then
    -- Historia zużycia zostaje (potrzebna do rozliczenia budowy) —
    -- zmniejszamy tylko "ile było zarezerwowane ponad to, co realnie
    -- zużyto".
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
