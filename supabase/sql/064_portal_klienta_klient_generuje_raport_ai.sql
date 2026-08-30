-- ============================================================
-- Portal Klienta: klient sam generuje zbiorczy raport AI (na życzenie),
-- zamiast Admina klikającego to za niego.
--
-- Nowy przełącznik builds.allow_client_ai_summary ("Klient może
-- wygenerować raport AI" w sekcji Portalu Klienta) decyduje, czy w
-- publicznym portalu (app/portal/[token].tsx) pojawia się przycisk
-- "Wygeneruj raport z budowy AI" pod sekcją "Ostatnie aktualizacje".
-- Kliknięcie woła Edge Function generate-client-summary z publicToken
-- zamiast sesji Admina — patrz zmiana w
-- supabase/functions/generate-client-summary/index.ts.
--
-- Uruchom PO 063_portal_klienta_podsumowanie_ai.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

alter table builds add column if not exists allow_client_ai_summary boolean not null default false;

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
  v_planned_cost numeric;
  v_used_cost numeric;
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
  where r."buildId" = v_build.id;

  select coalesce(sum(bm.planned * bm."unitPrice"), 0), coalesce(sum(bm.used * bm."unitPrice"), 0)
    into v_planned_cost, v_used_cost
    from build_materials bm
    where bm."buildId" = v_build.id;
  v_has_plan := v_planned_cost > 0;

  if v_has_plan then
    v_progress := least(round((v_used_cost / v_planned_cost) * 100), 100);
  else
    v_progress := least(round((coalesce(v_days_elapsed, 0)::numeric / nullif(v_build."durationDays", 0)) * 100), 100);
  end if;

  select json_agg(
    json_build_object(
      'name', s.stage_name,
      'percent', case
        when coalesce(s.planned_cost, 0) > 0
          then least(round((coalesce(u.used_cost, 0) / s.planned_cost) * 100), 100)
        else 0
      end
    ) order by s.min_id
  )
  into v_stages
  from (
    select
      p.stage_name,
      min(p.id) as min_id,
      sum(p.planned_quantity * coalesce(m."unitPrice", 0)) as planned_cost
    from build_material_plan p
    left join materials m on m.id = p.linked_material_id
    where p.build_id = v_build.id
    group by p.stage_name
  ) s
  left join (
    select rm.stage_name, sum(rm.cost) as used_cost
    from report_materials rm
    join reports r on r.id = rm."reportId"
    where r."buildId" = v_build.id and rm.stage_name is not null
    group by rm.stage_name
  ) u on u.stage_name = s.stage_name;

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
  where r."buildId" = v_build.id and r.status in ('submitted', 'approved');

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
    -- Front pokazuje przycisk "Wygeneruj raport z budowy AI" tylko gdy
    -- Admin włączył ten przełącznik w Portalu Klienta — patrz
    -- build-portal-section.tsx i app/portal/[token].tsx.
    'allowClientAiSummary', coalesce(v_build.allow_client_ai_summary, false),
    'lastUpdateDate', v_last_update,
    'photosUrl', v_build."photosUrl",
    'contractValue', case when v_build.show_contract_value_to_client then v_build."contractValue" else null end
  );
end;
$$;

grant execute on function get_public_build(uuid, text) to anon;
