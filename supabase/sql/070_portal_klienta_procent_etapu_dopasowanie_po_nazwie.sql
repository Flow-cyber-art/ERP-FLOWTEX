-- ============================================================
-- Portal Klienta: procent KAŻDEGO etapu pokazywał 0% mimo realnego
-- zużycia materiałów (069_portal_klienta_procent_srednia_materialow.sql).
--
-- Przyczyna: dokładnie ten sam problem co w
-- 060_portal_klienta_procent_etapu_bez_linku.sql, tylko w nowej wersji
-- liczącej średnią z procentów materiałów zamiast kosztu — dopasowanie
-- zużycia do pozycji planu robiłem po `build_material_plan.
-- linked_material_id`, a ta kolumna jest PUSTA dla wszystkich pozycji
-- (Admin nigdy jej ręcznie nie ustawia w tym projekcie). Efekt: żadna
-- pozycja planu nie znajdowała swojego zużycia → 0% na każdym etapie,
-- mimo że postęp ogólny (liczony z build_materials, bez tego linku)
-- pokazywał poprawną wartość.
--
-- Naprawa: dopasuj materiał PO NAZWIE (normalize_material_name, ta sama
-- funkcja co w 060) gdy `linked_material_id` jest puste — priorytet:
-- jawny link, potem dopasowanie po znormalizowanej nazwie.
--
-- Uruchom PO 069_portal_klienta_procent_srednia_materialow.sql.
-- Bezpieczne do wielokrotnego wklejenia. Jak uruchomić: Supabase
-- Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

