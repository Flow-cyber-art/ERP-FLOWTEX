-- ============================================================
-- Regresja: "invalid input value for enum batch_source: zwrot z budowy"
-- przy zamykaniu budowy — WRÓCIŁ błąd raz już naprawiony w
-- 077_napraw_enum_zwrotu_zamkniecie_budowy.sql.
--
-- Przyczyna: 080_blokada_zamkniecia_niezerowy_podmagazyn.sql redefiniuje
-- close_build() od zera (CREATE OR REPLACE) i przy kopiowaniu ciała
-- funkcji wkleił z powrotem STARĄ, sprzed-077 wersję insertu do
-- material_batches — z source = 'zwrot z budowy' zamiast poprawionego
-- 'zwrot' (jedyna pasująca wartość enuma batch_source, patrz
-- drizzle/schema.ts: 'stan początkowy' | 'zamówienie' | 'korekta' |
-- 'zwrot'). 080 jest nowszym plikiem niż 077, więc to ta wadliwa wersja
-- została ostatecznie zapisana w bazie.
--
-- Naprawa: identyczna funkcja jak w 080 (blokada niezerowego podmagazynu
-- zostaje), jedyna zmiana to 'zwrot z budowy' -> 'zwrot' w linii z
-- insertem do material_batches.
--
-- Uruchom po 080_blokada_zamkniecia_niezerowy_podmagazyn.sql. Bezpieczne
-- do wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

create or replace function close_build(p_build_id integer, p_returns jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_build builds;
  v_pending_count integer;
  v_total_hours decimal;
  v_labor_cost decimal;
  v_materials_cost decimal;
  v_total_extra_costs decimal;
  v_waste_cost decimal := 0;
  v_total_cost decimal;
  v_ret jsonb;
  v_material_id integer;
  v_batch_id integer;
  v_qty decimal;
  v_decision text;
  v_reason text;
  v_lot_price decimal;
  v_lot_id integer;
  v_unresolved_list text;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_build from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_build.status = 'zamknięta' then
    return;
  end if;

  select count(*) into v_pending_count from reports
    where "buildId" = p_build_id and status <> 'approved';
  if v_pending_count > 0 then
    raise exception 'Nie wszystkie raporty tej budowy są zatwierdzone — zatwierdź je przed zamknięciem.';
  end if;

  -- Pozostałość materiałowa: zwrot na magazyn albo do wyrzucenia.
  for v_ret in select * from jsonb_array_elements(p_returns)
  loop
    v_material_id := (v_ret->>'materialId')::integer;
    v_batch_id := nullif(v_ret->>'batchId', '')::integer;
    v_qty := (v_ret->>'quantity')::decimal;
    v_decision := v_ret->>'decision';
    v_reason := v_ret->>'reason';

    if v_qty is null or v_qty <= 0 then
      continue;
    end if;
    if v_decision not in ('zwrot', 'wyrzucenie') then
      raise exception 'Nieprawidłowa decyzja rozliczenia materiału #%: %', v_material_id, v_decision;
    end if;

    select id into v_lot_id
      from build_material_lots
      where "buildId" = p_build_id and "materialId" = v_material_id
        and "sourceBatchId" is not distinct from v_batch_id and quantity >= v_qty - 0.0001
      order by id asc
      limit 1
      for update;
    if v_lot_id is null then
      raise exception 'Ilość do rozliczenia (materiał #%, partia #%) przekracza pozostałość na budowie.',
        v_material_id, v_batch_id;
    end if;

    update build_material_lots set quantity = quantity - v_qty
      where id = v_lot_id
      returning "unitPrice" into v_lot_price;
    delete from build_material_lots where id = v_lot_id and quantity <= 0.0001;

    if v_decision = 'zwrot' then
      if v_batch_id is not null then
        update material_batches set quantity = quantity + v_qty where id = v_batch_id;
      else
        insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source)
          values (v_material_id, v_qty, v_lot_price, current_date, 'zwrot');
      end if;
      perform fn_recalc_material(v_material_id);
    else
      v_waste_cost := v_waste_cost + v_qty * v_lot_price;
    end if;

    insert into build_material_returns ("buildId", "materialId", "batchId", quantity, decision, reason, "unitPrice")
      values (p_build_id, v_material_id, v_batch_id, v_qty, v_decision::return_decision, v_reason, v_lot_price);
  end loop;

  -- N6: podmagazyn (Σ q_S(a) per materiał, dodatnie NIEROZLICZONE i
  -- ujemne NIEDOBORY razem) musi wynosić zero, inaczej blokada. Bez tego
  -- materiał/koszt mógł zniknąć z rozliczenia bez śladu i bez ostrzeżenia.
  select string_agg(
           coalesce(m.name, 'materiał #' || v_unresolved."materialId") || ': ' || round(v_unresolved.net, 3),
           ', '
         )
    into v_unresolved_list
    from (
      select "materialId", sum(quantity) as net
        from build_material_lots
        where "buildId" = p_build_id
        group by "materialId"
        having abs(sum(quantity)) > 0.0001
    ) v_unresolved
    left join materials m on m.id = v_unresolved."materialId";

  if v_unresolved_list is not null then
    raise exception 'Nie można zamknąć budowy — podmagazyn nie jest wyzerowany: %. Rozlicz zwrot/wyrzucenie (dodatnia pozostałość) albo uzupełnij przypisanie materiału (ujemny niedobór) przed zamknięciem.',
      v_unresolved_list;
  end if;

  select coalesce(sum(t.hours), 0),
         coalesce(sum(t.hours * coalesce(t."hourlyRate", e."hourlyRate", 0)), 0)
    into v_total_hours, v_labor_cost
    from time_entries t
    join employees e on e.id = t."employeeId"
    where t."buildId" = p_build_id;

  select coalesce(sum("actualCost"), 0) into v_materials_cost from build_materials
    where "buildId" = p_build_id;

  select coalesce(sum(rec.amount), 0) into v_total_extra_costs
    from report_extra_costs rec
    join reports r on r.id = rec."reportId"
    where r."buildId" = p_build_id;

  v_total_cost := v_materials_cost + v_labor_cost + v_total_extra_costs + v_waste_cost;

  insert into build_settlements (
    "buildId", "totalHours", "totalExtraCosts", "materialsCost", "laborCost", "wasteCost", "totalCost"
  ) values (
    p_build_id, v_total_hours, v_total_extra_costs, v_materials_cost, v_labor_cost, v_waste_cost, v_total_cost
  )
  on conflict ("buildId") do update set
    "closedAt" = now(),
    "totalHours" = excluded."totalHours",
    "totalExtraCosts" = excluded."totalExtraCosts",
    "materialsCost" = excluded."materialsCost",
    "laborCost" = excluded."laborCost",
    "wasteCost" = excluded."wasteCost",
    "totalCost" = excluded."totalCost";

  delete from build_settlement_materials where "buildId" = p_build_id;
  insert into build_settlement_materials ("buildId", "materialId", planned, used, "unitPrice", "actualCost")
    select "buildId", "materialId", planned, used, "unitPrice", "actualCost"
      from build_materials where "buildId" = p_build_id;

  update builds set status = 'zamknięta', "updatedAt" = now() where id = p_build_id;
end;
$$;

grant execute on function close_build(integer, jsonb) to authenticated;
