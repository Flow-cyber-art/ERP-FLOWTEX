-- ============================================================
-- Treść "Karty Standardu Wykonawczego" (opis technologii / przebieg
-- prac / korzyści dla Inwestora) potrzebna do prawdziwego kroku
-- "Podgląd oferty" — porównanie z realną ofertą FLOWTEX N/Ref 26103
-- (dostarczoną jako wzorzec) pokazało, że tych treści w ogóle nie
-- mieliśmy w bazie: technologies/technology_stages/technology_materials
-- niosą tylko dane do wyceny (zużycie materiału), zero opisu do
-- dokumentu dla klienta.
--
-- Dodaje 3 nowe, w pełni odwracalne kolumny (nullable — brak treści =
-- ta sekcja po prostu nie renderuje się w dokumencie, żadnego wymogu):
--   description        — opis technologii (1 akapit)
--   work_phases         — jsonb: tablica stringów, kolejne fazy prac
--                          (numeracja "Faza N" dodawana przy renderze,
--                          nie w danych)
--   investor_benefits   — jsonb: tablica stringów, "Co zyskuje Inwestor?"
--
-- Wypełnione dla 8 z 9 kart użytych w realnej ofercie N/Ref 26103:
-- P/12, ACO/K/1, ACO/K/2, P/6, ST/PU/25, CT/8, DS/1, SM/1 — treść
-- przepisana słowo w słowo z tej oferty (PDF dostarczony przez
-- użytkownika). P/12, P/6 i ST/PU/25 nie istniały wcześniej w naszym
-- katalogu (przy transkrypcji 27 kart z Dysku w 095 wylosowały się
-- inne 3 pliki z tych samych folderów P:0/ST:0) — dodane tu jako nowe
-- technologie.
--
-- ŚWIADOMIE POMINIĘTE: ST/PU/24. W realnej ofercie N/Ref 26103 ten kod
-- to "Systemowa posadzka Deckshield LBD grubość 5-6mm", ale w naszym
-- katalogu (095, zweryfikowane z aktualnym stanem Dysku Google) ten sam
-- kod ST/PU/24 jest dziś przypisany innej, aktualnej karcie —
-- "Systemowa posadzka Flowfresh SF 3mm" (numeracja kart się kiedyś
-- powtórzyła, patrz komentarz w 098_faza0_karty_pdf_prawdziwy_bucket.sql).
-- Nadpisanie nazwy/treści ST/PU/24 danymi z PDF nadpisałoby ten
-- zweryfikowany, aktualny wpis czymś nieaktualnym — do wyjaśnienia z
-- użytkownikiem, nie zgadywane samodzielnie w tej migracji.
-- ============================================================

alter table technologies add column if not exists description text;
alter table technologies add column if not exists work_phases jsonb;
alter table technologies add column if not exists investor_benefits jsonb;

-- ---------- Nowe technologie (brakujące w 095, użyte w N/Ref 26103) ----------

with new_tech as (
  insert into technologies (code, name, is_active, version, description, work_phases, investor_benefits)
  values (
    'P/12', 'Wycinanie dwustronne kanału', true, 1,
    'Wycinanie dwustronne kanału pod wymianę na nowy to precyzyjny proces mechanicznego nacinania płyty betonowej wzdłuż wyznaczonej trasy nowo projektowanego kanału technologicznego lub odwodnieniowego. Zabieg ten ma na celu całkowite odseparowanie usuwanej sekcji betonu od pozostałej struktury posadzki, zapobiegając jej uszkodzeniu, spękaniom oraz obłupywaniu krawędzi podczas późniejszych prac wyburzeniowych. Prace wykonywane są przy użyciu profesjonalnych przecinarek jezdnych lub ręcznych wyposażonych w diamentowe tarcze tnące na mokro lub na sucho z odsysaniem pyłu.',
    '["Geodezyjne lub traserskie wyznaczenie linii cięcia wzdłuż obu krawędzi planowanego kanału z uwzględnieniem wymaganej szerokości strefy roboczej.","Wykonanie dwustronnego nacięcia posadzki betonowej tnącą tarczą diamentową na zadaną głębokość technologiczną (np. 50–100 mm lub do odpowiedniej grubości płyty) wzdłuż wyznaczonych linii trasowania.","Oczyszczenie powstałych szczelin ciętych oraz przyległego pasa posadzki z urobku i pyłu betonowego za pomocą odkurzacza przemysłowego dużej mocy."]'::jsonb,
    '["Precyzyjna linia cięcia chroni sąsiadującą konstrukcję posadzki przed wykruszeniami i pęknięciami zmęczeniowymi podczas późniejszego kucia betonu.","Idealnie równe, pionowe krawędzie ułatwiają późniejszy montaż nowego koryta kanałowego oraz prawidłowe wykonanie odtworzeniowych połączeń dylatacyjnych.","Zastosowanie odsysania pyłu lub chłodzenia wodą eliminuje uciążliwe zapylenie, co pozwala na bezpieczne prowadzenie prac w czynnych obiektach przemysłowych."]'::jsonb
  )
  returning id
)
select 1 from new_tech; -- brak stawki zużycia materiału (ryczałt w realnej ofercie) — bez technology_stages, patrz materialsNote w prototypie

