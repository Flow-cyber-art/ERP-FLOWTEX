-- ============================================================
-- Faza 0: pełna struktura katalogu Księgi Technicznej (Dysk Google) w
-- wizardzie ofert — 27 realnych kart technicznych z 12 rzeczywistych
-- folderów Księgi (nie z wymyślonej listy 8 kategorii z pierwszego
-- prototypu). Treść (opis/fazy/zużycie materiału) przepisana z realnych
-- plików .docx "Karta Standardu Wykonawczego" na Dysku — po 3 na
-- folder tam, gdzie jest ich więcej; tam gdzie folder ma mniej niż 3
-- pliki, wstawiono tyle, ile faktycznie jest (patrz rozmowa).
--
-- Świadomie NIE dotykamy `technologies`/`technology_stages`/
-- `technology_materials` w sensie ALTER — tylko INSERT nowych wierszy,
-- wyłącznie addytywnie, obok istniejących 3 (SIPOPU40M3 itd.).
--
-- offer_pilot_technologies rozszerzone o `category_name` (pełna nazwa
-- folderu z Dysku — używana jako klucz grupowania w akordeonie kroku 2,
-- bo dwa foldery na Dysku mają ten sam krótki kod "SS:0" — "Systemy
-- schodowe" i "Systemy SIKA" — więc kod sam w sobie nie jest unikalny,
-- pełna nazwa jest) oraz `unit` (część kategorii rozlicza się w mb, nie
-- w m² — kanały liniowe, dylatacje, cokoły — więc jednostka musi być
-- właściwością technologii, nie sztywnym założeniem wizardu).
--
-- Oryginalne 3 automatycznie zasiane technologie (094_faza0_oferty.sql)
-- są usuwane WYŁĄCZNIE z `offer_pilot_technologies` (odpięte od
-- pilotażu) — same wiersze w `technologies` zostają nietknięte.
-- ============================================================

alter table offer_pilot_technologies add column if not exists category_name text;
alter table offer_pilot_technologies add column if not exists unit text not null default 'm2';

delete from offer_pilot_technologies;

-- ---------- ST:0 - Systemy TREMCO ----------

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('ST/PU/24', 'Systemowa posadzka Flowfresh SF 3mm', 'Tremco CPG', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Nacięcia kotwiące', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zasadnicza', 2 from new_tech returning id
), s3 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zamykająca', 3 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Flowfresh SL (A+B+C+D)', 'kg', 3.80 from s2
union all select id, 'Piasek kwarcowy 0,4-0,8 mm', 'kg', 3.00 from s2
union all select id, 'Flowcoat SF41', 'kg', 0.70 from s3;

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('ST/PU/23', 'Systemowa posadzka Flowfresh HF', 'Tremco CPG', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Nacięcia kotwiące', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Grunt', 2 from new_tech returning id
), s3 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zasadnicza', 3 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Flowfresh Primer (A+B+C)', 'kg', 0.35 from s2
union all select id, 'Piasek kwarcowy 0,4-0,8 mm', 'kg', 0.50 from s2
union all select id, 'Flowfresh HF (A+B+C+D)', 'kg', 13.00 from s3;

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('ST/PU/2', 'Systemowa posadzka Flowfresh SR 4mm', 'Tremco CPG', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Nacięcia kotwiące', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zasadnicza', 2 from new_tech returning id
), s3 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zamykająca', 3 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Flowfresh SL (A+B+C+D)', 'kg', 4.00 from s2
union all select id, 'Piasek kwarcowy 0,4-0,8 mm', 'kg', 2.50 from s2
union all select id, 'Flowfresh Coating Matt (A+B+C+D)', 'kg', 0.70 from s3;

