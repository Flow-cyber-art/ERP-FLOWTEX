-- ============================================================
-- FLOWTEX / Budowy — funkcje RPC dla dostępu BEZPOŚREDNIO z klienta
-- (anon key + RLS już włączone), bez pośredniczącego serwera
-- Express/tRPC (Railway).
--
-- Schemat tabel i polityki RLS już istnieją w Twojej bazie i się
-- zgadzają z drizzle/schema.ts (zweryfikowane introspekcją) — ten plik
-- NIE tworzy żadnych tabel, tylko dopisuje:
--   1) unique constraint na reports(buildId, date) — potrzebny do
--      idempotentnego zapisu raportu (jeden raport = jedna budowa +
--      jeden dzień; bez osobnej kolumny clientId w bazie, upsert robimy
--      po tym naturalnym kluczu).
--   2) funkcje pomocnicze FIFO (odpowiednik dawnych funkcji
--      recalcMaterial/addBatch/consumeFifo z server/data-routers.ts).
--   3) publiczne RPC wołane z klienta przez supabase.rpc(...) —
--      wieloetapowe operacje (FIFO, snapshot rozliczenia budowy), które
--      muszą wykonać się atomowo w jednej transakcji, więc nie da się
--      ich bezpiecznie zrobić kilkoma osobnymi zapytaniami z klienta.
--
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej całość -> Run.
-- Bezpieczne do wielokrotnego uruchomienia (CREATE OR REPLACE / DO-blok
-- łapiący duplicate_object).
-- ============================================================

-- "duplicate_table" (nie tylko "duplicate_object") bo ADD CONSTRAINT UNIQUE
-- tworzy pod spodem indeks o tej samej nazwie — jeśli taki indeks już
-- istnieje (np. z wcześniejszej, częściowo nieudanej próby uruchomienia
-- tego pliku), Postgres zgłasza 42P07, nie 42710.
do $$ begin
  alter table reports add constraint reports_build_date_key unique ("buildId", date);
exception when duplicate_object or duplicate_table then null; end $$;

-- ------------------------------------------------------------
-- FUNKCJE POMOCNICZE (FIFO)
-- ------------------------------------------------------------
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
end;
$$;

create or replace function fn_add_material_batch(
  p_material_id integer,
  p_quantity decimal,
  p_unit_price decimal,
  p_received_at date,
  p_source batch_source
)
returns void
language plpgsql
as $$
begin
  insert into material_batches ("materialId", quantity, "unitPrice", "receivedAt", source)
    values (p_material_id, p_quantity, p_unit_price, p_received_at, p_source);
  perform fn_recalc_material(p_material_id);
end;
$$;

-- Zdejmuje ilość metodą FIFO (najstarsza partia wg receivedAt, potem id)
-- i zwraca faktyczny koszt PLN zdjętej ilości. Rzuca wyjątek, jeśli na
-- stanie nie ma wystarczająco dużo.
create or replace function fn_consume_fifo(p_material_id integer, p_amount decimal)
returns decimal
language plpgsql
as $$
declare
  v_remaining decimal := p_amount;
  v_cost decimal := 0;
  v_row record;
  v_take decimal;
  v_left decimal;
begin
  if p_amount <= 0 then
    return 0;
  end if;

  for v_row in
    select id, quantity, "unitPrice"
      from material_batches
      where "materialId" = p_material_id
      order by "receivedAt" asc, id asc
      for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_row.quantity, v_remaining);
    v_cost := v_cost + v_take * v_row."unitPrice";
    v_remaining := v_remaining - v_take;
    v_left := v_row.quantity - v_take;
    if v_left > 0.0001 then
      update material_batches set quantity = v_left where id = v_row.id;
    else
      delete from material_batches where id = v_row.id;
    end if;
  end loop;

  if v_remaining > 0.0001 then
    raise exception 'Za mało towaru na stanie (materiał #%): brakuje %', p_material_id, round(v_remaining, 3);
  end if;

  perform fn_recalc_material(p_material_id);
  return v_cost;
end;
$$;

-- ------------------------------------------------------------
-- PUBLICZNE RPC
-- ------------------------------------------------------------

