-- ============================================================
-- Fix: close_build mógł podwójnie odjąć tę samą pulę materiału budowy
-- (docs/AUDYT_BEZPIECZENSTWO_WYDAJNOSC_ERP.md, punkt C3).
--
-- `update build_material_lots set quantity = quantity - v_qty where
-- "buildId" = ... and "materialId" = ... and "sourceBatchId" is not
-- distinct from ...` (033_straty_materialowe.sql) nie ograniczał się do
-- JEDNEGO wiersza. Jeśli materiał z tej samej partii źródłowej trafił na
-- budowę dwoma osobnymi przypisaniami (normalne przy budowie trwającej
-- kilka dni — `assign_material_batches_to_build` wywołane więcej niż raz
-- dla tej samej partii), w `build_material_lots` powstają dwa wiersze o
-- identycznym `("buildId", "materialId", "sourceBatchId")`. UPDATE bez
-- dopasowania po `id` modyfikował OBA wiersze naraz, jeśli oba spełniały
-- `quantity >= v_qty` — materiał znikał z ewidencji budowy podwójnie, bez
-- odpowiadającego zwrotu/kosztu straty (drugie odjęcie nie ma pokrycia w
-- `build_material_returns`, który wstawia tylko jeden wiersz na tę
-- operację). Dodatkowo `RETURNING "unitPrice" INTO v_lot_price` przy
-- wielu dopasowanych wierszach po cichu bierze tylko PIERWSZY z nich
-- (PL/pgSQL bez STRICT nie zgłasza błędu) — więc nawet cena straty mogła
-- nie odpowiadać rzeczywiście zdjętemu wierszowi.
--
-- Naprawa: UPDATE dopasowuje teraz dokładnie jeden wiersz przez
-- podzapytanie `id = (select id from ... order by id limit 1)` — ten sam
-- wzorzec deterministycznego wyboru "jednego konkretnego wiersza" co
-- LIFO/FIFO gdzie indziej w tym module. Reszta funkcji identyczna jak w
-- 033_straty_materialowe.sql.
--
-- Uruchom PO 033_straty_materialowe.sql. Bezpieczne do wielokrotnego
-- wklejenia. Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej
-- całość -> Run.
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
    -- Partia źródłowa mogła w międzyczasie zniknąć (material_batches ON
    -- DELETE SET NULL, gdy zejdzie do zera gdzie indziej) — wtedy
    -- "sourceBatchId" tego lota jest już null. Nie ma dokąd zwrócić —
    -- twardy błąd zamiast cichego pominięcia (Admin musi wybrać
    -- "Do wyrzucenia" dla tej pozycji).
    if v_decision = 'zwrot' and v_batch_id is null then
      raise exception 'Nie można zwrócić materiału #% na magazyn — partia źródłowa już nie istnieje (skonsumowana gdzie indziej). Wybierz "Do wyrzucenia".',
        v_material_id;
    end if;

    -- Dopasowanie dokładnie JEDNEGO wiersza (patrz komentarz na górze
    -- pliku) — gdy do tej samej budowy/materiału/partii źródłowej istnieje
    -- więcej niż jeden lot (np. dwa osobne przypisania tej samej partii),
    -- bierzemy zawsze ten sam, deterministyczny wiersz zamiast modyfikować
    -- wszystkie pasujące naraz. `is not distinct from` zamiast `=`, żeby
    -- dopasowanie działało też dla lotów z już wyzerowanym "sourceBatchId".
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

    -- RETURNING "unitPrice" — realna cena TEJ partii, do rozliczenia
    -- straty materiałowej niżej (bez uśredniania, ta sama zasada co
    -- przy korekcie raportu, patrz 035_dokladny_zwrot_partii.sql).
    update build_material_lots set quantity = quantity - v_qty
      where id = v_lot_id
      returning "unitPrice" into v_lot_price;
    delete from build_material_lots where id = v_lot_id and quantity <= 0.0001;

    if v_decision = 'zwrot' then
      update material_batches set quantity = quantity + v_qty where id = v_batch_id;
      -- Jak w każdym innym miejscu, które rusza material_batches (008, 009)
      -- — odświeża zdenormalizowane materials.stock/unitPrice.
      perform fn_recalc_material(v_material_id);
    else
      -- Do wyrzucenia: materiał, który firma faktycznie straciła (np.
      -- przeterminowany) — dolicza się jako koszt budowy, osobną pozycją
      -- "Straty materiałowe" (nie miesza się ze zwykłym kosztem zużycia).
      v_waste_cost := v_waste_cost + v_qty * v_lot_price;
    end if;

    insert into build_material_returns ("buildId", "materialId", "batchId", quantity, decision, reason, "unitPrice")
      values (p_build_id, v_material_id, v_batch_id, v_qty, v_decision::return_decision, v_reason, v_lot_price);
  end loop;

  select coalesce(sum(t.hours), 0), coalesce(sum(t.hours * e."hourlyRate"), 0)
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
