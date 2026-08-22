-- ============================================================
-- Logowanie (Supabase Auth) + role-świadome RLS.
--
-- Do teraz RLS było CELOWO otwarte (`USING (true)` dla wszystkich, rola
-- `anon`) — MVP dla małego, zaufanego zespołu. Ten plik to zamyka:
-- każda operacja wymaga zalogowania (`authenticated`), a część operacji
-- (ceny, stawki, zamykanie budowy, przyjmowanie dostaw, zarządzanie
-- pracownikami) wymaga roli Admin.
--
-- Model ról: mała firma, JEDNA brygada na JEDNĄ budowę na raz — więc
-- świadomie NIE budujemy tu granulacji "który brygadzista widzi którą
-- budowę". Role są trzy: Admin, Brygadzista, Pracownik (te same, które
-- dziś przełącza ekran "Dev" — ten ekran/switcher znika, rolę odczytuje
-- się teraz z zalogowanego konta).
--
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej całość -> Run
-- PO 001_rpc_functions.sql (ta kolejność ma znaczenie — 001 odwołuje
-- się do assert_role() zdefiniowanej tu; samo tworzenie funkcji w 001
-- nie wymaga, żeby assert_role już istniała, ale ich WYWOŁANIE z apki
-- już tak, więc uruchom oba pliki, zanim ktokolwiek się zaloguje).
-- Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Konta i role
-- ------------------------------------------------------------

do $$ begin
  create type app_role as enum ('Admin', 'Brygadzista', 'Pracownik');
exception when duplicate_object then null; end $$;

-- Jeden wiersz na konto logowania (auth.users). employeeId — tylko dla
-- Brygadzisty/Pracownika, żeby np. "Mój czas" wiedział, czyj to czas;
-- Admin może zostać bez powiązanego pracownika.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role app_role not null default 'Pracownik',
  "employeeId" integer references employees(id) on delete set null,
  "createdAt" timestamp not null default now()
);

alter table profiles enable row level security;

-- RLS same w sobie nie wystarcza — to tylko FILTR wierszy nałożony NA
-- ISTNIEJĄCE uprawnienia. Inne tabele w tym pliku (materials, employees,
-- itd.) już miały GRANT dla "authenticated" z wcześniejszego etapu
-- projektu (Dashboard), więc nikt tego tu nie zauważył — ale `profiles`
-- to nowa tabela, stworzona właśnie w tym pliku, i bez tego GRANT-a
-- każde zapytanie do niej dostaje "permission denied" jeszcze przed tym,
-- jak RLS w ogóle zdąży coś przefiltrować.
grant select, insert, update, delete on profiles to authenticated;

drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
  for select to authenticated
  using (id = auth.uid());

-- Rola aktualnie zalogowanego — `stable` (nie `volatile`), bo w obrębie
-- jednego zapytania/transakcji się nie zmienia; SECURITY DEFINER, żeby
-- odczyt własnej roli w środku (patrz niżej — `profiles_admin_all`)
-- ominął RLS na `profiles`, zamiast przez nie przechodzić. Musi być
-- zdefiniowana PRZED `profiles_admin_all`, bo ta polityka jej używa —
-- inaczej (surowy `exists (select ... from profiles ...)` wprost w
-- USING) polityka odpytuje własną tabelę bez pominięcia RLS, więc
-- Postgres próbuje ponownie zastosować RLS (w tym tę samą politykę) do
-- tego podzapytania → `infinite recursion detected in policy for
-- relation "profiles"` (PostgREST pokazuje to jako 500).
create or replace function app_role()
returns app_role
language sql
security definer
stable
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

grant execute on function app_role() to authenticated;

-- Admin zarządza rolami innych (zakładanie kont — patrz
-- SUPABASE_SETUP.md, sekcja logowania) — reszta widzi tylko siebie.
drop policy if exists "profiles_admin_all" on profiles;
create policy "profiles_admin_all" on profiles
  for all to authenticated
  using (app_role() = 'Admin')
  with check (app_role() = 'Admin');

