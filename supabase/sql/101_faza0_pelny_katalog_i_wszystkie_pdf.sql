-- ============================================================
-- Pełny katalog Księgi Technicznej + podpięcie WSZYSTKICH przesłanych
-- kart PDF (użytkownik dorzucił do bucketu `karty technologiczne`
-- resztę biblioteki — 107 plików zamiast wcześniejszych 27/3-na-folder).
--
-- Dotąd mieliśmy tylko próbkę "po 3 na folder" (095) + 8 kart z realnej
-- oferty wzorcowej (099) = 33 technologie w bazie. Ten plik dodaje
-- WSZYSTKIE pozostałe technologie, których pliki faktycznie są w
-- Storage — kategorie i jednostki (m2/mb/szt) zweryfikowane wprost ze
-- struktury folderów na Dysku Google (Księga Techniczna Flowtex), nie
-- zgadywane z samego prefiksu kodu.
--
-- ŚWIADOMIE POMINIĘTE / NIE dodane tu:
--   - ST/PU/24 "Deckshield LBD grubość 5-6mm" (plik
--     ST-PU-24-Systemowa-posadzka-Deckhield-LBD-...) — kod ST/PU/24 jest
--     już zajęty przez inną, zweryfikowaną kartę (Flowfresh SF 3mm, patrz
--     099). Użytkownik: "indeksy sa stare bedzie zmiana" — czekamy na
--     nową numerację zamiast zgadywać.
--   - 2 dodatkowe duplikaty pliku P/12 (bez "-dok-A-" w nazwie) — te same
--     karty co już mamy, inny plik źródłowy; link idzie do wersji
--     "-dok-A-" (spójna z resztą folderu P:0).
--   - Duplikat ST/EPO/4 "TIKSO" — inna wersja tej samej karty; link idzie
--     do wersji "-OK-" (spójnej z konwencją nazewnictwa całego folderu).
--
-- Brak technology_stages/technology_materials dla nowych technologii
-- (zużycie materiału do wyceny w kroku 3) — wymagałoby przeczytania
-- treści każdej z ~65 kart osobno. Krok 3 po prostu nie pokaże rozbicia
-- kosztu materiału dla tych kart (tak jak już działa dla P/12), ale
-- cena sprzedaży w kroku 4 i realny załączony PDF działają w pełni.
-- ============================================================

-- ---------- Nowe technologie (bez treści opisowej — real PDF ją zastępuje w dokumencie oferty) ----------

