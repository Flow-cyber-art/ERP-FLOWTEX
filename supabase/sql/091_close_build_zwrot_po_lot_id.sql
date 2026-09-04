-- ============================================================
-- close_build: dopasowanie decyzji "zwrot/wyrzucenie" do partii PO
-- lotId (build_material_lots.id), nie po (materialId, batchId, quantity).
--
-- Zgłoszony problem: przy zamykaniu budowy Admin decyduje osobno dla
-- KAŻDEJ pozostałej partii materiału (build_material_lots) — zwrot na
-- magazyn albo do wyrzucenia. Front wysyłał (materialId, batchId,
-- quantity), a funkcja odnajdywała odpowiedni wiersz partii dopasowując
-- PO TYCH WARTOŚCIACH, nie po ID partii.
--
-- Problem w tym, że "batchId" (sourceBatchId partii) bardzo często jest
-- `null` — nie tylko gdy materiał zamówiono bezpośrednio pod budowę
-- (receive_order z build_id), ale też w zwykłym, ręcznym przypisaniu
-- partii z magazynu, gdy Admin wziął całą partię naraz (typowy
-- przypadek): partia-źródłowa jest wtedy od razu kasowana z
-- material_batches, a FK `sourceBatchId` zeruje się przez ON DELETE
-- SET NULL. Więc DWIE różne partie tego samego materiału (różne ceny,
-- bo np. jedna z magazynu, druga z nowego zamówienia) mogły mieć
-- identyczne (materialId, batchId=null) — a jeśli dodatkowo miały tę
-- samą pozostałą ilość, `order by id asc limit 1` wybierał dowolną z
-- nich. Skutek: gdyby Admin podjął dla nich RÓŻNE decyzje (np. jedna
-- "zwrot", druga "do wyrzucenia"), funkcja potrafiła po cichu zamienić
-- im ceny/decyzje miejscami — bez błędu, bez ostrzeżenia. (Zanim ktoś
-- to naprawi z powrotem "dla uproszczenia": to jest źródło błędu, nie
-- naddatek).
--
-- Naprawa: front (lib/data/builds.ts, CloseBuildReturnItem) wysyła teraz
-- `lotId` wprost — dokładnie ten sam wiersz, który był pokazany i
-- decydowany na ekranie. Funkcja dopasowuje partię po jej własnym ID,
-- odczytuje z niej `materialId`/`sourceBatchId` sama (nie ufa temu, co
-- przyszło z frontu poza `lotId`/`quantity`/`decision`/`reason`).
--
-- Uruchom PO 053_zwrot_do_usunietej_partii_przy_zamknieciu.sql i
-- 080_blokada_zamkniecia_niezerowy_podmagazyn.sql (ich logika — nowa
-- partia przy skasowanej partii-źródłowej, blokada niewyzerowanego
-- podmagazynu — zostaje bez zmian). Bezpieczne do wielokrotnego
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
  v_lot_id integer;
  v_material_id integer;
  v_batch_id integer;
  v_qty decimal;
  v_decision text;
  v_reason text;
  v_lot_price decimal;
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
    v_lot_id := (v_ret->>'lotId')::integer;
    v_qty := (v_ret->>'quantity')::decimal;
    v_decision := v_ret->>'decision';
    v_reason := v_ret->>'reason';

    if v_qty is null or v_qty <= 0 then
      continue;
    end if;
    if v_decision not in ('zwrot', 'wyrzucenie') then
      raise exception 'Nieprawidłowa decyzja rozliczenia partii #%: %', v_lot_id, v_decision;
    end if;

    -- Dopasowanie WPROST po ID partii — jednoznaczne, niezależnie od
    -- tego, ile innych partii tego samego materiału (z tą samą albo
    -- pustą sourceBatchId) jest jeszcze przypisanych do budowy.
    select "materialId", "sourceBatchId" into v_material_id, v_batch_id
      from build_material_lots
      where id = v_lot_id and "buildId" = p_build_id and quantity >= v_qty - 0.0001
      for update;
    if not found then
      raise exception 'Partia #% nie istnieje na budowie #% albo ilość do rozliczenia przekracza jej pozostałość.',
        v_lot_id, p_build_id;
    end if;

    -- RETURNING "unitPrice" — realna cena TEJ partii, do zwrotu/straty
    -- materiałowej niżej (bez uśredniania, ta sama zasada co przy
    -- korekcie raportu, patrz 035_dokladny_zwrot_partii.sql).
    update build_material_lots set quantity = quantity - v_qty
      where id = v_lot_id
      returning "unitPrice" into v_lot_price;
    delete from build_material_lots where id = v_lot_id and quantity <= 0.0001;

    if v_decision = 'zwrot' then
      if v_batch_id is not null then
        update material_batches set quantity = quantity + v_qty where id = v_batch_id;
      else
        -- Partia-źródłowa nie istnieje (materiał zamówiony wprost pod
        -- budowę, albo skasowana po wyczerpaniu gdzie indziej) — zwrot
        -- trafia do nowej partii (ta sama ilość i cena), jak w
        -- 028_fix_zwrot_do_usunietej_partii.sql / 053.
        insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source)
          values (v_material_id, v_qty, v_lot_price, current_date, 'zwrot z budowy');
      end if;
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
