-- ============================================================
-- 115: Raport podwykonawcy — raport w imieniu podwykonawcy bez konta i
-- korekta zgłoszonych m² przez Admina.
--
-- 1) submit_daily_report(+ p_team_id): Admin może wysłać raport ZA
--    brygadę podwykonawcy (podwykonawca nie zawsze ma konto w aplikacji).
--    Brygada musi być brygadą podwykonawcy przypisaną do budowy; dla
--    innych ról parametr jest ignorowany (brygadzista podwykonawcy nadal
--    jest rozpoznawany po swoim koncie, jak w 112).
--
-- 2) set_report_stage_progress: Admin poprawia szacunkowe m² per etap
--    zgłoszone w raporcie, ZANIM go zatwierdzi (po zatwierdzeniu — blokada,
--    jak reszta raportu). Zatwierdzone m² są podpowiedzią do protokołu
--    odbioru (protokół pozostaje osobnym dokumentem, 113).
--
-- Uruchom PO 114_podwykonawca_jedna_stawka_m2.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

-- Nowy parametr = nowa sygnatura; poprzednia (112) musi zniknąć.
drop function if exists submit_daily_report(integer, date, jsonb, jsonb, jsonb, numeric, text, jsonb);

create or replace function submit_daily_report(
  p_build_id integer,
  p_date date,
  p_people jsonb,
  p_materials jsonb,
  p_extra_costs jsonb,
  p_km numeric default null,
  p_note text default null,
  p_stage_progress jsonb default null,
  p_team_id integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_build_status build_status;
  v_report_id integer;
  v_existing_status report_status;
  v_item jsonb;
  v_material_id integer;
  v_daily_quantity decimal;
  v_prev_daily decimal;
  v_prev_materials jsonb;
  v_reason text;
  v_stage_name text;
  v_key text;
  v_assignment build_materials;
  v_delta decimal;
  v_cost decimal;
  v_employee_id integer;
  v_start text;
  v_end text;
  v_km_rate decimal;
  v_km_rate_applied decimal;
  v_km_cost decimal;
  v_result_materials jsonb := '[]'::jsonb;
  v_qty_to_return decimal;
  v_returned_cost decimal;
  v_lot_row record;
  v_take decimal;
  v_updated integer;
  v_hourly_rate decimal;
  v_cost_rate decimal;
  v_actor text;
  v_team_id integer;
  v_scope text[];
  v_progress_qty decimal;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);
  v_actor := auth.uid()::text;

  select status into v_build_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_build_status = 'zamknięta' then
    raise exception 'Ta budowa jest zamknięta — nie można już dodawać raportów.';
  end if;

  -- 112: brygadzista podwykonawcy raportuje we WŁASNYM raporcie
  -- (reports.team_id), osobno od brygady własnej tego samego dnia.
  -- Brygada ustalana po stronie bazy (nie z parametru), więc nie da się
  -- podszyć pod cudzą brygadę.
  v_team_id := my_subcontractor_team(p_build_id);
  if v_team_id is null and is_subcontractor_lead() then
    raise exception 'Twoja brygada nie jest przypisana do tej budowy.';
  end if;

  -- 115: Admin raportuje W IMIENIU podwykonawcy bez konta w aplikacji —
  -- p_team_id wskazuje jego brygadę (musi być brygadą podwykonawcy
  -- przypisaną do tej budowy). Dla innych ról parametr jest ignorowany.
  if v_team_id is null and p_team_id is not null and app_role() = 'Admin' then
    if not exists (
      select 1 from build_teams bt join teams t on t.id = bt.team_id
       where bt.build_id = p_build_id and bt.team_id = p_team_id and t.subcontractor_id is not null
    ) then
      raise exception 'Wybrana brygada podwykonawcy nie jest przypisana do tej budowy.';
    end if;
    v_team_id := p_team_id;
  end if;

  select id, status into v_report_id, v_existing_status
    from reports where "buildId" = p_build_id and date = p_date
      and team_id is not distinct from v_team_id;
  if v_report_id is not null and v_existing_status = 'approved' then
    raise exception 'Zatwierdzonego raportu nie można już edytować.';
  end if;

  if v_report_id is not null then
    -- Klucz "materialId:stageName" (pusty string zamiast null — jsonb
    -- object nie akceptuje null jako klucza) — musi dokładnie odpowiadać
    -- kluczowi liczonemu niżej w pętli dla v_item, inaczej delta wyszłaby
    -- względem złego (albo żadnego) poprzedniego wiersza.
    select coalesce(
             jsonb_object_agg("materialId"::text || ':' || coalesce(stage_name, ''), "usedQuantity"),
             '{}'::jsonb
           )
      into v_prev_materials
      from report_materials where "reportId" = v_report_id;
  else
    v_prev_materials := '{}'::jsonb;
  end if;

  -- Podwykonawca: bez osób/godzin, kilometrówki i kosztów dodatkowych —
  -- rozlicza się za wykonaną ilość, ludźmi i dojazdami zajmuje się sam.
  if v_team_id is not null then
    p_people := '[]'::jsonb;
    p_extra_costs := '[]'::jsonb;
    p_km := null;
  end if;

  if p_km is not null then
    select km_rate into v_km_rate from settings where id = true;
    v_km_rate_applied := coalesce(v_km_rate, 0);
    v_km_cost := p_km * v_km_rate_applied;
  else
    v_km_rate_applied := null;
    v_km_cost := null;
  end if;

  if v_report_id is null then
    insert into reports ("buildId", date, status, km, "kmRateApplied", "kmCost", note, "submittedByProfileId", team_id)
      values (p_build_id, p_date, 'submitted', p_km, v_km_rate_applied, v_km_cost, p_note, auth.uid(), v_team_id)
      returning id into v_report_id;
  else
    update reports set
      status = 'submitted',
      "updatedAt" = now(),
      km = p_km,
      "kmRateApplied" = v_km_rate_applied,
      "kmCost" = v_km_cost,
      note = p_note
      where id = v_report_id;
    delete from report_people where "reportId" = v_report_id;
    delete from report_materials where "reportId" = v_report_id;
    delete from report_extra_costs where "reportId" = v_report_id;
    delete from report_stage_progress where report_id = v_report_id;
    -- report_material_lots NIE jest tu kasowane — to trwały, append-only
    -- rozkład "z jakiego lota ile" (patrz nagłówek pliku).
  end if;

  for v_item in select * from jsonb_array_elements(p_materials)
  loop
    v_material_id := (v_item->>'materialId')::integer;
    v_daily_quantity := (v_item->>'usedQuantity')::decimal;
    v_reason := v_item->>'reason';
    v_stage_name := v_item->>'stageName';
    v_key := v_material_id::text || ':' || coalesce(v_stage_name, '');

    select * into v_assignment from build_materials
      where "buildId" = p_build_id and "materialId" = v_material_id
      for update;
    if not found then
      continue;
    end if;

    v_prev_daily := coalesce((v_prev_materials ->> v_key)::decimal, 0);
    v_delta := v_daily_quantity - v_prev_daily;
    v_cost := 0;

    if v_delta > 0.0001 then
      v_cost := fn_consume_build_lot_fifo(p_build_id, v_material_id, v_delta, v_report_id, v_stage_name);
      update build_materials
        set used = v_assignment.used + v_delta, "actualCost" = "actualCost" + v_cost
        where "buildId" = p_build_id and "materialId" = v_material_id;

    elsif v_delta < -0.0001 then
      -- Korekta w dół: cofnij DOKŁADNIE tyle, ile TEN WPIS (materiał +
      -- ETAP) sam dołożył, w kolejności LIFO, po realnej cenie każdego
      -- kawałka. Dopasowanie po stage_name — bez tego korekta jednego
      -- etapu potrafiłaby cofnąć zużycie zapisane dla DRUGIEGO etapu tego
      -- samego materiału w tym samym raporcie.
      v_qty_to_return := -v_delta;
      v_returned_cost := 0;

      for v_lot_row in
        select
          rml.id, rml."lotId", rml."sourceBatchId", rml."unitPrice",
          rml.quantity + coalesce(rev.reversed, 0) as outstanding
        from report_material_lots rml
        left join (
          select "reversalOfId", sum(quantity) as reversed
            from report_material_lots
            where "reversalOfId" is not null
            group by "reversalOfId"
        ) rev on rev."reversalOfId" = rml.id
        where rml."reportId" = v_report_id and rml."materialId" = v_material_id
          and rml.stage_name is not distinct from v_stage_name
          and rml."reversalOfId" is null
        order by rml.id desc
        for update of rml
      loop
        exit when v_qty_to_return <= 0.0001;
        if v_lot_row.outstanding <= 0.0001 then
          continue;
        end if;
        v_take := least(v_lot_row.outstanding, v_qty_to_return);

        if v_lot_row."lotId" is not null then
          update build_material_lots set quantity = quantity + v_take
            where id = v_lot_row."lotId";
          get diagnostics v_updated = row_count;
        else
          v_updated := 0;
        end if;
        if v_updated = 0 then
          insert into build_material_lots ("buildId", "materialId", "sourceBatchId", quantity, "unitPrice", "issuedAt")
            values (p_build_id, v_material_id, v_lot_row."sourceBatchId", v_take, v_lot_row."unitPrice", now());
        end if;

        v_returned_cost := v_returned_cost + v_take * v_lot_row."unitPrice";

        insert into report_material_lots
            ("reportId", "materialId", "lotId", "sourceBatchId", quantity, "unitPrice", "reversalOfId", stage_name)
          values (v_report_id, v_material_id, v_lot_row."lotId", v_lot_row."sourceBatchId", -v_take, v_lot_row."unitPrice", v_lot_row.id, v_stage_name);

        insert into stock_movements
            ("type", "materialId", "buildId", "batchId", "lotId", "reportId", quantity, "unitPrice", note, "createdByProfileId")
          values ('korekta', v_material_id, p_build_id, v_lot_row."sourceBatchId", v_lot_row."lotId", v_report_id, v_take, v_lot_row."unitPrice",
                  'Korekta w dół — storno zużycia z raportu', v_actor);

        v_qty_to_return := v_qty_to_return - v_take;
      end loop;

      v_cost := -v_returned_cost;
      update build_materials
        set used = greatest(v_assignment.used + v_delta, 0), "actualCost" = greatest("actualCost" - v_returned_cost, 0)
        where "buildId" = p_build_id and "materialId" = v_material_id;
    end if;

    insert into report_materials ("reportId", "materialId", "usedQuantity", cost, reason, stage_name)
      values (v_report_id, v_material_id, v_daily_quantity, v_cost, v_reason, v_stage_name);

    v_result_materials := v_result_materials || jsonb_build_object(
      'materialId', v_material_id,
      'stageName', v_stage_name,
      'usedQuantity', v_daily_quantity,
      'cost', v_cost
    );
  end loop;

  if jsonb_array_length(p_people) > 0 then
    delete from time_entries where date = p_date and "buildId" = p_build_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_people)
  loop
    v_employee_id := (v_item->>'employeeId')::integer;
    v_start := v_item->>'start';
    v_end := v_item->>'end';

    select "hourlyRate", "costRate" into v_hourly_rate, v_cost_rate
      from employees where id = v_employee_id;

    insert into report_people ("reportId", "employeeId", start, "end")
      values (v_report_id, v_employee_id, v_start::time, v_end::time);
    insert into time_entries ("employeeId", "buildId", date, hours, start, "end", "hourlyRate", "costRate")
      values (
        v_employee_id, p_build_id, p_date,
        greatest(0, extract(epoch from (v_end::time - v_start::time)) / 3600.0),
        v_start::time, v_end::time,
        v_hourly_rate, v_cost_rate
      );
  end loop;

  for v_item in select * from jsonb_array_elements(p_extra_costs)
  loop
    insert into report_extra_costs ("reportId", label, amount, note, category)
      values (v_report_id, v_item->>'label', (v_item->>'amount')::decimal, v_item->>'note', v_item->>'category');
  end loop;

  -- Wykonana ilość per etap (informacyjnie — podstawą zapłaty będzie
  -- odbiór etapu przez Admina). Podwykonawca tylko w swoim zakresie etapów.
  if p_stage_progress is not null then
    if v_team_id is not null then
      select stage_names into v_scope from build_teams
        where build_id = p_build_id and team_id = v_team_id;
    end if;
    for v_item in select * from jsonb_array_elements(p_stage_progress)
    loop
      v_stage_name := nullif(trim(v_item->>'stageName'), '');
      v_progress_qty := (v_item->>'quantity')::decimal;
      continue when v_stage_name is null or v_progress_qty is null or v_progress_qty <= 0;
      continue when v_scope is not null and not (v_stage_name = any(v_scope));
      insert into report_stage_progress (report_id, stage_name, quantity, unit)
        values (v_report_id, v_stage_name, v_progress_qty, coalesce(nullif(v_item->>'unit', ''), 'm2'))
        on conflict (report_id, stage_name) do update set quantity = excluded.quantity, unit = excluded.unit;
    end loop;
  end if;

  return jsonb_build_object(
    'reportId', v_report_id,
    'teamId', v_team_id,
    'materials', v_result_materials,
    'km', p_km,
    'kmRateApplied', v_km_rate_applied,
    'kmCost', v_km_cost
  );
