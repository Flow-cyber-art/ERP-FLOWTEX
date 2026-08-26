-- ------------------------------------------------------------
-- Poprawka: archiwizować można tylko materiał ze stanem magazynowym
-- równym zero — inaczej dałoby się ukryć z widoku Magazynu materiał,
-- który wciąż fizycznie leży na stanie (i dalej można by nim ruszać przez
-- przypisania/zamówienia, tylko nikt by go nie widział na liście).
--
-- Dotychczasowy zapis szedł wprost z klienta (`materials.update({active})`,
-- RLS "materials_write_admin") — bez miejsca na taką walidację. Zamiast
-- tego RPC `set_material_active`, ten sam wzorzec co
-- `adjust_material_stock`/`create_material` w 001_rpc_functions.sql.
-- Przywracanie (active=true) bez ograniczeń — materiał ze stanem zero,
-- który wraca do użycia, i tak sam odarchiwizuje się przy przyjęciu
-- kolejnej dostawy (038_archiwizacja_materialow.sql).
-- ------------------------------------------------------------

create or replace function set_material_active(p_material_id integer, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select stock into v_stock from materials where id = p_material_id;
  if not found then
    raise exception 'Nie znaleziono materiału #%.', p_material_id;
  end if;

  if p_active = false and coalesce(v_stock, 0) <> 0 then
    raise exception 'Nie można zarchiwizować materiału ze stanem magazynowym różnym od zera (aktualnie: %).', v_stock;
  end if;

  update materials set active = p_active, "updatedAt" = now() where id = p_material_id;
end;
$$;

grant execute on function set_material_active(integer, boolean) to authenticated;
