-- ============================================================
-- Komunikat "Za mało materiału #4 przypisanego do budowy #1: brakuje 34"
-- (fn_consume_build_lot_fifo, 046_fix_report_material_lots_fk.sql) trafiał
-- prosto do Brygadzisty przy nieudanej wysyłce raportu (patrz
-- contexts/app-data.tsx: "Raport zapisany lokalnie, ale serwer go
-- odrzucił: ${errorMessage}") — nic mu nie mówiące numery ID zamiast
-- nazwy materiału, i zbędny numer budowy (brygadzista raportuje na
-- JEDNEJ, aktualnie wybranej budowie, więc "#1" nie wnosi nic).
--
-- Naprawa: dociągnij nazwę materiału (materials.name) i pokaż
-- "Za mało materiału „X” przypisanego do budowy: brakuje Y" — bez
-- numerów ID w ogóle.
--
-- Uruchom po 071_zakonczenie_etapu_checkbox.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
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
  v_material_name text;
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
    select name into v_material_name from materials where id = p_material_id;
    raise exception 'Za mało materiału "%" przypisanego do budowy: brakuje %',
      coalesce(v_material_name, 'materiału #' || p_material_id), round(v_remaining, 3);
  end if;

  return v_cost;
end;
$$;