-- Nowy materiał w magazynie + (opcjonalnie) partia startowa.
--
-- SECURITY DEFINER + assert_role: od 003_auth_rls.sql zwykłe polityki
-- RLS na tabelach są zawężone (np. tylko SELECT dla nie-Admina), więc
-- funkcje, które muszą pisać w wielu tabelach w jednej transakcji,
-- działają z podniesionymi uprawnieniami właściciela funkcji — ale same
-- na wejściu sprawdzają rolę wołającego (assert_role), więc efektywne
-- uprawnienia są i tak takie, jak zakłada model ról aplikacji, tylko
-- sprawdzane raz, w jednym miejscu, zamiast osobno na każdej tabeli.
create or replace function create_material(
  p_name text,
  p_index text,
  p_unit text,
  p_initial_stock decimal,
  p_min decimal,
  p_unit_price decimal
)
returns materials
language plpgsql
security definer
set search_path = public
as $$
declare
  v_material materials;
begin
  perform assert_role(array['Admin']::app_role[]);

  if exists (select 1 from materials where index = p_index) then
    raise exception 'Materiał z indeksem "%" już istnieje.', p_index;
  end if;

  insert into materials (name, index, unit, stock, min, "unitPrice")
    values (p_name, p_index, p_unit, 0, p_min, p_unit_price)
    returning * into v_material;

  if p_initial_stock > 0 then
    perform fn_add_material_batch(
      v_material.id, p_initial_stock, p_unit_price, current_date, 'stan początkowy'
    );
  end if;

  select * into v_material from materials where id = v_material.id;
  return v_material;
end;
$$;

-- Korekta stanu do konkretnej wartości: w górę dopisuje partię "korekta"
-- po aktualnej cenie, w dół zdejmuje FIFO jak realne zużycie.
create or replace function adjust_material_stock(p_material_id integer, p_new_stock decimal)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_material materials;
  v_delta decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_material from materials where id = p_material_id for update;
  if not found then
    raise exception 'Nie znaleziono materiału #%.', p_material_id;
  end if;

  v_delta := p_new_stock - v_material.stock;
  if abs(v_delta) < 0.0001 then
    return;
  end if;

  if v_delta > 0 then
    perform fn_add_material_batch(p_material_id, v_delta, coalesce(v_material."unitPrice", 0), current_date, 'korekta');
  else
    perform fn_consume_fifo(p_material_id, -v_delta);
  end if;
end;
$$;

