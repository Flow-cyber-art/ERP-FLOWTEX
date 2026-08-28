-- ============================================================
-- 1) FIX: decide_leave_request rzucał "column status is of type
--    leave_status but expression is of type text". CASE zbudowany z
--    samych literałów tekstowych domyślnie typuje wynik jako text — w
--    przeciwieństwie do prostego `set status = 'anulowany'` (gdzie
--    pojedynczy literał "unknown" dostaje niejawny cast na typ kolumny),
--    Postgres NIE rzutuje niejawnie wyniku CASE (już typu text) na enum
--    przy przypisaniu. Fix: jawny cast ::leave_status.
--
-- 2) Edycja oczekującego wniosku (zamiast tylko anuluj+złóż nowy) —
--    update_leave_request: ten sam zestaw walidacji co request_leave
--    (dni robocze, nakładanie się terminów), tylko na WŁASNYM,
--    jeszcze nierozpatrzonym wniosku.
--
-- Uruchom PO 049_urlopy.sql. Bezpieczne do wielokrotnego wklejenia.
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

create or replace function decide_leave_request(p_request_id integer, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decider_id integer;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);

  select "employeeId" into v_decider_id from profiles where id = auth.uid();

  update leave_requests
  set
    status = (case when p_approve then 'zatwierdzony' else 'odrzucony' end)::leave_status,
    "decidedBy" = v_decider_id,
    "decidedAt" = now(),
    "updatedAt" = now()
  where id = p_request_id
    and status = 'oczekujący';

  if not found then
    raise exception 'Wniosek nie istnieje lub został już rozpatrzony.';
  end if;
end;
$$;

grant execute on function decide_leave_request(integer, boolean) to authenticated;

create or replace function update_leave_request(
  p_request_id integer,
  p_type leave_type,
  p_date_from date,
  p_date_to date,
  p_note text default null
)
returns leave_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id integer;
  v_business_days integer;
  v_row leave_requests;
begin
  select "employeeId" into v_employee_id from profiles where id = auth.uid();
  if v_employee_id is null then
    raise exception 'Konto nie jest powiązane z pracownikiem — skontaktuj się z Adminem.';
  end if;

  if p_date_to < p_date_from then
    raise exception 'Data końcowa nie może być wcześniejsza niż początkowa.';
  end if;

  v_business_days := count_business_days(p_date_from, p_date_to);
  if v_business_days = 0 then
    raise exception 'Wybrany zakres nie zawiera dni roboczych.';
  end if;

  if exists (
    select 1 from leave_requests
    where "employeeId" = v_employee_id
      and id <> p_request_id
      and status in ('oczekujący', 'zatwierdzony')
      and "dateFrom" <= p_date_to
      and "dateTo" >= p_date_from
  ) then
    raise exception 'W tym terminie masz już zgłoszony wniosek urlopowy.';
  end if;

  update leave_requests
  set
    type = p_type,
    "dateFrom" = p_date_from,
    "dateTo" = p_date_to,
    "businessDays" = v_business_days,
    note = nullif(trim(p_note), ''),
    "updatedAt" = now()
  where id = p_request_id
    and "employeeId" = v_employee_id
    and status = 'oczekujący'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Wniosek nie istnieje, nie należy do Ciebie lub został już rozpatrzony.';
  end if;

  return v_row;
end;
$$;

grant execute on function update_leave_request(integer, leave_type, date, date, text) to authenticated;
