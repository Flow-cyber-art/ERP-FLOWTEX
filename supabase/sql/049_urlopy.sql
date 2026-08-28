-- ============================================================
-- Moduł urlopów — wnioski pracownika, zatwierdzanie przez Brygadzistę/
-- Admina, pula dni urlopowych per pracownik (do przyszłego rozliczenia
-- tygodniowego/miesięcznego/rocznego).
--
-- Model zgodny z resztą apki (patrz 003_auth_rls.sql): mała firma, jedna
-- brygada — więc "kto zatwierdza" to każdy Brygadzista LUB Admin, nie
-- przypisanie 1:1 pracownik→brygadzista (tego przypisania w ogóle nie ma
-- w modelu danych). Tak samo jak dziś każdy Brygadzista/Admin widzi
-- WSZYSTKIE wpisy czasu pracy (select_time_entries), a nie tylko "swojej"
-- brygady.
--
-- Zapis idzie WYŁĄCZNIE przez RPC (jak submit_daily_report w
-- 001_rpc_functions.sql) — nie przez surowe insert/update z klienta —
-- bo trzeba: (1) odczytać employeeId z profilu wywołującego (klient nie
-- może sam podać cudzego employeeId), (2) policzyć dni robocze po
-- stronie serwera (nie ufamy wyliczeniu z klienta), (3) pilnować, że
-- tylko Brygadzista/Admin zmienia status, a pracownik anuluje wyłącznie
-- WŁASNY, jeszcze nierozpatrzony wniosek.
--
-- Uruchom PO 048_stawka_kosztowa_pracownika.sql. Bezpieczne do
-- wielokrotnego wklejenia.
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

do $$ begin
  create type leave_type as enum (
    'wypoczynkowy', 'na_zadanie', 'L4', 'okolicznościowy', 'bezpłatny'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type leave_status as enum (
    'oczekujący', 'zatwierdzony', 'odrzucony', 'anulowany'
  );
exception when duplicate_object then null; end $$;

-- Pula dni urlopowych na rok — ustawiana ręcznie przez Admina (HR),
-- bo staż pracy (który w Polsce decyduje o 20 vs 26 dniach) nie jest
-- nigdzie w apce śledzony. Domyślnie 26 (najczęstszy przypadek).
alter table employees add column if not exists "leaveDaysPerYear" integer not null default 26;

create table if not exists leave_requests (
  id serial primary key,
  "employeeId" integer not null references employees(id) on delete cascade,
  type leave_type not null,
  "dateFrom" date not null,
  "dateTo" date not null,
  "businessDays" integer not null check ("businessDays" > 0),
  status leave_status not null default 'oczekujący',
  note text,
  "decidedBy" integer references employees(id) on delete set null,
  "decidedAt" timestamp,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now(),
  constraint leave_requests_date_order check ("dateTo" >= "dateFrom")
);

create index if not exists leave_requests_employee_idx on leave_requests ("employeeId");

-- "leaveDaysPerYear" NIE jest wrażliwa jak hourlyRate/costRate (patrz
-- 044/048) — pracownik musi widzieć własną pulę na ekranie Urlopy, więc
-- rozszerzamy get_employees() o tę kolumnę bez ukrywania (widoczna dla
-- każdego zalogowanego, tak jak name/role).
-- CREATE OR REPLACE nie pozwala zmienić kształtu wiersza zwracanego przez
-- funkcję z OUT-parametrami — trzeba najpierw usunąć starą wersję (z 048).
drop function if exists get_employees();

create or replace function get_employees()
returns table (
  id integer,
  name text,
  role employee_role,
  "hourlyRate" decimal(10, 2),
  "costRate" decimal(10, 2),
  "leaveDaysPerYear" integer
)
language sql
security definer
stable
set search_path = public
as $$
  select
    e.id,
    e.name,
    e.role,
    case when app_role() = 'Admin' then e."hourlyRate" else null end as "hourlyRate",
    case when app_role() = 'Admin' then e."costRate" else null end as "costRate",
    e."leaveDaysPerYear"
  from employees e
  order by e.name;
$$;

grant execute on function get_employees() to authenticated;

alter table leave_requests enable row level security;
grant select on leave_requests to authenticated;

-- Odczyt: Admin/Brygadzista widzą wszystkie wnioski (tak jak wszystkie
-- inne dane operacyjne w tej apce), Pracownik tylko własne — ten sam
-- wzorzec co "select_time_entries" w 003_auth_rls.sql.
drop policy if exists "select_leave_requests" on leave_requests;
create policy "select_leave_requests" on leave_requests
  for select to authenticated
  using (
    app_role() in ('Admin', 'Brygadzista')
    or "employeeId" = (select "employeeId" from profiles where id = auth.uid())
  );

-- Dni robocze (pon–pt) w zakresie dat włącznie z granicami — urlop w
-- Polsce liczy się w dniach roboczych, nie kalendarzowych.
create or replace function count_business_days(p_from date, p_to date)
returns integer
language sql
immutable
as $$
  select count(*)::integer
  from generate_series(p_from, p_to, interval '1 day') as d
  where extract(isodow from d) < 6;
$$;

create or replace function request_leave(
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
  if app_role() is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;

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
      and status in ('oczekujący', 'zatwierdzony')
      and "dateFrom" <= p_date_to
      and "dateTo" >= p_date_from
  ) then
    raise exception 'W tym terminie masz już zgłoszony wniosek urlopowy.';
  end if;

  insert into leave_requests ("employeeId", type, "dateFrom", "dateTo", "businessDays", note)
  values (v_employee_id, p_type, p_date_from, p_date_to, v_business_days, nullif(trim(p_note), ''))
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function request_leave(leave_type, date, date, text) to authenticated;

create or replace function cancel_leave_request(p_request_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id integer;
begin
  select "employeeId" into v_employee_id from profiles where id = auth.uid();

  update leave_requests
  set status = 'anulowany', "updatedAt" = now()
  where id = p_request_id
    and status = 'oczekujący'
    and "employeeId" = v_employee_id;

  if not found then
    raise exception 'Wniosek nie istnieje, nie należy do Ciebie lub został już rozpatrzony.';
  end if;
end;
$$;

grant execute on function cancel_leave_request(integer) to authenticated;

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
    status = case when p_approve then 'zatwierdzony' else 'odrzucony' end,
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

-- Realtime — żeby zatwierdzenie/odrzucenie było widoczne u pracownika (i
-- nowy wniosek u tych, którzy go zatwierdzają) bez ręcznego odświeżania,
-- patrz lib/data/use-realtime-sync.ts.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'leave_requests'
  ) then
    alter publication supabase_realtime add table leave_requests;
  end if;
end $$;
