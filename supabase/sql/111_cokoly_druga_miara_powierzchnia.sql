-- ============================================================
-- 111: cokoły rozliczane w mb, ale z lakierem/farbą liczoną na m²
-- powierzchni cokołu (CT/2, CT/3, CT/5) - druga miara technologii
-- (patrz 107): "Powierzchnia cokołu" w m², ilość podawana na budowie
-- ręcznie (quantity2). Dawki z kart Księgi Technicznej
-- (docs/ksiega-techniczna/03_Cokoly), materiały trafiają do etapów
-- założonych w 110 z basis = 'secondary'.
--   CT/2: Peran SL 0.50 kg/m²;  CT/5: Flowshield LXP 0.50 kg/m²
--   CT/3: Flowseal EPW Glossy 0.25 kg/m² x 2 warstwy (0.50 łącznie)
-- CT/6, CT/7: karty bez dawek (proporcja 1:5) - bez zmian.
-- Idempotentna.
-- ============================================================

update technologies set secondary_unit = 'm2', secondary_label = 'Powierzchnia cokołu'
where code in ('CT/2', 'CT/3', 'CT/5') and secondary_unit is null;

create or replace function _seed_secondary_material(p_code text, p_stage text, p_name text, p_unit text, p_dose numeric)
returns void
language plpgsql
as $$
declare
  v_stage_id integer;
begin
  select s.id into v_stage_id
  from technology_stages s join technologies t on t.id = s.technology_id
  where t.code = p_code and t.is_active and s.name = p_stage
  order by t.version desc, s.id limit 1;
  if v_stage_id is null then
    raise notice '% / % : brak etapu - pominięto (uruchom najpierw 110)', p_code, p_stage;
    return;
  end if;
  if not exists (select 1 from technology_materials where stage_id = v_stage_id and material_name = p_name) then
    insert into technology_materials (stage_id, material_name, unit, consumption_per_m2, basis)
    values (v_stage_id, p_name, p_unit, p_dose, 'secondary');
  end if;
end;
$$;

select _seed_secondary_material('CT/2', 'Lakierowanie cokołu', 'Peran SL (żywica epoksydowa)', 'kg', 0.50);
select _seed_secondary_material('CT/5', 'Lakierowanie cokołu', 'Flowshield LXP (żywica poliuretanowa)', 'kg', 0.50);
select _seed_secondary_material('CT/3', 'Malowanie 1 (podkładowe)', 'Flowseal EPW Glossy', 'kg', 0.25);
select _seed_secondary_material('CT/3', 'Malowanie 2 (po związaniu pierwszej)', 'Flowseal EPW Glossy', 'kg', 0.25);

drop function _seed_secondary_material(text, text, text, text, numeric);
