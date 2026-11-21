-- ============================================================
-- 113: Podwykonawcy — krok 3 (zlecenia, protokoły odbioru, koszt budowy).
--
-- 1) build_subcontracts — ZLECENIE podwykonawcy na budowie: pozycja per
--    etap (stage_name NULL = cała technologia) z ilością zleconą i
--    stawką ZAMROŻONĄ w chwili zlecenia (skopiowaną z cennika
--    subcontractor_rates, ten sam wzorzec co "hourlyRate" w time_entries).
--    Późniejsza zmiana cennika nie zmienia już zleconych prac.
--    material_by — czyj materiał na tej pozycji ('flowtex' = nasz, z
--    podmagazynu budowy, raportowany jak dotąd; 'podwykonawca' = jego,
--    poza magazynem, wliczony w jego stawkę).
--
-- 2) subcontract_acceptances + subcontract_acceptance_items — PROTOKÓŁ
--    ODBIORU: Admin potwierdza faktycznie wykonaną ilość (obmiar; raporty
--    brygadzisty z report_stage_progress tylko podpowiadają). Pozycje:
--      'etap'       — ilość × stawka z zlecenia (liczone w bazie),
--      'dodatkowe'  — prace spoza zlecenia, kwota ręczna (+),
--      'potracenie' — poprawki itp., kwota ręczna (−, zapisywana ujemnie).
--    paid_on — data zapłaty (NULL = do zapłaty).
--    Zapis tylko przez save_subcontract_acceptance (atomowo, kwoty z bazy).
--
-- 3) build_settlements."subcontractCost" + close_build: suma protokołów
--    budowy wchodzi do kosztu całkowitego przy zamknięciu.
--
-- Wszystko tylko dla Admina (kwoty/stawki — D11.1).
--
-- Uruchom PO 112_podwykonawcy_raport_i_brygady_budowy.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

/* ---------- 1) Zlecenia ---------- */

create table if not exists build_subcontracts (
  id serial primary key,
  build_id integer not null references builds(id) on delete cascade,
  subcontractor_id integer not null references subcontractors(id),
  team_id integer references teams(id) on delete set null,
  technology_code text not null default '',
  stage_name text,
  unit text not null default 'm2' check (unit in ('m2', 'mb', 'szt')),
  quantity decimal(12, 3) not null default 0 check (quantity >= 0),
  rate decimal(12, 2) not null default 0 check (rate >= 0),
  material_by text not null default 'flowtex' check (material_by in ('flowtex', 'podwykonawca')),
  note text not null default '',
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);

create unique index if not exists build_subcontracts_unique_idx
  on build_subcontracts (build_id, subcontractor_id, coalesce(stage_name, ''));
create index if not exists build_subcontracts_build_idx on build_subcontracts (build_id);

alter table build_subcontracts enable row level security;

drop policy if exists "build_subcontracts_admin_all" on build_subcontracts;
create policy "build_subcontracts_admin_all" on build_subcontracts
  for all to authenticated
  using (app_role() = 'Admin') with check (app_role() = 'Admin');

/* ---------- 2) Protokoły odbioru ---------- */

create table if not exists subcontract_acceptances (
  id serial primary key,
  build_id integer not null references builds(id) on delete cascade,
  subcontractor_id integer not null references subcontractors(id),
  accepted_on date not null default current_date,
  note text not null default '',
  paid_on date,
  "createdBy" uuid default auth.uid(),
  "createdAt" timestamp not null default now()
);

create index if not exists subcontract_acceptances_build_idx on subcontract_acceptances (build_id);

create table if not exists subcontract_acceptance_items (
  id serial primary key,
  acceptance_id integer not null references subcontract_acceptances(id) on delete cascade,
  -- Pozycja zlecenia — tylko dla 'etap'. RESTRICT: nie da się usunąć
  -- pozycji zlecenia, która ma już odebrane ilości.
  subcontract_id integer references build_subcontracts(id) on delete restrict,
  kind text not null check (kind in ('etap', 'dodatkowe', 'potracenie')),
  description text not null default '',
  quantity decimal(12, 3),
  rate decimal(12, 2),
  amount decimal(12, 2) not null
);

create index if not exists subcontract_acceptance_items_acc_idx on subcontract_acceptance_items (acceptance_id);
create index if not exists subcontract_acceptance_items_sub_idx on subcontract_acceptance_items (subcontract_id);

