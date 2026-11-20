-- ============================================================
-- Etap 3: druga miara technologii (np. renowacja posadzki z odtworzeniem
-- dylatacji = m² posadzki + mb dylatacji).
--
--   * technologies.secondary_unit / secondary_label — druga jednostka
--     (m2/mb/szt) i jej nazwa ("Dylatacje"); NULL = technologia ma jedną miarę
--   * technology_materials.basis — 'primary' (zużycie na jednostkę
--     podstawową, jak dotąd) albo 'secondary' (na drugą miarę)
--   * builds."quantity2" — ilość drugiej miary na budowie (builds."areaM2"
--     nadal trzyma ilość podstawową)
--   * build_technology_snapshot.unit2/label2, build_material_plan.basis —
--     zamrożone w chwili przypisania, jak reszta snapshotu
--   * assign_technology_to_build(p_build_id, p_technology_id, p_area_m2,
--     p_quantity2 default null): plan = zużycie × (ilość podstawowa albo
--     druga miara — zależnie od basis materiału)
--
-- Seed: N/4, N/5, N/7, N/9 (renowacje z odtworzeniem dylatacji) dostają
-- drugą miarę "Dylatacje" w mb. Materiały ich receptur zostają na miarze
-- podstawowej (m²) — te, które liczą się na mb dylatacji, przestawia się w
-- edytorze technologii ("Liczone na").
-- ============================================================

alter table technologies add column if not exists secondary_unit text;
alter table technologies add column if not exists secondary_label text;
alter table technologies drop constraint if exists technologies_secondary_unit_check;
alter table technologies add constraint technologies_secondary_unit_check
  check (secondary_unit is null or secondary_unit in ('m2', 'mb', 'szt'));

alter table technology_materials add column if not exists basis text not null default 'primary';
alter table technology_materials drop constraint if exists technology_materials_basis_check;
alter table technology_materials add constraint technology_materials_basis_check
  check (basis in ('primary', 'secondary'));

alter table builds add column if not exists "quantity2" numeric;
alter table build_technology_snapshot add column if not exists unit2 text;
alter table build_technology_snapshot add column if not exists label2 text;
alter table build_material_plan add column if not exists basis text not null default 'primary';

update technologies set secondary_unit = 'mb', secondary_label = 'Dylatacje'
where code in ('N/4', 'N/5', 'N/7', 'N/9');

create or replace function update_technology_secondary(p_technology_id integer, p_unit text, p_label text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_role(array['Admin']::app_role[]);
  if p_unit is not null and p_unit not in ('m2', 'mb', 'szt') then
    raise exception 'Nieznana jednostka: % (dozwolone: m2, mb, szt).', p_unit;
  end if;
  update technologies
    set secondary_unit = p_unit,
        secondary_label = case when p_unit is null then null else nullif(trim(p_label), '') end
    where id = p_technology_id;
  if not found then
    raise exception 'Nie znaleziono technologii #%.', p_technology_id;
  end if;
  -- Bez drugiej miary żaden materiał nie może się na niej opierać.
  if p_unit is null then
    update technology_materials set basis = 'primary'
    where stage_id in (select id from technology_stages where technology_id = p_technology_id);
  end if;
end;
$$;
grant execute on function update_technology_secondary(integer, text, text) to authenticated;

drop function if exists assign_technology_to_build(integer, integer, numeric);
create or replace function assign_technology_to_build(
  p_build_id integer,
  p_technology_id integer,
  p_area_m2 numeric,
  p_quantity2 numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tech technologies%rowtype;
  v_snapshot jsonb;
  v_needs_q2 boolean;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_tech from technologies where id = p_technology_id;
  if v_tech.id is null then
    raise exception 'Technologia o id % nie istnieje.', p_technology_id;
  end if;

  if p_area_m2 is null or p_area_m2 <= 0 then
    raise exception 'Ilość (%) musi być większa od zera.', v_tech.unit;
  end if;

  -- Druga miara jest wymagana tylko wtedy, gdy jakiś materiał receptury się na niej opiera.
  select exists (
    select 1 from technology_materials m
    join technology_stages s on s.id = m.stage_id
    where s.technology_id = p_technology_id and m.basis = 'secondary'
  ) into v_needs_q2;
  if v_needs_q2 and (p_quantity2 is null or p_quantity2 <= 0) then
    raise exception '% (%) musi być większe od zera.',
      coalesce(v_tech.secondary_label, 'Druga miara'), coalesce(v_tech.secondary_unit, '');
  end if;

  update builds
    set "areaM2" = p_area_m2,
        "quantity2" = case when v_tech.secondary_unit is null then null else p_quantity2 end
    where id = p_build_id;

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
            'linkedMaterialId', m.linked_material_id,
            'basis', m.basis
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
    technology_version, snapshot_json, unit, unit2, label2
  )
  values (
    p_build_id, v_tech.id, v_tech.code, v_tech.name, v_tech.version,
    coalesce(v_snapshot, '[]'::jsonb), v_tech.unit, v_tech.secondary_unit, v_tech.secondary_label
  );

  delete from build_material_plan where build_id = p_build_id;
  insert into build_material_plan (
    build_id, stage_name, material_name, unit, consumption_per_m2,
    planned_quantity, linked_material_id, basis
  )
  select
    p_build_id,
    s.name,
    m.material_name,
    m.unit,
    m.consumption_per_m2,
    round(m.consumption_per_m2 * case m.basis when 'secondary' then coalesce(p_quantity2, 0) else p_area_m2 end, 3),
    m.linked_material_id,
    m.basis
  from technology_stages s
  join technology_materials m on m.stage_id = s.id
  where s.technology_id = p_technology_id;
end;
$$;
grant execute on function assign_technology_to_build(integer, integer, numeric, numeric) to authenticated;

-- save_technology: zachowuje basis materiałów; nowa wersja dziedziczy jednostkę i drugą miarę.
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

      insert into technologies (code, name, version, is_active, "createdBy", unit, secondary_unit, secondary_label)
      select p_code, p_name, v_version, true, auth.uid(), unit, secondary_unit, secondary_label
      from technologies where id = p_source_id
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
      insert into technology_materials (stage_id, material_name, unit, consumption_per_m2, linked_material_id, is_primary, basis)
      values (
        v_stage_id,
        v_material->>'name',
        coalesce(nullif(v_material->>'unit', ''), 'kg'),
        (v_material->>'consumptionPerM2')::decimal,
        nullif(v_material->>'linkedMaterialId', '')::integer,
        coalesce((v_material->>'isPrimary')::boolean, false),
        case when v_material->>'basis' = 'secondary' then 'secondary' else 'primary' end
      );
    end loop;
  end loop;

  return v_new_id;
end;
$$;
