-- ============================================================
-- `save_technology()` (005_faza1_technologie.sql) do tej pory ZAWSZE
-- tworzyło nową wersję przy edycji (nowy wiersz w `technologies`,
-- stara wersja dezaktywowana) — nawet dla technologii, której jeszcze
-- nikt nigdzie nie użył. Przy częstym poprawianiu receptury (literówka,
-- doprecyzowanie zużycia materiału) generowało to lawinę martwych,
-- nigdy nieużytych wersji w historii.
--
-- Naprawa: jeśli edytowana technologia (p_source_id) NIE jest jeszcze
-- przypisana do ŻADNEJ budowy (brak wiersza w build_technology_snapshot
-- z source_technology_id = p_source_id) — edytuj W MIEJSCU, bez
-- tworzenia nowej wersji (ten sam id, ta sama wersja; stare etapy/
-- materiały kasowane i wstawiane od nowa). Gdy technologia JEST już
-- użyta na jakiejś budowie — zachowanie bez zmian: nowa wersja, stara
-- dezaktywowana, żeby budowa z przypisaną recepturą nigdy nie zobaczyła
-- późniejszej zmiany (patrz assign_technology_to_build — zamraża
-- snapshot w build_technology_snapshot/build_material_plan w momencie
-- przypisania).
--
-- Bezpieczne do wielokrotnego wklejenia. Jak uruchomić: Supabase
-- Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

create or replace function save_technology(
  p_source_id integer,
  p_code text,
  p_name text,
  p_stages jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
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
      -- Technologia nigdy nie była użyta na żadnej budowie — edycja W
      -- MIEJSCU, bez nowej wersji.
      update technologies set code = p_code, name = p_name where id = p_source_id;
      -- Kasuje też technology_materials przez ON DELETE CASCADE.
      delete from technology_stages where technology_id = p_source_id;
      v_new_id := p_source_id;
    else
      select version + 1 into v_version from technologies where id = p_source_id;
      if v_version is null then
        raise exception 'Technologia o id % nie istnieje.', p_source_id;
      end if;
      update technologies set is_active = false where id = p_source_id;

      insert into technologies (code, name, version, is_active, "createdBy")
      values (p_code, p_name, v_version, true, auth.uid())
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
      insert into technology_materials (stage_id, material_name, unit, consumption_per_m2, linked_material_id)
      values (
        v_stage_id,
        v_material->>'name',
        coalesce(nullif(v_material->>'unit', ''), 'kg'),
        (v_material->>'consumptionPerM2')::decimal,
        nullif(v_material->>'linkedMaterialId', '')::integer
      );
    end loop;
  end loop;

  return v_new_id;
end;
$function$;
