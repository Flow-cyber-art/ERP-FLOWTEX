-- ============================================================
-- Procent postępu w Portalu Klienta liczył się WYŁĄCZNIE z ręcznie
-- odznaczanych etapów (build_stage_status) — dopóki nikt nie kliknie
-- "Zakończ etap" w apce, gauge pokazuje 0%, nawet gdy budowa realnie
-- zużyła już sporo materiału. To myląco wygląda jak "nic się nie
-- dzieje", mimo że w panelu admina (Koszty na bieżąco) widać realny
-- postęp zużycia.
--
-- Zmiana: postęp liczy się teraz z REALNEGO zużycia materiałów —
-- wartość zużytych materiałów (build_materials.used × unitPrice) do
-- wartości zaplanowanych (planned × unitPrice), ta sama logika co
-- sekcja "Koszty na bieżąco" w panelu admina (plan vs wykonano).
-- Ręcznie odznaczane etapy zostają w JSON (`stages`) jako informacyjny
-- checklist dla klienta, ale już nie sterują samym procentem.
--
-- Kolejność źródła procentu: 1) zużycie materiałów (gdy budowa ma
-- przypisany plan materiałowy z planowaną wartością > 0), 2) etapy
-- (gdy materiałów nie ma, ale są etapy), 3) fallback czasowy (ani
-- materiałów, ani etapów — budowa bez przypisanej technologii).
--
-- Uruchom PO 054_portal_klienta_lista_materialow.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
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
  v_total_stages integer;
  v_completed_stages integer;
  v_current_stage text;
  v_progress numeric;
  v_days_elapsed integer;
  v_expected_progress numeric;
  v_delta numeric;
  v_status_color text;
  v_display_status text;
  v_last_update date;
  v_stages json;
  v_materials json;
  v_planned_cost numeric;
  v_used_cost numeric;
begin
  select b.* into v_build
  from builds b
  where b.public_token = p_token;

  -- Token nieistniejący LUB portal wyłączony -> ten sam wynik (404 po
  -- stronie klienta), żeby nie zdradzać, że token istnieje.
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

  -- Postęp etapowy — kolejność etapów = kolejność wstawienia planu
  -- materiałowego budowy (ten sam porządek, jakiego używa report-screen
  -- do grupowania po stageName), ukończenie = wpis w build_stage_status.
  -- Zostaje jako informacyjny checklist (JSON "stages") — NIE steruje już
  -- procentem postępu, patrz niżej.
  select json_agg(
    json_build_object(
      'name', s.stage_name,
      'completed', bss.stage_name is not null
    ) order by s.min_id
  )
  into v_stages
  from (
    select stage_name, min(id) as min_id
    from build_material_plan
    where build_id = v_build.id
    group by stage_name
  ) s
  left join build_stage_status bss
    on bss.build_id = v_build.id and bss.stage_name = s.stage_name;

  v_total_stages := coalesce(json_array_length(v_stages), 0);
  select count(*) into v_completed_stages
  from json_array_elements(coalesce(v_stages, '[]'::json)) e
  where (e->>'completed')::boolean is true;

  select count(distinct r.date) into v_days_elapsed
  from reports r
  where r."buildId" = v_build.id;

  -- Postęp z REALNEGO zużycia materiałów (wartość, nie same ilości —
  -- spójne z "Koszty na bieżąco" w panelu admina): wartość zużyta /
  -- wartość zaplanowana, capped na 100%.
  select coalesce(sum(bm.planned * bm."unitPrice"), 0), coalesce(sum(bm.used * bm."unitPrice"), 0)
    into v_planned_cost, v_used_cost
    from build_materials bm
    where bm."buildId" = v_build.id;

  if v_planned_cost > 0 then
    v_progress := least(round((v_used_cost / v_planned_cost) * 100), 100);
  elsif v_total_stages > 0 then
    v_progress := round((v_completed_stages::numeric / v_total_stages) * 100);
  else
    -- Fallback czasowy (brak przypisanej technologii/planu materiałowego).
    v_progress := least(round((coalesce(v_days_elapsed, 0)::numeric / nullif(v_build."durationDays", 0)) * 100), 100);
  end if;

  -- "Aktualny etap" do podtytułu — nadal z checklisty etapów (informacyjne),
  -- niezależnie od tego, skąd wzięty jest sam procent wyżej.
  if v_total_stages > 0 then
    select e->>'name' into v_current_stage
    from json_array_elements(v_stages) with ordinality as t(e, ord)
    where (e->>'completed')::boolean is not true
    order by ord
    limit 1;

    -- Wszystkie etapy ukończone -> pokaż ostatni jako "aktualny".
    if v_current_stage is null then
      select e->>'name' into v_current_stage
      from json_array_elements(v_stages) with ordinality as t(e, ord)
      order by ord desc
      limit 1;
    end if;
  else
    v_current_stage := null;
  end if;

  v_expected_progress := least((coalesce(v_days_elapsed, 0)::numeric / nullif(v_build."durationDays", 0)) * 100, 100);
  v_delta := coalesce(v_progress, 0) - coalesce(v_expected_progress, 0);
  v_status_color := case
    when v_delta >= -5 then 'green'
    when v_delta >= -15 then 'yellow'
    else 'red'
  end;

  -- Etykieta stanu budowy do UI portalu — trzy stany, niezależne od
  -- koloru gauge'a "na czasie/opóźnienie" (ma sens tylko, gdy budowa
  -- faktycznie trwa):
  --  - "zamknieta"    -> builds.status = 'zamknięta' (budowa domknięta,
  --                      ew. PIN-em, patrz "Zamknij i rozlicz budowę"),
  --  - "nierozpoczeta" -> startDate jeszcze nie nadszedł, postęp = 0,
  --  - "aktywna"       -> normalny widok z gauge'em i kolorem wyżej.
  if v_build.status = 'zamknięta' then
    v_display_status := 'zamknieta';
  elsif v_build."startDate" > current_date then
    v_display_status := 'nierozpoczeta';
    v_progress := 0;
    v_current_stage := null;
    v_status_color := null;
  else
    v_display_status := 'aktywna';
  end if;

  select max(r.date) into v_last_update
  from reports r
  where r."buildId" = v_build.id and r.status in ('submitted', 'approved');

  -- Lista materiałów przypisanych do budowy — WYŁĄCZNIE nazwy, alfabetycznie,
  -- bez ilości/jednostek/cen.
  select json_agg(m.name order by m.name)
  into v_materials
  from build_materials bm
  join materials m on m.id = bm."materialId"
  where bm."buildId" = v_build.id;

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
    'currentStageName', v_current_stage,
    'stages', coalesce(v_stages, '[]'::json),
    'materials', coalesce(v_materials, '[]'::json),
    'lastUpdateDate', v_last_update,
    'photosUrl', v_build."photosUrl",
    'contractValue', case when v_build.show_contract_value_to_client then v_build."contractValue" else null end
  );
end;
$$;

-- SECURITY DEFINER + brak GRANT na tabele bazowe dla anon = jedyna droga
-- do tych danych to ta funkcja. `anon` musi móc ją wywołać.
grant execute on function get_public_build(uuid, text) to anon;