with new_tech as (
  insert into technologies (code, name, is_active, version, description, work_phases, investor_benefits)
  values (
    'P/6', 'Frezowanie podłoża i obróbka krawędziowa', true, 1,
    'Frezowanie podłoża to proces intensywnej, mechanicznej obróbki skrawaniem podłoża betonowego lub grubych, zdegradowanych powłok żywicznych za pomocą maszyn bębnowych (frezarek). Metoda ta jest niezbędna przy renowacjach wymagających obniżenia poziomu posadzki, usuwaniu grubych warstw klejów, jastrychów oraz niwelowaniu znacznych nierówności podłoża. Miejsca niedostępne dla frezarki bębnowej (narożniki, obrzeża przy ścianach) wymagają obróbki metodami alternatywnymi – ręcznymi szlifierkami kątowymi z tarczami diamentowymi.',
    '["Dobór odpowiedniego typu frezów (np. frezy gwiazdkowe lub z węglików spiekanych) oraz ustawienie głębokości skrawania maszyny.","Przejazd frezarką bębnową. Prace prowadzone są pasami „na zakładkę” (ok. 2-5 cm), aby zapewnić równomierne zebranie materiału i uniknąć powstawania niesfrezowanych garbów.","Obróbka krawędziowa pasów wzdłuż ścian, słupów i dylatacji za pomocą szlifierek diamentowych w celu usunięcia materiału w miejscach niedostępnych dla frezarki głównej."]'::jsonb,
    '["Frezowanie bez problemu radzi sobie z grubymi powłokami, z którymi szlifowanie mogłoby sobie nie poradzić.","Proces nadaje powierzchni wysoką chropowatość, co gwarantuje doskonałe zakotwiczenie mechaniczne dla nowych, grubowarstwowych jastrychów cementowych lub polimerowo-cementowych.","Podłączenie frezarek do systemowych odkurzaczy przemysłowych o dużej mocy minimalizuje zapylenie, chroniąc otoczenie budowy."]'::jsonb
  )
  returning id
)
select 1 from new_tech; -- praca czysto mechaniczna — brak zużywalnego materiału chemicznego do rozliczenia na m²

