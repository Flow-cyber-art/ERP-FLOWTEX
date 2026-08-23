-- ============================================================
-- Faza 7 modułu Technologia — Kilometrówka i koszty dodatkowe.
--
-- Uruchom PO 011. Bezpieczne do wielokrotnego wklejenia.
--
-- Zakres:
--   1. Tabela `settings` (singleton, snake_case per ustalona decyzja) —
--      jedna wartość: stawka za km. Tylko Admin może ją zmieniać,
--      wszyscy zalogowani mogą odczytać (potrzebne np. do podglądu
--      kosztu przed wysyłką raportu).
--   2. `reports` dostaje km / kmRateApplied / kmCost — zamrożone w
--      momencie wysyłki raportu (kolejna zmiana stawki w ustawieniach
--      nie rusza już wysłanych raportów), tak jak ceny partii w Fazie 5.
--   3. `report_extra_costs` dostaje category (nocleg / parking / zakup /
--      inne / dowolna własna — walidacji po stronie bazy celowo brak,
--      pole czysto opisowe dla rozliczenia).
--   4. `submit_daily_report` liczy kmCost = p_km * aktualna stawka z
--      `settings` i zapisuje wynik na wierszu `reports`, oraz zapisuje
--      category przy każdym koszcie dodatkowym.
-- ============================================================

create table if not exists settings (
  id boolean primary key default true,
  constraint settings_singleton check (id),
  km_rate numeric(10, 2) not null default 0,
  "updatedAt" timestamp not null default now()
);

insert into settings (id) values (true) on conflict (id) do nothing;

alter table settings enable row level security;
grant select, update on settings to authenticated;

drop policy if exists "settings_select_authenticated" on settings;
create policy "settings_select_authenticated" on settings
  for select to authenticated using (true);

drop policy if exists "settings_update_admin" on settings;
create policy "settings_update_admin" on settings
  for update to authenticated
  using (app_role() = 'Admin')
  with check (app_role() = 'Admin');

alter table reports add column if not exists km decimal(10, 2);
alter table reports add column if not exists "kmRateApplied" decimal(10, 2);
alter table reports add column if not exists "kmCost" decimal(12, 2);

alter table report_extra_costs add column if not exists category text;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'settings'
  ) then
    execute 'alter publication supabase_realtime add table settings';
  end if;
end $$;

-- CREATE OR REPLACE z dodatkowym parametrem NIE nadpisuje starej,
-- 5-argumentowej wersji funkcji (Postgres traktuje to jako przeciążenie
-- po liczbie argumentów) — trzeba ją jawnie usunąć, inaczej PostgREST
-- ma dwie pasujące funkcje o tej samej nazwie i odrzuca wywołanie jako
-- niejednoznaczne (PGRST203).
drop function if exists submit_daily_report(integer, date, jsonb, jsonb, jsonb);

