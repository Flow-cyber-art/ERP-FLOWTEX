-- ============================================================
-- Zamykanie budowy z decyzją "zwrot" (materiał wraca na magazyn) dla
-- pozycji BEZ istniejącej już partii źródłowej (sourceBatchId = null —
-- dokładnie stan po 075/076: partia dostarczona z wizarda technologii
-- jest w 100% od razu "wydawana" na budowę i usuwana z material_batches)
-- wybuchało błędem:
--   invalid input value for enum batch_source: "zwrot z budowy"
--
-- Przyczyna: `close_build` wstawiał nową partię z source =
-- 'zwrot z budowy', ale enum `batch_source` ma tylko: 'stan początkowy',
-- 'zamówienie', 'korekta', 'zwrot' — 'zwrot z budowy' nigdy nie
-- istniało jako dopuszczalna wartość. Błąd był w kodzie od dawna, ale
-- uśpiony — dopóki sourceBatchId istniał (materiał "dodatkowy"
-- przypisywany ręcznie, partia źródłowa nigdy nie znika w 100%),
-- zwrot szedł inną gałęzią (UPDATE istniejącej partii), która w ogóle
-- nie dotyka tej kolumny. Naprawa 075/076 (materiał technologiczny w
-- 100% wychodzi z magazynu przy dostawie) sprawiła, że zwrot takiego
-- materiału zawsze trafia w tę drugą, wadliwą gałąź (INSERT).
--
-- Naprawa: 'zwrot z budowy' -> 'zwrot' (jedyna pasująca wartość enuma).
-- Reszta funkcji bez zmian.
--
-- Uruchom PO 076_zabezpieczenia_przyjecia_zamowienia_budowy.sql.
-- Bezpieczne do wielokrotnego wklejenia. Jak uruchomić: Supabase
-- Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

create or replace function close_build(
  p_build_id integer,
  p_returns jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
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

  -- Robocizna: stawka zamrożona na TYM konkretnym wpisie godzin
  -- (time_entries."hourlyRate") — nie aktualna stawka pracownika. Fallback
  -- na employees."hourlyRate" tylko dla wierszy bez zamrożonej wartości
  -- (nie powinno się zdarzać po backfillu w 055, ale bez tego stare/
  -- pominięte wiersze liczyłyby się jako 0 zamiast najlepszego przybliżenia).
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
$function$;
