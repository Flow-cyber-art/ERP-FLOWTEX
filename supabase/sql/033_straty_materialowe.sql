-- ============================================================
-- Decyzja C (docs/PROCES_RAPORTOWANIE_BRYGADZISTA.md, §6): materiał
-- pozostały po budowie, który Admin przy zamknięciu oznaczy jako
-- "Do wyrzucenia" (zamiast zwrotu na magazyn), ma DOLICZYĆ SIĘ do kosztu
-- budowy jako osobna pozycja "Straty materiałowe" — dziś (013) taka
-- decyzja tylko zapisywała się w build_material_returns jako ślad
-- audytowy, bez żadnego wpływu na koszt/rozliczenie budowy.
--
-- "Zwrot na magazyn" zostaje bez zmian kosztowych — ten koszt nigdy nie
-- wszedł do build_materials."actualCost" (to rośnie tylko przy realnym
-- ZUŻYCIU w raporcie, nie przy samym przypisaniu do budowy), więc nie ma
-- czego "odejmować" — materiał po prostu wraca tak, jakby nigdy nie
-- opuszczał magazynu na dłużej niż postój na placu budowy.
--
-- Cena straty = realna cena partii (build_material_lots."unitPrice"),
-- z której ta pozostałość pochodzi — bez uśredniania, ta sama zasada co
-- w decyzji A (§4 tego samego dokumentu).
-- ============================================================

alter table build_material_returns
  add column if not exists "unitPrice" decimal(12, 2) not null default 0;

alter table build_settlements
  add column if not exists "wasteCost" decimal(12, 2) not null default 0;

-- Realtime na build_material_returns — front liczy "Straty materiałowe"
-- na żywo z tej tabeli (patrz lib/data/use-realtime-sync.ts), tym samym
-- wzorcem co reszta ekranu Rozliczenia, zamiast polegać na
-- build_settlements (ten snapshot dziś i tak nie jest jeszcze nigdzie
-- odczytywany z powrotem do frontu — osobny, wcześniejszy dług, poza
-- zakresem tej zmiany).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'build_material_returns'
  ) then
    execute 'alter publication supabase_realtime add table build_material_returns';
  end if;
end $$;

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

    -- `is not distinct from` zamiast `=`, żeby dopasowanie działało też
    -- dla lotów z już wyzerowanym "sourceBatchId" (patrz wyżej) — inaczej
    -- taki lot nigdy nie zostałby zdjęty z build_material_lots, mimo że
    -- build_material_returns i tak zapisałby go jako rozliczony.
    -- RETURNING "unitPrice" — realna cena TEJ partii, do rozliczenia
    -- straty materiałowej niżej (bez uśredniania, ta sama zasada co
    -- przy korekcie raportu, patrz 035_dokladny_zwrot_partii.sql).
    update build_material_lots set quantity = quantity - v_qty
      where "buildId" = p_build_id and "materialId" = v_material_id
        and "sourceBatchId" is not distinct from v_batch_id and quantity >= v_qty - 0.0001
      returning "unitPrice" into v_lot_price;
    if not found then
      raise exception 'Ilość do rozliczenia (materiał #%, partia #%) przekracza pozostałość na budowie.',
        v_material_id, v_batch_id;
    end if;
    delete from build_material_lots
      where "buildId" = p_build_id and "materialId" = v_material_id
        and "sourceBatchId" is not distinct from v_batch_id and quantity <= 0.0001;

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
