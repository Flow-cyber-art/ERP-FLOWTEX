-- ============================================================
-- Faza 6 modułu Technologia — Raport dzienny (etapy technologii).
--
-- Uruchom PO 009. Bezpieczne do wielokrotnego wklejenia.
--
-- Największa zmiana w codziennej pracy brygadzisty, ale schemat zostaje
-- świadomie płytki: nie duplikujemy modelu build_materials/report_materials
-- per-etap (to wymagałoby zmiany klucza głównego report_materials i całej
-- logiki FIFO z Fazy 5, ryzykownie krótko po tamtej zmianie). Zamiast
-- tego:
--   1. `report_materials` dostaje `stage_name` — WYŁĄCZNIE informacyjne
--      (do jakiego etapu zaliczono zużycie tego dnia), liczone i
--      wysyłane przez klienta na podstawie `build_material_plan`
--      (Faza 2). Nie zmienia FIFO/kosztu — to samo dzielenie na
--      materiał co dotychczas.
--   2. Status etapu (⚪ nierozpoczęty / 🟢 zakończony) to osobna, nowa
--      tabela `build_stage_status` — jeden wiersz = jeden zakończony
--      etap danej budowy. Brak wiersza = nierozpoczęty/w trakcie
--      (rozróżnia to już samo UI, na podstawie zużycia > 0).
-- ============================================================

alter table report_materials add column if not exists stage_name text;

create table if not exists build_stage_status (
  build_id integer not null references builds(id) on delete cascade,
  stage_name text not null,
  "completedAt" timestamp not null default now(),
  "completedBy" uuid references auth.users(id) on delete set null,
  primary key (build_id, stage_name)
);

alter table build_stage_status enable row level security;
grant select, insert, delete on build_stage_status to authenticated;

drop policy if exists "select_authenticated" on build_stage_status;
create policy "select_authenticated" on build_stage_status
  for select to authenticated using (true);

-- Zapis wprost z klienta (bez RPC) — Admin i Brygadzista, tak jak
-- submit_daily_report; to jedyna operacja na tej tabeli (insert = "Zakończ
-- etap", delete = "Wznów etap"), więc RPC nie jest tu potrzebne.
drop policy if exists "build_stage_status_write" on build_stage_status;
create policy "build_stage_status_write" on build_stage_status
  for all to authenticated
  using (app_role() in ('Admin', 'Brygadzista'))
  with check (app_role() in ('Admin', 'Brygadzista'));

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'build_stage_status'
  ) then
    execute 'alter publication supabase_realtime add table build_stage_status';
  end if;
end $$;

-- ------------------------------------------------------------
-- submit_daily_report — identyczne jak w 009, plus zapis stage_name
-- (czysto informacyjny, z p_materials[].stageName) przy insercie do
-- report_materials. Reszta logiki (FIFO po build_material_lots z Fazy 5,
-- idempotencja po buildId+date) bez zmian.
-- ------------------------------------------------------------
create or replace function submit_daily_report(
  p_build_id integer,
  p_date date,
  p_people jsonb,
  p_materials jsonb,
  p_extra_costs jsonb
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

  if v_report_id is null then
    insert into reports ("buildId", date, status)
      values (p_build_id, p_date, 'submitted')
      returning id into v_report_id;
  else
    update reports set status = 'submitted', "updatedAt" = now() where id = v_report_id;
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
    insert into report_extra_costs ("reportId", label, amount, note)
      values (v_report_id, v_item->>'label', (v_item->>'amount')::decimal, v_item->>'note');
  end loop;

  return jsonb_build_object('reportId', v_report_id, 'materials', v_result_materials);
end;
$$;

grant execute on function submit_daily_report(integer, date, jsonb, jsonb, jsonb) to authenticated;
