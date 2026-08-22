# Research notes — raporty budowy i offline-first

## Fieldwire — Construction daily report template

Źródło: https://www.fieldwire.com/blog/construction-daily-report-template/

Praktyczny raport dzienny powinien być przypisany do konkretnego projektu i daty oraz łączyć informacje o ekipie, wykonanych pracach, materiałach i problemach. Fieldwire wskazuje sześć głównych obszarów: dane budowy, warunki, pracę/ludzi/sprzęt/materiały, wykonane prace, bezpieczeństwo oraz dokumentację pomocniczą. Dla naszego uproszczonego procesu oznacza to, że raport powinien mieć minimum: budowę, dzień, osoby, czas pracy, materiały i status akceptacji. Wprowadzanie powinno być strukturalne i możliwie krótkie, bez dublowania danych.

## Android Developers — Build an offline-first app

Źródło: https://developer.android.com/topic/architecture/data-layer/offline-first

Lokalne źródło danych powinno być kanonicznym źródłem dla interfejsu, także po odzyskaniu połączenia. Warstwa UI nie powinna komunikować się bezpośrednio z siecią; repozytorium powinno synchronizować dane sieciowe z lokalnym źródłem. Aplikacja offline-first powinna działać bez niezawodnej sieci, pokazywać lokalne dane natychmiast oraz posiadać mechanizm synchronizacji i rozwiązywania konfliktów.

## Wnioski projektowe

1. Raport budowy powinien być jednym dokumentem dziennym z koszykami: materiały oraz osoby/czas.
2. Raport musi mieć status roboczy, wysłany, do poprawy lub zatwierdzony; status blokuje niekontrolowane zmiany po akceptacji.
3. Materiały dodane przez brygadzistę powinny mieć znacznik „do weryfikacji administratora”.
4. W trybie offline wszystkie odczyty i zapisy pracują na lokalnym źródle; synchronizacja jest osobną akcją administratora po odzyskaniu internetu.
5. Konflikty wymagają jawnej kolejki do rozstrzygnięcia, szczególnie gdy raport został zmieniony lokalnie i zdalnie.

## Rhumbix — Time and Material Tracking

Źródło: https://www.rhumbix.com/blog/time-and-material-tracking-construction

Śledzenie materiałów powinno obejmować drogę od zakupu/dostawy do użycia: ilość, koszt, lokalizację i sposób wykorzystania. W praktyce warto rozdzielić co najmniej: dokument zakupu lub przyjęcia, potwierdzenie dostawy, stan/lokalizację, wpis zużycia oraz przypisanie kosztu do budowy. Połączenie czasu pracy i materiałów w jednym systemie daje spójny raport dla konkretnego zadania/budowy. Źródło wskazuje również wartość cyfrowych podpisów lub akceptacji przy zatwierdzaniu.

## Ustalenie dla naszego MVP

W pierwszej wersji nie dodajemy zdjęć, etapów ani rozliczeń płacowych. Zachowujemy jednak strukturę umożliwiającą późniejsze rozszerzenie: raport budowy/dnia, koszyk materiałów, koszyk pracowników z godziną od–do, materiały dodane na budowie oznaczone do kontroli, akceptacja albo odrzucenie z komentarzem oraz historia zmian statusu.

Raporty administratora powinny być filtrowalne według budowy, osoby i zakresu dat. Dla materiałów warto rozróżnić co najmniej: wydane/zgłoszone, zużyte, zwrócone lub pozostałe oraz pozycje wymagające kontroli. Dla pracy: osoba, budowa, dzień, start, koniec, czas trwania i status potwierdzenia.
