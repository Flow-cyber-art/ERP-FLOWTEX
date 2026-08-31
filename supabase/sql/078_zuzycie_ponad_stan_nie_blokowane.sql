-- ============================================================
-- Rejestr decyzji projektowych — Magazyn/Materiały:
-- D7.5 "Zużycie > stan NIE JEST BLOKOWANE" (raport ma zostać
-- zapisany zawsze, bo blokada zatrzymałaby raportowanie w ogóle),
-- D7.6 "Stany są ORIENTACYJNE",
-- D8.3 "Stany ujemne naprawia ADMIN SAM — brygadzista nic nie wskazuje",
-- D8.4 "Jeśli zużyto więcej niż przypisano → materiał musiał
--       pochodzić z innej budowy → transfer wykonuje admin".
--
-- fn_consume_build_lot_fifo (072_czytelny_komunikat_braku_materialu.sql)
-- do tej pory rzucał wyjątek i CAŁY raport brygadzisty się nie
-- zapisywał, gdy zużycie przekraczało to, co widniało jako
-- przypisane do budowy. Zgodnie z D7.5 to nie ma blokować.
--
-- Naprawa: brakująca ilość jest nadal wyceniana (po cenie ostatnio
-- zużytej partii z tej budowy, a jeśli budowa nie miała żadnej
-- partii tego materiału — po cenie z ostatniej przyjętej partii
-- magazynowej, a w ostateczności po bieżącej cenie materiału) i
-- wchodzi w koszt budowy jak dotychczas. Brakująca ilość jest
-- zapisywana jako partia o UJEMNEJ ilości w build_material_lots —
-- to jest ten "stan ujemny", który zgodnie z D8.3/D8.4 widzi i
-- naprawia admin (korektą stanu lub transferem z innej budowy), a
-- nie brygadzista.
--
-- Uruchom po 077_napraw_enum_zwrotu_zamkniecie_budowy.sql. Bezpieczne
-- do wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard ->
-- SQL Editor -> wklej całość -> Run.
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
  v_last_price decimal;
  v_deficit_lot_id integer;
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
    v_last_price := v_row."unitPrice";
    v_remaining := v_remaining - v_take;
    v_left := v_row.quantity - v_take;

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

  -- D7.5: zużycie ponad przypisany stan nie blokuje raportu. Brakującą
  -- ilość wyceniamy i zostawiamy jako widoczny dla admina stan ujemny.
  if v_remaining > 0.0001 then
    if v_last_price is null then
      select "unitPrice" into v_last_price
        from material_batches
        where "materialId" = p_material_id
        order by "receivedAt" desc, id desc
        limit 1;
    end if;
    if v_last_price is null then
      select "unitPrice" into v_last_price from materials where id = p_material_id;
    end if;
    v_last_price := coalesce(v_last_price, 0);

    v_cost := v_cost + v_remaining * v_last_price;

    insert into build_material_lots
      ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice")
      values (p_build_id, p_material_id, null, -v_remaining, v_last_price)
      returning id into v_deficit_lot_id;

    if p_report_id is not null then
      insert into report_material_lots
        ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice")
        values (p_report_id, p_material_id, v_deficit_lot_id, null, v_remaining, v_last_price);
    end if;
  end if;

  return v_cost;
end;
$$;
