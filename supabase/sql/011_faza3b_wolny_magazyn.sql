-- ============================================================
-- Faza 3b modułu Technologia — podpowiedź "wolny magazyn" przy
-- generowaniu zamówienia z planu.
--
-- Uruchom PO 007_faza3_zamowienia.sql (rozszerza tabelę i funkcję
-- z tego pliku). Bezpieczne do wielokrotnego wklejenia.
--
-- Problem: `generate_order_from_plan` (007) ustawiało ordered_quantity
-- zawsze równe planned_quantity, nawet jeśli część (albo cały) tego
-- materiału leży już na magazynie, ale nie jest przypisana (zarezer-
-- wowana) do żadnej budowy — więc admin zamawiał materiał, który
-- faktycznie już ma.
--
-- Rozwiązanie: przy generowaniu zamówienia liczymy per materiał
-- "wolny magazyn" = materials.stock - suma(build_materials.planned)
-- ze WSZYSTKICH budów (to samo wyrażenie co `shortages` liczy dziś
-- po stronie klienta w contexts/app-data.tsx, tylko odwrotnie: tam
-- brakujące, tu nadwyżka). Ta wolna ilość pomniejsza domyślne
-- ordered_quantity, a ile dokładnie pomniejszyła zapisujemy w nowej
-- kolumnie `available_free_quantity`, żeby dało się to pokazać w UI
-- i cofnąć ręcznie (ordered_quantity zostaje edytowalne jak dotychczas,
-- dopóki zamówienie jest w statusie 'robocze').
-- ============================================================

alter table order_items
  add column if not exists available_free_quantity decimal(12, 3) not null default 0;

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
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_build from builds where id = p_build_id;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;

  if not exists (select 1 from build_material_plan where build_id = p_build_id) then
    raise exception 'Budowa nie ma jeszcze planu materiałowego (przypisz technologię).';
  end if;

  select count(*) + 1 into v_seq from orders where build_id = p_build_id;
  v_order_number := 'ZAM/' || v_build.number || '/' || v_seq;

  insert into orders (build_id, order_number, status, "createdBy")
    values (p_build_id, v_order_number, 'robocze', auth.uid())
    returning id into v_order_id;

  with plan_agg as (
    -- Plan zagregowany per materiał (jak dotychczas w 007).
    select
      material_name,
      linked_material_id,
      unit,
      sum(planned_quantity) as plan_qty
    from build_material_plan
    where build_id = p_build_id
    group by material_name, linked_material_id, unit
  ),
  reserved as (
    -- Ile z magazynu jest już zaplanowane/zarezerwowane przez
    -- WSZYSTKIE budowy (włącznie z tą) — `build_materials.planned`,
    -- czyli te same "assignments", które `shortages` sumuje po
    -- stronie klienta.
    select "materialId" as material_id, sum(planned) as reserved_qty
    from build_materials
    group by "materialId"
  ),
  free_stock as (
    select
      pa.material_name,
      pa.linked_material_id,
      pa.unit,
      pa.plan_qty,
      -- Materiał bez linked_material_id (jeszcze nie istnieje w
      -- magazynie) nie może mieć wolnego zapasu.
      case
        when pa.linked_material_id is null then 0
        else greatest(0, coalesce(m.stock, 0) - coalesce(r.reserved_qty, 0))
      end as free_qty
    from plan_agg pa
    left join materials m on m.id = pa.linked_material_id
    left join reserved r on r.material_id = pa.linked_material_id
  )
  insert into order_items (
    order_id, material_name, linked_material_id,
    planned_quantity, ordered_quantity, unit, available_free_quantity
  )
  select
    v_order_id,
    material_name,
    linked_material_id,
    plan_qty,
    -- Zamawiamy tylko brakującą część ponad to, co już wolne na
    -- magazynie. Admin może to potem ręcznie nadpisać (np. jeśli
    -- świadomie chce zbudować bufor zamiast zabierać wolny materiał).
    greatest(0, plan_qty - least(free_qty, plan_qty)),
    unit,
    least(free_qty, plan_qty)
  from free_stock;

  return v_order_id;
end;
$$;

grant execute on function generate_order_from_plan(integer) to authenticated;
