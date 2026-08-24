-- ============================================================
-- Usuwanie przypisania materiału pomocniczego z budowy — odwrotność
-- assign_material_batches_to_build (009, potem 018, 024). Brygadzista
-- (i Admin) mogli dotąd tylko DODAWAĆ materiał pomocniczy z magazynu do
-- budowy w raporcie dziennym, bez możliwości cofnięcia pomyłki — jedyną
-- opcją było poprosić administratora o ręczną korektę w bazie.
--
-- Symetryczne do assign_material_batches_to_build: zwraca ilość do
-- partii źródłowej (material_batches), usuwa wiersze build_material_lots
-- i przypisanie z build_materials, odświeża materials.stock/unitPrice.
--
-- Zablokowane, gdy materiał został już częściowo zużyty w raporcie
-- (build_materials.used > 0) — to nie jest cofnięcie pomyłki przy
-- dodawaniu, tylko realne zużycie, które wymaga korekty raportu, nie
-- usunięcia przypisania. Zablokowane też, gdy którakolwiek partia
-- źródłowa już nie istnieje (sourceBatchId is null — skonsumowana gdzie
-- indziej w międzyczasie, ON DELETE SET NULL, patrz 013) — nie ma dokąd
-- zwrócić ilości.
-- Uruchom PO 024. Bezpieczne do wielokrotnego wklejenia.
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
  if v_assignment.used > 0.0001 then
    raise exception 'Materiał został już częściowo zużyty w raporcie — nie można usunąć przypisania, skoryguj ilość zużycia zamiast tego.';
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
  end loop;

  perform fn_recalc_material(p_material_id);

  delete from build_material_lots where "buildId" = p_build_id and "materialId" = p_material_id;
  delete from build_materials where "buildId" = p_build_id and "materialId" = p_material_id;
end;
$$;

grant execute on function unassign_material_from_build(integer, integer) to authenticated;
