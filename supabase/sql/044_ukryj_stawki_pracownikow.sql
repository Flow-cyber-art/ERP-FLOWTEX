-- ============================================================
-- Ukryj stawkę godzinową (employees."hourlyRate") przed każdym, kto nie
-- jest Adminem — docs/AUDYT_BEZPIECZENSTWO_WYDAJNOSC_ERP.md, punkt A1.
--
-- Problem: RLS na `employees` filtruje WIERSZE, nie KOLUMNY —
-- "select_authenticated ... using (true)" (003_auth_rls.sql) pozwala
-- każdemu zalogowanemu kontu (Pracownik, Brygadzista, Admin) czytać CAŁY
-- wiersz, łącznie ze stawką godzinową kolegów. `lib/data/employees.ts`
-- pobiera ją wprost (`select id, name, role, hourlyRate`), a
-- `contexts/app-data.tsx` ładuje tę listę dla KAŻDEGO zalogowanego konta
-- przy starcie aplikacji, niezależnie od roli.
--
-- Naprawa: kolumnowy REVOKE (Postgres pozwala nadawać/odbierać
-- uprawnienia per kolumna, nie tylko per tabela) — "hourlyRate" przestaje
-- być czytelna wprost przez rolę `authenticated` dla KOGOKOLWIEK
-- (surowe zapytanie REST/JS o tę kolumnę dostanie "permission denied for
-- column hourlyRate", niezależnie od profiles.role — Postgres nie zna
-- app-owej roli, zna tylko rolę połączenia). Jedyna droga do realnej
-- wartości to nowa funkcja `get_employees()` (SECURITY DEFINER, więc
-- omija REVOKE tak samo jak inne uprzywilejowane RPC w tym module) —
-- zwraca prawdziwą stawkę tylko gdy `app_role() = 'Admin'`, w przeciwnym
-- razie `null`. `id`/`name`/`role` zostają widoczne dla wszystkich jak
-- dotąd (potrzebne np. do wyboru osób w raporcie dziennym) — to WYŁĄCZNIE
-- stawka jest tu wrażliwa, nie tożsamość pracownika.
--
-- Wszystkie dotychczasowe miejsca czytające hourlyRate (settlement-screen,
-- builds-screen, admin-screen) są i tak dostępne tylko dla roli Admin na
-- poziomie UI (app/(tabs)/index.tsx) — dla pozostałych ról `hourlyRate`
-- będzie po prostu `null`, co istniejące wzorce (`employee?.hourlyRate ||
-- 0`, `Number(e.hourlyRate)`) już bezpiecznie obsługują jako 0.
--
-- Uruchom PO 003_auth_rls.sql. Bezpieczne do wielokrotnego wklejenia.
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

revoke select ("hourlyRate") on employees from authenticated;

create or replace function get_employees()
returns table (
  id integer,
  name text,
  role employee_role,
  "hourlyRate" decimal(10, 2)
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
    case when app_role() = 'Admin' then e."hourlyRate" else null end as "hourlyRate"
  from employees e
  order by e.name;
$$;

grant execute on function get_employees() to authenticated;
