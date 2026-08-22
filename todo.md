# Project TODO

- [x] Ustawić paletę inspirowaną Flowtex
- [x] Skonfigurować ikonę aplikacji
- [x] Zbudować dashboard
- [x] Zbudować magazyn z wyszukiwaniem i dodawaniem materiałów
- [x] Zbudować listę i formularz budów
- [x] Zbudować szczegóły budowy i materiały przypisane
- [x] Zbudować raport dzienny zużycia
- [x] Wymagać uzasadnienia przy różnicach
- [x] Dodać lokalny store z trwałym zapisem
- [ ] Przygotować adapter danych pod Supabase
- [x] Wykonać test TypeScript i test przepływów
- [ ] Zapisać checkpoint gotowej wersji

## Zakres odroczony

- [ ] Podłączenie SUPABASE_URL i SUPABASE_ANON_KEY przez environment variables
- [ ] Logowanie użytkowników przez Supabase Auth
- [ ] Synchronizacja danych między urządzeniami

- [x] Przebudować nagłówek na stały pasek z logo FLOWTEX Polska u góry
- [x] Zastąpić górne przyciski nawigacyjne stałą dolną nawigacją z ikonami i podpisami
- [x] Dostosować dashboard do kartowego układu z przesłanego wzorca
- [x] Zachować grafitowo-bursztynową paletę aplikacji w nowym układzie

- [x] Naprawić brak możliwości przypisania materiału do nowo utworzonej budowy
- [x] Dodać wybór budowy, materiału i ilości planowanej w formularzu przypisania
- [x] Pokazać zapisane przypisania w karcie budowy i raporcie dziennym

- [x] Zastąpić pojedyncze zapisywanie materiału koszykiem przypisań
- [x] Umożliwić dodawanie wielu materiałów bez opuszczania formularza
- [x] Pokazać tymczasową listę materiałów i ilości przed zatwierdzeniem
- [x] Zatwierdzać wszystkie przypisania jednym przyciskiem
- [x] Wyczyścić listę roboczą po zatwierdzeniu lub anulowaniu

- [x] Zastąpić poziomy wybór budowy wyszukiwanym panelem listy
- [x] Zastąpić poziomy wybór materiału wyszukiwanym panelem listy
- [x] Pokazać nazwę i indeks wybranego materiału po wyborze
- [x] Zachować koszyk wielu materiałów i jedno zatwierdzenie

- [x] Naprawić brak reakcji przy zapisie raportu dziennego
- [x] Zapisywać zużycie i uzasadnienia lokalnie
- [x] Aktualizować wartości zużycia przypisanych materiałów
- [x] Pokazać widoczne potwierdzenie zapisu raportu

- [x] Dodać osobne menu „Raporty budów” dla zarządzającego
- [x] Umożliwić wybór budowy w raporcie zarządczym
- [x] Pokazać materiały wydane na budowę, plan, zużycie i pozostałość
- [x] Wyróżnić różnice i materiały wymagające wyjaśnienia
- [x] Dodać podsumowanie wartości/ilości dla wybranej budowy

- [x] Dodać lokalną listę pracowników z imieniem, nazwiskiem i stanowiskiem
- [x] Dodać panel administratora do zarządzania pracownikami
- [x] Dodać panel administratora do zakładania budów i przypisywania materiałów
- [x] Dodać role administratora i brygadzisty w modelu lokalnym
- [x] Dodać dzienne rozliczenie pracowników na wybranej budowie
- [x] Zapisywać osoby pracujące oraz liczbę przepracowanych godzin
- [x] Pokazać podsumowanie roboczogodzin dla budowy i dnia

## Nowe zasady procesu raportowego

- [ ] Jeden raport obejmuje jedną budowę i jeden dzień, z możliwością utworzenia kolejnego raportu dla drugiej budowy tego samego dnia
- [ ] Połączyć rozliczenie materiałów i czasu pracy w jednym raporcie budowy
- [ ] Pozwolić brygadziście dodawać materiały znalezione lub dokupione na budowie, oznaczając je do weryfikacji administratora
- [ ] Dodać koszyk osób pracujących z godziną rozpoczęcia i zakończenia
- [ ] Pozwolić pracownikowi wyłącznie przeglądać oraz potwierdzać swój wpis czasu
- [ ] Dodać statusy raportu: roboczy, wysłany, do poprawy, zatwierdzony
- [ ] Dodać administratorowi możliwość zatwierdzenia lub odrzucenia raportu z komentarzem
- [ ] Dodać tryb offline z lokalną kolejką zmian
- [ ] Dodać ręczny przycisk synchronizacji po odzyskaniu internetu
- [ ] Przygotować raporty administratora według budowy, osoby, dnia, tygodnia i miesiąca
- [ ] Uwzględnić raportowanie kosztów i wszystkich dostępnych zestawień materiałowych w późniejszym etapie

## Zaakceptowane decyzje MVP

- [ ] Zatwierdzenie raportu nie wymaga wcześniejszego potwierdzenia pracownika
- [ ] Blokować zapis, gdy godzina końca jest wcześniejsza niż godzina startu
- [ ] Pominąć przerwy w MVP
- [ ] Komentarz przy materiale dodanym na budowie pozostaje opcjonalny
- [ ] Administrator może ponownie otworzyć zatwierdzony raport
- [ ] Pracownik widzi wyłącznie własny wpis czasu
- [ ] Synchronizację uruchamia brygadzista
- [ ] Panel administratora na komputerze ma zajmować maksymalnie 60% szerokości ekranu
- [ ] Panel administratora na mobile ma działać jako pełny widok responsywny

