-- ============================================================
-- 121: MAGAZYN v2 — księga ruchów jako jedyne źródło stanu
-- Projekt: docs/PROJEKT_MODELU_MAGAZYNU_v2.md (decyzje D1–D8 zaakceptowane).
--
--  batches          trwała partia (cena stała, PZ, dostawca, nr partii
--                   producenta, data ważności, dokumenty) — nigdy kasowana
--  stock_operations nagłówek operacji (kto, kiedy, do weryfikacji)
--  stock_ledger     księga: każdy wiersz = zmiana salda JEDNEJ partii w
--                   JEDNEJ lokalizacji (NULL = magazyn, id = budowa) i/lub
--                   skutek kosztowy dla budowy; append-only
--  batch_balances   saldo partii w lokalizacji — odczyt, aktualizowany
--                   WYŁĄCZNIE przez fn_ledger_post w tej samej transakcji
--  shortages        niedobory „do wyjaśnienia” (zamiast ujemnych partii)
--  material_loss_requests  zgłoszenia strat przez brygadzistę (D5)
--
-- Stare tabele (material_batches, build_material_lots, build_materials,
-- stock_movements, build_material_returns, report_material_lots) zostają
-- zastąpione WIDOKAMI o tych samych nazwach i kolumnach — działająca
-- aplikacja czyta je bez zmian. Baza była pusta (po czyszczeniu 23.11.2026),
-- więc nie ma migracji danych.
-- ============================================================
BEGIN;

-- ---------- 0. Stare obiekty ----------
DROP FUNCTION IF EXISTS close_build(integer);
DROP FUNCTION IF EXISTS receive_material_order(integer, numeric, numeric);
DROP FUNCTION IF EXISTS receive_order(integer, jsonb);
DROP FUNCTION IF EXISTS commit_build_materials(integer, jsonb);
DROP FUNCTION IF EXISTS fn_consume_fifo(integer, numeric);
DROP FUNCTION IF EXISTS fn_consume_build_lot_fifo(integer, integer, numeric, integer, text);
DROP FUNCTION IF EXISTS fn_add_material_batch(integer, numeric, numeric, date, batch_source);
DROP FUNCTION IF EXISTS fn_add_material_batch_ext(integer, numeric, numeric, date, batch_source, text, text);
DROP FUNCTION IF EXISTS fn_recalc_material(integer);
DROP FUNCTION IF EXISTS fn_report_day_cost(integer, integer, text);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM builds) OR EXISTS (SELECT 1 FROM materials) OR EXISTS (SELECT 1 FROM material_batches) THEN
    RAISE EXCEPTION 'Migracja 121 zakłada pustą bazę magazynu i budów (brak migracji danych).';
  END IF;
END $$;

DROP TABLE IF EXISTS report_material_lots CASCADE;
DROP TABLE IF EXISTS stock_movements CASCADE;
DROP TABLE IF EXISTS build_material_returns CASCADE;
DROP TABLE IF EXISTS build_material_lots CASCADE;
DROP TABLE IF EXISTS build_materials CASCADE;
DROP TABLE IF EXISTS material_batches CASCADE;

-- ---------- 1. Typy ----------
DO $$ BEGIN
  CREATE TYPE stock_op_type AS ENUM ('przyjecie','wydanie','zuzycie','korekta_raportu','zwrot','strata',
    'transfer','korekta_inwentaryzacyjna','rozliczenie_niedoboru');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE stock_cost_effect AS ENUM ('brak','zuzycie','strata');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- 2. Tabele ----------
CREATE TABLE batches (
  id               serial PRIMARY KEY,
  material_id      integer NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  qty_received     numeric NOT NULL CHECK (qty_received > 0),
  unit_price       numeric NOT NULL CHECK (unit_price >= 0),
  received_at      date NOT NULL DEFAULT current_date,
  source           batch_source NOT NULL,
  received_location_build_id integer REFERENCES builds(id) ON DELETE RESTRICT,
  document_no      text,
  supplier         text,
  producer_lot_no  text,
  expiry_date      date,
  quality_docs     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT auth.uid()
);
CREATE INDEX batches_material_idx ON batches(material_id);