-- ------------------------------------------------------------
-- submit_daily_report — identyczne jak w 010, plus:
--   - nowy parametr p_km (default null, więc wywołania sprzed Fazy 7,
--     w tym te zalegające w kolejce offline na urządzeniach, które
--     jeszcze nie zaktualizowały apki, dalej działają bez zmian),
--   - zamrożenie kmRateApplied/kmCost na wierszu reports,
--   - zapis category z p_extra_costs[].category.
-- Reszta logiki (FIFO, stage_name z Fazy 6, idempotencja po
-- buildId+date) bez zmian.
-- ------------------------------------------------------------
create or replace function submit_daily_report(
  p_build_id integer,
  p_date date,
  p_people jsonb,
  p_materials jsonb,
  p_extra_costs jsonb,
  p_km decimal default null
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
  v_used_quantity decimal;
  v_reason text;
  v_stage_name text;
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
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);

  select status into v_build_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_build_status = 'zamknięta' then
    raise exception 'Ta budowa jest zamknięta — nie można już dodawać raportów.';
  end if;

  select id, status into v_report_id, v_existing_status
    from reports where "buildId" = p_build_id and date = p_date;
  if v_report_id is not null and v_existing_status = 'approved' then
    raise exception 'Zatwierdzonego raportu nie można już edytować.';
  end if;

  -- Stawka zamrażana przy KAŻDYM zapisie raportu (nie tylko przy
  -- pierwszym), tak samo jak ceny partii w FIFO: brygadzista może
  -- poprawiać roboczy raport kilka razy tego samego dnia, ma dostać
  -- aktualną stawkę z każdym zapisem, dopóki raport nie jest approved
  -- (a approved i tak nie da się już edytować, patrz wyżej).
  if p_km is not null then
    select km_rate into v_km_rate from settings where id = true;
    v_km_rate_applied := coalesce(v_km_rate, 0);
    v_km_cost := p_km * v_km_rate_applied;
  else
    v_km_rate_applied := null;
    v_km_cost := null;
  end if;

  if v_report_id is null then
    insert into reports ("buildId", date, status, km, "kmRateApplied", "kmCost")
      values (p_build_id, p_date, 'submitted', p_km, v_km_rate_applied, v_km_cost)
      returning id into v_report_id;
  else
    update reports set
      status = 'submitted',
      "updatedAt" = now(),
      km = p_km,
      "kmRateApplied" = v_km_rate_applied,
      "kmCost" = v_km_cost
      where id = v_report_id;
    delete from report_people where "reportId" = v_report_id;
    delete from report_materials where "reportId" = v_report_id;
    delete from report_extra_costs where "reportId" = v_report_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_materials)
  loop
    v_material_id := (v_item->>'materialId')::integer;
    v_used_quantity := (v_item->>'usedQuantity')::decimal;
    v_reason := v_item->>'reason';
    v_stage_name := v_item->>'stageName';

    select * into v_assignment from build_materials
      where "buildId" = p_build_id and "materialId" = v_material_id
      for update;
    if not found then
      continue; -- materiał nieprzypisany do budowy — pomiń, jak lokalnie
    end if;

    v_delta := v_used_quantity - v_assignment.used;
    v_cost := 0;
    if v_delta > 0.0001 then
      v_cost := fn_consume_build_lot_fifo(p_build_id, v_material_id, v_delta);
      update build_materials
        set used = v_used_quantity, "actualCost" = "actualCost" + v_cost
        where "buildId" = p_build_id and "materialId" = v_material_id;
    elsif v_delta < -0.0001 then
      update build_materials
        set used = v_used_quantity
        where "buildId" = p_build_id and "materialId" = v_material_id;
    end if;

    insert into report_materials ("reportId", "materialId", "usedQuantity", cost, reason, stage_name)
      values (v_report_id, v_material_id, v_used_quantity, v_cost, v_reason, v_stage_name);

    v_result_materials := v_result_materials || jsonb_build_object(
      'materialId', v_material_id,
      'usedQuantity', v_used_quantity,
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

    insert into report_people ("reportId", "employeeId", start, "end")
      values (v_report_id, v_employee_id, v_start::time, v_end::time);
    insert into time_entries ("employeeId", "buildId", date, hours, start, "end")
      values (
        v_employee_id, p_build_id, p_date,
        greatest(0, extract(epoch from (v_end::time - v_start::time)) / 3600.0),
        v_start::time, v_end::time
      );
  end loop;

  for v_item in select * from jsonb_array_elements(p_extra_costs)
  loop
    insert into report_extra_costs ("reportId", label, amount, note, category)
      values (v_report_id, v_item->>'label', (v_item->>'amount')::decimal, v_item->>'note', v_item->>'category');
  end loop;

  return jsonb_build_object(
    'reportId', v_report_id,
    'materials', v_result_materials,
    'km', p_km,
    'kmRateApplied', v_km_rate_applied,
    'kmCost', v_km_cost
  );
end;
$$;

grant execute on function submit_daily_report(integer, date, jsonb, jsonb, jsonb, decimal) to authenticated;
