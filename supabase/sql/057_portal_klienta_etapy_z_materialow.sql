-- ============================================================
-- Etapy technologii z powrotem w Portalu Klienta — tym razem procent
-- KAŻDEGO etapu liczony z realnego zużycia materiału tego etapu (jak
-- ogólny procent budowy w 056/057), zamiast ręcznego odznaczania
-- (build_stage_status), które nigdy nie miało UI do klikania.
--
-- Źródło:
--  - planowany koszt etapu = suma (build_material_plan.plannedQuantity ×
--    materials.unitPrice) dla materiałów TEGO etapu (ten sam wzorzec co
--    "Koszt materiałowy planowany razem" w builds-screen.tsx),
--  - zużyty koszt etapu = suma report_materials.cost (realny koszt FIFO
--    z raportów dziennych) dla wpisów oznaczonych tym stage_name.
--
-- Procent etapu = zużyty/planowany × 100 (capped 100, 0 gdy plan = 0).
-- Kolejność etapów = kolejność wstawienia planu materiałowego (jak
-- dotąd). build_stage_status PRZESTAJE być używane w tej funkcji.
--
-- Uruchom PO 056_portal_klienta_postep_z_materialow.sql. Bezpieczne do
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

  select count(distinct r.date) into v_days_elapsed
  from reports r
  where r."buildId" = v_build.id;

  -- Postęp CAŁEJ budowy z realnego zużycia materiałów (wartość zużyta /
  -- zaplanowana, capped 100%) — spójne z "Koszty na bieżąco" w panelu
  -- admina. Obejmuje WSZYSTKIE materiały budowy (z technologii i
  -- "dodatkowe"), stąd liczone z build_materials, nie z samego planu
  -- etapowego. Fallback czasowy tylko gdy budowa nie ma jeszcze żadnego
  -- planu materiałowego (planned_cost = 0).
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

  -- Etapy technologii — TYLKO materiały z planu (build_material_plan),
  -- osobno per etap: planowany koszt (ilość × aktualna cena materiału,
  -- jak plannedCostFor w builds-screen.tsx) i zużyty koszt (suma
  -- realnego kosztu FIFO z report_materials oznaczonych tym etapem).
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
