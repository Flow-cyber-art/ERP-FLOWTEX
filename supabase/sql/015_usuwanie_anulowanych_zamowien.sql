-- ============================================================
-- Usuwanie anulowanych zamówień (orders/order_items, Faza 3).
--
-- Do tej pory `orders`/`order_items` miały tylko `select, update` dla
-- authenticated (007_faza3_zamowienia.sql) — nie dało się ich w ogóle
-- skasować, więc anulowane zamówienia zaśmiecały listę na stałe.
-- RPC zamiast gołego DELETE, żeby wymusić regułę biznesową: da się
-- skasować WYŁĄCZNIE zamówienie już oznaczone jako "anulowane" (nie da
-- się np. przez wyścig skasować czegoś w trakcie realizacji) —
-- `order_items` znika automatycznie (ON DELETE CASCADE, patrz 007).
-- Uruchom raz, bezpieczne do wielokrotnego wklejenia.
-- ============================================================

create or replace function delete_build_order(p_order_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status order_header_status;
begin
  perform assert_role(array['Admin']::app_role[]);

  select status into v_status from orders where id = p_order_id for update;
  if not found then
    return;
  end if;
  if v_status <> 'anulowane' then
    raise exception 'Można skasować tylko anulowane zamówienie.';
  end if;

  delete from orders where id = p_order_id;
end;
$$;

grant execute on function delete_build_order(integer) to authenticated;