with new_tech as (
  insert into technologies (code, name, company, is_active, version, description, work_phases, investor_benefits)
  values (
    'ST/PU/25', 'Deckshield LBD grubość rampa 5-6mm', 'Tremco CPG', true, 1,
    'Deckshield LBD w wariancie na rampy to specjalistyczny, elastyczny system posadzkowy na bazie żywic poliuretanowych przeznaczony do zabezpieczania mocno obciążonych, pochyłych nawierzchni parkingowych oraz ramp zjazdowych. System o grubości 5-6 mm tworzy trwałą, szczelną powłokę odporną na intensywny ruch kołowy, dynamiczne obciążenia oraz czynniki atmosferyczne i promieniowanie UV. Charakteryzuje się podwyższoną szorstkością wykończenia, doskonałą przyczepnością do podłoża oraz wysoką zdolnością do mostkowania rys w konstrukcji betonowej.',
    '["Wykonanie nacięć kotwiących przy krawędziach.","Rozłożenie bazy Deckshield DPM przy zużyciu 5,60 kg/m² wraz z zasypem piaskiem kwarcowym o frakcji 0,8-1,2 mm w ilości 3,50 kg/m² w celu odprężenia, uszczelnienia podłoża oraz zapewnienia przyczepności mechanicznej.","Aplikacja warstwy zamykającej z żywicy poliuretanowej Deckshield Finish (A+B) przy zużyciu 1,1 kg/m² w celu nadania ostatecznej odporności chemicznej, mechanicznej oraz estetycznego wykończenia.","Aplikacja odpornej na promieniowanie UV warstwy wykończeniowej Deckshield Topcoat UV przy zużyciu 0,40 kg/m² zapewniającej ostateczną odporność chemiczną, stabilność kolorystyczną oraz zwiększoną trwałość nawierzchni na działanie czynników zewnętrznych."]'::jsonb,
    '["Wysoka odporność na poślizg i wymóg bezpiecznego ruchu pojazdów na pochyłych rampach zjazdowych przy zmiennych warunkach atmosferycznych.","Pełna odporność na promieniowanie UV oraz starzenie pod wpływem warunków pogodowych.","Trwała ochrona podłoża betonowego przed penetracją wody, soli odladzających, paliw oraz wycieków płynów eksploatacyjnych przy jednoczesnym tłumieniu hałasu toczonych opon."]'::jsonb
  )
  returning id
), s1 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Nacięcia kotwiące', 1 from new_tech returning id
), s2 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa bazowa', 2 from new_tech returning id
), s3 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa zamykająca', 3 from new_tech returning id
), s4 as (
  insert into technology_stages (technology_id, name, order_index)
  select id, 'Warstwa UV', 4 from new_tech returning id
)
insert into technology_materials (stage_id, material_name, unit, consumption_per_m2)
select id, 'Deckshield DPM', 'kg', 5.60 from s2
union all select id, 'Piasek kwarcowy 0,8-1,2 mm', 'kg', 3.50 from s2
union all select id, 'Deckshield Finish (A+B)', 'kg', 1.10 from s3
union all select id, 'Deckshield Topcoat UV', 'kg', 0.40 from s4;

-- ---------- Istniejące technologie — dopisanie treści dokumentu ----------

update technologies set
  description = 'Kompleksowa wymiana i montaż kanału odwodnienia liniowego w systemie ACO Drain Deklie P100 wyposażonego w ruszt tworzywowy w klasie obciążeń B125. Technologia obejmuje demontaż uszkodzonego odcinka, przygotowanie gniazda montażowego, precyzyjne osadzenie korpusów polimerobetonowych na podbudowie oraz ich obetonowanie i uszczelnienie. Rozwiązanie to dedykowane jest do stref ruchu pieszego i ciągów komunikacyjnych dla samochodów osobowych oraz lekkich wózków dostawczych, zapewniając skuteczne odprowadzenie wód opadowych i procesowych przy zachowaniu pełnej odporności chemicznej i mechanicznej.',
  work_phases = '["Przygotowanie gniazda montażowego i krawędzi wykopu poprzez wycięcie piłą tarczową, wyklucie betonu do odpowiednich wymiarów technologicznych oraz dokładne odkurzenie podłoża przemysłowym odkurzaczem z wyniesieniem gruzu do kontenera.","Uszczelnienie nowo powstałej bruzdy oraz posadowienie (montaż) i pozycjonowanie korpusów odwodnienia ACO Drain Deklie P100 z szybkosprawnej, bezskurczowej zaprawy ekspansywnej.","Wykonanie dylatacji obwodowej i uszczelnienie połączeń na styku korpusu kanału z posadzką przy użyciu elastycznej masy poliuretanowej Sikaflex-11 FC."]'::jsonb,
  investor_benefits = '["Trwały i odporny na korozję system odwodnienia liniowego o klasie obciążeń B125, pozwalający na bezpieczny ruch samochodów osobowych i lekkiego transportu bez ryzyka uszkodzenia rusztu lub korpusu.","Doskonała szczelność i ochrona podbudowy posadzki przed penetracją wody i agresywnych substancji chemicznych dzięki zastosowaniu bezskurczowych zapraw montażowych oraz elastycznych mas uszczelniających.","Estetyczne wykończenie i pełna kompatybilność z istniejącą nawierzchnią betonową lub żywiczną, ograniczająca przestoje na obiekcie dzięki zastosowaniu szybkosprawnej chemii budowlanej."]'::jsonb
