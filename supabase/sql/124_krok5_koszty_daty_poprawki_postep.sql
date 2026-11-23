-- ============================================================================
-- 124 — Krok 5: jedna kalkulacja kosztów, data wykonania prac vs wysłania,
--        „Odeślij do poprawy” z historią, postęp w portalu z m².
--
-- 1. fn_build_cost(build) — JEDYNE miejsce liczenia kosztu budowy:
--    materiał = Σ wycenionych ruchów zużycia z księgi (stock_ledger),
--    straty = Σ ruchów „strata”, robocizna = godziny × stawka KOSZTOWA
--    zamrożona na wpisie, kilometrówka, koszty dodatkowe raportów,
--    podwykonawcy = protokoły odbioru. Z niej korzystają: karta budowy,
--    ekran Rozliczenie (get_build_costs) i zamknięcie budowy (close_build
--    → build_settlements). Usuwa F17/F18 (karta ≠ Rozliczenie).
-- 2. Data raportu = data WYKONANIA prac. Wysłanie stempluje
--    reports.submitted_at. Brygadzista może raportować dziś i do
--    settings.report_backdate_days dni wstecz (domyślnie 3), nigdy w
--    przyszłość; raport odesłany do poprawy można poprawić niezależnie od
--    wieku. Zamknięty okres (period_locks — miesiąc) blokuje wysłanie i
--    zmianę raportu każdej roli, także Admina, dopóki okresu nie otworzy.
-- 3. review_report(raport, zatwierdź?, komentarz) — zatwierdzenie albo
--    odesłanie do poprawy (komentarz wymagany); każde zdarzenie
--    (wysłany / poprawiony / zatwierdzony / do poprawy) trafia do
--    report_review_log.
-- 4. Portal: postęp etapu = zatwierdzone m² (report_stage_progress z
--    zatwierdzonych raportów) / ilość budowy; etap bez wpisanych m² —
--    jak dotąd z materiałów; etap oznaczony jako zakończony — 100%.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Koszty
-- ---------------------------------------------------------------------------
create or replace function fn_build_cost(p_build_id integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with
  mat as (
    select coalesce(sum(cost_value) filter (where cost_effect = 'zuzycie'), 0) as materials,
           coalesce(sum(cost_value) filter (where cost_effect = 'strata'), 0) as losses
      from stock_ledger where cost_build_id = p_build_id
  ),
  lab as (
    select coalesce(sum(t.hours), 0) as hours,
           coalesce(sum(t.hours * coalesce(t."costRate", e."costRate", t."hourlyRate", e."hourlyRate", 0)), 0) as labor,
           coalesce(sum(t.hours) filter (where coalesce(t."costRate", e."costRate") is null), 0) as hours_without_cost_rate
      from time_entries t join employees e on e.id = t."employeeId"
     where t."buildId" = p_build_id
  ),
  rep as (
    select coalesce(sum("kmCost"), 0) as km from reports where "buildId" = p_build_id
  ),
  ext as (
    select coalesce(sum(rec.amount), 0) as extra
      from report_extra_costs rec join reports r on r.id = rec."reportId"
     where r."buildId" = p_build_id
  ),
  sub as (
    select coalesce(sum(i.amount), 0) as subcontract
      from subcontract_acceptance_items i join subcontract_acceptances a on a.id = i.acceptance_id
     where a.build_id = p_build_id
  )
  select jsonb_build_object(
    'buildId', p_build_id,
    'materials', round(mat.materials, 2),
    'losses', round(mat.losses, 2),
    'hours', round(lab.hours, 2),
    'labor', round(lab.labor, 2),
    'hoursWithoutCostRate', round(lab.hours_without_cost_rate, 2),
    'km', round(rep.km, 2),
    'extra', round(ext.extra, 2),
    'subcontract', round(sub.subcontract, 2),
    'total', round(mat.materials + mat.losses + lab.labor + rep.km + ext.extra + sub.subcontract, 2)
  )
  from mat, lab, rep, ext, sub;
$$;
revoke all on function fn_build_cost(integer) from public, anon, authenticated;

-- Koszty wszystkich (albo wskazanych) budów — tylko Admin (zawiera stawki).
create or replace function get_build_costs(p_build_ids integer[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform assert_role(array['Admin']::app_role[]);
  return coalesce(
    (select jsonb_agg(fn_build_cost(b.id) order by b.id)
       from builds b
      where p_build_ids is null or b.id = any(p_build_ids)),
    '[]'::jsonb);
end;
$$;
revoke all on function get_build_costs(integer[]) from public, anon;
grant execute on function get_build_costs(integer[]) to authenticated;

-- close_build: rozliczenie końcowe z fn_build_cost (te same liczby co na ekranie).
create or replace function close_build(p_build_id integer, p_returns jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_build builds;
  v_pending integer;
  v_ret jsonb;
  v_bal batch_balances;
  v_qty numeric;
  v_decision text;
  v_reason text;
  v_op_ret uuid;
  v_list text;
  v_cost jsonb;
begin
  perform assert_role(array['Admin']::app_role[]);
  select * into v_build from builds where id = p_build_id for update;
  if not found then raise exception 'Nie znaleziono budowy #%.', p_build_id; end if;
  if v_build.status = 'zamknięta' then return; end if;

  select count(*) into v_pending from reports where "buildId" = p_build_id and status <> 'approved';
  if v_pending > 0 then
    raise exception 'Nie wszystkie raporty tej budowy są zatwierdzone — zatwierdź je przed zamknięciem.';
  end if;

  for v_ret in select * from jsonb_array_elements(p_returns) loop
    v_qty := (v_ret->>'quantity')::numeric;
    continue when v_qty is null or v_qty <= 0;
    v_decision := v_ret->>'decision';
    v_reason := nullif(trim(v_ret->>'reason'), '');
    if v_decision not in ('zwrot', 'wyrzucenie') then
      raise exception 'Nieprawidłowa decyzja rozliczenia: %', v_decision;
    end if;
    select * into v_bal from batch_balances
      where id = (v_ret->>'lotId')::integer and location_build_id = p_build_id and qty >= v_qty - 0.00001;
    if not found then
      raise exception 'Partia #% nie leży na tej budowie albo ilość przekracza jej saldo.', v_ret->>'lotId';
    end if;
    if v_decision = 'zwrot' then
      if v_op_ret is null then
        v_op_ret := fn_op_begin('zwrot', p_build_id, null, null, 'Zamknięcie budowy — zwrot na magazyn');
      end if;
      perform fn_stock_move(v_op_ret, 'zwrot', v_bal.material_id, p_build_id, null, v_qty, v_bal.batch_id, false,
        coalesce(v_reason, 'Zamknięcie budowy — zwrot na magazyn'));
    else
      if v_reason is null then raise exception 'Podaj powód wyrzucenia materiału.'; end if;
      perform fn_ledger_post(fn_op_begin('strata', p_build_id, null, null, v_reason), 'strata', v_bal.material_id,
        v_bal.batch_id, p_build_id, -v_qty, 0, v_bal.unit_price, p_build_id, 'strata', v_qty * v_bal.unit_price,
        p_note => v_reason);
    end if;
  end loop;

  select string_agg(fn_material_name(material_id) || ': ' || round(qty_open, 3), ', ') into v_list
    from shortages where build_id = p_build_id and status = 'do_wyjasnienia';
  if v_list is not null then
    raise exception 'Nie można zamknąć budowy — są niedobory do wyjaśnienia: %. Wyjaśnij je na karcie budowy (dostawa, transfer, korekta raportu albo różnica inwentaryzacyjna).', v_list;
  end if;
  select string_agg(fn_material_name(material_id) || ': ' || round(s, 3), ', ') into v_list
    from (select material_id, sum(qty) s from batch_balances where location_build_id = p_build_id group by 1 having sum(qty) > 0.00001) x;
  if v_list is not null then
    raise exception 'Nie można zamknąć budowy — na budowie zostały materiały: %. Zdecyduj: zwrot na magazyn albo do wyrzucenia.', v_list;
  end if;

  v_cost := fn_build_cost(p_build_id);
  insert into build_settlements ("buildId", "totalHours", "totalExtraCosts", "materialsCost", "laborCost",
      "wasteCost", "subcontractCost", "kmCost", "totalCost")
    values (p_build_id, (v_cost->>'hours')::numeric, (v_cost->>'extra')::numeric, (v_cost->>'materials')::numeric,
      (v_cost->>'labor')::numeric, (v_cost->>'losses')::numeric, (v_cost->>'subcontract')::numeric,
      (v_cost->>'km')::numeric, (v_cost->>'total')::numeric)
    on conflict ("buildId") do update set "closedAt" = now(), "totalHours" = excluded."totalHours",
      "totalExtraCosts" = excluded."totalExtraCosts", "materialsCost" = excluded."materialsCost",
      "laborCost" = excluded."laborCost", "wasteCost" = excluded."wasteCost",
      "subcontractCost" = excluded."subcontractCost", "kmCost" = excluded."kmCost", "totalCost" = excluded."totalCost";

  delete from build_settlement_materials where "buildId" = p_build_id;
  insert into build_settlement_materials ("buildId", "materialId", planned, used, "unitPrice", "actualCost")
    select "buildId", "materialId", planned, used, "unitPrice", "actualCost" from build_materials where "buildId" = p_build_id;

  update builds set status = 'zamknięta', "updatedAt" = now() where id = p_build_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Data wykonania prac, okno wstecz, zamknięte okresy
-- ---------------------------------------------------------------------------
alter table settings add column if not exists report_backdate_days integer not null default 3
  check (report_backdate_days between 0 and 31);
alter table reports add column if not exists submitted_at timestamptz;
update reports set submitted_at = coalesce(submitted_at, "createdAt" at time zone 'UTC')
  where status <> 'roboczy';

create table if not exists period_locks (
  month date primary key check (extract(day from month) = 1),
  locked_at timestamptz not null default now(),
  locked_by uuid default auth.uid(),
  note text
);
alter table period_locks enable row level security;
drop policy if exists period_locks_select on period_locks;
create policy period_locks_select on period_locks for select to authenticated using (true);
revoke insert, update, delete on period_locks from anon, authenticated;

create or replace function fn_period_locked(p_date date)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from period_locks where month = date_trunc('month', p_date)::date) $$;

-- Admin zamyka/otwiera miesiąc (np. po wypłatach).
create or replace function set_period_lock(p_month date, p_locked boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform assert_role(array['Admin']::app_role[]);
  if p_locked then
    insert into period_locks (month, note) values (date_trunc('month', p_month)::date, nullif(trim(p_note), ''))
      on conflict (month) do nothing;
  else
    delete from period_locks where month = date_trunc('month', p_month)::date;
  end if;
end;
$$;
revoke all on function set_period_lock(date, boolean, text) from public, anon;
grant execute on function set_period_lock(date, boolean, text) to authenticated;

-- Historia przeglądu raportu.
create table if not exists report_review_log (
  id bigserial primary key,
  report_id integer not null references reports(id) on delete cascade,
  action text not null check (action in ('wyslany', 'poprawiony', 'zatwierdzony', 'do_poprawy')),
  comment text,
  actor uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists report_review_log_report_idx on report_review_log(report_id, created_at);
alter table report_review_log enable row level security;
drop policy if exists report_review_log_select on report_review_log;
-- Widoczność jak raportu (polityki reports zawężają podwykonawcę do jego brygady).
create policy report_review_log_select on report_review_log for select to authenticated
  using (exists (select 1 from reports r where r.id = report_id));
revoke insert, update, delete on report_review_log from anon, authenticated;

-- Strażnik daty + stempel wysłania + wpis w historii (działa wewnątrz
-- submit_daily_report, więc nie trzeba przepisywać tej funkcji).
create or replace function trg_reports_submit_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Warsaw')::date;
  v_days integer;
  v_resubmit_after_fix boolean := tg_op = 'UPDATE' and old.status = 'do_poprawy';
begin
  if new.status <> 'submitted' or coalesce(current_setting('app.report_admin_touch', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'submitted' and new.status = 'submitted'
     and new.date = old.date and new."updatedAt" is not distinct from old."updatedAt" then
    return new; -- zmiana pól pobocznych (np. notatka klienta), nie ponowne wysłanie
  end if;

  if fn_period_locked(new.date) or (tg_op = 'UPDATE' and fn_period_locked(old.date)) then
    raise exception 'Okres % jest zamknięty — raportów z tego miesiąca nie można już wysyłać ani zmieniać. Poproś Admina o otwarcie okresu.',
      to_char(new.date, 'MM.YYYY');
  end if;
  if new.date > v_today then
    raise exception 'Data wykonania prac (%) nie może być z przyszłości.', to_char(new.date, 'DD.MM.YYYY');
  end if;
  if app_role() is distinct from 'Admin' and not v_resubmit_after_fix then
    select report_backdate_days into v_days from settings where id = true;
    v_days := coalesce(v_days, 3);
    if new.date < v_today - v_days then
      raise exception 'Raport za % jest starszy niż % dni — wpisać go może tylko Admin (albo odeślij istniejący raport do poprawy).',
        to_char(new.date, 'DD.MM.YYYY'), v_days;
    end if;
  end if;

  new.submitted_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists reports_submit_guard on reports;
create trigger reports_submit_guard before insert or update on reports
  for each row execute function trg_reports_submit_guard();

create or replace function trg_reports_submit_log()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted'
      or new.submitted_at is distinct from old.submitted_at) then
    insert into report_review_log (report_id, action)
      values (new.id, case when tg_op = 'UPDATE' and old.status = 'do_poprawy' then 'poprawiony' else 'wyslany' end);
  end if;
  return null;
end;
$$;
drop trigger if exists reports_submit_log on reports;
create trigger reports_submit_log after insert or update on reports
  for each row execute function trg_reports_submit_log();

-- ---------------------------------------------------------------------------
-- 3. Zatwierdź / odeślij do poprawy
-- ---------------------------------------------------------------------------
create or replace function review_report(p_report_id integer, p_approve boolean, p_comment text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_report reports;
  v_comment text := nullif(trim(p_comment), '');
begin
  perform assert_role(array['Admin']::app_role[]);
  select * into v_report from reports where id = p_report_id for update;
  if not found then raise exception 'Nie znaleziono raportu #%.', p_report_id; end if;
  if fn_period_locked(v_report.date) then
    raise exception 'Okres % jest zamknięty — otwórz go, żeby zmienić status raportu.', to_char(v_report.date, 'MM.YYYY');
  end if;
  if p_approve then
    if v_report.status = 'approved' then return; end if;
    update reports set status = 'approved', "adminComment" = coalesce(v_comment, "adminComment"), "updatedAt" = now()
      where id = p_report_id;
    insert into report_review_log (report_id, action, comment) values (p_report_id, 'zatwierdzony', v_comment);
  else
    if v_comment is null then
      raise exception 'Napisz, co trzeba poprawić — komentarz jest wymagany przy odesłaniu raportu.';
    end if;
    if v_report.status = 'approved' then
      raise exception 'Raport jest już zatwierdzony — nie można go odesłać do poprawy.';
    end if;
    update reports set status = 'do_poprawy', "adminComment" = v_comment, "updatedAt" = now()
      where id = p_report_id;
    insert into report_review_log (report_id, action, comment) values (p_report_id, 'do_poprawy', v_comment);
  end if;
end;
$$;
revoke all on function review_report(integer, boolean, text) from public, anon;
grant execute on function review_report(integer, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Portal: postęp z zatwierdzonych m²
-- ---------------------------------------------------------------------------
create or replace function get_public_build(p_token uuid, p_pin text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_build record;
  v_pin_ok boolean;
  v_progress numeric;
  v_days_elapsed integer;
  v_expected_progress numeric;
  v_delta numeric;
  v_status_color text;
  v_display_status text;
  v_last_update date;
  v_materials json;
  v_stages json;
  v_technology_name text;
  v_photos json;
  v_notes json;
  v_qty numeric;
begin
  select b.* into v_build from builds b where b.public_token = p_token;
  if not found or v_build.public_access_enabled is not true then
    return null;
  end if;

  v_pin_ok := v_build.public_pin_hash is null
    or (p_pin is not null and crypt(p_pin, v_build.public_pin_hash) = v_build.public_pin_hash);
  if not v_pin_ok then
    return json_build_object('requiresPin', true, 'name', v_build.name, 'number', v_build.number);
  end if;

  select count(distinct r.date) into v_days_elapsed
    from reports r where r."buildId" = v_build.id and r.status = 'approved';

  v_qty := nullif(v_build."areaM2", 0);

  with
  plan_stage as (
    select p.stage_name, min(p.id) as ord,
           sum(least(coalesce(u.used_qty, 0), p.planned_quantity)) / nullif(sum(p.planned_quantity), 0) * 100 as mat_percent
      from build_material_plan p
      left join (
        select rm."materialId", rm.stage_name, sum(rm."usedQuantity") as used_qty
          from report_materials rm join reports r on r.id = rm."reportId"
         where r."buildId" = v_build.id and r.status = 'approved' and rm.stage_name is not null
         group by rm."materialId", rm.stage_name
      ) u on u.stage_name = p.stage_name
         and u."materialId" = coalesce(p.linked_material_id,
              (select m.id from materials m
                where normalize_material_name(m.name) = normalize_material_name(p.material_name) limit 1))
     where p.build_id = v_build.id and p.planned_quantity > 0
     group by p.stage_name
  ),
  done_m2 as (
    select sp.stage_name, sum(sp.quantity) as qty
      from report_stage_progress sp join reports r on r.id = sp.report_id
     where r."buildId" = v_build.id and r.status = 'approved'
     group by sp.stage_name
  ),
  stages as (
    select coalesce(ps.stage_name, d.stage_name) as stage_name,
           coalesce(ps.ord, 1000000) as ord,
           case
             when bss.stage_name is not null then 100
             when d.qty is not null and v_qty is not null then least(d.qty / v_qty * 100, 100)
             else coalesce(ps.mat_percent, 0)
           end as percent
      from plan_stage ps
      full join done_m2 d on d.stage_name = ps.stage_name
      left join build_stage_status bss on bss.build_id = v_build.id
             and bss.stage_name = coalesce(ps.stage_name, d.stage_name)
  )
  select json_agg(json_build_object('name', s.stage_name, 'percent', round(s.percent)) order by s.ord, s.stage_name),
         avg(s.percent)
    into v_stages, v_progress
    from stages s;

  if v_progress is not null then
    v_progress := round(v_progress);
  else
    v_progress := least(round((coalesce(v_days_elapsed, 0)::numeric / nullif(v_build."durationDays", 0)) * 100), 100);
  end if;

  v_expected_progress := least((coalesce(v_days_elapsed, 0)::numeric / nullif(v_build."durationDays", 0)) * 100, 100);
  v_delta := coalesce(v_progress, 0) - coalesce(v_expected_progress, 0);
  v_status_color := case when v_delta >= -5 then 'green' when v_delta >= -15 then 'yellow' else 'red' end;

  if v_build.status = 'zamknięta' then
    v_display_status := 'zamknieta';
  elsif v_build."startDate" > current_date then
    v_display_status := 'nierozpoczeta';
    v_progress := 0;
    v_status_color := null;
  else
    v_display_status := 'aktywna';
  end if;

  select max(r.date) into v_last_update from reports r where r."buildId" = v_build.id and r.status = 'approved';

  select json_agg(m.name order by m.name) into v_materials
    from build_materials bm join materials m on m.id = bm."materialId" where bm."buildId" = v_build.id;

  select technology_name into v_technology_name from build_technology_snapshot where build_id = v_build.id;

  if v_build.show_photos_to_client then
    select json_agg(json_build_object('id', bp."driveFileId", 'createdAt', bp."createdAt") order by bp."createdAt" desc)
      into v_photos
      from (select * from build_photos where "buildId" = v_build.id order by "createdAt" desc limit 24) bp;
  else
    v_photos := '[]'::json;
  end if;

  if v_build.show_notes_to_client then
    select json_agg(json_build_object('date', n.date, 'note', n.client_note) order by n.date desc)
      into v_notes
      from (select date, client_note from reports
             where "buildId" = v_build.id and status = 'approved'
               and client_note is not null and length(trim(client_note)) > 0
             order by date desc limit 1) n;
  else
    v_notes := '[]'::json;
  end if;

  return json_build_object(
    'name', v_build.name,
    'number', v_build.number,
    'address', v_build.address,
    'areaM2', v_build."areaM2",
    'quantityUnit', coalesce((select s.unit from build_technology_snapshot s where s.build_id = v_build.id), 'm2'),
    'startDate', v_build."startDate",
    'plannedEndDate', v_build."startDate"::date + (v_build."durationDays" || ' days')::interval,
    'status', v_build.status,
    'displayStatus', v_display_status,
    'progressPercent', coalesce(v_progress, 0),
    'statusColor', v_status_color,
    'stages', coalesce(v_stages, '[]'::json),
    'materials', coalesce(v_materials, '[]'::json),
    'technologyName', v_technology_name,
    'photos', coalesce(v_photos, '[]'::json),
    'notes', coalesce(v_notes, '[]'::json),
    'aiSummary', case
      when v_build.show_notes_to_client and v_build.ai_client_summary is not null
        and length(trim(v_build.ai_client_summary)) > 0
      then v_build.ai_client_summary else null end,
    'allowClientAiSummary', coalesce(v_build.allow_client_ai_summary, false),
    'lastUpdateDate', v_last_update,
    'photosUrl', v_build."photosUrl",
    'contractValue', case when v_build.show_contract_value_to_client then v_build."contractValue" else null end
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Poprawa m² przez Admina (set_report_stage_progress) dotyka
--    reports."updatedAt" — to NIE jest ponowne wysłanie raportu, więc
--    strażnik daty i historia mają je pominąć (flaga w transakcji).
-- ---------------------------------------------------------------------------
create or replace function set_report_stage_progress(p_report_id integer, p_items jsonb)
returns void
language plpgsql security definer set search_path = public
as $function$
declare
  v_status report_status;
  v_item jsonb;
  v_stage text;
  v_qty decimal;
begin
  perform assert_role(array['Admin']::app_role[]);

  select status into v_status from reports where id = p_report_id for update;
  if not found then
    raise exception 'Nie znaleziono raportu #%.', p_report_id;
  end if;
  if v_status = 'approved' then
    raise exception 'Raport jest już zatwierdzony — m² nie można poprawić.';
  end if;

  delete from report_stage_progress where report_id = p_report_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_stage := nullif(trim(v_item->>'stageName'), '');
    v_qty := (v_item->>'quantity')::decimal;
    continue when v_stage is null or v_qty is null or v_qty <= 0;
    insert into report_stage_progress (report_id, stage_name, quantity, unit)
      values (p_report_id, v_stage, v_qty, coalesce(nullif(v_item->>'unit', ''), 'm2'))
      on conflict (report_id, stage_name) do update set quantity = excluded.quantity, unit = excluded.unit;
  end loop;

  perform set_config('app.report_admin_touch', 'on', true);
  update reports set "updatedAt" = now() where id = p_report_id;
  perform set_config('app.report_admin_touch', 'off', true);
end;
$function$;