create or replace function assert_role(allowed app_role[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role;
begin
  v_role := app_role();
  if v_role is null then
    raise exception 'Wymagane zalogowanie.' using errcode = '28000';
  end if;
  if not (v_role = any(allowed)) then
    raise exception 'Brak uprawnień (rola: %, wymagane: %).', v_role, allowed
      using errcode = '42501';
  end if;
end;
$$;

grant execute on function app_role() to authenticated;
grant execute on function assert_role(app_role[]) to authenticated;

-- ------------------------------------------------------------
-- 2. RLS: zdejmujemy stare permisywne polityki, dopisujemy
--    role-świadome. Nazwa starej polityki to zawsze "Dostęp do <tabela>".
-- ------------------------------------------------------------

do $$
declare
  tbl text;
begin
  for tbl in
    select unnest(array[
      'build_material_lots', 'build_materials', 'build_settlement_materials',
      'build_settlements', 'builds', 'employees', 'material_batches',
      'material_orders', 'materials', 'report_extra_costs',
      'report_materials', 'report_people', 'reports', 'stock_movements',
      'teams', 'time_entries'
    ])
  loop
    execute format('drop policy if exists "Dostęp do %s" on %I', tbl, tbl);
    execute format('revoke all on %I from anon', tbl);
  end loop;
end $$;

-- Odczyt: każdy zalogowany widzi wszystko (mała firma, jedna brygada —
-- nie ma sensu dzielić widoczności danych operacyjnych; jedyny wyjątek
-- to "Pracownik widzi tylko swój czas pracy", patrz time_entries niżej).
do $$
declare
  tbl text;
begin
  for tbl in
    select unnest(array[
      'build_material_lots', 'build_materials', 'build_settlement_materials',
      'build_settlements', 'builds', 'employees', 'material_batches',
      'material_orders', 'materials', 'report_extra_costs',
      'report_materials', 'report_people', 'reports', 'stock_movements',
      'teams'
    ])
  loop
    execute format('drop policy if exists "select_authenticated" on %I', tbl);
    execute format(
      'create policy "select_authenticated" on %I for select to authenticated using (true)',
      tbl
    );
  end loop;
end $$;

-- time_entries: Admin/Brygadzista widzą wszystko (jedna brygada — to
-- właśnie oni prowadzą ewidencję); Pracownik widzi tylko swój wiersz.
drop policy if exists "select_authenticated" on time_entries;
create policy "select_time_entries" on time_entries
  for select to authenticated
  using (
    app_role() in ('Admin', 'Brygadzista')
    or "employeeId" = (select "employeeId" from profiles where id = auth.uid())
  );

-- Zapis: tabele, do których klient pisze BEZPOŚREDNIO (nie przez RPC z
-- 001_rpc_functions.sql — te mają własny assert_role() w środku i
-- działają jako SECURITY DEFINER niezależnie od poniższych polityk).
-- Patrz lib/data/*.ts, żeby zweryfikować, co faktycznie idzie wprost:
--   materials.unitPrice (updateMaterialPrice) — Admin
--   employees insert/update (createEmployee/updateEmployeeRate) — Admin
--   material_orders insert/update (createOrder/markOrderOrdered) — Admin
--   builds insert (createBuild) — Admin; update (reopenBuild,
--     updateBuildPhotosUrl) — Admin LUB Brygadzista (link do zdjęć
--     dodaje też brygadzista, z ekranu Raportu)
--   reports update (updateReportStatus / zatwierdzanie) — Admin

create policy "materials_write_admin" on materials
  for update to authenticated
  using (app_role() = 'Admin') with check (app_role() = 'Admin');

create policy "employees_write_admin" on employees
  for all to authenticated
  using (app_role() = 'Admin') with check (app_role() = 'Admin');

create policy "orders_write_admin" on material_orders
  for insert to authenticated with check (app_role() = 'Admin');
create policy "orders_update_admin" on material_orders
  for update to authenticated
  using (app_role() = 'Admin') with check (app_role() = 'Admin');

create policy "builds_insert_admin" on builds
  for insert to authenticated with check (app_role() = 'Admin');
create policy "builds_update_admin_brygadzista" on builds
  for update to authenticated
  using (app_role() in ('Admin', 'Brygadzista'))
  with check (app_role() in ('Admin', 'Brygadzista'));

create policy "reports_update_admin" on reports
  for update to authenticated
  using (app_role() = 'Admin') with check (app_role() = 'Admin');

-- ------------------------------------------------------------
-- 3. Realtime na tabelach raportów — patrz lib/data/use-realtime-sync.ts
--    (rozszerzone o "reports", żeby "Moje raporty"/"Raporty" też żyły
--    na bieżąco, tak jak magazyn/budowy/zamówienia).
-- ------------------------------------------------------------
do $$
declare
  tbl text;
begin
  for tbl in select unnest(array['reports', 'report_materials', 'report_people', 'report_extra_costs'])
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table %I', tbl);
    end if;
  end loop;
end $$;