alter table subcontract_acceptances enable row level security;
alter table subcontract_acceptance_items enable row level security;

-- Odczyt i zmiana daty zapłaty: Admin. Usunięcie protokołu: Admin, tylko
-- dopóki budowa nie jest zamknięta (zamknięcie zamraża koszt). Wstawianie
-- wyłącznie przez save_subcontract_acceptance.
drop policy if exists "subcontract_acceptances_admin_select" on subcontract_acceptances;
create policy "subcontract_acceptances_admin_select" on subcontract_acceptances
  for select to authenticated using (app_role() = 'Admin');
drop policy if exists "subcontract_acceptances_admin_update" on subcontract_acceptances;
create policy "subcontract_acceptances_admin_update" on subcontract_acceptances
  for update to authenticated
  using (app_role() = 'Admin') with check (app_role() = 'Admin');
drop policy if exists "subcontract_acceptances_admin_delete" on subcontract_acceptances;
create policy "subcontract_acceptances_admin_delete" on subcontract_acceptances
  for delete to authenticated
  using (
    app_role() = 'Admin'
    and not exists (select 1 from builds b where b.id = build_id and b.status = 'zamknięta')
  );

drop policy if exists "subcontract_acceptance_items_admin_select" on subcontract_acceptance_items;
create policy "subcontract_acceptance_items_admin_select" on subcontract_acceptance_items
  for select to authenticated using (app_role() = 'Admin');