where code = 'ACO/K/1';

update technologies set
  description = 'Kompleksowa wymiana i montaż kanału odwodnienia liniowego w systemie montażu oraz obróbki krawędziowej odwodnienia liniowego ACO Drain Multislot 150 z rusztem grzebieniowym. Technologia obejmuje demontaż uszkodzonego odcinka, przygotowanie gniazda montażowego, precyzyjne osadzenie korpusów polimerobetonowych na podbudowie oraz ich obetonowanie i uszczelnienie. Rozwiązanie to dedykowane jest do stref ruchu pieszego i ciągów komunikacyjnych dla samochodów osobowych oraz lekkich wózków dostawczych, zapewniając skuteczne odprowadzenie wód opadowych i procesowych przy zachowaniu pełnej odporności chemicznej i mechanicznej.',
  work_phases = '["Przygotowanie gniazda montażowego i krawędzi wykopu poprzez wycięcie piłą tarczową, wyklucie betonu do odpowiednich wymiarów technologicznych oraz dokładne odkurzenie podłoża przemysłowym odkurzaczem z wyniesieniem gruzu do kontenera.","Uszczelnienie nowo powstałej bruzdy oraz posadowienie (montaż) i pozycjonowanie korpusów odwodnienia ACO Drain Multislot 150 z rusztem grzebieniowym, z szybkosprawnej zaprawy ekspansywnej.","Wykonanie dylatacji obwodowej i uszczelnienie połączeń na styku korpusu kanału z posadzką przy użyciu elastycznej masy poliuretanowej Sikaflex-11 FC."]'::jsonb,
  investor_benefits = '["Trwały i odporny na korozję system odwodnienia liniowego o klasie obciążeń B125.","Doskonała szczelność i ochrona podbudowy posadzki przed penetracją wody i agresywnych substancji chemicznych dzięki zastosowaniu bezskurczowych zapraw montażowych oraz elastycznych mas uszczelniających.","Gładka, wyprofilowana linia odpływu z rusztem grzebieniowym zapewniająca wysoką przepustowość hydrauliczną oraz łatwość w utrzymaniu czystości i higieny."]'::jsonb
where code = 'ACO/K/2';

update technologies set
  description = 'StoCryl WV 200 to wodorozcieńczalna, barwna powłoka epoksydowa przeznaczona do zabezpieczania i estetycznego wykańczania powierzchni pionowych, w tym cokołów systemowych oraz ścian w obiektach przemysłowych i komercyjnych. System o wykończeniu z połyskiem (Glossy) charakteryzuje się bardzo dobrą paroprzepuszczalnością, doskonałą przyczepnością do podłoży cementowych oraz wysoką odpornością na zmywanie i lekkie obciążenia chemiczne. Umożliwia stworzenie łatwej w utrzymaniu czystości powłoki ochronnej współgrającej z posadzkami żywicznymi.',
  work_phases = '["Pierwsze malowanie cokołu żywicą StoCryl WV 200 w ilości 0,25 kg/m² wykonywane jako warstwa podkładowa (odcinająca) w celu ujednolicenia chłonności podłoża pionowego.","Drugie malowanie cokołu żywicą StoCryl WV 200 w ilości 0,25 kg/m² (łączny nakład dla obu warstw wynosi 0,50 kg/m²) nanoszone po związaniu pierwszej warstwy w celu uzyskania pełnego krycia, jednolitego połysku oraz docelowej grubości powłoki ochronnej."]'::jsonb,
  investor_benefits = '["Estetyczne i łatwe do utrzymania w czystości wykończenie strefy przyściennej, w pełni odporne na szorowanie oraz standardowe środki czyszczące.","Paroprzepuszczalna struktura powłoki, która umożliwia odprowadzenie wilgoci z podłoża, zapobiegając jej odspajaniu się od betonu.","Skuteczna ochrona cokołów przed wnikaniem wody, wilgoci oraz powierzchownymi zabrudzeniami eksploatacyjnymi."]'::jsonb
