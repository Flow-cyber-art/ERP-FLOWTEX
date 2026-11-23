-- ============================================================
-- 118: Uprawnienia — łatanie luk znalezionych w testach E2E (23.11.2026)
--   SEC   : get_employees / get_time_entries wykonywalne BEZ logowania (anon)
--           → imiona, nazwiska i cały rejestr godzin pracy dostępne publicznie.
--   SEC-2 : stawki (hourlyRate, costRate) czytelne wprost z tabel employees
--           i time_entries dla KAŻDEGO zalogowanego (044 maskował je tylko w RPC).
--   F8    : get_time_entries (SECURITY DEFINER) oddawał Pracownikowi godziny
--           wszystkich osób — RLS tabeli był omijany.
--   F15   : Brygadzista mógł UPDATE dowolnej kolumny builds (np. contractValue).
--           Jedyne, czego potrzebuje aplikacja, to link do zdjęć → osobne RPC.
--   F16   : decide_leave_request pozwalał zatwierdzić WŁASNY wniosek.
--   Oferty: INSERT offers / zapis offer_items dozwolony dla każdego zalogowanego.
--
-- Wszystko w jednej transakcji. Idempotentne (można uruchomić ponownie).
-- ============================================================
BEGIN;

-- ---------- 1. Funkcje: domyślnie BEZ dostępu dla anon/PUBLIC ----------
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
-- Anon potrzebuje tylko portalu klienta oraz funkcji wołanych w politykach RLS
-- (zwracają NULL/false dla niezalogowanego, nie ujawniają danych).
GRANT EXECUTE ON FUNCTION get_public_build(uuid, text)      TO anon;
GRANT EXECUTE ON FUNCTION app_role()                        TO anon;
GRANT EXECUTE ON FUNCTION is_superadmin()                   TO anon;
GRANT EXECUTE ON FUNCTION is_subcontractor_lead()           TO anon;
GRANT EXECUTE ON FUNCTION my_subcontractor_team_ids()       TO anon;
GRANT EXECUTE ON FUNCTION my_subcontractor_team(integer)    TO anon;
-- Nowe funkcje też bez anon/PUBLIC, dopóki ktoś świadomie nie nada.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- ---------- 2. get_employees: tylko zalogowani; Pracownik — tylko siebie ----------
CREATE OR REPLACE FUNCTION public.get_employees()
 RETURNS TABLE(id integer, name text, role employee_role, "hourlyRate" numeric, "costRate" numeric, "leaveDaysPerYear" integer, active boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select e.id, e.name, e.role,
    case when app_role() = 'Admin' then e."hourlyRate" else null end,
    case when app_role() = 'Admin' then e."costRate"   else null end,
    e."leaveDaysPerYear", e."active"
  from employees e
  where auth.uid() is not null
    and (
      app_role() in ('Admin', 'Brygadzista')
      or e.id = (select p."employeeId" from profiles p where p.id = auth.uid())
    )
  order by e.name;
$function$;

-- ---------- 3. get_time_entries: tylko zalogowani; Pracownik — tylko swoje ----------
CREATE OR REPLACE FUNCTION public.get_time_entries()
 RETURNS TABLE(id integer, date date, "buildId" integer, "employeeId" integer, hours numeric, start time without time zone, "end" time without time zone, "hourlyRate" numeric, "costRate" numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select t.id, t.date, t."buildId", t."employeeId", t.hours, t.start, t."end",
    case when app_role() = 'Admin' then t."hourlyRate" else null end,
    case when app_role() = 'Admin' then t."costRate"   else null end
  from time_entries t
  where auth.uid() is not null
    and (
      app_role() in ('Admin', 'Brygadzista')
      or t."employeeId" = (select p."employeeId" from profiles p where p.id = auth.uid())
    )
  order by t.date desc;
$function$;
REVOKE EXECUTE ON FUNCTION get_employees(), get_time_entries() FROM PUBLIC, anon;

-- ---------- 4. Stawki: bez odczytu wprost z tabel ----------
-- Odczyt stawek wyłącznie przez get_employees / get_time_entries (maskowane
-- dla nie-Admina). Zapis (UPDATE/INSERT) zostaje — pilnują go polityki RLS.
REVOKE SELECT ON employees FROM authenticated, anon;
GRANT  SELECT (id, name, role, "userId", active, "createdAt", "updatedAt", "leaveDaysPerYear")
  ON employees TO authenticated;
REVOKE SELECT ON time_entries FROM authenticated, anon;
GRANT  SELECT (id, date, "buildId", "employeeId", hours, start, "end")
  ON time_entries TO authenticated;

-- Pracownik widzi w tabeli employees tylko siebie.
DROP POLICY IF EXISTS select_authenticated ON employees;
DROP POLICY IF EXISTS employees_select_scoped ON employees;
CREATE POLICY employees_select_scoped ON employees FOR SELECT TO authenticated
  USING (
    app_role() in ('Admin', 'Brygadzista')
    or id = (select p."employeeId" from profiles p where p.id = auth.uid())
  );

-- ---------- 5. Budowy: zapis tylko Admin; link do zdjęć przez RPC ----------
DROP POLICY IF EXISTS builds_update_admin_brygadzista ON builds;
DROP POLICY IF EXISTS builds_update_admin ON builds;
CREATE POLICY builds_update_admin ON builds FOR UPDATE TO authenticated
  USING (app_role() = 'Admin') WITH CHECK (app_role() = 'Admin');

CREATE OR REPLACE FUNCTION public.set_build_photos_url(p_build_id integer, p_photos_url text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);
  update builds
     set "photosUrl" = nullif(trim(coalesce(p_photos_url, '')), ''),
         "updatedAt" = now()
   where id = p_build_id;
  if not found then raise exception 'Budowa nie istnieje.'; end if;
end;
$function$;
REVOKE EXECUTE ON FUNCTION set_build_photos_url(integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION set_build_photos_url(integer, text) TO authenticated;

-- ---------- 6. Urlopy: nikt nie decyduje o własnym wniosku ----------
CREATE OR REPLACE FUNCTION public.decide_leave_request(p_request_id integer, p_approve boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_decider_id integer;
  v_owner_id integer;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);
  select "employeeId" into v_decider_id from profiles where id = auth.uid();
  select "employeeId" into v_owner_id from leave_requests where id = p_request_id;
  if v_owner_id is not null and v_decider_id is not null and v_owner_id = v_decider_id then
    raise exception 'Nie możesz rozpatrzyć własnego wniosku urlopowego.';
  end if;
  update leave_requests
     set status = (case when p_approve then 'zatwierdzony' else 'odrzucony' end)::leave_status,
         "decidedBy" = v_decider_id,
         "decidedAt" = now(),
         "updatedAt" = now()
   where id = p_request_id and status = 'oczekujący';
  if not found then raise exception 'Wniosek nie istnieje lub został już rozpatrzony.'; end if;
end;
$function$;

-- ---------- 7. Oferty: zapis tylko Admin ----------
DROP POLICY IF EXISTS insert_authenticated ON offers;
DROP POLICY IF EXISTS insert_admin ON offers;
CREATE POLICY insert_admin ON offers FOR INSERT TO authenticated
  WITH CHECK (app_role() = 'Admin');
DROP POLICY IF EXISTS write_authenticated ON offer_items;
DROP POLICY IF EXISTS write_admin ON offer_items;
CREATE POLICY write_admin ON offer_items FOR ALL TO authenticated
  USING (app_role() = 'Admin') WITH CHECK (app_role() = 'Admin');
REVOKE ALL ON offers, offer_items FROM anon;

COMMIT;

-- Kontrola (jako anon powinno zwrócić błąd uprawnień):
--   select * from get_employees();   select * from get_time_entries();
