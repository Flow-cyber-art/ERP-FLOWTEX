-- Naprawa: pozycje receptur technologicznych (technology_materials) bez
-- powiązania z magazynem (linked_material_id IS NULL) powodowały, że
-- rzeczywiste zużycie w Rozliczeniu budowy (settlement-screen.tsx) było
-- pokazywane jako "Materiały pomocnicze (spoza planu technologii)" zamiast
-- pod właściwym etapem technologii, mimo że plan istniał (Przypisano/
-- Zużyto/Koszt renderowały się jako 0 w tabeli per-etap — patrz
-- docs/PROCES_KOSZT_PLANOWANY_VS_RZECZYWISTY.md, sekcja z dnia 2026-08-27).
--
-- Ta migracja jednorazowo dowiązuje po DOKŁADNEJ nazwie (materials.name =
-- technology_materials.material_name), tylko gdy dopasowanie jest
-- JEDNOZNACZNE (dokładnie jedno trafienie w materials). Przypadki
-- niejednoznaczne lub bez trafienia zostają NULL — do ręcznego dowiązania
-- w edytorze technologii (Panel Admina → Technologie), gdzie od teraz pole
-- jest wymagane przy zapisie (patrz components/screens/technologies-screen.tsx).
--
-- Bezpieczne do wielokrotnego wklejenia (aktualizuje tylko wiersze z NULL).

do $$
declare
  v_tech_matched integer;
  v_tech_ambiguous integer;
  v_tech_unmatched integer;
  v_plan_matched integer;
begin
  -- 1) technology_materials — recepta (źródło przy przyszłych przypisaniach
  --    technologii do nowych budów).
  with matches as (
    select tm.id, m.matched_id
    from technology_materials tm
    join lateral (
      select array_agg(mm.id) as ids
      from materials mm
      where mm.name = tm.material_name
    ) agg on true
    left join lateral (
      select agg.ids[1] as matched_id
      where array_length(agg.ids, 1) = 1
    ) m on true
    where tm.linked_material_id is null
  )
  update technology_materials tm
  set linked_material_id = matches.matched_id
  from matches
  where tm.id = matches.id and matches.matched_id is not null;

  get diagnostics v_tech_matched = row_count;

  select count(*) into v_tech_ambiguous
  from technology_materials tm
  where tm.linked_material_id is null
    and (select count(*) from materials mm where mm.name = tm.material_name) > 1;

  select count(*) into v_tech_unmatched
  from technology_materials tm
  where tm.linked_material_id is null
    and (select count(*) from materials mm where mm.name = tm.material_name) = 0;

  -- 2) build_material_plan — zamrożone snapshoty planu dla budów, które
  --    JESZCZE NIE zostały zamknięte (status <> 'zamknięta'): to wciąż
  --    "żywe" plany, więc warto je też dowiązać retroaktywnie, żeby
  --    Rozliczenie budowy od razu pokazało poprawny podział. Zamknięte
  --    budowy mają już zamrożone `build.settlement` — nie dotykamy ich.
  with matches as (
    select bmp.id, m.matched_id
    from build_material_plan bmp
    join builds b on b.id = bmp.build_id and b.status <> 'zamknięta'
    join lateral (
      select array_agg(mm.id) as ids
      from materials mm
      where mm.name = bmp.material_name
    ) agg on true
    left join lateral (
      select agg.ids[1] as matched_id
      where array_length(agg.ids, 1) = 1
    ) m on true
    where bmp.linked_material_id is null
  )
  update build_material_plan bmp
  set linked_material_id = matches.matched_id
  from matches
  where bmp.id = matches.id and matches.matched_id is not null;

  get diagnostics v_plan_matched = row_count;

  raise notice 'Naprawa linked_material_id: technology_materials dowiązano=%, niejednoznaczne=%, bez dopasowania=%; build_material_plan (aktywne budowy) dowiązano=%',
    v_tech_matched, v_tech_ambiguous, v_tech_unmatched, v_plan_matched;
end $$;

-- Raport do ręcznej weryfikacji: pozycje receptur wciąż bez powiązania po
-- naprawie (niejednoznaczne nazwy lub brak odpowiednika w magazynie).
select
  t.code as technologia_kod,
  t.name as technologia_nazwa,
  ts.name as etap,
  tm.material_name,
  (select count(*) from materials mm where mm.name = tm.material_name) as liczba_dopasowan
from technology_materials tm
join technology_stages ts on ts.id = tm.stage_id
join technologies t on t.id = ts.technology_id
where tm.linked_material_id is null
order by t.code, ts.order_index, tm.material_name;
