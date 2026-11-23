-- ============================================================
-- 117. Podwykonawca wybierany wprost przy budowie (bez ręcznego
--      zakładania i przypisywania brygady).
--
-- Z testów: w kreatorze budowy "Podwykonawcy" pokazywało tylko brygady
-- przypisane do firmy, więc świeżo dodaną firmę trzeba było najpierw
-- podpiąć do brygady w zakładce Podwykonawcy. Podwykonawca to osobny byt
-- (firma) — wybiera się go wprost.
--
-- Pod spodem model zostaje (111/112): na budowie pracuje brygada
-- (build_teams), a brygada podwykonawcy to teams.subcontractor_id — przez
-- nią jego brygadzista raportuje. add_subcontractor_to_build bierze
-- pierwszą aktywną brygadę firmy, a gdy firma żadnej nie ma, zakłada ją
-- sama (nazwa = nazwa firmy). Brygadzistę firmy można dopisać później
-- (HR → Zespół → Brygady), raporty działają od tej chwili.
--
-- Supabase -> SQL Editor -> wklej całość -> Run. Uruchom PO 112.
-- Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

create or replace function subcontractor_team_for(p_subcontractor_id integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub subcontractors;
  v_team_id integer;
begin
  perform assert_role(array['Admin']::app_role[]);

  select * into v_sub from subcontractors where id = p_subcontractor_id;
  if not found then
    raise exception 'Nie znaleziono podwykonawcy #%.', p_subcontractor_id;
  end if;

  select id into v_team_id
    from teams
    where subcontractor_id = p_subcontractor_id and active
    order by id
    limit 1;

  if v_team_id is null then
    insert into teams (name, active, subcontractor_id, "createdAt", "updatedAt")
      values (v_sub.name, true, p_subcontractor_id, now(), now())
      returning id into v_team_id;
  end if;

  return v_team_id;
end;
$$;

grant execute on function subcontractor_team_for(integer) to authenticated;

-- Dopina podwykonawcę do budowy (zakres etapów: NULL = wszystkie).
-- Zwraca id brygady, przez którą firma pracuje na tej budowie.
create or replace function add_subcontractor_to_build(
  p_build_id integer,
  p_subcontractor_id integer,
  p_stage_names text[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id integer;
begin
  perform assert_role(array['Admin']::app_role[]);

  if not exists (select 1 from builds where id = p_build_id) then
    raise exception 'Nie znaleziono budowy #%.', p_build_id;
  end if;

  v_team_id := subcontractor_team_for(p_subcontractor_id);

  insert into build_teams (build_id, team_id, stage_names)
    values (p_build_id, v_team_id, p_stage_names)
    on conflict (build_id, team_id) do update set stage_names = excluded.stage_names;

  return v_team_id;
end;
$$;

grant execute on function add_subcontractor_to_build(integer, integer, text[]) to authenticated;
