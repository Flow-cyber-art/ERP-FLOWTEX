-- Czyszczenie bazy do stanu testowego: zostają TYLKO konta logowania
-- (`auth.users`, żeby dało się zalogować hasłem, którego już używasz) i
-- `settings` (jednowierszowy globalny config appki — kmRate; jego
-- wyczyszczenie zepsułoby appkę, bo id jest tam stałym `true`, nie
-- danymi testowymi).
--
-- WAŻNE — poprawka po realnym incydencie: pierwsza wersja tego skryptu
-- NIE wymieniała `profiles` (tabela z rolami Admin/Brygadzista/Pracownik,
-- patrz supabase/sql/003_auth_rls.sql) w liście TRUNCATE, zakładając że
-- zostanie nietknięta. To błędne założenie — `profiles."employeeId"`
-- ma FK do `employees(id)`, a `TRUNCATE employees CASCADE` w Postgresie
-- IGNORUJE zdefiniowaną akcję `ON DELETE SET NULL` na takim kluczu i
-- zawsze kasuje CAŁY wiersz w tabeli referencującej — więc czyszczenie
-- `employees` kasowało przy okazji wszystkie wiersze w `profiles`,
-- łącznie z rolą Admina głównego konta (objaw: "Konto zalogowane, ale
-- bez przypisanej roli" zaraz po reset+deploy).
--
-- Naprawa: `profiles` jest teraz JAWNIE w liście TRUNCATE (i tak
-- zostałaby wyczyszczona przez CASCADE, więc lepiej to nazwać wprost),
-- a zaraz po TRUNCATE skrypt sam odtwarza wiersz Admina dla konta
-- głównego (PROTECTED_ADMIN_EMAIL, patrz
-- supabase/functions/admin-users/index.ts — domyślnie admin@flowtex.pl).
--
-- Wszystkie POZOSTAŁE konta logowania (Brygadzista/Pracownik, dodatkowi
-- Admini) TRACĄ swój wiersz w `profiles`, czyli TRACĄ przypisaną rolę —
-- to nieuniknione przy czyszczeniu `employees`/`teams`. Po tym skrypcie
-- trzeba im rolę nadać ponownie: Zespół → Konta logowania → Edytuj.
-- `auth.users` (loginy/hasła) same w sobie nie są ruszane — konta nie
-- znikają, tylko chwilowo wracają do stanu "zalogowany, bez roli".
--
-- Kasuje WSZYSTKO inne, w tym `technologies` / `technology_stages` /
-- `technology_materials`, zgodnie z prośbą. RESTART IDENTITY zeruje
-- też liczniki serial (nowe rekordy znów zaczną się od id=1).
--
-- UWAGA: nieodwracalne. Zrób najpierw backup (pg_dump / snapshot
-- Supabase), zwłaszcza jeśli baza nie jest czysto testowa.
--
-- Uruchom całość jako jedną transakcję (psql -f, albo w Supabase SQL
-- Editor — tam BEGIN/COMMIT można pominąć, edytor i tak owija w
-- transakcję, ale zostawiam je jawnie dla psql/CLI).

BEGIN;

TRUNCATE TABLE
  -- role kont logowania (patrz uwaga wyżej — i tak ginie przez CASCADE
  -- z employees, więc jest tu wymieniona jawnie)
  profiles,
  -- kadry / brygady
  employees,
  teams,
  -- magazyn
  materials,
  material_batches,
  stock_movements,
  material_orders,
  -- budowy i ich rozliczenia
  builds,
  build_materials,
  build_material_lots,
  build_material_returns,
  build_material_plan,
  build_settlements,
  build_settlement_materials,
  -- raporty dzienne
  reports,
  report_materials,
  report_people,
  report_extra_costs,
  time_entries,
  -- technologie (receptury)
  technologies,
  technology_stages,
  technology_materials,
  build_technology_snapshot,
  -- zamówienia (moduł orders/order_items)
  orders,
  order_items
RESTART IDENTITY CASCADE;

-- Odtwórz od razu rolę Admin dla konta głównego, żeby po tym skrypcie
-- dało się normalnie zalogować i zarządzać resztą (m.in. przez Zespół →
-- Konta logowania nadać role pozostałym kontom). Jeśli zmieniłeś email
-- głównego admina, podmień go też tutaj.
insert into profiles (id, role, "employeeId")
select id, 'Admin', null
from auth.users
where email = 'admin@flowtex.pl'
on conflict (id) do update set role = 'Admin';

COMMIT;
