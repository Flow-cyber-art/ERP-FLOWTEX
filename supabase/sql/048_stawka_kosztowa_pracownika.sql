-- ============================================================
-- Druga stawka pracownika: "costRate" — stawka kosztowa doliczana do
-- kosztów budowy (narzuty: ZUS pracodawcy, urlopy, sprzęt, nadzór), obok
-- istniejącej "hourlyRate", która pozostaje stawką wypłatową. Na razie
-- to WYŁĄCZNIE nowa kolumna + jej konfiguracja w Admin → Zespół — nie
-- zmienia jeszcze, której stawki używają kalkulacje kosztu robocizny
-- (001/013/033/040/043_*.sql nadal liczą po "hourlyRate").
--
-- Chroniona tak samo jak "hourlyRate" (patrz 044_ukryj_stawki_
-- pracownikow.sql) — kolumnowy REVOKE + get_employees() zwraca realną
-- wartość tylko dla Admina, w przeciwnym razie null.
--
-- Uruchom PO 044_ukryj_stawki_pracownikow.sql. Bezpieczne do
-- wielokrotnego wklejenia.
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

alter table employees add column if not exists "costRate" decimal(10, 2);

revoke select ("costRate") on employees from authenticated;

create or replace function get_employees()
returns table (
  id integer,
  name text,
  role employee_role,
  "hourlyRate" decimal(10, 2),
  "costRate" decimal(10, 2)
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
    case when app_role() = 'Admin' then e."costRate" else null end as "costRate"
  from employees e
  order by e.name;
$$;

grant execute on function get_employees() to authenticated;

-- Update idzie zwykłym `update employees set "costRate" = ...` (jak
-- dotychczasowe updateEmployeeRate) — chroni go istniejąca RLS policy
-- "employees_write_admin" (003_auth_rls.sql), więc osobna RPC do zapisu
-- nie jest potrzebna.
