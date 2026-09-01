-- ============================================================
-- "Na magazynie (wolne): X — uwzględnić?" nie pokazywało się mimo
-- realnie wolnego materiału na magazynie głównym (np. 25 kg SL20, 50
-- mb/m2 Copperstripu) — po naprawie dopasowania po nazwie (086) wolna
-- ilość dalej wychodziła 0.
--
-- Przyczyna: wzór z 083/086 liczył wolny stan jako
--   materials.stock − SUMA(build_materials.planned ze WSZYSTKICH budów)
-- czyli od BIEŻĄCEGO stanu magazynu odejmował SKUMULOWANĄ HISTORYCZNIE
-- ilość zaplanowaną na każdej budowie w historii — łącznie z budowami
-- dawno zamkniętymi, gdzie materiał już dawno zszedł z magazynu i
-- fizycznie go tam nie ma. materials.stock JUŻ uwzględnia to wydanie
-- (odejmowane przy każdym receive_order/fn_recalc_material) — odjęcie
-- planned po raz drugi było podwójnym liczeniem tego samego zejścia ze
-- stanu, więc wynik wychodził ≤ 0 dla każdego materiału, który
-- kiedykolwiek trafił na jakąkolwiek budowę.
--
-- Decyzja (ustalona z Adminem): licz wolny stan WYŁĄCZNIE jako to, co
-- FIZYCZNIE leży teraz na magazynie głównym (materials.stock) — bez
-- odejmowania niczego. To tylko PODPOWIEDŹ do decyzji Admina (patrz
-- 083: nie pomniejsza automatycznie, nie przypisuje materiału do
-- budowy — Admin robi to ręcznie), więc nie trzeba zgadywać, czy stan
-- jest "mentalnie" zarezerwowany pod inną budowę — Admin to i tak widzi
-- i ocenia sam.
--
-- Uruchom po 086_wolny_magazyn_dopasowanie_po_nazwie.sql. Bezpieczne do
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

    -- Wolny magazyn = to, co FIZYCZNIE leży teraz na magazynie głównym
    -- (materials.stock), bez odejmowania historycznych rezerwacji innych
    -- budów (patrz nagłówek pliku — materials.stock już uwzględnia to,
    -- co zeszło na budowy). Materiał bez rozwiązanego id (nie istnieje
    -- jeszcze w magazynie, albo nazwa niejednoznaczna) nie może mieć
    -- wolnego zapasu.
    if v_resolved_material_id is null then
      v_free_qty := 0;
    else
      select coalesce(m.stock, 0) into v_free_qty
        from materials m
        where m.id = v_resolved_material_id;
      v_free_qty := coalesce(v_free_qty, 0);
    end if;

    -- Informacja do decyzji Admina — NIE pomniejsza automatycznie
    -- ordered_quantity i NIE przypisuje materiału do budowy (patrz
    -- nagłówek pliku). Admin widzi "na magazynie wolne: X" przy pozycji
    -- i sam decyduje, edytując ilość zamawianą (istniejący mechanizm,
    -- dopóki zamówienie jest 'robocze').
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
