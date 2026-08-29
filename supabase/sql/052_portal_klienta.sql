-- ============================================================
-- PORTAL KLIENTA — publiczny, read-only podgląd postępu budowy (QR /
-- link publiczny), bez logowania. Patrz specyfikacja: Portal Klienta —
-- podgląd postępu budowy.
--
-- Zasada: whitelist, nie blacklist — RPC `get_public_build` zwraca
-- WYŁĄCZNIE jawnie wymienione pola. Rola `anon` nie ma i nie dostaje
-- bezpośredniego dostępu do żadnej tabeli bazowej — cały dostęp idzie
-- przez tę jedną funkcję SECURITY DEFINER.
-- ============================================================

create extension if not exists pgcrypto schema extensions;

alter table builds add column if not exists public_token uuid unique default gen_random_uuid();
alter table builds add column if not exists public_access_enabled boolean not null default false;
alter table builds add column if not exists public_pin_hash text;
alter table builds add column if not exists show_contract_value_to_client boolean not null default false;

-- Istniejące budowy nie miały jeszcze tokenu przed dodaniem kolumny
-- (DEFAULT działa tylko dla nowych wierszy przy ADD COLUMN z wartością
-- stałą, ale gen_random_uuid() liczy się raz dla wszystkich — dobija to
-- explicit UPDATE-em, żeby każda budowa miała odrębny token).
update builds set public_token = gen_random_uuid() where public_token is null;

-- Ustawienia udostępniania budowy klientowi (toggle/PIN/regeneracja
-- tokenu) idą wyłącznie przez poniższe funkcje SECURITY DEFINER — nie
-- przez bezpośredni UPDATE z klienta, więc RLS na `builds` (istniejąca
-- polityka "builds_update_admin_brygadzista", 003_auth_rls.sql) nie
-- wymaga tu żadnej zmiany.

-- Regeneracja tokenu (unieważnienie starego linku) — jedno kliknięcie.
create or replace function regenerate_public_token(p_build_id integer)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_new_token uuid := gen_random_uuid();
begin
  if app_role() <> 'Admin' then
    raise exception 'Brak uprawnień.';
  end if;

  update builds set public_token = v_new_token where id = p_build_id;
  if not found then
    raise exception 'Budowa nie istnieje.';
  end if;

  return v_new_token;
end;
$$;

grant execute on function regenerate_public_token(integer) to authenticated;

-- Ustawienie/wyłączenie PIN-u portalu klienta (hash po stronie bazy —
-- PIN w postaci jawnej nigdy nie trafia do żadnej tabeli).
create or replace function set_public_portal_pin(p_build_id integer, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if app_role() <> 'Admin' then
    raise exception 'Brak uprawnień.';
  end if;

  update builds
  set public_pin_hash = case when p_pin is null or p_pin = '' then null else crypt(p_pin, gen_salt('bf')) end
  where id = p_build_id;

  if not found then
    raise exception 'Budowa nie istnieje.';
  end if;
end;
$$;

grant execute on function set_public_portal_pin(integer, text) to authenticated;

-- ------------------------------------------------------------
-- Widok publiczny (whitelist) — wywoływany WYŁĄCZNIE przez rolę anon,
-- bez sesji. Nigdy nie zwraca kosztów, marży, danych pracowników ani
-- ilości materiałów.
-- ------------------------------------------------------------
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

  -- Postęp etapowy (5.1) — kolejność etapów = kolejność wstawienia planu
  -- materiałowego budowy (ten sam porządek, jakiego używa report-screen
  -- do grupowania po stageName), ukończenie = wpis w build_stage_status.
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

  if v_total_stages > 0 then
    v_progress := round((v_completed_stages::numeric / v_total_stages) * 100);

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
    -- 5.2 fallback czasowy (brak przypisanej technologii/planu).
    v_progress := least(round((coalesce(v_days_elapsed, 0)::numeric / nullif(v_build."durationDays", 0)) * 100), 100);
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
  -- 5.3 (kolor gauge'a "na czasie/opóźnienie" ma sens tylko, gdy budowa
  -- faktycznie trwa):
  --  - "zamknieta"    -> builds.status = 'zamknięta' (budowa domknięta,
  --                      ew. PIN-em, patrz "Zamknij i rozlicz budowę"),
  --  - "nierozpoczeta" -> startDate jeszcze nie nadszedł, postęp = 0,
  --  - "aktywna"       -> normalny widok z gauge'em i kolorem 5.3.
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
    'lastUpdateDate', v_last_update,
    'photosUrl', v_build."photosUrl",
    'contractValue', case when v_build.show_contract_value_to_client then v_build."contractValue" else null end
  );
end;
$$;

-- SECURITY DEFINER + brak GRANT na tabele bazowe dla anon = jedyna droga
-- do tych danych to ta funkcja. `anon` musi móc ją wywołać.
grant execute on function get_public_build(uuid, text) to anon;