insert into technologies (code, name, company, is_active, version) values
  ('ACO/W/1', 'Wpust ACO 157', 'ACO', true, 1),
  ('CS/1', 'Systemowy cokół Ucrete RG (H=8cm)', 'Sika', true, 1),
  ('CT/2', 'Cokół pod epoksydowe systemy SL', 'Tremco CPG', true, 1),
  ('CT/3', 'Cokół Flowseal EPW', 'Tremco CPG', true, 1),
  ('CT/5', 'Cokół pod epoksydowe systemy LXP', 'Tremco CPG', true, 1),
  ('CT/6', 'Systemowy cokół Peran STB (H=10cm)', 'Tremco CPG', true, 1),
  ('CT/7', 'Systemowy cokół Peran STB (H=8cm)', 'Tremco CPG', true, 1),
  ('N/1', 'Klamrowanie konstrukcyjne i zszywanie betonu z pęknięciami powyżej 1,0 mm', null, true, 1),
  ('N/2', 'Laminowanie pęknięć osiadłych i skurczowych o rozwartości powyżej 0,3 mm', null, true, 1),
  ('N/3', 'Laminowanie pęknięć osiadłych i skurczowych o rozwartości powyżej 0,5 mm', null, true, 1),
  ('N/4', 'Renowacja posadzki Flowfresh SR z odtworzeniem dylatacji', null, true, 1),
  ('N/5', 'Renowacja posadzki Deckshield ID z odtworzeniem dylatacji', null, true, 1),
  ('N/7', 'Renowacja posadzki Flowfresh SR UV z odtworzeniem dylatacji', null, true, 1),
  ('N/8', 'Naprawa wyszczerbionych dylatacji na posadzkach Flowfresh lub Ucrete', null, true, 1),
  ('N/10', 'Warstwa wyrównawcza z żywicy epoksydowej', null, true, 1),
  ('N/11', 'Warstwa naprawczo-wyrównawcza MMA', null, true, 1),
  ('N/12', 'Iniekcja ciśnieniowa rys w betonie', null, true, 1),
  ('P/1', 'Przygotowanie betonu — śrutowanie bezpyłowe i obróbka krawędziowa', null, true, 1),
  ('P/2', 'Wykonanie spadków licujących przy elementach stalowych', null, true, 1),
  ('P/3', 'Szlifowanie planetarne i obróbka krawędziowa', null, true, 1),
  ('P/4', 'Demontaż warstw wierzchnich (płytki, wylewki mineralne)', null, true, 1),
  ('P/5', 'Szpachlowanie spadków', null, true, 1),
  ('P/7', 'Obróbka pionowa podłoża — piaskowanie', null, true, 1),
  ('P/11', 'Demontaż warstw wierzchnich z wykładziny', null, true, 1),
  ('SS/EPO/2', 'Sikagard 7000CR', 'Sika', true, 1),
  ('SS/PU/2', 'System posadzkowy Ucrete DP10 6mm', 'Sika', true, 1),
  ('SS/PU/3', 'System posadzkowy Ucrete UD200 9mm', 'Sika', true, 1),
  ('SS/PU/4', 'System posadzkowy Ucrete UD200 6mm', 'Sika', true, 1),
  ('SS/PU/5', 'System posadzkowy Ucrete CS10 9mm', 'Sika', true, 1),
  ('SS/PU/6', 'System posadzkowy Sikafloor MultiDur ES-30 (2,0mm)', 'Sika', true, 1),
  ('SS/PU/7', 'System posadzkowy Ucrete RG 9mm', 'Sika', true, 1),
  ('SS/PU/8', 'System posadzkowy Ucrete DP10 4mm', 'Sika', true, 1),
  ('SS/PU/9', 'System posadzkowy Ucrete DP20 9mm', 'Sika', true, 1),
  ('SS/PU/10', 'System posadzkowy Ucrete UD200 SR 9mm', 'Sika', true, 1),
  ('ST/DPM/1', 'System posadzkowy Hydraseal DPM', 'Tremco CPG', true, 1),
  ('ST/EPO/1', 'System posadzkowy STB Compact (2,5-3,0mm)', 'Tremco CPG', true, 1),
  ('ST/EPO/2', 'System posadzkowy Peran ESD STB Compact (3,0mm)', 'Tremco CPG', true, 1),
  ('ST/EPO/3', 'System posadzkowy Flowcoat SF41 (1,5mm)', 'Tremco CPG', true, 1),
  ('ST/EPO/4', 'System posadzkowy Flowcoat SF41 na ścianach pionowych (System Fundamentowy)', 'Tremco CPG', true, 1),
  ('ST/EPO/5', 'System posadzkowy Peran ESD SL20 (2,0mm)', 'Tremco CPG', true, 1),
  ('ST/EPO/6', 'System posadzkowy Peran STB 8 Structure (2,0mm)', 'Tremco CPG', true, 1),
  ('ST/EPO/7', 'System posadzkowy Flowcoat ESD SF41', 'Tremco CPG', true, 1),
  ('ST/EPO/8', 'System posadzkowy Peran SL LE (2,5mm)', 'Tremco CPG', true, 1),
  ('ST/EPO/9', 'System posadzkowy Peran ESD SL (2,0mm)', 'Tremco CPG', true, 1),
  ('ST/EPO/10', 'System posadzkowy Peran SL (2,0mm)', 'Tremco CPG', true, 1),
  ('ST/EPO/11', 'System posadzkowy Peran SL20 (2,0mm)', 'Tremco CPG', true, 1),
  ('ST/MMA/1', 'System posadzkowy Deckshield Rapide ID (2,0mm)', 'Tremco CPG', true, 1),
  ('ST/MMA/2', 'System posadzkowy Deckshield Rapide ED (2,0mm)', 'Tremco CPG', true, 1),
  ('ST/MMA/3', 'System posadzkowy Deckshield Rapide ED (4,0mm)', 'Tremco CPG', true, 1),
  ('ST/NWL/1', 'System posadzkowy Flowcoat EPN (1,5mm)', 'Tremco CPG', true, 1),
  ('ST/PU/1', 'System posadzkowy Flowfresh SR 6mm', 'Tremco CPG', true, 1),
  ('ST/PU/3', 'System posadzkowy Flowfresh SR 9mm', 'Tremco CPG', true, 1),
  ('ST/PU/4', 'System posadzkowy Flowfresh MF 4mm', 'Tremco CPG', true, 1),
  ('ST/PU/5', 'System posadzkowy Flowfresh MF 6mm', 'Tremco CPG', true, 1),
  ('ST/PU/6', 'System posadzkowy Flowfresh HF 9mm', 'Tremco CPG', true, 1),
  ('ST/PU/7', 'System posadzkowy Flowfresh RT 6mm', 'Tremco CPG', true, 1),
  ('ST/PU/8', 'System posadzkowy Flowfresh RT 9mm', 'Tremco CPG', true, 1),
  ('ST/PU/9', 'System posadzkowy Flowfresh ID (1,5mm)', 'Tremco CPG', true, 1),
  ('ST/PU/10', 'System posadzkowy Flowfresh ESD SR UV (4,0mm)', 'Tremco CPG', true, 1),
  ('ST/PU/11', 'System posadzkowy Flowfresh ESD SL (2,0mm)', 'Tremco CPG', true, 1),
  ('ST/PU/12', 'System posadzkowy Flowfresh SL (4,0mm)', 'Tremco CPG', true, 1),
  ('ST/PU/13', 'System posadzkowy Flowfresh SR 8mm', 'Tremco CPG', true, 1),
  ('ST/PU/14', 'System posadzkowy Flowfresh SR 11mm', 'Tremco CPG', true, 1),
  ('ST/PU/15', 'System posadzkowy Deckshield ID (1,5mm)', 'Tremco CPG', true, 1),
  ('ST/PU/16', 'System posadzkowy Deckshield ID (3,0mm)', 'Tremco CPG', true, 1),
  ('ST/PU/17', 'System posadzkowy Flowfresh SL / Deckshield Finish (3,0mm)', 'Tremco CPG', true, 1),
  ('ST/PU/18', 'System posadzkowy Deckshield ID (1,5mm) + Hydraseal DPM', 'Tremco CPG', true, 1),
  ('ST/PU/19', 'System posadzkowy Deckshield HD + TopCoat (2,5mm)', 'Tremco CPG', true, 1),
  ('ST/PU/20', 'System posadzkowy Deckshield ED (2,0mm)', 'Tremco CPG', true, 1),
  ('ST/PU/21', 'System posadzkowy Flowcoat SK (1,5mm)', 'Tremco CPG', true, 1),
  ('ST/PU/22', 'System posadzkowy Flowshield LXP (2,0mm)', 'Tremco CPG', true, 1),
  ('ST/VE/1', 'System posadzkowy Flowchem VE ESD GL (2,5mm)', 'Tremco CPG', true, 1),
  ('ST/VE/2', 'System posadzkowy Flowchem VE GL (2,5mm)', 'Tremco CPG', true, 1)
