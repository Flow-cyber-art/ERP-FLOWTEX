-- ============================================================
-- "Na magazynie (wolne): X — uwzględnić?" (083_wolny_magazyn_pytaj_
-- zamiast_ignorowac.sql) nigdy się nie pokazywało dla materiału
-- technologicznego w normalnym flow, mimo że materiał fizycznie leżał
-- na magazynie głównym (wolny, nieprzypisany do żadnej budowy).
--
-- Przyczyna: generate_order_from_plan liczyło wolną ilość WYŁĄCZNIE po
-- build_material_plan.linked_material_id — a to pole prawie zawsze jest
-- NULL (technologia jest definiowana zanim materiał fizycznie istnieje
-- w magazynie; dopasowanie do realnej pozycji magazynowej odbywa się po
-- nazwie, ten sam wzorzec co resolveMaterialIdForPlanRow w
-- settlement-screen.tsx, receive_order() i naprawiony w app-data.tsx
-- dla listy "Braki"). Bez tego dopasowania cała ścieżka "wolny magazyn
-- -> podpowiedź w zamówieniu" była martwa dla świeżo przypisanej
-- technologii.
--
-- Naprawa: gdy linked_material_id jest puste, dopasuj materiał po
-- znormalizowanej nazwie (normalize_material_name, 045/060) — ale TYLKO
-- gdy dopasowanie jest jednoznaczne (dokładnie jeden materiał o tej
-- nazwie), tak jak w receive_order(). Przy niejednoznaczności (materiał
-- występuje w magazynie więcej niż raz) zostajemy przy poprzednim,
-- bezpiecznym zachowaniu — wolna ilość = 0, żadnej podpowiedzi — zamiast
-- zgadywać, którą pozycję magazynową mieć na myśli.
--
-- Ten sam rozwiązany materiał trafia też do order_items.linked_material_id
-- przy wstawianiu pozycji zamówienia — dokładnie ta sama wartość, którą i
-- tak ustawiłby receive_order() przy przyjęciu dostawy (037/045/075/076/
-- 079/084), więc to tylko wcześniejsze wypełnienie tego samego pola, bez
-- zmiany zachowania przy odbiorze.
--
-- Uruchom po 085_napraw_regresje_enum_zwrotu.sql. Bezpieczne do
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
  v_resolved_material_id integer;
  v_match_count integer;
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
    v_resolved_material_id := v_item.linked_material_id;
    if v_resolved_material_id is null then
      select count(*) into v_match_count from materials
        where normalize_material_name(name) = normalize_material_name(v_item.material_name);
      if v_match_count = 1 then
        select id into v_resolved_material_id from materials
          where normalize_material_name(name) = normalize_material_name(v_item.material_name);
      end if;
    end if;

    -- Wolny magazyn = to, co leży na materials.stock ponad to, co już
    -- zaplanowane/zarezerwowane przez WSZYSTKIE budowy (build_materials.
    -- planned, ten sam wyraz co "shortages" po stronie klienta, tylko
    -- odwrotnie). Materiał bez rozwiązanego id (nie istnieje jeszcze w
    -- magazynie, albo nazwa niejednoznaczna) nie może mieć wolnego zapasu.
    if v_resolved_material_id is null then
      v_free_qty := 0;
    else
      select greatest(0, coalesce(m.stock, 0) - coalesce(
        (select sum(planned) from build_materials where "materialId" = v_resolved_material_id), 0
      ))
        into v_free_qty
        from materials m
        where m.id = v_resolved_material_id;
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
        v_order_id, v_item.material_name, v_resolved_material_id,
        v_item.remaining, v_item.remaining, v_item.unit,
        least(v_free_qty, v_item.remaining)
      );
  end loop;

  return v_order_id;
end;
$$;

grant execute on function generate_order_from_plan(integer) to authenticated;