-- Dostawa dotarła: dopisuje partię (nowy materiał, jeśli zamówienie nie
-- było powiązane z istniejącą pozycją magazynową) i oznacza zamówienie
-- jako dostarczone.
create or replace function receive_material_order(
  p_order_id integer,
  p_received_quantity decimal,
  p_received_unit_price decimal default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order material_orders;
  v_material_id integer;
  v_price decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_order from material_orders where id = p_order_id for update;
  if not found then
    raise exception 'Nie znaleziono zamówienia #%.', p_order_id;
  end if;

  v_material_id := v_order."materialId";
  if v_material_id is null then
    select id into v_material_id from materials where name = v_order."materialName" limit 1;
  end if;

  v_price := p_received_unit_price;
  if v_price is null and v_material_id is not null then
    select "unitPrice" into v_price from materials where id = v_material_id;
  end if;
  v_price := coalesce(v_price, 0);

  if v_material_id is null then
    insert into materials (name, index, unit, stock, min, "unitPrice")
      values (v_order."materialName", 'AUTO-' || v_order.id, v_order.unit, 0, 5, v_price)
      returning id into v_material_id;
  end if;

  perform fn_add_material_batch(v_material_id, p_received_quantity, v_price, current_date, 'zamówienie');

  update material_orders
    set status = 'dostarczone',
        "receivedQuantity" = p_received_quantity,
        "receivedUnitPrice" = v_price,
        "receivedAt" = now(),
        "materialId" = v_material_id
    where id = p_order_id;
end;
$$;

-- Przypisuje listę materiałów (planned) do budowy — jeśli przypisanie już
-- istnieje, dolicza do planned; jeśli nie, tworzy nowe z ceną zamrożoną
-- na aktualnej cenie materiału. p_items: [{"materialId":1,"planned":10}, ...]
create or replace function commit_build_materials(p_build_id integer, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status build_status;
  v_item jsonb;
  v_material_id integer;
  v_planned decimal;
  v_price decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select status into v_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_status = 'zamknięta' then
    raise exception 'Budowa jest zamknięta — nie można już przypisywać materiałów.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_material_id := (v_item->>'materialId')::integer;
    v_planned := (v_item->>'planned')::decimal;

    select "unitPrice" into v_price from materials where id = v_material_id;
    if v_price is null then
      continue;
    end if;

    insert into build_materials ("buildId", "materialId", planned, used, "unitPrice")
      values (p_build_id, v_material_id, v_planned, 0, v_price)
      on conflict ("buildId", "materialId")
      do update set planned = build_materials.planned + excluded.planned;
  end loop;
end;
$$;

-- Zapis/aktualizacja raportu dziennego: idempotentny po (buildId, date)
-- — bezpieczny do ponawiania z kolejki offline. FIFO liczone tu, w
-- jednej transakcji, na AKTUALNYCH partiach z bazy. Materiały bez
-- wcześniejszego przypisania do budowy (build_materials) są pomijane.
-- p_people:      [{"employeeId":1,"start":"07:00","end":"15:00"}, ...]
-- p_materials:   [{"materialId":1,"usedQuantity":12,"reason":"..."}, ...]
-- p_extra_costs: [{"label":"...","amount":50,"note":"..."}, ...]
--
-- Zwraca jsonb {"reportId": N, "materials": [{"materialId":..,
-- "usedQuantity":..,"cost":..}, ...]} — koszt PRZELICZONY TU, w bazie,
-- na realnych partiach. Klient (contexts/app-data.tsx) nadpisuje tym
-- swój lokalny, optymistyczny szacunek kosztu, żeby na ekranie nigdy nie
-- został pokazany koszt, który różni się od tego, co faktycznie
-- zaksięgowano (mogło się to rozjechać, gdy raport czekał w kolejce
-- offline i w międzyczasie ktoś inny zdjął towar z tej samej partii).
create or replace function submit_daily_report(
  p_build_id integer,
  p_date date,
  p_people jsonb,
  p_materials jsonb,
  p_extra_costs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_build_status build_status;
  v_report_id integer;
  v_existing_status report_status;
  v_item jsonb;
  v_material_id integer;
  v_used_quantity decimal;
  v_reason text;
  v_assignment build_materials;
  v_delta decimal;
  v_cost decimal;
  v_employee_id integer;
  v_start text;
  v_end text;
  v_result_materials jsonb := '[]'::jsonb;
begin
  perform assert_role(array['Admin', 'Brygadzista']::app_role[]);

  select status into v_build_status from builds where id = p_build_id for update;
  if not found then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;
  if v_build_status = 'zamknięta' then
    raise exception 'Ta budowa jest zamknięta — nie można już dodawać raportów.';
  end if;

  select id, status into v_report_id, v_existing_status
    from reports where "buildId" = p_build_id and date = p_date;
  if v_report_id is not null and v_existing_status = 'approved' then
    raise exception 'Zatwierdzonego raportu nie można już edytować.';
  end if;

  if v_report_id is null then
    insert into reports ("buildId", date, status)
      values (p_build_id, p_date, 'submitted')
      returning id into v_report_id;
  else
    update reports set status = 'submitted', "updatedAt" = now() where id = v_report_id;
    delete from report_people where "reportId" = v_report_id;
    delete from report_materials where "reportId" = v_report_id;
    delete from report_extra_costs where "reportId" = v_report_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_materials)
  loop
    v_material_id := (v_item->>'materialId')::integer;
    v_used_quantity := (v_item->>'usedQuantity')::decimal;
    v_reason := v_item->>'reason';

    select * into v_assignment from build_materials
      where "buildId" = p_build_id and "materialId" = v_material_id
      for update;
    if not found then
      continue; -- materiał nieprzypisany do budowy — pomiń, jak lokalnie
    end if;

    v_delta := v_used_quantity - v_assignment.used;
    v_cost := 0;
    if v_delta > 0.0001 then
      v_cost := fn_consume_fifo(v_material_id, v_delta);
      update build_materials
        set used = v_used_quantity, "actualCost" = "actualCost" + v_cost
        where "buildId" = p_build_id and "materialId" = v_material_id;
    elsif v_delta < -0.0001 then
      -- Korekta w dół: nie oddaje partii ani kosztu (jak lokalnie) — tylko
      -- zapisuje nową, niższą wartość `used`.
      update build_materials
        set used = v_used_quantity
        where "buildId" = p_build_id and "materialId" = v_material_id;
    end if;

    insert into report_materials ("reportId", "materialId", "usedQuantity", cost, reason)
      values (v_report_id, v_material_id, v_used_quantity, v_cost, v_reason);

    v_result_materials := v_result_materials || jsonb_build_object(
      'materialId', v_material_id,
      'usedQuantity', v_used_quantity,
      'cost', v_cost
    );
  end loop;

  if jsonb_array_length(p_people) > 0 then
    delete from time_entries where date = p_date and "buildId" = p_build_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_people)
  loop
    v_employee_id := (v_item->>'employeeId')::integer;
    v_start := v_item->>'start';
    v_end := v_item->>'end';

    insert into report_people ("reportId", "employeeId", start, "end")
      values (v_report_id, v_employee_id, v_start::time, v_end::time);
    insert into time_entries ("employeeId", "buildId", date, hours, start, "end")
      values (
        v_employee_id, p_build_id, p_date,
        greatest(0, extract(epoch from (v_end::time - v_start::time)) / 3600.0),
        v_start::time, v_end::time
      );
  end loop;

  for v_item in select * from jsonb_array_elements(p_extra_costs)
  loop
    insert into report_extra_costs ("reportId", label, amount, note)
      values (v_report_id, v_item->>'label', (v_item->>'amount')::decimal, v_item->>'note');
  end loop;

  return jsonb_build_object('reportId', v_report_id, 'materials', v_result_materials);
end;
$$;

-- Zamyka budowę i zapisuje snapshot rozliczenia (godziny, materiały,
-- koszty dodatkowe). Wymaga, żeby wszystkie raporty budowy były już
-- zatwierdzone.
create or replace function close_build(p_build_id integer)
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
  v_total_cost decimal;
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

  select coalesce(sum(t.hours), 0), coalesce(sum(t.hours * e."hourlyRate"), 0)
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

  v_total_cost := v_materials_cost + v_labor_cost + v_total_extra_costs;

  insert into build_settlements (
    "buildId", "totalHours", "totalExtraCosts", "materialsCost", "laborCost", "totalCost"
  ) values (
    p_build_id, v_total_hours, v_total_extra_costs, v_materials_cost, v_labor_cost, v_total_cost
  )
  on conflict ("buildId") do update set
    "closedAt" = now(),
    "totalHours" = excluded."totalHours",
    "totalExtraCosts" = excluded."totalExtraCosts",
    "materialsCost" = excluded."materialsCost",
    "laborCost" = excluded."laborCost",
    "totalCost" = excluded."totalCost";

  delete from build_settlement_materials where "buildId" = p_build_id;
  insert into build_settlement_materials ("buildId", "materialId", planned, used, "unitPrice", "actualCost")
    select "buildId", "materialId", planned, used, "unitPrice", "actualCost"
      from build_materials where "buildId" = p_build_id;

  update builds set status = 'zamknięta', "updatedAt" = now() where id = p_build_id;
end;
$$;

-- Tylko `authenticated` — od 003_auth_rls.sql anonimowy dostęp (`anon`)
-- jest wyłączony całkowicie, logowanie jest wymagane. `assert_role`
-- wewnątrz każdej funkcji i tak by odrzucił wołanie bez zalogowanej roli,
-- ale nie ma sensu w ogóle wystawiać wykonania na `anon`.
grant execute on function
  create_material(text, text, text, decimal, decimal, decimal),
  adjust_material_stock(integer, decimal),
  receive_material_order(integer, decimal, decimal),
  commit_build_materials(integer, jsonb),
  submit_daily_report(integer, date, jsonb, jsonb, jsonb),
  close_build(integer)
to authenticated;
