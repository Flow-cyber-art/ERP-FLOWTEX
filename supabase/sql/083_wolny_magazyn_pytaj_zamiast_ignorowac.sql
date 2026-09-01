-- ============================================================
-- Budowa = podmagazyn (D6.1): jeśli materiał z technologii już leży
-- wolny (nieprzypisany do żadnej budowy) na magazynie głównym, admin
-- powinien o tym wiedzieć PRZED wysłaniem zamówienia do dostawcy — po
-- co zamawiać to, co już mamy.
--
-- Stan sprzed tej migracji: `generate_order_from_plan` (036_zamowienie_
-- z_planu_reszta.sql, ostatnia redefinicja) w ogóle nie patrzył na stan
-- magazynu głównego — liczył tylko "ile jeszcze nie zamówiono dla TEJ
-- budowy" (żeby nie duplikować zamówień). Kolumna order_items.
-- available_free_quantity (011_faza3b_wolny_magazyn.sql) istniała w
-- bazie i UI ("Na magazynie (wolne): X") już ją wyświetlał, ale nic jej
-- nie wypełniało od 036 — martwa etykieta.
--
-- 011 rozwiązywało to auto-odejmowaniem (ordered_quantity od razu
-- pomniejszone o wolny magazyn). Świadoma decyzja: NIE wracamy do tego
-- — auto-odjęcie zakłada, że wolny materiał na pewno powinien trafić na
-- TĘ budowę, a nie zawsze tak jest (może być pod inną, jeszcze
-- nieprzypisaną budowę). Zamiast tego: pokazujemy wolny stan i ZAWSZE
-- PYTAMY (Admin decyduje jednym kliknięciem w UI, patrz
-- orders-screen.tsx) — ordered_quantity domyślnie zostaje pełną
-- brakującą ilością, available_free_quantity to czysta informacja do
-- decyzji, nie automat.
--
-- Uruchom po 082_korekta_dopisuje_nie_kasuje.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

create or replace function generate_order_from_plan(p_build_id integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_build builds;
  v_order_id integer;
  v_seq integer;
  v_order_number text;
  v_item record;
  v_free_qty decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_build from builds where id = p_build_id;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;

  if not exists (select 1 from build_material_plan where build_id = p_build_id) then
    raise exception 'Budowa nie ma jeszcze planu materiałowego (przypisz technologię).';
  end if;

  if not exists (select 1 from fn_build_plan_remaining(p_build_id)) then
    raise exception 'Cały plan materiałowy tej budowy jest już zamówiony (uwzględniając wcześniejsze, nieanulowane zamówienia) — nie ma nic więcej do zamówienia.';
  end if;

  select count(*) + 1 into v_seq from orders where build_id = p_build_id;
  v_order_number := 'ZAM/' || v_build.number || '/' || v_seq;

  insert into orders (build_id, order_number, status, "createdBy")
    values (p_build_id, v_order_number, 'robocze', auth.uid())
    returning id into v_order_id;

  for v_item in select * from fn_build_plan_remaining(p_build_id)
  loop
    -- Wolny magazyn = to, co leży na materials.stock ponad to, co już
    -- zaplanowane/zarezerwowane przez WSZYSTKIE budowy (build_materials.
    -- planned, ten sam wyraz co "shortages" po stronie klienta, tylko
    -- odwrotnie). Materiał bez linked_material_id (jeszcze nie istnieje
    -- w magazynie) nie może mieć wolnego zapasu.
    if v_item.linked_material_id is null then
      v_free_qty := 0;
    else
      select greatest(0, coalesce(m.stock, 0) - coalesce(
        (select sum(planned) from build_materials where "materialId" = v_item.linked_material_id), 0
      ))
        into v_free_qty
        from materials m
        where m.id = v_item.linked_material_id;
      v_free_qty := coalesce(v_free_qty, 0);
    end if;

    -- Informacja do decyzji Admina — NIE pomniejsza automatycznie
    -- ordered_quantity (patrz nagłówek pliku). Admin widzi "na magazynie
    -- wolne: X" przy pozycji i sam decyduje, edytując ilość zamawianą
    -- (istniejący mechanizm, dopóki zamówienie jest 'robocze').
    insert into order_items (
      order_id, material_name, linked_material_id,
      planned_quantity, ordered_quantity, unit, available_free_quantity
    )
      values (
        v_order_id, v_item.material_name, v_item.linked_material_id,
        v_item.remaining, v_item.remaining, v_item.unit,
        least(v_free_qty, v_item.remaining)
      );
  end loop;

  return v_order_id;
end;
$$;

grant execute on function generate_order_from_plan(integer) to authenticated;
