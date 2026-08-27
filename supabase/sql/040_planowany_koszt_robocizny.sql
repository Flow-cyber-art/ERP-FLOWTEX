-- ------------------------------------------------------------
-- Planowany koszt robocizny (analogia do planu materiałowego z Fazy 2) —
-- do tej pory istniał tylko koszt RZECZYWISTY (time_entries -> laborCost
-- w close_build/build_settlements). Plan wymaga wiedzieć, KTO (skład
-- brygady przypisanej do budowy), więc dochodzi tabela `team_members`
-- (do dziś `teams` miała tylko kierownika, bez listy członków — ani
-- jednej polityki zapisu, ani wiersza UI, które by z niej korzystały).
--
-- Wzór (ustalony z właścicielem):
--   plannedLaborCost = SUM(hourlyRate członków brygady) × plannedHoursPerDay × durationDays
--
-- `durationDays` na `builds` już istnieje i już oznacza dni ROBOCZE (patrz
-- builds-screen.tsx: `durationDays * workdayHours` do dziś liczy się tam
-- z globalnej dniówki) — zostaje bez zmian nazwy, tylko dochodzi
-- `plannedHoursPerDay` per budowa (domyślnie 8), żeby dało się to
-- policzyć bez zależności od globalnego ustawienia "Dniówka".
-- ------------------------------------------------------------

/* ============================================================
 * 1) team_members — skład brygady. Nowa tabela = snake_case kolumn
 *    (jak technologies/build_material_plan), poza createdAt (camelCase,
 *    z premedytacją, ten sam powód co w 005_faza1_technologie.sql).
 * ============================================================ */

create table if not exists team_members (
  team_id integer not null references teams(id) on delete cascade,
  employee_id integer not null references employees(id) on delete cascade,
  "createdAt" timestamp not null default now(),
  primary key (team_id, employee_id)
);

alter table builds
  add column if not exists "plannedHoursPerDay" decimal(5, 2) not null default 8;

/* ============================================================
 * 2) RLS — team_members: ten sam wzorzec co reszta danych operacyjnych
 *    (odczyt: każdy zalogowany; zapis: Admin) — patrz 003_auth_rls.sql.
 *    `teams` miała odczyt już od 003, ale NIGDY zapisu — dopisujemy go
 *    tu, bo dopiero teraz powstaje UI, które go potrzebuje.
 * ============================================================ */

alter table team_members enable row level security;

drop policy if exists "select_authenticated" on team_members;
create policy "select_authenticated" on team_members
  for select to authenticated using (true);

drop policy if exists "team_members_write_admin" on team_members;
create policy "team_members_write_admin" on team_members
  for all to authenticated
  using (app_role() = 'Admin') with check (app_role() = 'Admin');

drop policy if exists "teams_write_admin" on teams;
create policy "teams_write_admin" on teams
  for all to authenticated
  using (app_role() = 'Admin') with check (app_role() = 'Admin');

/* ============================================================
 * 3) Koszt materiałowy planowany — weryfikacja, nie zmiana: `materials.
 *    "unitPrice"` to już średnia ważona AKTUALNEGO stanu (fn_recalc_
 *    material, 001_rpc_functions.sql), przeliczana przy KAŻDEJ partii
 *    (przyjęcie zamówienia, korekta, zwrot) — czyli dokładnie "aktualna
 *    cena zakupu", o którą chodziło. Plan materiałowy budowy
 *    (build_material_plan.plannedQuantity) × ta cena = koszt planowany;
 *    liczone po stronie klienta (ten sam wzorzec co reszta modułu
 *    Technologia — klient dociąga surowe tabele i liczy sam, patrz
 *    lib/data/build-technology.ts), NIE wymaga nowej kolumny/widoku.
 *
 *    Odrębny problem: `build_materials."unitPrice"` (kolumna na
 *    PRZYPISANIU materiału do budowy, nie na planie technologii) była
 *    ustawiana TYLKO raz, przy pierwszym wydaniu partii na budowę
 *    (średnia ważona wydanych partii — patrz assign_material_batches_to_
 *    build i pochodne w 009/018/024/037/038) i później nigdy nie
 *    odświeżana. Efekt: "Materiały (plan ...)" w builds-screen.tsx
 *    (materialsCostPlanned = sum(planned × unitPrice)) potrafiła pokazywać
 *    cenę sprzed tygodni/miesięcy, mimo że w międzyczasie przyszła nowa
 *    dostawa po innej cenie. Naprawa: fn_recalc_material (wołana po
 *    KAŻDEJ zmianie partii materiału) dodatkowo odświeża
 *    build_materials."unitPrice" na aktualną materials."unitPrice" dla
 *    pozycji na budowach jeszcze NIEZAMKNIĘTYCH — koszt RZECZYWISTY
 *    (build_materials."actualCost", build_settlement_materials przy
 *    zamknięciu) tego nie rusza, bo liczy się osobno z build_material_lots
 *    (partia + cena zamrożone w momencie wydania), więc rozliczenie
 *    końcowe zostaje nietknięte.
 * ============================================================ */

create or replace function fn_recalc_material(p_material_id integer)
returns void
language plpgsql
as $$
declare
  v_stock decimal(12, 3);
  v_value decimal(14, 2);
  v_price decimal(12, 2);
begin
  select coalesce(sum(quantity), 0), coalesce(sum(quantity * "unitPrice"), 0)
    into v_stock, v_value
    from material_batches
    where "materialId" = p_material_id;

  v_price := case when v_stock > 0 then v_value / v_stock else 0 end;

  update materials
    set stock = v_stock, "unitPrice" = v_price, "updatedAt" = now()
    where id = p_material_id;

  -- Odśwież planowaną cenę na budowach jeszcze aktywnych (zamknięte mają
  -- już zamrożone rozliczenie w build_settlement_materials — nie ruszamy).
  update build_materials bm
    set "unitPrice" = v_price
    from builds b
    where bm."materialId" = p_material_id
      and bm."buildId" = b.id
      and b.status = 'aktywna';
end;
$$;

grant execute on function fn_recalc_material(integer) to authenticated;