on conflict (code, version) do nothing;

-- ---------- Przypisanie WSZYSTKICH (nowych i istniejących) do pilotażu ----------
-- Kategorie i jednostki zweryfikowane wprost z realnej struktury
-- folderów na Dysku (nie zgadywane z prefiksu kodu — np. ACO/W/1 to
-- "sztuka", nie m²/mb).

insert into offer_pilot_technologies (technology_id, category_name, unit)
select id, 'WL:K:1 - Kanały Liniowe i Wpusty', 'szt' from technologies where code = 'ACO/W/1'
union all
select id, 'CS:CT:0 - Systemowe Cokoły', 'mb' from technologies where code in ('CS/1','CT/2','CT/3','CT/5','CT/6','CT/7')
union all
select id, 'N:0 - Naprawy', 'm2' from technologies where code in ('N/1','N/2','N/3','N/4','N/5','N/7','N/8','N/10','N/11','N/12')
union all
select id, 'P:0 - Przygotowanie Betonu', 'm2' from technologies where code in ('P/1','P/2','P/3','P/4','P/5','P/7','P/11')
union all
select id, 'SS:0 - Systemy SIKA', 'm2' from technologies where code in ('SS/EPO/2','SS/PU/2','SS/PU/3','SS/PU/4','SS/PU/5','SS/PU/6','SS/PU/7','SS/PU/8','SS/PU/9','SS/PU/10')
union all
select id, 'ST:0 - Systemy TREMCO', 'm2' from technologies where code in (
  'ST/DPM/1','ST/EPO/1','ST/EPO/2','ST/EPO/3','ST/EPO/4','ST/EPO/5','ST/EPO/6','ST/EPO/7','ST/EPO/8','ST/EPO/9','ST/EPO/10','ST/EPO/11',
  'ST/MMA/1','ST/MMA/2','ST/MMA/3','ST/NWL/1',
  'ST/PU/1','ST/PU/3','ST/PU/4','ST/PU/5','ST/PU/6','ST/PU/7','ST/PU/8','ST/PU/9','ST/PU/10','ST/PU/11','ST/PU/12','ST/PU/13','ST/PU/14',
  'ST/PU/15','ST/PU/16','ST/PU/17','ST/PU/18','ST/PU/19','ST/PU/20','ST/PU/21','ST/PU/22',
  'ST/VE/1','ST/VE/2'
)
on conflict (technology_id) do update set category_name = excluded.category_name, unit = excluded.unit;

