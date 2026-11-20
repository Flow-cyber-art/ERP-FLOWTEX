-- ============================================================
-- Etap 1: jednostka rozliczenia technologii (m2 / mb / szt)
-- Etap 2: "materiał główny" — gdy sama technologia (cokół, kanał, wpust,
--         profil dylatacyjny) jest też materiałem z magazynu.
--
-- Dotąd jednostkę miały tylko technologie z katalogu ofert
-- (offer_pilot_technologies.unit); budowa zawsze pytała o "Powierzchnię
-- (m²)", zapisywała builds."areaM2" i liczyła plan jako m² × zużycie/m².
-- Teraz jednostka jest właściwością technologii:
--   * technologies.unit               — m2 / mb / szt
--   * build_technology_snapshot.unit  — zamrożona jednostka z chwili
--                                       przypisania (jak reszta snapshotu)
--   * builds."areaM2" nadal przechowuje ILOŚĆ w tej jednostce (nazwa
--     kolumny zostaje, żeby nie rozbijać RPC i portalu); "zużycie/m²" w
--     recepturze znaczy teraz "zużycie na jednostkę technologii".
--
-- Korekty jednostek: N/1, N/2, N/3, N/8, N/12, P/2 -> mb (rysy, szwy,
-- dylatacje, obwód przy elementach stalowych). Świadomie BEZ zmian:
--   * SM/1, SM/2 — receptura SM/2 ma zużycie kg/m² powierzchni malowania;
--     zmiana jednostki na mb po cichu zmieniłaby sens tych liczb,
--   * N/13 (naprawy punktowe) i ST/S/1 (schody) — do decyzji.
-- ============================================================

-- ---------- Etap 1 ----------
alter table technologies add column if not exists unit text not null default 'm2';
alter table technologies drop constraint if exists technologies_unit_check;
alter table technologies add constraint technologies_unit_check check (unit in ('m2', 'mb', 'szt'));

update technologies t set unit = p.unit
from offer_pilot_technologies p
where p.technology_id = t.id and p.unit in ('m2', 'mb', 'szt');

update technologies set unit = 'mb' where code in ('N/1', 'N/2', 'N/3', 'N/8', 'N/12', 'P/2');
update offer_pilot_technologies p set unit = 'mb'
from technologies t
where t.id = p.technology_id and t.code in ('N/1', 'N/2', 'N/3', 'N/8', 'N/12', 'P/2');

create or replace function update_technology_unit(p_technology_id integer, p_unit text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_role(array['Admin']::app_role[]);
  if p_unit is null or p_unit not in ('m2', 'mb', 'szt') then
    raise exception 'Nieznana jednostka: % (dozwolone: m2, mb, szt).', p_unit;
  end if;
  update technologies set unit = p_unit where id = p_technology_id;
  if not found then
    raise exception 'Nie znaleziono technologii #%.', p_technology_id;
  end if;
  update offer_pilot_technologies set unit = p_unit where technology_id = p_technology_id;
end;
$$;
grant execute on function update_technology_unit(integer, text) to authenticated;

alter table build_technology_snapshot add column if not exists unit text not null default 'm2';
update build_technology_snapshot s set unit = t.unit
from technologies t where t.id = s.source_technology_id;

create or replace function assign_technology_to_build(p_build_id integer, p_technology_id integer, p_area_m2 numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tech technologies%rowtype;
  v_snapshot jsonb;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_tech from technologies where id = p_technology_id;
  if v_tech.id is null then
    raise exception 'Technologia o id % nie istnieje.', p_technology_id;
  end if;

  if p_area_m2 is null or p_area_m2 <= 0 then
    raise exception 'Ilość (%) musi być większa od zera.', v_tech.unit;
  end if;

  -- builds."areaM2" przechowuje ilość w jednostce technologii (m2/mb/szt).
  update builds set "areaM2" = p_area_m2 where id = p_build_id;

  select jsonb_agg(
    jsonb_build_object(
      'stageName', s.name,
      'orderIndex', s.order_index,
      'materials', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'materialName', m.material_name,
            'unit', m.unit,
            'consumptionPerM2', m.consumption_per_m2,
            'linkedMaterialId', m.linked_material_id
          ) order by m.id
        ), '[]'::jsonb)
        from technology_materials m
        where m.stage_id = s.id
      )
    ) order by s.order_index
  )
  into v_snapshot
  from technology_stages s
  where s.technology_id = p_technology_id;

  delete from build_technology_snapshot where build_id = p_build_id;
  insert into build_technology_snapshot (
    build_id, source_technology_id, technology_code, technology_name,
    technology_version, snapshot_json, unit
  )
  values (
    p_build_id, v_tech.id, v_tech.code, v_tech.name, v_tech.version,
    coalesce(v_snapshot, '[]'::jsonb), v_tech.unit
  );

  delete from build_material_plan where build_id = p_build_id;
  insert into build_material_plan (
    build_id, stage_name, material_name, unit, consumption_per_m2,
    planned_quantity, linked_material_id
  )
  select
    p_build_id,
    s.name,
    m.material_name,
    m.unit,
    m.consumption_per_m2,
    round(m.consumption_per_m2 * p_area_m2, 3),
    m.linked_material_id
  from technology_stages s
  join technology_materials m on m.stage_id = s.id
  where s.technology_id = p_technology_id;