create or replace function get_public_build(p_token uuid, p_pin text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_build record;
  v_pin_ok boolean;
  v_has_plan boolean;
  v_progress numeric;
  v_days_elapsed integer;
  v_expected_progress numeric;
  v_delta numeric;
  v_status_color text;
  v_display_status text;
  v_last_update date;
  v_materials json;
  v_stages json;
  v_technology_name text;
  v_photos json;
  v_notes json;
begin
  select b.* into v_build
  from builds b
  where b.public_token = p_token;

  if not found or v_build.public_access_enabled is not true then
    return null;
  end if;

  v_pin_ok := v_build.public_pin_hash is null
    or (p_pin is not null and crypt(p_pin, v_build.public_pin_hash) = v_build.public_pin_hash);

  if not v_pin_ok then
    return json_build_object(
      'requiresPin', true,
      'name', v_build.name,
      'number', v_build.number
    );
  end if;

  select count(distinct r.date) into v_days_elapsed
  from reports r
  where r."buildId" = v_build.id and r.status = 'approved';

  select count(*) > 0 into v_has_plan
  from build_materials bm
  where bm."buildId" = v_build.id and bm.planned > 0;

  if v_has_plan then
    select avg(least(coalesce(u.used_qty, 0) / bm.planned, 1)) * 100
      into v_progress
      from build_materials bm
      left join (
        select rm."materialId", sum(rm."usedQuantity") as used_qty
        from report_materials rm
        join reports r on r.id = rm."reportId"
        where r."buildId" = v_build.id and r.status = 'approved'
        group by rm."materialId"
      ) u on u."materialId" = bm."materialId"
      where bm."buildId" = v_build.id and bm.planned > 0;
    v_progress := round(v_progress);
  else
    v_progress := least(round((coalesce(v_days_elapsed, 0)::numeric / nullif(v_build."durationDays", 0)) * 100), 100);
  end if;

  -- Procent KAŻDEGO etapu — średnia z min(zużyto/plan, 1) po materiałach
  -- TEGO etapu, dopasowanych do report_materials po (materialId,
  -- stage_name), gdzie materialId pozycji planu to jawny link ALBO
  -- (gdy pusty) materiał o tej samej znormalizowanej nazwie.
  select json_agg(
    json_build_object('name', s.stage_name, 'percent', round(s.percent)) order by s.min_id
  )
  into v_stages
  from (
    select
      p.stage_name,
      min(p.id) as min_id,
      avg(least(coalesce(u.used_qty, 0) / p.planned_quantity, 1)) * 100 as percent
    from build_material_plan p
    left join (
      select rm."materialId", rm.stage_name, sum(rm."usedQuantity") as used_qty
      from report_materials rm
      join reports r on r.id = rm."reportId"
      where r."buildId" = v_build.id and r.status = 'approved' and rm.stage_name is not null
      group by rm."materialId", rm.stage_name
    ) u on u.stage_name = p.stage_name
      and u."materialId" = coalesce(
        p.linked_material_id,
        (select m.id from materials m
          where normalize_material_name(m.name) = normalize_material_name(p.material_name)
          limit 1)
      )
    where p.build_id = v_build.id and p.planned_quantity > 0
    group by p.stage_name
  ) s;

  v_expected_progress := least((coalesce(v_days_elapsed, 0)::numeric / nullif(v_build."durationDays", 0)) * 100, 100);
  v_delta := coalesce(v_progress, 0) - coalesce(v_expected_progress, 0);
  v_status_color := case
    when v_delta >= -5 then 'green'
    when v_delta >= -15 then 'yellow'
    else 'red'
  end;

  if v_build.status = 'zamknięta' then
    v_display_status := 'zamknieta';
  elsif v_build."startDate" > current_date then
    v_display_status := 'nierozpoczeta';
    v_progress := 0;
    v_status_color := null;
  else
    v_display_status := 'aktywna';
  end if;

  select max(r.date) into v_last_update
  from reports r
  where r."buildId" = v_build.id and r.status = 'approved';

  select json_agg(m.name order by m.name)
  into v_materials
  from build_materials bm
  join materials m on m.id = bm."materialId"
  where bm."buildId" = v_build.id;

  select technology_name into v_technology_name
  from build_technology_snapshot
  where build_id = v_build.id;

  if v_build.show_photos_to_client then
    select json_agg(
      json_build_object('id', bp."driveFileId", 'createdAt', bp."createdAt")
      order by bp."createdAt" desc
    )
    into v_photos
    from (
      select * from build_photos where "buildId" = v_build.id
      order by "createdAt" desc
      limit 24
    ) bp;
  else
    v_photos := '[]'::json;
  end if;

  if v_build.show_notes_to_client then
    select json_agg(
      json_build_object('date', n.date, 'note', n.client_note) order by n.date desc
    )
    into v_notes
    from (
      select date, client_note from reports
      where "buildId" = v_build.id and status = 'approved'
        and client_note is not null and length(trim(client_note)) > 0
      order by date desc
      limit 1
    ) n;
  else
    v_notes := '[]'::json;
  end if;

  return json_build_object(
    'name', v_build.name,
    'number', v_build.number,
    'address', v_build.address,
    'areaM2', v_build."areaM2",
    'startDate', v_build."startDate",
    'plannedEndDate', v_build."startDate"::date + (v_build."durationDays" || ' days')::interval,
    'status', v_build.status,
    'displayStatus', v_display_status,
    'progressPercent', coalesce(v_progress, 0),
    'statusColor', v_status_color,
    'stages', coalesce(v_stages, '[]'::json),
    'materials', coalesce(v_materials, '[]'::json),
    'technologyName', v_technology_name,
    'photos', coalesce(v_photos, '[]'::json),
    'notes', coalesce(v_notes, '[]'::json),
    'aiSummary', case
      when v_build.show_notes_to_client and v_build.ai_client_summary is not null
        and length(trim(v_build.ai_client_summary)) > 0
      then v_build.ai_client_summary
      else null
    end,
    'allowClientAiSummary', coalesce(v_build.allow_client_ai_summary, false),
    'lastUpdateDate', v_last_update,
    'photosUrl', v_build."photosUrl",
    'contractValue', case when v_build.show_contract_value_to_client then v_build."contractValue" else null end
  );
end;
$$;

grant execute on function get_public_build(uuid, text) to anon;
