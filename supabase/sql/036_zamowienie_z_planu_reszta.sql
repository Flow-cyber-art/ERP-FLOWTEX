-- ============================================================
-- Ryzyko 5 / Wariant 3 (docs/PROCES_CYKL_ZYCIA_BUDOWY.md, §3): "+ Z planu"
-- generowało za każdym razem NOWE zamówienie na PEŁNĄ planowaną ilość
-- każdego materiału (sum(planned_quantity) z build_material_plan, od
-- zera), niezależnie od tego, ile już zamówiono/przyjęto wcześniej.
-- Dwukrotne kliknięcie (pomyłka albo świadoma decyzja, bo pierwsze
-- zamówienie "wisiało") realnie podwajało zamówienie.
--
-- Poprawka: `generate_order_from_plan` liczy teraz per materiał
-- "ile jeszcze trzeba zamówić" = planned_quantity (z planu) minus suma
-- ordered_quantity ze WSZYSTKICH nie-anulowanych zamówień tej budowy dla
-- tego materiału — i wstawia do nowego zamówienia tylko tę różnicę.
-- Efekt: przypadkowe drugie kliknięcie od razu pokazuje "nic więcej do
-- zamówienia" (twardy błąd zamiast pustego/duplikującego zamówienia), a
-- legalna dosyłka (dostawca przywiózł za mało) poprawnie liczy tylko
-- brakującą resztę — bez pytania Admina o nic.
--
-- Uruchom PO 035. Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

-- Pomocnicza funkcja tabelaryczna — używana i do sprawdzenia "czy jest
-- cokolwiek do zamówienia", i do samego wstawienia pozycji, żeby nie
-- powielać tej samej logiki liczenia w dwóch miejscach.
create or replace function fn_build_plan_remaining(p_build_id integer)
returns table (
  material_name text,
  linked_material_id integer,
  unit text,
  remaining decimal
)
language sql
stable
as $$
  select p.material_name, p.linked_material_id, p.unit,
         p.total_planned - coalesce(a.total_ordered, 0) as remaining
    from (
      select material_name, linked_material_id, unit, sum(planned_quantity) as total_planned
        from build_material_plan
        where build_id = p_build_id
        group by material_name, linked_material_id, unit
    ) p
    left join (
      select oi.material_name, oi.linked_material_id, oi.unit, sum(oi.ordered_quantity) as total_ordered
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.build_id = p_build_id and o.status <> 'anulowane'
        group by oi.material_name, oi.linked_material_id, oi.unit
    ) a
      on a.material_name = p.material_name
      and a.linked_material_id is not distinct from p.linked_material_id
      and a.unit = p.unit
    where p.total_planned - coalesce(a.total_ordered, 0) > 0.0001;
$$;

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
    insert into order_items (order_id, material_name, linked_material_id, planned_quantity, ordered_quantity, unit)
      values (v_order_id, v_item.material_name, v_item.linked_material_id, v_item.remaining, v_item.remaining, v_item.unit);
  end loop;

  return v_order_id;
end;
$$;

grant execute on function generate_order_from_plan(integer) to authenticated;
