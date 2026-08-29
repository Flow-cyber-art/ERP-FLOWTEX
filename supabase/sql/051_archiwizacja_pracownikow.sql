-- ============================================================
-- Archiwizacja pracownika — ten sam wzorzec co materiały
-- (setMaterialActive/showArchivedMaterials w warehouse-screen.tsx):
-- kolumna "active" zamiast usuwania wiersza (pracownik ma historię —
-- raporty, wpisy czasu, urlopy — więc twarde usunięcie byłoby stratą
-- danych i połamałoby FK). Domyślnie true; archiwizacja = active=false,
-- przywrócenie = active=true, ta sama funkcja w obie strony.
--
-- "active" NIE jest wrażliwe jak stawki (044/048) — widoczne dla
-- każdego zalogowanego, tak jak name/role, żeby dało się filtrować listy
-- też tam, gdzie nie tylko Admin widzi pracowników.
--
-- Uruchom PO 050_edycja_urlopu_i_fix_decyzji.sql. Bezpieczne do
-- wielokrotnego wklejenia.
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

alter table employees add column if not exists "active" boolean not null default true;

-- CREATE OR REPLACE nie pozwala zmienić kształtu wiersza zwracanego przez
-- funkcję z OUT-parametrami — trzeba najpierw usunąć starą wersję.
drop function if exists get_employees();

create or replace function get_employees()
returns table (
  id integer,
  name text,
  role employee_role,
  "hourlyRate" decimal(10, 2),
  "costRate" decimal(10, 2),
  "leaveDaysPerYear" integer,
  "active" boolean
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
    e."leaveDaysPerYear",
    e."active"
  from employees e
  order by e.name;
$$;

grant execute on function get_employees() to authenticated;