CREATE TABLE stock_operations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op_type          stock_op_type NOT NULL,
  build_id         integer REFERENCES builds(id) ON DELETE RESTRICT,
  related_build_id integer REFERENCES builds(id) ON DELETE RESTRICT,
  report_id        integer REFERENCES reports(id) ON DELETE SET NULL,
  note             text,
  needs_review     boolean NOT NULL DEFAULT false,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shortages (
  id               serial PRIMARY KEY,
  build_id         integer NOT NULL REFERENCES builds(id) ON DELETE RESTRICT,
  material_id      integer NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  report_id        integer REFERENCES reports(id) ON DELETE SET NULL,
  stage_name       text,
  qty_original     numeric NOT NULL CHECK (qty_original > 0),
  qty_open         numeric NOT NULL CHECK (qty_open >= 0),
  provisional_price numeric NOT NULL,
  status           text NOT NULL DEFAULT 'do_wyjasnienia' CHECK (status IN ('do_wyjasnienia','wyjasniony')),
  resolution       text CHECK (resolution IN ('dostawa','transfer','wydanie','korekta_raportu','roznica_inwentaryzacyjna')),
  resolved_by      uuid,
  resolved_at      timestamptz,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shortages_open_idx ON shortages(build_id, material_id) WHERE status = 'do_wyjasnienia';

CREATE TABLE stock_ledger (
  id               bigserial PRIMARY KEY,
  operation_id     uuid NOT NULL REFERENCES stock_operations(id) ON DELETE RESTRICT,
  op_type          stock_op_type NOT NULL,
  material_id      integer NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  batch_id         integer REFERENCES batches(id) ON DELETE RESTRICT,
  location_build_id integer REFERENCES builds(id) ON DELETE RESTRICT,
  qty_delta        numeric NOT NULL DEFAULT 0,      -- zmiana salda partii w lokalizacji
  qty_consumed     numeric NOT NULL DEFAULT 0,      -- ilość zużycia raportowa (+ zużycie, − storno)
  unit_price       numeric NOT NULL DEFAULT 0,
  cost_build_id    integer REFERENCES builds(id) ON DELETE RESTRICT,
  cost_effect      stock_cost_effect NOT NULL DEFAULT 'brak',
  cost_value       numeric NOT NULL DEFAULT 0,      -- + obciąża budowę, − zmniejsza
  report_id        integer REFERENCES reports(id) ON DELETE SET NULL,
  stage_name       text,
  shortage_id      integer REFERENCES shortages(id) ON DELETE RESTRICT,
  reversal_of      bigint REFERENCES stock_ledger(id) ON DELETE RESTRICT,
  related_build_id integer REFERENCES builds(id) ON DELETE RESTRICT,
  note             text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (batch_id IS NOT NULL OR qty_delta = 0)
);
CREATE INDEX stock_ledger_batch_loc_idx ON stock_ledger(batch_id, location_build_id);
CREATE INDEX stock_ledger_cost_idx ON stock_ledger(cost_build_id, material_id);
CREATE INDEX stock_ledger_report_idx ON stock_ledger(report_id, material_id);
CREATE INDEX stock_ledger_loc_idx ON stock_ledger(location_build_id, material_id);

CREATE TABLE batch_balances (
  id               serial PRIMARY KEY,
  batch_id         integer NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  material_id      integer NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  location_build_id integer REFERENCES builds(id) ON DELETE RESTRICT,
  qty              numeric NOT NULL DEFAULT 0 CHECK (qty >= -0.00001),
  unit_price       numeric NOT NULL,
  first_in_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (batch_id, location_build_id)
);
CREATE INDEX batch_balances_loc_idx ON batch_balances(location_build_id, material_id) WHERE qty > 0;

CREATE TABLE material_loss_requests (
  id               serial PRIMARY KEY,
  build_id         integer NOT NULL REFERENCES builds(id) ON DELETE RESTRICT,
  material_id      integer NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  qty              numeric NOT NULL CHECK (qty > 0),
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'oczekuje' CHECK (status IN ('oczekuje','zatwierdzona','odrzucona')),
  operation_id     uuid REFERENCES stock_operations(id),
  requested_by     uuid DEFAULT auth.uid(),
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_integrity_alerts (
  id               serial PRIMARY KEY,
  checked_at       timestamptz NOT NULL DEFAULT now(),
  issues           jsonb NOT NULL,
  acknowledged_by  uuid,
  acknowledged_at  timestamptz
);

-- Uprawnienia: odczyt dla zalogowanych, zapis wyłącznie przez funkcje.
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE shortages ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_loss_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_integrity_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_authenticated ON batches FOR SELECT TO authenticated USING (true);
CREATE POLICY select_authenticated ON stock_operations FOR SELECT TO authenticated USING (true);
CREATE POLICY select_authenticated ON stock_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY select_authenticated ON batch_balances FOR SELECT TO authenticated USING (true);
CREATE POLICY select_authenticated ON shortages FOR SELECT TO authenticated USING (true);
CREATE POLICY select_authenticated ON material_loss_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY select_admin ON stock_integrity_alerts FOR SELECT TO authenticated USING (app_role() = 'Admin');
REVOKE ALL ON batches, stock_operations, stock_ledger, batch_balances, shortages,
  material_loss_requests, stock_integrity_alerts FROM anon, authenticated;
GRANT SELECT ON batches, stock_operations, stock_ledger, batch_balances, shortages,
  material_loss_requests, stock_integrity_alerts TO authenticated;

-- materials.stock = pole odczytowe — aplikacja nie może go zmieniać.
REVOKE UPDATE ON materials FROM authenticated, anon;
GRANT UPDATE (name, index, unit, min, category, active, "updatedAt") ON materials TO authenticated;

-- ---------- 3. Rdzeń: jedyny zapis do księgi ----------
CREATE OR REPLACE FUNCTION fn_op_begin(p_type stock_op_type, p_build integer DEFAULT NULL,
  p_related integer DEFAULT NULL, p_report integer DEFAULT NULL, p_note text DEFAULT NULL,
  p_needs_review boolean DEFAULT false)
 RETURNS uuid LANGUAGE sql SET search_path TO 'public'
AS $$
  insert into stock_operations (op_type, build_id, related_build_id, report_id, note, needs_review)
  values (p_type, p_build, p_related, p_report, p_note, p_needs_review)
  returning id;
$$;

CREATE OR REPLACE FUNCTION fn_ledger_post(
  p_op uuid, p_type stock_op_type, p_material integer, p_batch integer, p_location integer,
  p_qty_delta numeric, p_qty_consumed numeric DEFAULT 0, p_unit_price numeric DEFAULT NULL,
  p_cost_build integer DEFAULT NULL, p_cost_effect stock_cost_effect DEFAULT 'brak', p_cost_value numeric DEFAULT 0,
  p_report integer DEFAULT NULL, p_stage text DEFAULT NULL, p_shortage integer DEFAULT NULL,
  p_reversal_of bigint DEFAULT NULL, p_related_build integer DEFAULT NULL, p_note text DEFAULT NULL)
 RETURNS bigint LANGUAGE plpgsql SET search_path TO 'public'
AS $$
declare
  v_price numeric := p_unit_price;
  v_id bigint;
  v_new numeric;
begin
  if p_batch is not null and v_price is null then
    select unit_price into v_price from batches where id = p_batch;
  end if;
  insert into stock_ledger (operation_id, op_type, material_id, batch_id, location_build_id, qty_delta,
      qty_consumed, unit_price, cost_build_id, cost_effect, cost_value, report_id, stage_name, shortage_id,
      reversal_of, related_build_id, note)
    values (p_op, p_type, p_material, p_batch, p_location, coalesce(p_qty_delta, 0), coalesce(p_qty_consumed, 0),
      coalesce(v_price, 0), p_cost_build, p_cost_effect, coalesce(p_cost_value, 0), p_report, p_stage, p_shortage,
      p_reversal_of, p_related_build, p_note)
    returning id into v_id;

  if p_batch is not null and abs(coalesce(p_qty_delta, 0)) > 0 then
    insert into batch_balances (batch_id, material_id, location_build_id, qty, unit_price)
      values (p_batch, p_material, p_location, p_qty_delta, coalesce(v_price, 0))
      on conflict (batch_id, location_build_id) do update
        set qty = batch_balances.qty + excluded.qty,
            first_in_at = case when batch_balances.qty <= 0.00001 and excluded.qty > 0 then now()
                               else batch_balances.first_in_at end
      returning qty into v_new;
    if v_new < -0.00001 then
      raise exception 'Za mało materiału w partii #% w tej lokalizacji (brakuje %).', p_batch, round(-v_new, 3);
    end if;
    if p_location is null then
      update materials set stock = stock + p_qty_delta, "updatedAt" = now() where id = p_material;
    end if;
  end if;
  return v_id;
end;
$$;

-- Przydział partii z lokalizacji: FEFO (najkrótsza data ważności) → FIFO (D1).
CREATE OR REPLACE FUNCTION fn_alloc(p_material integer, p_location integer, p_qty numeric,
  p_batch integer DEFAULT NULL, p_lifo boolean DEFAULT false)
 RETURNS TABLE(batch_id integer, take numeric, unit_price numeric)
 LANGUAGE plpgsql SET search_path TO 'public'
AS $$
declare
  v_left numeric := p_qty;
  r record;
begin
  for r in
    select bb.batch_id as bid, bb.qty, bb.unit_price as price
      from batch_balances bb join batches b on b.id = bb.batch_id
     where bb.material_id = p_material
       and bb.location_build_id is not distinct from p_location
       and bb.qty > 0.00001
       and (p_batch is null or bb.batch_id = p_batch)
     order by
       case when p_lifo then null else b.expiry_date end asc nulls last,
       case when p_lifo then bb.first_in_at end desc,
       case when p_lifo then null else bb.first_in_at end asc,
       b.id
     for update of bb
  loop
    exit when v_left <= 0.00001;
    batch_id := r.bid;
    take := least(r.qty, v_left);
    unit_price := r.price;
    v_left := v_left - take;
    return next;
  end loop;
end;
$$;

CREATE OR REPLACE FUNCTION fn_available(p_material integer, p_location integer)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  select coalesce(sum(qty), 0) from batch_balances
   where material_id = p_material and location_build_id is not distinct from p_location and qty > 0;
$$;

CREATE OR REPLACE FUNCTION fn_material_name(p_material integer)
 RETURNS text LANGUAGE sql STABLE SET search_path TO 'public'
AS $$ select coalesce((select name from materials where id = p_material), 'materiał #' || p_material); $$;

-- Przyjęcie: nowa trwała partia + ruch w lokalizacji (magazyn albo budowa).
CREATE OR REPLACE FUNCTION fn_stock_receive(p_material integer, p_qty numeric, p_price numeric,
  p_location integer, p_source batch_source, p_document_no text DEFAULT NULL, p_supplier text DEFAULT NULL,
  p_producer_lot text DEFAULT NULL, p_expiry date DEFAULT NULL, p_quality_docs text DEFAULT NULL,
  p_note text DEFAULT NULL)
 RETURNS integer LANGUAGE plpgsql SET search_path TO 'public'
AS $$
declare
  v_batch integer;
  v_op uuid;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Ilość przyjęcia musi być większa od zera.';
  end if;
  if p_price is null then
    raise exception 'Podaj cenę dostawy dla „%” — bez ceny nie da się przyjąć partii.', fn_material_name(p_material);
  end if;
  if p_price < 0 then
    raise exception 'Cena nie może być ujemna.';
  end if;
  insert into batches (material_id, qty_received, unit_price, received_at, source, received_location_build_id,
      document_no, supplier, producer_lot_no, expiry_date, quality_docs)
    values (p_material, p_qty, p_price, current_date, p_source, p_location,
      nullif(trim(p_document_no), ''), nullif(trim(p_supplier), ''), nullif(trim(p_producer_lot), ''),
      p_expiry, nullif(trim(p_quality_docs), ''))
    returning id into v_batch;
  v_op := fn_op_begin('przyjecie', p_location, null, null,
    coalesce(p_note, case when p_document_no is not null then 'Dok. ' || p_document_no end));
  perform fn_ledger_post(v_op, 'przyjecie', p_material, v_batch, p_location, p_qty, 0, p_price,
    p_note => coalesce(p_note, case when p_document_no is not null then 'Dok. ' || p_document_no end));
  update materials set "unitPrice" = p_price, active = true, "updatedAt" = now() where id = p_material;
  if p_location is not null then
    perform fn_settle_shortages(p_location, p_material, 'dostawa');
  end if;
  return v_batch;
end;
$$;

-- Przesunięcie między lokalizacjami (wydanie, zwrot, transfer) — ta sama partia i cena.
CREATE OR REPLACE FUNCTION fn_stock_move(p_op uuid, p_type stock_op_type, p_material integer,
  p_from integer, p_to integer, p_qty numeric, p_batch integer DEFAULT NULL, p_lifo boolean DEFAULT false,
  p_note text DEFAULT NULL)
 RETURNS numeric LANGUAGE plpgsql SET search_path TO 'public'
AS $$
declare
  v_avail numeric;
  v_value numeric := 0;
  a record;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Ilość musi być większa od zera.';
  end if;
  v_avail := case when p_batch is null then fn_available(p_material, p_from)
                  else coalesce((select bb.qty from batch_balances bb where bb.batch_id = p_batch
                                  and bb.location_build_id is not distinct from p_from), 0) end;
  if v_avail < p_qty - 0.00001 then
    raise exception 'Za mało „%” w lokalizacji źródłowej (dostępne %, żądane %).',
      fn_material_name(p_material), round(v_avail, 3), round(p_qty, 3);
  end if;
  for a in select * from fn_alloc(p_material, p_from, p_qty, p_batch, p_lifo) loop
    perform fn_ledger_post(p_op, p_type, p_material, a.batch_id, p_from, -a.take, 0, a.unit_price,
      p_related_build => p_to, p_note => p_note);
    perform fn_ledger_post(p_op, p_type, p_material, a.batch_id, p_to, a.take, 0, a.unit_price,
      p_related_build => p_from, p_note => p_note);
    v_value := v_value + a.take * a.unit_price;
  end loop;
  return v_value;
end;
$$;

-- Cena tymczasowa niedoboru: ostatnia dostawa indeksu, potem kartoteka (D2).
CREATE OR REPLACE FUNCTION fn_provisional_price(p_material integer)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  select coalesce(
    (select unit_price from batches where material_id = p_material order by received_at desc, id desc limit 1),
    (select "unitPrice" from materials where id = p_material), 0);
$$;

-- Zużycie z raportu: partie budowy FEFO→FIFO; reszta ponad saldo = niedobór.
CREATE OR REPLACE FUNCTION fn_stock_consume(p_op uuid, p_build integer, p_material integer, p_qty numeric,
  p_report integer, p_stage text)
 RETURNS numeric LANGUAGE plpgsql SET search_path TO 'public'
AS $$
declare
  v_left numeric := p_qty;
  v_cost numeric := 0;
  v_price numeric;
  v_shortage integer;
  a record;
begin
  if p_qty <= 0.00001 then return 0; end if;
  for a in select * from fn_alloc(p_material, p_build, p_qty) loop
    perform fn_ledger_post(p_op, 'zuzycie', p_material, a.batch_id, p_build, -a.take, a.take, a.unit_price,
      p_build, 'zuzycie', a.take * a.unit_price, p_report, p_stage);
    v_cost := v_cost + a.take * a.unit_price;
    v_left := v_left - a.take;
  end loop;
  if v_left > 0.00001 then
    v_price := fn_provisional_price(p_material);
    insert into shortages (build_id, material_id, report_id, stage_name, qty_original, qty_open, provisional_price)
      values (p_build, p_material, p_report, p_stage, v_left, v_left, v_price)
      returning id into v_shortage;
    perform fn_ledger_post(p_op, 'zuzycie', p_material, null, p_build, 0, v_left, v_price,
      p_build, 'zuzycie', v_left * v_price, p_report, p_stage, v_shortage,
      p_note => 'Niedobór — zużycie ponad stan budowy, do wyjaśnienia przez Admina');
    v_cost := v_cost + v_left * v_price;
  end if;
  return v_cost;
end;
$$;

-- Storno zużycia (korekta raportu w dół): najpierw otwarty niedobór tego
-- raportu/etapu, potem partie LIFO — wraca DOKŁADNIE ta sama partia i cena.
CREATE OR REPLACE FUNCTION fn_stock_reverse(p_op uuid, p_build integer, p_material integer, p_qty numeric,
  p_report integer, p_stage text)
 RETURNS numeric LANGUAGE plpgsql SET search_path TO 'public'
AS $$
declare
  v_left numeric := p_qty;
  v_returned numeric := 0;
  v_take numeric;
  s record;
  r record;
begin
  for s in
    select * from shortages sh
     where sh.build_id = p_build and sh.material_id = p_material and sh.report_id is not distinct from p_report
       and sh.stage_name is not distinct from p_stage and sh.status = 'do_wyjasnienia'
     order by sh.id desc for update
  loop
    exit when v_left <= 0.00001;
    v_take := least(s.qty_open, v_left);
    update shortages set qty_open = qty_open - v_take,
           status = case when qty_open - v_take <= 0.00001 then 'wyjasniony' else status end,
           resolution = case when qty_open - v_take <= 0.00001 then 'korekta_raportu' else resolution end,
           resolved_at = case when qty_open - v_take <= 0.00001 then now() else resolved_at end,
           resolved_by = case when qty_open - v_take <= 0.00001 then auth.uid() else resolved_by end
     where id = s.id;
    perform fn_ledger_post(p_op, 'korekta_raportu', p_material, null, p_build, 0, -v_take, s.provisional_price,
      p_build, 'zuzycie', -v_take * s.provisional_price, p_report, p_stage, s.id,
      p_note => 'Korekta raportu w dół — zmniejszenie niedoboru');
    v_returned := v_returned + v_take * s.provisional_price;
    v_left := v_left - v_take;
  end loop;

  for r in
    select l.id, l.batch_id, l.unit_price,
           l.qty_consumed + coalesce((select sum(x.qty_consumed) from stock_ledger x where x.reversal_of = l.id), 0) as outstanding
      from stock_ledger l
     where l.cost_build_id = p_build and l.material_id = p_material and l.report_id is not distinct from p_report
       and l.stage_name is not distinct from p_stage and l.batch_id is not null and l.qty_consumed > 0
       and l.reversal_of is null
     order by l.id desc
  loop
    exit when v_left <= 0.00001;
    continue when r.outstanding <= 0.00001;
    v_take := least(r.outstanding, v_left);
    perform fn_ledger_post(p_op, 'korekta_raportu', p_material, r.batch_id, p_build, v_take, -v_take, r.unit_price,
      p_build, 'zuzycie', -v_take * r.unit_price, p_report, p_stage, p_reversal_of => r.id,
      p_note => 'Korekta raportu w dół — storno zużycia');
    v_returned := v_returned + v_take * r.unit_price;
    v_left := v_left - v_take;
  end loop;
  return v_returned;
end;
$$;

-- Koszt materiału dnia w raporcie (F12) — z księgi, łącznie z rewyceną niedoboru.
CREATE OR REPLACE FUNCTION fn_report_day_cost(p_report_id integer, p_material_id integer, p_stage_name text)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  select coalesce(round(sum(cost_value), 2), 0) from stock_ledger
   where report_id = p_report_id and material_id = p_material_id
     and stage_name is not distinct from p_stage_name and cost_effect = 'zuzycie';
$$;

-- Wyjaśnienie niedoboru materiałem, który pojawił się na budowie
-- (dostawa / wydanie / transfer): zużycie z partii + rewycena.
CREATE OR REPLACE FUNCTION fn_settle_shortages(p_build integer, p_material integer, p_reason text)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public'
AS $$
declare
  s record;
  a record;
  v_op uuid;
  v_need numeric;
begin
  for s in
    select * from shortages sh
     where sh.build_id = p_build and sh.material_id = p_material and sh.status = 'do_wyjasnienia'
     order by sh.id for update
  loop
    exit when fn_available(p_material, p_build) <= 0.00001;
    if v_op is null then
      v_op := fn_op_begin('rozliczenie_niedoboru', p_build, null, null, 'Wyjaśnienie niedoboru: ' || p_reason);
    end if;
    v_need := s.qty_open;
    for a in select * from fn_alloc(p_material, p_build, v_need) loop
      perform fn_ledger_post(v_op, 'rozliczenie_niedoboru', p_material, null, p_build, 0, -a.take, s.provisional_price,
        p_build, 'zuzycie', -a.take * s.provisional_price, s.report_id, s.stage_name, s.id,
        p_note => 'Niedobór pokryty — cena tymczasowa cofnięta');
      perform fn_ledger_post(v_op, 'rozliczenie_niedoboru', p_material, a.batch_id, p_build, -a.take, a.take, a.unit_price,
        p_build, 'zuzycie', a.take * a.unit_price, s.report_id, s.stage_name, s.id,
        p_note => 'Niedobór pokryty — zużycie z partii');
      v_need := v_need - a.take;
    end loop;
    update shortages set qty_open = v_need,
           status = case when v_need <= 0.00001 then 'wyjasniony' else status end,
           resolution = case when v_need <= 0.00001 then p_reason else resolution end,
           resolved_at = case when v_need <= 0.00001 then now() else resolved_at end,
           resolved_by = case when v_need <= 0.00001 then auth.uid() else resolved_by end
     where id = s.id;
    if s.report_id is not null then
      update report_materials set cost = fn_report_day_cost(s.report_id, p_material, s.stage_name)
       where "reportId" = s.report_id and "materialId" = p_material and stage_name is not distinct from s.stage_name;
    end if;
  end loop;
end;
$$;

-- ---------- 4. Widoki zgodności (stare nazwy, te same kolumny) ----------
CREATE VIEW material_batches WITH (security_invoker = true) AS
  select b.id, b.material_id as "materialId", bb.qty as quantity, b.unit_price as "unitPrice",
         b.received_at as "receivedAt", b.source, b.created_at as "createdAt",
         b.document_no as "documentNumber", b.supplier,
         b.producer_lot_no as "producerLotNo", b.expiry_date as "expiryDate",
         b.quality_docs as "qualityDocs", b.qty_received as "qtyReceived"
    from batches b
    join batch_balances bb on bb.batch_id = b.id and bb.location_build_id is null
   where bb.qty > 0.00001;

CREATE VIEW build_material_lots WITH (security_invoker = true) AS
  select bb.id, bb.location_build_id as "buildId", bb.material_id as "materialId",
         bb.batch_id as "sourceBatchId", bb.qty as quantity, bb.unit_price as "unitPrice",
         bb.first_in_at::timestamp as "issuedAt"
    from batch_balances bb
   where bb.location_build_id is not null and bb.qty > 0.00001
  union all
  select -s.id, s.build_id, s.material_id, null, -s.qty_open, s.provisional_price, s.created_at::timestamp
    from shortages s
   where s.status = 'do_wyjasnienia' and s.qty_open > 0.00001;

CREATE VIEW build_materials WITH (security_invoker = true) AS
  with flows as (
    select coalesce(l.location_build_id, l.cost_build_id) as build_id, l.material_id,
           sum(case when l.location_build_id is not null and l.op_type in ('przyjecie','wydanie','transfer','zwrot')
                    then l.qty_delta else 0 end) as issued,
           sum(case when l.location_build_id is not null and l.op_type in ('przyjecie','wydanie','transfer','zwrot')
                     and l.qty_delta > 0 then l.qty_delta * l.unit_price else 0 end) as in_value,
           sum(case when l.location_build_id is not null and l.op_type in ('przyjecie','wydanie','transfer','zwrot')
                     and l.qty_delta > 0 then l.qty_delta else 0 end) as in_qty,
           sum(l.qty_consumed) as used,
           sum(case when l.cost_effect = 'zuzycie' then l.cost_value else 0 end) as cost
      from stock_ledger l
     where coalesce(l.location_build_id, l.cost_build_id) is not null
     group by 1, 2
  )
  select f.build_id as "buildId", f.material_id as "materialId",
         greatest(f.issued, 0) as planned,
         greatest(f.used, 0) as used,
         case when f.in_qty > 0 then round(f.in_value / f.in_qty, 4) else fn_provisional_price(f.material_id) end as "unitPrice",
         greatest(f.issued, 0) as issued,
         round(f.cost, 2) as "actualCost"
    from flows f;

CREATE VIEW stock_movements WITH (security_invoker = true) AS
  select l.id::integer as id,
         case
           when l.op_type = 'przyjecie' and l.location_build_id is null then 'przyjecie'
           when l.op_type in ('przyjecie','wydanie','transfer','zwrot') and l.location_build_id is not null and l.qty_delta > 0 then 'wydanie'
           when l.op_type in ('wydanie','transfer','zwrot') and l.location_build_id is not null and l.qty_delta < 0 then 'zwrot'
           when l.op_type = 'zwrot' and l.location_build_id is null then 'przyjecie'
           when l.op_type = 'wydanie' and l.location_build_id is null then 'wydanie_z_magazynu'
           when l.op_type in ('zuzycie','rozliczenie_niedoboru') then 'zuzycie'
           when l.op_type = 'strata' then 'strata'
           else 'korekta'
         end as type,
         l.material_id as "materialId", coalesce(l.location_build_id, l.cost_build_id) as "buildId",
         l.batch_id as "batchId", null::integer as "lotId", l.report_id as "reportId",
         case when l.qty_delta <> 0 then abs(l.qty_delta) else abs(l.qty_consumed) end as quantity,
         l.unit_price as "unitPrice", l.note, null::integer as "createdByUserId",
         l.created_at::timestamp as "createdAt", l.created_by::text as "createdByProfileId",
         case when l.op_type = 'transfer' then l.operation_id end as "transferId",
         l.related_build_id as "relatedBuildId", l.op_type::text as "opType",
         l.qty_delta as "qtyDelta", l.location_build_id as "locationBuildId"
    from stock_ledger l;

CREATE VIEW build_material_returns WITH (security_invoker = true) AS
  select l.id::integer as id, l.location_build_id as "buildId", l.material_id as "materialId",
         l.batch_id as "batchId", -l.qty_delta as quantity,
         (case when l.op_type = 'zwrot' then 'zwrot' else 'wyrzucenie' end)::return_decision as decision,
         l.note as reason, l.created_at::timestamp as "createdAt", l.unit_price as "unitPrice"
    from stock_ledger l
   where l.location_build_id is not null and l.qty_delta < 0
     and l.op_type in ('zwrot','strata');

GRANT SELECT ON material_batches, build_material_lots, build_materials, stock_movements, build_material_returns TO authenticated;

-- ---------- 5. Kontrola spójności (N1, N2, N4, cache magazynu) ----------
CREATE OR REPLACE FUNCTION check_stock_integrity()
 RETURNS TABLE(check_name text, detail jsonb) LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  -- N1: saldo = suma ruchów
  select 'N1_saldo_vs_ksiega', jsonb_build_object('batch', x.batch_id, 'location', x.loc, 'saldo', x.bal, 'ksiega', x.led)
    from (
      select coalesce(bb.batch_id, l.batch_id) as batch_id, coalesce(bb.location_build_id, l.location_build_id) as loc,
             coalesce(bb.qty, 0) as bal, coalesce(l.s, 0) as led
        from batch_balances bb
        full join (select batch_id, location_build_id, sum(qty_delta) s from stock_ledger
                    where batch_id is not null group by 1, 2) l
          on l.batch_id = bb.batch_id and l.location_build_id is not distinct from bb.location_build_id
    ) x where abs(x.bal - x.led) > 0.0001
  union all
  -- N2: przyjęto = salda + zużycie + straty (− korekty inwentaryzacyjne)
  select 'N2_bilans_partii', jsonb_build_object('batch', b.id, 'przyjeto', b.qty_received, 'suma_ruchow_przyjecia', r.s)
    from batches b
    left join (select batch_id, sum(qty_delta) s from stock_ledger where op_type in ('przyjecie','korekta_inwentaryzacyjna') and qty_delta > 0 group by 1) r on r.batch_id = b.id
   where abs(b.qty_received - coalesce(r.s, 0)) > 0.0001
  union all
  -- N4: saldo nieujemne
  select 'N4_ujemne_saldo', jsonb_build_object('batch', batch_id, 'location', location_build_id, 'qty', qty)
    from batch_balances where qty < -0.0001
  union all
  -- materials.stock = suma sald w magazynie
  select 'stan_magazynu_vs_salda', jsonb_build_object('material', m.id, 'stock', m.stock, 'salda', coalesce(s.q, 0))
    from materials m
    left join (select material_id, sum(qty) q from batch_balances where location_build_id is null group by 1) s on s.material_id = m.id
   where abs(coalesce(m.stock, 0) - coalesce(s.q, 0)) > 0.0001
  union all
  -- niedobór: otwarta ilość = pierwotna − rozliczona
  select 'niedobor_vs_ksiega', jsonb_build_object('shortage', s.id, 'open', s.qty_open, 'ksiega', coalesce(l.c, 0))
    from shortages s
    left join (select shortage_id, sum(qty_consumed) c from stock_ledger where shortage_id is not null and batch_id is null group by 1) l
      on l.shortage_id = s.id
   where abs(s.qty_open - coalesce(l.c, 0)) > 0.0001
     and s.resolution is distinct from 'roznica_inwentaryzacyjna';
$$;

CREATE OR REPLACE FUNCTION run_stock_integrity_check()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare v_issues jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('check', check_name, 'detail', detail)), '[]'::jsonb)
    into v_issues from check_stock_integrity();
  if jsonb_array_length(v_issues) > 0 then
    insert into stock_integrity_alerts (issues) values (v_issues);
  end if;
  return jsonb_array_length(v_issues);
end;
$$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
-- Funkcje wewnętrzne księgi — tylko z innych funkcji, nie z aplikacji.
REVOKE EXECUTE ON FUNCTION fn_op_begin(stock_op_type, integer, integer, integer, text, boolean),
  fn_ledger_post(uuid, stock_op_type, integer, integer, integer, numeric, numeric, numeric, integer, stock_cost_effect, numeric, integer, text, integer, bigint, integer, text),
  fn_alloc(integer, integer, numeric, integer, boolean),
  fn_stock_receive(integer, numeric, numeric, integer, batch_source, text, text, text, date, text, text),
  fn_stock_move(uuid, stock_op_type, integer, integer, integer, numeric, integer, boolean, text),
  fn_stock_consume(uuid, integer, integer, numeric, integer, text),
  fn_stock_reverse(uuid, integer, integer, numeric, integer, text),
  fn_settle_shortages(integer, integer, text),
  run_stock_integrity_check()
  FROM authenticated;
GRANT EXECUTE ON FUNCTION get_public_build(uuid, text), app_role(), is_superadmin(), is_subcontractor_lead(),
  my_subcontractor_team_ids(), my_subcontractor_team(integer) TO anon;

COMMIT;