create or replace function save_subcontract_acceptance(
  p_build_id integer,
  p_subcontractor_id integer,
  p_accepted_on date,
  p_note text,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status build_status;
  v_acceptance_id integer;
  v_item jsonb;
  v_kind text;
  v_line build_subcontracts;
  v_qty decimal;
  v_amount decimal;
  v_desc text;
  v_count integer := 0;
begin
  perform assert_role(array['Admin']::app_role[]);

  select status into v_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można dodać protokołu odbioru.';
  end if;

  insert into subcontract_acceptances (build_id, subcontractor_id, accepted_on, note)
    values (p_build_id, p_subcontractor_id, coalesce(p_accepted_on, current_date), coalesce(trim(p_note), ''))
    returning id into v_acceptance_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_kind := v_item->>'kind';
    v_desc := coalesce(trim(v_item->>'description'), '');

    if v_kind = 'etap' then
      v_qty := (v_item->>'quantity')::decimal;
      continue when v_qty is null or v_qty <= 0;
      select * into v_line from build_subcontracts
        where id = (v_item->>'subcontractId')::integer
          and build_id = p_build_id and subcontractor_id = p_subcontractor_id;
      if not found then
        raise exception 'Pozycja zlecenia #% nie należy do tego podwykonawcy na tej budowie.',
          v_item->>'subcontractId';
      end if;
      insert into subcontract_acceptance_items
          (acceptance_id, subcontract_id, kind, description, quantity, rate, amount)
        values (v_acceptance_id, v_line.id, 'etap',
                coalesce(v_line.stage_name, 'Cała technologia'),
                v_qty, v_line.rate, round(v_qty * v_line.rate, 2));
      v_count := v_count + 1;

    elsif v_kind in ('dodatkowe', 'potracenie') then
      v_amount := abs((v_item->>'amount')::decimal);
      continue when v_amount is null or v_amount = 0;
      if v_desc = '' then
        v_desc := case when v_kind = 'dodatkowe' then 'Prace dodatkowe' else 'Potrącenie' end;
      end if;
      insert into subcontract_acceptance_items (acceptance_id, kind, description, amount)
        values (v_acceptance_id, v_kind, v_desc,
                case when v_kind = 'potracenie' then -round(v_amount, 2) else round(v_amount, 2) end);
      v_count := v_count + 1;

    else
      raise exception 'Nieznany rodzaj pozycji protokołu: %', v_kind;
    end if;
  end loop;

  if v_count = 0 then
    raise exception 'Protokół jest pusty — wpisz odebraną ilość albo kwotę.';
  end if;

  return v_acceptance_id;
end;
$$;

grant execute on function save_subcontract_acceptance(integer, integer, date, text, jsonb) to authenticated;

/* ---------- 3) Koszt podwykonawców w rozliczeniu budowy ---------- */

alter table build_settlements
  add column if not exists "subcontractCost" numeric not null default 0;

create or replace function close_build(p_build_id integer, p_returns jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_build builds;
  v_pending_count integer;
  v_total_hours decimal;
  v_labor_cost decimal;
  v_materials_cost decimal;
  v_total_extra_costs decimal;
  v_waste_cost decimal := 0;
  v_subcontract_cost decimal := 0;
  v_total_cost decimal;
  v_ret jsonb;
  v_lot_id integer;
  v_material_id integer;
  v_batch_id integer;
  v_qty decimal;
  v_decision text;
  v_reason text;
  v_lot_price decimal;
  v_unresolved_list text;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_build from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_build.status = 'zamknięta' then
    return;
  end if;

  select count(*) into v_pending_count from reports
    where "buildId" = p_build_id and status <> 'approved';
  if v_pending_count > 0 then
    raise exception 'Nie wszystkie raporty tej budowy są zatwierdzone — zatwierdź je przed zamknięciem.';
  end if;

  -- Pozostałość materiałowa: zwrot na magazyn albo do wyrzucenia.
  for v_ret in select * from jsonb_array_elements(p_returns)
  loop
    v_lot_id := (v_ret->>'lotId')::integer;
    v_qty := (v_ret->>'quantity')::decimal;
    v_decision := v_ret->>'decision';
    v_reason := v_ret->>'reason';

    if v_qty is null or v_qty <= 0 then
      continue;
    end if;
    if v_decision not in ('zwrot', 'wyrzucenie') then
      raise exception 'Nieprawidłowa decyzja rozliczenia partii #%: %', v_lot_id, v_decision;
    end if;

    -- Dopasowanie WPROST po ID partii — jednoznaczne, niezależnie od
    -- tego, ile innych partii tego samego materiału (z tą samą albo
    -- pustą sourceBatchId) jest jeszcze przypisanych do budowy.
    select "materialId", "sourceBatchId" into v_material_id, v_batch_id
      from build_material_lots
      where id = v_lot_id and "buildId" = p_build_id and quantity >= v_qty - 0.0001
      for update;
    if not found then
      raise exception 'Partia #% nie istnieje na budowie #% albo ilość do rozliczenia przekracza jej pozostałość.',
        v_lot_id, p_build_id;
    end if;

    -- RETURNING "unitPrice" — realna cena TEJ partii, do zwrotu/straty
    -- materiałowej niżej (bez uśredniania, ta sama zasada co przy
    -- korekcie raportu, patrz 035_dokladny_zwrot_partii.sql).
    update build_material_lots set quantity = quantity - v_qty
      where id = v_lot_id
      returning "unitPrice" into v_lot_price;
    delete from build_material_lots where id = v_lot_id and quantity <= 0.0001;

    if v_decision = 'zwrot' then
      if v_batch_id is not null then
        update material_batches set quantity = quantity + v_qty where id = v_batch_id;
      else
        -- Partia-źródłowa nie istnieje (materiał zamówiony wprost pod
        -- budowę, albo skasowana po wyczerpaniu gdzie indziej) — zwrot
        -- trafia do nowej partii (ta sama ilość i cena), jak w
        -- 028_fix_zwrot_do_usunietej_partii.sql / 053.
        insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source)
          values (v_material_id, v_qty, v_lot_price, current_date, 'zwrot');
      end if;
      perform fn_recalc_material(v_material_id);
    else
      -- Do wyrzucenia: materiał, który firma faktycznie straciła (np.
      -- przeterminowany) — dolicza się jako koszt budowy, osobną pozycją
      -- "Straty materiałowe" (nie miesza się ze zwykłym kosztem zużycia).
      v_waste_cost := v_waste_cost + v_qty * v_lot_price;
    end if;

    insert into build_material_returns ("buildId", "materialId", "batchId", quantity, decision, reason, "unitPrice")
      values (p_build_id, v_material_id, v_batch_id, v_qty, v_decision::return_decision, v_reason, v_lot_price);
  end loop;

  -- N6: podmagazyn (Σ q_S(a) per materiał, dodatnie NIEROZLICZONE i
  -- ujemne NIEDOBORY razem) musi wynosić zero, inaczej blokada. Bez tego
  -- materiał/koszt mógł zniknąć z rozliczenia bez śladu i bez ostrzeżenia.
  select string_agg(
           coalesce(m.name, 'materiał #' || v_unresolved."materialId") || ': ' || round(v_unresolved.net, 3),
           ', '
         )
    into v_unresolved_list
    from (
      select "materialId", sum(quantity) as net
        from build_material_lots
        where "buildId" = p_build_id
        group by "materialId"
        having abs(sum(quantity)) > 0.0001
    ) v_unresolved
    left join materials m on m.id = v_unresolved."materialId";

  if v_unresolved_list is not null then
    raise exception 'Nie można zamknąć budowy — podmagazyn nie jest wyzerowany: %. Rozlicz zwrot/wyrzucenie (dodatnia pozostałość) albo uzupełnij przypisanie materiału (ujemny niedobór) przed zamknięciem.',
      v_unresolved_list;
  end if;

  select coalesce(sum(t.hours), 0),
         coalesce(sum(t.hours * coalesce(t."hourlyRate", e."hourlyRate", 0)), 0)
    into v_total_hours, v_labor_cost
    from time_entries t
    join employees e on e.id = t."employeeId"
    where t."buildId" = p_build_id;

  select coalesce(sum("actualCost"), 0) into v_materials_cost from build_materials
    where "buildId" = p_build_id;

  select coalesce(sum(rec.amount), 0) into v_total_extra_costs
    from report_extra_costs rec
    join reports r on r.id = rec."reportId"
    where r."buildId" = p_build_id;

  -- 113: koszt podwykonawców = suma protokołów odbioru tej budowy (etapy
  -- × zamrożona stawka + prace dodatkowe − potrącenia).
  select coalesce(sum(i.amount), 0) into v_subcontract_cost
    from subcontract_acceptance_items i
    join subcontract_acceptances a on a.id = i.acceptance_id
    where a.build_id = p_build_id;

  v_total_cost := v_materials_cost + v_labor_cost + v_total_extra_costs + v_waste_cost + v_subcontract_cost;

  insert into build_settlements (
    "buildId", "totalHours", "totalExtraCosts", "materialsCost", "laborCost", "wasteCost", "subcontractCost", "totalCost"
  ) values (
    p_build_id, v_total_hours, v_total_extra_costs, v_materials_cost, v_labor_cost, v_waste_cost, v_subcontract_cost, v_total_cost
  )
  on conflict ("buildId") do update set
    "closedAt" = now(),
    "totalHours" = excluded."totalHours",
    "totalExtraCosts" = excluded."totalExtraCosts",
    "materialsCost" = excluded."materialsCost",
    "laborCost" = excluded."laborCost",
    "wasteCost" = excluded."wasteCost",
    "subcontractCost" = excluded."subcontractCost",
    "totalCost" = excluded."totalCost";

  delete from build_settlement_materials where "buildId" = p_build_id;
  insert into build_settlement_materials ("buildId", "materialId", planned, used, "unitPrice", "actualCost")
    select "buildId", "materialId", planned, used, "unitPrice", "actualCost"
      from build_materials where "buildId" = p_build_id;

  update builds set status = 'zamknięta', "updatedAt" = now() where id = p_build_id;
end;
$$;

grant execute on function close_build(integer, jsonb) to authenticated;

/* ---------- 4) Widoczność dla brygadzisty podwykonawcy ---------- */

-- Brygady podwykonawców, których liderem jest zalogowany (pusta tablica
-- dla wszystkich pozostałych).
create or replace function my_subcontractor_team_ids()
returns integer[]
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(array_agg(t.id), '{}')
    from teams t
    join profiles p on p.id = auth.uid()
   where t.subcontractor_id is not null
     and t.active
     and t."leadEmployeeId" = p."employeeId";
$$;

grant execute on function my_subcontractor_team_ids() to authenticated;

-- Polityki RESTRICTIVE: łączą się (AND) z istniejącymi politykami odczytu,
-- więc dla wszystkich poza brygadzistą podwykonawcy nic się nie zmienia.
-- Brygadzista podwykonawcy czyta tylko budowy, do których przypisano jego
-- brygadę, i tylko raporty swojej brygady.
drop policy if exists "builds_subcontractor_scope" on builds;
create policy "builds_subcontractor_scope" on builds
  as restrictive for select to authenticated
  using (
    cardinality(my_subcontractor_team_ids()) = 0
    or exists (
      select 1 from build_teams bt
       where bt.build_id = builds.id and bt.team_id = any(my_subcontractor_team_ids())
    )
  );

drop policy if exists "reports_subcontractor_scope" on reports;
create policy "reports_subcontractor_scope" on reports
  as restrictive for select to authenticated
  using (
    cardinality(my_subcontractor_team_ids()) = 0
    or team_id = any(my_subcontractor_team_ids())
  );