end;
$$;

grant execute on function submit_daily_report(integer, date, jsonb, jsonb, jsonb, numeric, text, jsonb, integer) to authenticated;

create or replace function set_report_stage_progress(p_report_id integer, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status report_status;
  v_item jsonb;
  v_stage text;
  v_qty decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select status into v_status from reports where id = p_report_id for update;
  if not found then
    raise exception 'Nie znaleziono raportu #%.', p_report_id;
  end if;
  if v_status = 'approved' then
    raise exception 'Raport jest już zatwierdzony — m² nie można poprawić.';
  end if;

  delete from report_stage_progress where report_id = p_report_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_stage := nullif(trim(v_item->>'stageName'), '');
    v_qty := (v_item->>'quantity')::decimal;
    continue when v_stage is null or v_qty is null or v_qty <= 0;
    insert into report_stage_progress (report_id, stage_name, quantity, unit)
      values (p_report_id, v_stage, v_qty, coalesce(nullif(v_item->>'unit', ''), 'm2'))
      on conflict (report_id, stage_name) do update set quantity = excluded.quantity, unit = excluded.unit;
  end loop;

  update reports set "updatedAt" = now() where id = p_report_id;
end;
$$;

grant execute on function set_report_stage_progress(integer, jsonb) to authenticated;
