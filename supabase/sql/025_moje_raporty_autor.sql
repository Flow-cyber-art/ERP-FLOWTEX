-- ============================================================
-- "Moje raporty" — Brygadzista ma dziś widoczne WSZYSTKIE raporty danej
-- budowy, łącznie z tymi wysłanymi przez innych brygadzistów (nie ma po
-- co ich porównywać, to tylko szum). Do tego potrzebny jest ślad, KTO
-- faktycznie wysłał raport — dotąd reports nie miało takiej kolumny
-- (report_people trzyma kto PRACOWAŁ tego dnia, nie kto wypełnił
-- formularz — to dwie różne rzeczy).
--
-- "submittedByProfileId" ustawiane WYŁĄCZNIE przy pierwszym utworzeniu
-- raportu (insert), nigdy nie nadpisywane przy edycji — jeśli ktoś
-- inny poprawia cudzy raport, autor się nie zmienia.
-- Uruchom PO 009 (submit_daily_report musi już istnieć). Bezpieczne do
-- wielokrotnego wklejenia.
-- ============================================================

alter table reports add column if not exists "submittedByProfileId" uuid references profiles(id) on delete set null;

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
    insert into reports ("buildId", date, status, "submittedByProfileId")
      values (p_build_id, p_date, 'submitted', auth.uid())
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
      -- Korekta w dół: nie oddaje partii ani kosztu (jak lokalnie) — tylko
      -- zapisuje nową, niższą wartość `used`.
      update build_materials
        set used = v_used_quantity
        where "buildId" = p_build_id and "materialId" = v_material_id;
    end if;

    insert into report_materials ("reportId", "materialId", "usedQuantity", cost, reason)
      values (v_report_id, v_material_id, v_used_quantity, v_cost, v_reason);

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