-- ---------- Podpięcie realnych PDF-ów (wszystkie technologie w pilotażu) ----------
-- Ta sama metoda dopasowania po prefiksie kodu w nazwie pliku co
-- 098_faza0_karty_pdf_prawdziwy_bucket.sql, teraz na całym zbiorze 107
-- plików. Jawnie wykluczone dwie znane wieloznaczności (patrz komentarz
-- na górze pliku): duplikaty P/12 bez "-dok-a-" i wariant "tikso" dla
-- ST/EPO/4.

insert into technology_documents (technology_id, storage_path, original_filename)
select distinct on (t.id) t.id, o.name, o.name
from technologies t
join offer_pilot_technologies opt on opt.technology_id = t.id
join storage.objects o
  on o.bucket_id = 'karty technologiczne'
  and o.name ~* ('^' || regexp_replace(lower(t.code), '/', '[-_]', 'g') || '[^0-9a-z]')
  and o.name ilike '%.pdf'
  and o.name not ilike '%deckhield-lbd%'      -- ST/PU/24: patrz 098 — zostawiamy Flowfresh SF 3mm
  and not (t.code = 'P/12' and o.name not ilike '%dok-a%')   -- P/12: preferuj wersję "-dok-A-"
  and not (t.code = 'ST/EPO/4' and o.name ilike '%tikso%')   -- ST/EPO/4: preferuj wersję "-OK-"
order by t.id, o.name
on conflict (technology_id) do update set storage_path = excluded.storage_path, original_filename = excluded.original_filename;