end;
$$;

-- Portal klienta: do JSON-a budowy dokładamy jednostkę ilości (quantityUnit),
-- żeby portal nie podpisywał metrów bieżących jako "m²".
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_public_build';
  if v_def is not null and position('quantityUnit' in v_def) = 0 then
    v_def := replace(
      v_def,
      '''areaM2'', v_build."areaM2",',
      '''areaM2'', v_build."areaM2", ''quantityUnit'', coalesce((select s.unit from build_technology_snapshot s where s.build_id = v_build.id), ''m2''),'
    );
    execute v_def;
  end if;
end $$;

-- ---------- Etap 2 ----------
alter table technology_materials add column if not exists is_primary boolean not null default false;

-- save_technology: zachowuje flagę is_primary (JSON: isPrimary)
create or replace function save_technology(p_source_id integer, p_code text, p_name text, p_stages jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id integer;
  v_version integer;
  v_stage jsonb;
  v_stage_id integer;
  v_material jsonb;
  v_used boolean;
begin
  perform assert_role(array['Admin']::app_role[]);

  if p_code is null or trim(p_code) = '' or p_name is null or trim(p_name) = '' then
    raise exception 'Kod i nazwa technologii są wymagane.';
  end if;

  if p_source_id is not null then
    select exists(
      select 1 from build_technology_snapshot where source_technology_id = p_source_id
    ) into v_used;

    if not v_used then
      update technologies set code = p_code, name = p_name where id = p_source_id;
      delete from technology_stages where technology_id = p_source_id;
      v_new_id := p_source_id;
    else
      select version + 1 into v_version from technologies where id = p_source_id;
      if v_version is null then
        raise exception 'Technologia o id % nie istnieje.', p_source_id;
      end if;
      update technologies set is_active = false where id = p_source_id;

      -- nowa wersja dziedziczy jednostkę poprzedniej
      insert into technologies (code, name, version, is_active, "createdBy", unit)
      values (p_code, p_name, v_version, true, auth.uid(),
              (select unit from technologies where id = p_source_id))
      returning id into v_new_id;
    end if;
  else
    insert into technologies (code, name, version, is_active, "createdBy")
    values (p_code, p_name, 1, true, auth.uid())
    returning id into v_new_id;
  end if;

  for v_stage in select * from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb))
  loop
    insert into technology_stages (technology_id, name, order_index)
    values (
      v_new_id,
      v_stage->>'name',
      coalesce((v_stage->>'orderIndex')::integer, 0)
    )
    returning id into v_stage_id;

    for v_material in select * from jsonb_array_elements(coalesce(v_stage->'materials', '[]'::jsonb))
    loop
      insert into technology_materials (stage_id, material_name, unit, consumption_per_m2, linked_material_id, is_primary)
      values (
        v_stage_id,
        v_material->>'name',
        coalesce(nullif(v_material->>'unit', ''), 'kg'),
        (v_material->>'consumptionPerM2')::decimal,
        nullif(v_material->>'linkedMaterialId', '')::integer,
        coalesce((v_material->>'isPrimary')::boolean, false)
      );
    end loop;
  end loop;

  return v_new_id;
end;
$$;

-- Materiał główny dla technologii, których nazwa jest też materiałem
-- (cokoły bez receptury, profile dylatacyjne, kanały, wpusty): 1 jednostka
-- technologii = 1 jednostka materiału, w osobnym etapie "Materiał główny".
-- Pomijamy technologie z prawdziwą recepturą (CT/1, CT/4, CT/8 — zużycie w kg/mb).
do $$
declare
  t record;
  v_stage_id integer;
begin
  for t in
    select id, name, unit from technologies
    where is_active
      and code in ('CS/1', 'CT/2', 'CT/3', 'CT/5', 'CT/6', 'CT/7',
                   'DB/1', 'DF/1', 'DS/1',
                   'ACO/K/1', 'ACO/K/2', 'ACO/W/1', 'WL/K/1')
      and not exists (
        select 1 from technology_materials m
        join technology_stages s on s.id = m.stage_id
        where s.technology_id = technologies.id and m.is_primary
      )
  loop
    insert into technology_stages (technology_id, name, order_index)
    values (
      t.id,
      'Materiał główny',
      coalesce((select min(order_index) from technology_stages where technology_id = t.id), 1) - 1
    )
    returning id into v_stage_id;

    -- jednostka materiału w zapisie jak w UNIT_OPTIONS aplikacji (m² / mb / szt.)
    insert into technology_materials (stage_id, material_name, unit, consumption_per_m2, is_primary)
    values (v_stage_id, t.name, case t.unit when 'm2' then 'm²' when 'szt' then 'szt.' else t.unit end, 1, true);
  end loop;
end $$;