where code = 'CT/8';

update technologies set
  description = 'Dylatacje odtwarzamy metodą dwuetapową „ślad w ślad”. Gwarantuje to, że posadzka żywiczna pracuje dokładnie tam, gdzie płyta betonowa, co eliminuje ryzyko pęknięć bocznych.',
  work_phases = '["Mechaniczne oczyszczenie szczeliny bruzdownicą z podwójną tarczą 125 mm i osadzenie sznura technicznego przed wylaniem żywicy. Oznaczamy początek i koniec dylatacji na ścianach/słupach.","Nacięcie gotowej posadzki dokładnie po śladzie pierwotnym (nawet jeśli nacięcie betoniarza jest krzywe).","Podwójne odkurzanie, osadzenie sznura docelowego na głębokość 5 mm i zabezpieczenie krawędzi taśmą 30 mm.","Gruntowanie (SIKA Primer) i wypełnienie masą elastyczną Sikaflex 415.","Wykończenie – zrywanie taśm „do środka” i finalne zaglądzanie na mokro (mydło)."]'::jsonb,
  investor_benefits = '["Gwarancję trwałości (brak pęknięć).","Idealną estetykę i łatwość w utrzymaniu czystości dzięki gładkiej powierzchni masy."]'::jsonb
where code = 'DS/1';

update technologies set
  description = 'System SM/1 obejmuje profesjonalne wyznaczanie i malowanie ciągów komunikacyjnych, pól odkładczych oraz oznakowania BHP na posadzkach betonowych i żywicznych. Zastosowanie farby akrylowej Bandax Sprint gwarantuje bardzo krótki czas schnięcia (możliwość ruchu pieszego po ok. 15-20 min), wysoką odporność na ścieranie oraz doskonałą widoczność krawędzi.',
  work_phases = '["Mechaniczne oczyszczenie stref malowania. Bezwzględne odtłuszczenie posadzki specjalistycznym preparatem chemicznym.","Wyznaczenie osi i krawędzi organizacji ruchu zgodnie z projektem wykonawczym. Oklejenie konturów profesjonalną taśmą malarską o wysokiej przyczepności (tzw. taśma „ostra krawędź”), co zapobiega podciekaniu farby i gwarantuje idealną linię.","Aplikacja pierwszej warstwy farby drogowej Bandax Sprint w wybranym kolorze (najczęściej żółty RAL 1023 lub biały RAL 9016). Malowanie wykonywane wałkiem moherowym lub metodą natryskową.","Aplikacja drugiej warstwy farby w celu uzyskania pełnego krycia i wymaganej grubości powłoki.","Zerwanie taśm zabezpieczających „do środka” linii natychmiast po aplikacji drugiej warstwy, co zapewnia czysty rant bez wyszczerbień."]'::jsonb,
  investor_benefits = '["Krótki czas schnięcia farby Bandax Sprint minimalizuje przestoje w pracy zakładu lub parkingu.","Dzięki trasowaniu i oklejaniu, linie są proste, powtarzalne i estetyczne, co wpływa na profesjonalny odbiór obiektu.","Czytelna i trwała organizacja ruchu znacząco redukuje ryzyko kolizji i wypadków w strefach współdzielonych przez pieszych i pojazdy."]'::jsonb
where code = 'SM/1';

-- ---------- Przypisanie nowych technologii do pilotażu ----------

insert into offer_pilot_technologies (technology_id, category_name, unit)
select id, 'P:0 - Przygotowanie Betonu', 'mb' from technologies where code = 'P/12'
union all
select id, 'P:0 - Przygotowanie Betonu', 'm2' from technologies where code = 'P/6'
union all
select id, 'ST:0 - Systemy TREMCO', 'm2' from technologies where code = 'ST/PU/25'
on conflict (technology_id) do update set category_name = excluded.category_name, unit = excluded.unit;