- [x] Dodać lokalny model użytkownika z identyfikatorem i rolą
- [x] Dodać role Brygadzista, Pracownik i Administrator
- [x] Dodać panel wyboru użytkownika i nadawania roli przez administratora
- [x] Zapisywać przypisane role w lokalnym magazynie danych
- [x] Przygotować mapowanie lokalnego użytkownika do Supabase Auth

- [x] Połączyć rozliczenie osób z zakładką raportu dziennego materiałów
- [x] Dodać dropdown wyboru pracownika
- [x] Dodać koszyk pracowników z czasem od–do
- [x] Dodać przycisk „Zapisz osoby” zapisujący cały koszyk do raportu
- [x] Usunąć dublowanie rozliczenia osób jako osobnej ścieżki HR

- [x] Zdiagnozować niedziałający preview po zmianach raportu i koszyka pracowników
- [x] Naprawić błąd kompilacji lub uruchamiania preview
- [x] Zweryfikować ponownie podgląd po naprawie

- [x] Dodać developerski przełącznik aktywnej roli Admin / Brygadzista / Pracownik
- [x] Zastąpić przycisk Start/Home trzema przyciskami ról w dolnej nawigacji
- [x] Ograniczyć panel Admin do administratora
- [x] Ograniczyć raport budowy i dodawanie materiałów do brygadzisty
- [x] Ograniczyć widok pracownika do własnego wpisu czasu i potwierdzenia
- [x] Zachować wyraźny oznacznik, że jest to tryb developerski bez Supabase Auth

- [x] Przywrócić starszy układ głównej dolnej nawigacji
- [x] Przenieść przełącznik ról do osobnego panelu developerskiego na końcu menu
- [x] Nie pokazywać trzech ról jako głównych przycisków roboczych
- [x] Zachować działanie ograniczeń widoczności paneli według wybranej roli

- [x] Zdiagnozować niedziałający preview po zmianach panelu Dev
- [x] Przywrócić ciemne tło i ciemne karty aplikacji
- [x] Zachować bursztynowy akcent i jasną typografię na ciemnym motywie
- [x] Zweryfikować preview oraz renderowanie motywu po restarcie

- [x] Podłączyć przycisk Dev do panelu developerskiego
- [x] Pokazać w panelu wybór aktywnej roli
- [x] Pokazać opis modułów dostępnych dla każdej roli
- [x] Zachować ciemny motyw panelu Dev

- [x] Ograniczyć panel Pracownika do własnej ewidencji czasu
- [x] Dodać filtr dzienny
- [x] Dodać filtr tygodniowy
- [x] Dodać filtr miesięczny
- [x] Dodać filtr roczny
- [x] Pokazać sumę godzin i wpisy od–do bez możliwości edycji

- [x] Dodać liczbę unikalnych przepracowanych dni do podsumowania pracownika

- [x] Dodać wykres słupkowy przepracowanych godzin w panelu Pracownika
- [x] Dopasować skalę wykresu do danych wybranego okresu
- [x] Zachować czytelność wykresu w ciemnym motywie i na mobile

- [x] Udostępnić Brygadziście zakładanie nowej budowy
- [x] Udostępnić Brygadziście przypisywanie materiałów do budowy
- [x] Dodać dropdown wyboru pracowników do podglądu czasu Brygadzisty
- [x] Umożliwić dodawanie wielu pracowników do listy podglądu
- [x] Pokazać dla wybranych osób godziny, dni, filtry okresów i wykres słupkowy
- [x] Zachować tylko wgląd Brygadzisty bez edycji cudzych wpisów czasu

- [x] Naprawić dostęp Brygadzisty do panelu Budowy
- [x] Zapewnić Brygadziście zakładanie budów i przypisywanie materiałów
- [x] Zmienić Czas zespołu na dropdown jednego pracownika
- [x] Pokazywać indywidualne godziny, dni, wpisy od–do i wykres wybranego pracownika

- [x] Usunąć panel Budowy z nawigacji Brygadzisty
- [x] Pozostawić zakładanie budów, dodawanie materiałów i przypisywanie wyłącznie Adminowi
- [x] Pozostawić Brygadziście raport dzienny oraz podgląd czasu wybranego pracownika
- [x] Zaktualizować opis uprawnień w panelu Dev

- [x] Zmienić etykietę „Dodaj osobę do koszyka” na „Dodaj osobę”
- [x] Zastąpić tekstowe pola Od i Do wyborem godziny z panelu
- [x] Pokazać wybraną godzinę w polu przed dodaniem osoby
- [x] Zachować walidację kolejności czasu od–do

- [x] Zastąpić siatkę godzin dolnym panelem w stylu iOS
- [x] Dodać przewijany picker godziny i minut
- [x] Dodać centralny podgląd wybranej wartości
- [x] Dodać przycisk „Gotowe” zapisujący wybór
- [x] Zachować wybór osobno dla rozpoczęcia i zakończenia pracy

- [x] Dodać planowane ilości materiałów w procesie zakładania budowy przez Admina
- [x] Pokazywać plan przy każdym materiale w raporcie Brygadzisty
- [x] Pokazywać różnicę plan kontra faktyczne zużycie
- [ ] Oznaczać brakujące materiały do zamówienia
- [x] Dodać Adminowi formularz tworzenia zamówienia materiałowego
- [x] Zapisywać zamówienie lokalnie ze statusem do realizacji

- [x] Ukryć planowane ilości materiałów w raporcie Brygadzisty
- [x] Ukryć różnice plan–zużycie przed Brygadzistą
- [x] Zachować plan i różnice w panelu Admina oraz raportach zarządczych
