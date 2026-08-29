-- ============================================================
-- Portal Klienta: procent etapu pokazywał 0% mimo realnego zużycia
-- materiału (Rozliczenie budowy w panelu admina liczyło je poprawnie).
--
-- Przyczyna: planowany koszt etapu (`s.planned_cost` w get_public_build,
-- patrz 057/059) liczył cenę materiału WYŁĄCZNIE przez
-- `build_material_plan.linked_material_id` — kolumnę, którą Admin
-- ustawia RĘCZNIE per pozycja receptury technologii (zakładka
-- Technologie). Jeśli nikt tego nie zrobił dla danej technologii,
-- `linked_material_id` zostaje puste dla WSZYSTKICH jej materiałów →
-- planned_cost = 0 dla KAŻDEGO etapu → percent zawsze 0%/"Zaplanowane",
-- niezależnie od tego, ile faktycznie zużyto (co brygadzista realnie
-- raportuje po prawdziwym materiale z magazynu, więc "Rozliczenie"
-- w panelu admina — liczone z report_materials.cost, bez udziału
-- linked_material_id — pokazuje poprawne kwoty).
--
-- Naprawa: gdy `linked_material_id` jest puste, dopasuj cenę materiału
-- PO NAZWIE (normalize_material_name — ta sama funkcja co w receive_
-- order/receive_material_order, 045_ujednolic_dopasowanie_materialu.sql,
-- odpowiednik JS-owego normalizeMaterialName używanego już w
-- contexts/app-data.tsx do wyznaczenia stage_name raportowanych
-- materiałów). Priorytet: jawny link, potem dopasowanie po nazwie.
--
-- Uruchom PO 059_portal_klienta_zdjecia_i_notatki.sql (i po
-- 045_ujednolic_dopasowanie_materialu.sql, skąd bierze
-- normalize_material_name — jeśli już w bazie, nic dodatkowego nie
-- trzeba). Bezpieczne do wielokrotnego wklejenia. Jak uruchomić:
-- Supabase Dashboard -> SQL Editor -> wklej całość -> Run.
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
  v_technology_name text;
  v_photos json;
  v_notes json;
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
  -- admina. Fallback czasowy tylko gdy budowa nie ma jeszcze żadnego
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

  -- Etapy technologii — planowany koszt etapu (build_material_plan × cena
  -- materiału, dopasowanego jawnym linkiem albo PO NAZWIE gdy link jest
  -- pusty — patrz komentarz na górze pliku) vs zużyty koszt etapu (suma
  -- realnego kosztu FIFO z report_materials oznaczonych tym stage_name).
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
      sum(p.planned_quantity * coalesce(
        (select m."unitPrice" from materials m where m.id = p.linked_material_id),
        (select m."unitPrice" from materials m
          where normalize_material_name(m.name) = normalize_material_name(p.material_name)
          limit 1),
        0
      )) as planned_cost
    from build_material_plan p
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

  -- Nazwa technologii — do karty "Zastosowana technologia" (bez opisu,
  -- bo receptura go nie ma; samo `name` wystarcza i nic nie zmyśla).
  select technology_name into v_technology_name
  from build_technology_snapshot
  where build_id = v_build.id;

  -- Zdjęcia — WYŁĄCZNIE gdy Admin włączył udostępnianie dla tej budowy.
  -- Front buduje miniaturkę z driveFileId (folder ma "anyone with the
  -- link: reader" ustawione przy tworzeniu), tu tylko id + data.
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

  -- Notatki brygadzisty — WYŁĄCZNIE gdy Admin włączył udostępnianie dla
  -- tej budowy, i wyłącznie z raportów zatwierdzonych (submitted jeszcze
  -- może się zmienić/zostać odrzucony).
  if v_build.show_notes_to_client then
    select json_agg(
      json_build_object('date', n.date, 'note', n.note) order by n.date desc
    )
    into v_notes
    from (
      select date, note from reports
      where "buildId" = v_build.id and status = 'approved'
        and note is not null and length(trim(note)) > 0
      order by date desc
      limit 10
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
    'lastUpdateDate', v_last_update,
    'photosUrl', v_build."photosUrl",
    'contractValue', case when v_build.show_contract_value_to_client then v_build."contractValue" else null end
  );
end;
$$;

-- SECURITY DEFINER + brak GRANT na tabele bazowe dla anon = jedyna droga
-- do tych danych to ta funkcja. `anon` musi móc ją wywołać.
grant execute on function get_public_build(uuid, text) to anon;
