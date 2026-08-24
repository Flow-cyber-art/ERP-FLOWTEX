-- ============================================================
-- Usuwanie zamówień materiałowych (material_orders) w statusie
-- "do realizacji" — np. przez pomyłkę utworzone drugi raz dla tego
-- samego materiału (parę partii o różnych cenach wystarczy pokryć
-- jednym zamówieniem, więc duplikat trzeba dać się skasować zamiast
-- zaśmiecać listę na stałe).
--
-- Tak jak delete_build_order (015) — RPC zamiast gołego DELETE, żeby
-- wymusić regułę biznesową: da się skasować WYŁĄCZNIE zamówienie
-- jeszcze nie złożone u dostawcy (status "do realizacji"). Zamówienie
-- już "zamówione"/"dostarczone" trzeba doprowadzić do końca (przyjąć
-- albo poprawić ręcznie), nie skasować bez śladu.
-- Uruchom w dowolnym momencie. Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

create or replace function delete_material_order(p_order_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform assert_role(array['Admin']::app_role[]);

  select status::text into v_status from material_orders where id = p_order_id for update;
  if not found then
    return;
  end if;
  if v_status <> 'do realizacji' then
    raise exception 'Można skasować tylko zamówienie jeszcze niezłożone u dostawcy (status "do realizacji").';
  end if;

  delete from material_orders where id = p_order_id;
end;
$$;

grant execute on function delete_material_order(integer) to authenticated;
