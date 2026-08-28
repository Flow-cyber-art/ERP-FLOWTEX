-- ============================================================
-- Naprawa buga z 035_dokladny_zwrot_partii.sql: `fn_consume_build_lot_fifo`
-- najpierw KASOWAŁO w pełni zużyty wiersz `build_material_lots` (gdy
-- v_left <= 0, czyli partia schodzi do zera), a DOPIERO POTEM wstawiało
-- do `report_material_lots` wiersz z "lotId" wskazującym na ten sam,
-- właśnie skasowany id. FK `report_material_lots_lotId_fkey` sprawdzany
-- jest natychmiast (nie deferred), więc insert wybuchał:
--   insert or update on table "report_material_lots" violates foreign
--   key constraint "report_material_lots_lotId_fkey"
--
-- Odtwarzalne za drugim razem, gdy: pierwszy raport zejdzie z partii
-- częściowo (v_left > 0, insert OK — lot jeszcze istnieje), a drugi
-- raport (na tej samej budowie, tego samego materiału) zejdzie z
-- reszty co do joty (v_left <= 0.0001 → delete, potem insert do
-- report_material_lots z lotId martwego wiersza → błąd FK). Pierwszy
-- raport przechodził, drugi nie — dokładnie to zgłoszono.
--
-- Naprawa: wstaw rozkład do `report_material_lots` PRZED
-- update/delete `build_material_lots`, więc insert zawsze widzi jeszcze
-- żywy wiersz. Reszta funkcji bez zmian.
--
-- Uruchom po 045. Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

drop function if exists fn_consume_build_lot_fifo(integer, integer, decimal, integer);

create or replace function fn_consume_build_lot_fifo(
  p_build_id integer,
  p_material_id integer,
  p_amount decimal,
  p_report_id integer default null
)
returns decimal
language plpgsql
as $$
declare
  v_remaining decimal := p_amount;
  v_cost decimal := 0;
  v_row record;
  v_take decimal;
  v_left decimal;
begin
  if p_amount <= 0 then
    return 0;
  end if;

  for v_row in
    select id, quantity, "unitPrice", "sourceBatchId"
      from build_material_lots
      where "buildId" = p_build_id and "materialId" = p_material_id
      order by "issuedAt" asc, id asc
      for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_row.quantity, v_remaining);
    v_cost := v_cost + v_take * v_row."unitPrice";
    v_remaining := v_remaining - v_take;
    v_left := v_row.quantity - v_take;

    -- Wstaw rozkład PRZED ewentualnym skasowaniem lota niżej — inaczej
    -- FK "report_material_lots_lotId_fkey" wybucha, gdy ta partia właśnie
    -- schodzi do zera (v_left <= 0.0001, patrz delete poniżej).
    if p_report_id is not null then
      insert into report_material_lots
        ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice")
        values (p_report_id, p_material_id, v_row.id, v_row."sourceBatchId", v_take, v_row."unitPrice");
    end if;

    if v_left > 0.0001 then
      update build_material_lots set quantity = v_left where id = v_row.id;
    else
      delete from build_material_lots where id = v_row.id;
    end if;
  end loop;

  if v_remaining > 0.0001 then
    raise exception 'Za mało materiału #% przypisanego do budowy #%: brakuje %', p_material_id, p_build_id, round(v_remaining, 3);
  end if;

  return v_cost;
end;
$$;