-- ---------- SP:0 - Systemy PPG ----------

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('SP/EPO/1', 'Systemowa posadzka epoksydowa Fontefloor EP Sand', 'PPG', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Grunt', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zasadnicza', 2 from new_tech returning id
), s3 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zamykająca', 3 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Fontefloor 400', 'kg', 0.35 from s1
union all select id, 'Piasek kwarcowy 0,4-0,8 mm', 'kg', 0.50 from s1
union all select id, 'Fontefloor 300', 'kg', 0.70 from s2
union all select id, 'Piasek kwarcowy 0,4-0,8 mm (pełny zasyp)', 'kg', 2.50 from s2
union all select id, 'Fontefloor 300 (zamykająca)', 'kg', 0.70 from s3;

-- ---------- N:0 - Naprawy ----------

with new_tech as (
  insert into technologies (code, name, is_active, version)
  values ('N/13', 'Naprawy punktowe', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Grunt', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Masa naprawcza', 2 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Protop 1000 (A+B)', 'kg', 0.35 from s1
union all select id, 'Peran SL 20', 'kg', 2.50 from s2;

with new_tech as (
  insert into technologies (code, name, is_active, version)
  values ('N/9', 'Renowacja posadzki Flowfresh SR Matt z odtworzeniem dylatacji', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa bazowa', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa finalna', 2 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Flowfresh Coating Matt', 'kg', 0.35 from s1
union all select id, 'Piasek kwarcowy 0,2-0,8 mm', 'kg', 2.00 from s1
union all select id, 'Flowfresh Coating Matt (finalna)', 'kg', 0.70 from s2;

with new_tech as (
  insert into technologies (code, name, is_active, version)
  values ('N/6', 'Scratch Coat na bazie Flowfresh MF', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa naprawcza', 1 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Flowfresh MF', 'kg', 3.00 from s1;

-- ---------- WL:K:1 - Kanały Liniowe i Wpusty (mb) ----------

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('ACO/K/1', 'Wymiana kanału Aco Drain Deklie P100, ruszt B125 tworzywowy', 'ACO', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Ława fundamentowa i obetonowanie', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Uszczelnienie dylatacji', 2 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'SikaGrout-314', 'kg', 2.20 from s1
union all select id, 'Sikaflex-11 FC+', 'kg', 0.10 from s2;

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('ACO/K/2', 'Aco Drain Multislot 150 (Grzebień)', 'ACO', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Posadowienie korpusów', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Uszczelnienie dylatacji', 2 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'SikaGrout-314', 'kg', 2.20 from s1
union all select id, 'Sikaflex-11 FC+', 'kg', 0.10 from s2;

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('WL/K/1', 'Montaż odwodnień liniowych Wodaland MEGA E600', 'Wodaland', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Obetonowanie boczne', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Uszczelnienie styków', 2 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Beton C25/30', 'm3', 0.15 from s1
union all select id, 'Sikaflex-11 FC', 'kg', 0.10 from s2;

-- ---------- P:0 - Przygotowanie Betonu ----------

with new_tech as (
  insert into technologies (code, name, is_active, version)
  values ('P/8', 'Warstwa wyrównawcza', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Grunt', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Masa dociągająca', 2 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Protop 1000 (A+B)', 'kg', 0.50 from s1
union all select id, 'Peran SLC (A+B+C)', 'kg', 0.50 from s2;

with new_tech as (
  insert into technologies (code, name, is_active, version)
  values ('P/10', 'Uzupełnianie ubytków', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Grunt', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Zaprawa naprawcza', 2 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Protop 1000', 'kg', 0.40 from s1
union all select id, 'Piasek kwarcowy 0,4-0,8 mm', 'kg', 0.50 from s1
union all select id, 'Protop 1000 (zaprawa)', 'kg', 2.50 from s2
union all select id, 'Mieszanka piasków kwarcowych', 'kg', 20.00 from s2;

with new_tech as (
  insert into technologies (code, name, is_active, version)
  values ('P/9', 'Warstwa naprawcza Flowfresh MF', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa naprawcza', 1 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Flowfresh MF (A+B+C+D)', 'kg', 4.00 from s1;

-- ---------- DS:0 - Systemowe Dylatacje (mb, bez podanego zużycia w karcie) ----------

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('DS/1', 'Systemowe przeniesienie dylatacji przeciwskurczowej Sikaflex 415', 'Sika', true, 1)
  returning id
)
insert into technology_stages (technology_id, name, order_index)
select id, 'Oczyszczenie i osadzenie sznura', 1 from new_tech
union all select id, 'Nacięcie i wypełnienie Sikaflex 415', 2 from new_tech;

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('DB/1', 'Systemowe przeniesienie dylatacji przeciwskurczowej Boll', 'Boll', true, 1)
  returning id
)
insert into technology_stages (technology_id, name, order_index)
select id, 'Oczyszczenie i osadzenie sznura', 1 from new_tech
union all select id, 'Nacięcie i wypełnienie masą Boll', 2 from new_tech;

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('DF/1', 'FloorBridge SLX 15/10', 'FloorBridge', true, 1)
  returning id
)
insert into technology_stages (technology_id, name, order_index)
select id, 'Przygotowanie bruzdy', 1 from new_tech
union all select id, 'Montaż panelu dylatacyjnego', 2 from new_tech;

-- ---------- SM:0 - Malowanie pasów ----------

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('SM/1', 'Pozioma organizacja ruchu (Maestria Bandax Sprint)', 'Maestria', true, 1)
  returning id
)
insert into technology_stages (technology_id, name, order_index)
select id, 'Przygotowanie i oklejenie', 1 from new_tech
union all select id, 'Malowanie dwuwarstwowe Bandax Sprint', 2 from new_tech;

with new_tech as (
  insert into technologies (code, name, is_active, version)
  values ('SM/2', 'Malowanie ciągów komunikacyjnych', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Grunt', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zasadnicza', 2 from new_tech returning id
), s3 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zamykająca', 3 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Protop 1000', 'kg', 0.35 from s1
union all select id, 'Piasek kwarcowy 0,4-0,8 mm', 'kg', 2.00 from s1
union all select id, 'Deckshield SF', 'kg', 0.50 from s2
union all select id, 'Piasek kwarcowy 0,4-0,8 mm', 'kg', 1.00 from s2
union all select id, 'Deckshield Finish (RAL)', 'kg', 0.60 from s3;

-- ---------- CS:CT:0 - Systemowe Cokoły (mb) ----------

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('CT/8', 'Cokół malowany StoCryl WV 200', 'Sto', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa podkładowa', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa krycia', 2 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'StoCryl WV 200', 'kg', 0.25 from s1
union all select id, 'StoCryl WV 200 (krycie)', 'kg', 0.25 from s2;

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('CT/1', 'Systemowy cokół wyoblany Flowfresh Cove (H=8cm, R=5cm)', 'Tremco CPG', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Wyoblenie', 1 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Flowfresh Cove', 'kg', 3.50 from s1;

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('CT/4', 'Uszczelnienie dylatacji obwodowych', 'Boll', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Uszczelnienie', 1 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Masa poliuretanowa Boll', 'kg', 0.15 from s1;

-- ---------- SST:0 - Systemy STO ----------

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('SST/EPO/1', 'StoPox KU 614 ESD', 'Sto', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Grunt', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Instalacja odprowadzająca ESD', 2 from new_tech returning id
), s3 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa przewodząca', 3 from new_tech returning id
), s4 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zasadnicza', 4 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'StoPos GH 530 (A+B)', 'kg', 0.35 from s1
union all select id, 'Taśma miedziana Peran Copperstrip', 'mb', 1.00 from s2
union all select id, 'StoPox WL 110', 'kg', 0.15 from s3
union all select id, 'StoPox KU 614', 'kg', 2.00 from s4;

-- ---------- SS:0 - Systemy schodowe ----------

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('ST/S/1', 'Wykończenie schodów prefabrykowanych w systemie Deckshield', 'Tremco CPG', true, 1)
  returning id
)
insert into technology_stages (technology_id, name, order_index)
select id, 'Szlifowanie i szpachlowanie', 1 from new_tech
union all select id, 'Aplikacja Deckshield SF + zasyp', 2 from new_tech
union all select id, 'Zamknięcie Deckshield Finish', 3 from new_tech;

-- ---------- SSW:0 - Systemy Sherwin&William ----------

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('SWW/PU/1', 'System posadzkowy FasTop Multi RS69 SRA (Heavy Duty)', 'Sherwin Williams', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zasadnicza', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zamykająca', 2 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'FasTop Multi RS69', 'kg', 16.00 from s1
union all select id, 'Piasek kwarcowy 0,4-0,8 mm', 'kg', 3.00 from s1
union all select id, 'FasTop Multi T150', 'kg', 0.70 from s2;

-- ---------- SS:0 - Systemy SIKA ----------

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('SS/PU/11', 'Posadzka Ucrete DP10 9,0mm', 'Sika', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zasadnicza', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zamykająca', 2 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Ucrete BC9', 'kg', 16.00 from s1
union all select id, 'Piasek kwarcowy 0,4-0,8 mm', 'kg', 4.00 from s1
union all select id, 'Ucrete TopCoat', 'kg', 0.70 from s2;

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('SS/EPO/1', 'Sikagard -63N', 'Sika', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Grunt', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zasadnicza', 2 from new_tech returning id
), s3 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zamykająca', 3 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Sikafloor 151', 'kg', 0.40 from s1
union all select id, 'Środek tiksotropowy Stellmittel T', 'kg', 0.008 from s1
union all select id, 'Sikagard -63N', 'kg', 0.40 from s2
union all select id, 'Sikagard -63N (zamykająca)', 'kg', 0.40 from s3;

with new_tech as (
  insert into technologies (code, name, company, is_active, version)
  values ('SS/PU/1', 'Systemowa posadzka chemoodporna Sikafloor MultiDur ES-31', 'Sika', true, 1)
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Grunt', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zasadnicza', 2 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Sikafloor-151', 'kg', 0.50 from s1
union all select id, 'Sikafloor-381', 'kg', 2.50 from s2
union all select id, 'Piasek kwarcowy 0,1-0,3 mm', 'kg', 0.50 from s2;

-- ---------- Przypisanie do pilotażu (kategoria + jednostka) ----------

insert into offer_pilot_technologies (technology_id, category_name, unit)
select id, 'ST:0 - Systemy TREMCO', 'm2' from technologies where code in ('ST/PU/24','ST/PU/23','ST/PU/2') and company = 'Tremco CPG'
union all
select id, 'SP:0 - Systemy PPG', 'm2' from technologies where code = 'SP/EPO/1'
union all
select id, 'N:0 - Naprawy', 'm2' from technologies where code in ('N/13','N/9','N/6')
union all
select id, 'WL:K:1 - Kanały Liniowe i Wpusty', 'mb' from technologies where code in ('ACO/K/1','ACO/K/2','WL/K/1')
union all
select id, 'P:0 - Przygotowanie Betonu', 'm2' from technologies where code in ('P/8','P/10','P/9')
union all
select id, 'DS:0 - Systemowe Dylatacje', 'mb' from technologies where code in ('DS/1','DB/1','DF/1')
union all
select id, 'SM:0 - Malowanie pasów', 'm2' from technologies where code in ('SM/1','SM/2')
union all
select id, 'CS:CT:0 - Systemowe Cokoły', 'mb' from technologies where code in ('CT/8','CT/1','CT/4')
union all
select id, 'SST:0 - Systemy STO', 'm2' from technologies where code = 'SST/EPO/1'
union all
select id, 'SS:0 - Systemy schodowe', 'm2' from technologies where code = 'ST/S/1'
union all
select id, 'SSW:0 - Systemy Sherwin&William', 'm2' from technologies where code = 'SWW/PU/1'
union all
select id, 'SS:0 - Systemy SIKA', 'm2' from technologies where code in ('SS/PU/11','SS/EPO/1','SS/PU/1')
on conflict (technology_id) do update set category_name = excluded.category_name, unit = excluded.unit;
