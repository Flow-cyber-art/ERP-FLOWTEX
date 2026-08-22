# FLOWTEX Polska — robocza specyfikacja procesu

## Cel systemu

Aplikacja ma być prostym systemem dziennego raportowania budów dla firmy wykonującej posadzki. Jeden raport opisuje jedną budowę i jeden dzień. Jeżeli ekipa tego samego dnia pracuje na dwóch budowach, powstają dwa niezależne raporty.

Raport jest jednym dokumentem zawierającym dwa koszyki: materiały oraz osoby z czasem pracy. Dzięki temu administrator otrzymuje spójny obraz tego, co zostało użyte i kto pracował na budowie.

## Role

| Rola                       | Odpowiedzialność       | Uprawnienia w MVP                                                                                                    |
| -------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Brygadzista                | Wypełnia raport budowy | Tworzy raport, dodaje materiały, dodaje osoby i czas od–do, wysyła raport                                            |
| Pracownik                  | Sprawdza własny czas   | Widzi swój wpis i potwierdza go; nie edytuje raportu                                                                 |
| Administrator / właściciel | Nadzoruje firmę        | Zarządza pracownikami, budowami i magazynem; weryfikuje materiały; zatwierdza lub odrzuca raporty; przegląda raporty |

## Przepływ raportu

1. Brygadzista wybiera budowę i datę.
2. Tworzy raport w statusie **Roboczy**.
3. Dodaje materiały do koszyka. Każda pozycja ma materiał, ilość i źródło: magazyn, zakup na budowie albo dostawa na budowę.
4. Pozycje dodane bezpośrednio na budowie otrzymują znacznik **Do weryfikacji administratora**.
5. Dodaje osoby pracujące tego dnia. Dla każdej osoby wpisuje godzinę rozpoczęcia i zakończenia.
6. Wysyła raport. Status zmienia się na **Wysłany**.
7. Pracownik widzi swój wpis i naciska **Potwierdzam**. Brak potwierdzenia nie blokuje administratora, ale jest widoczny jako brak potwierdzenia.
8. Administrator sprawdza materiały, czas i ewentualne pozycje do kontroli. Może raport **Zatwierdzić** albo **Odesłać do poprawy** z komentarzem.
9. Raport zatwierdzony jest zamknięty dla brygadzisty. Korekta odbywa się przez kontrolowaną wersję lub ponowne otwarcie przez administratora.

## Minimalny model raportu

| Obszar         | Dane                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| Nagłówek       | budowa, data, brygadzista, status, komentarz administratora                           |
| Materiał       | materiał/indeks, ilość, jednostka, źródło, znacznik kontroli, komentarz               |
| Czas pracy     | pracownik, start, koniec, czas trwania, status potwierdzenia                          |
| Synchronizacja | lokalny identyfikator, status synchronizacji, data ostatniej synchronizacji, konflikt |

## Statusy

| Status                     | Znaczenie                                          |
| -------------------------- | -------------------------------------------------- |
| Roboczy                    | Raport jest uzupełniany lokalnie przez brygadzistę |
| Oczekuje na synchronizację | Raport zapisany offline i czeka na ręczne wysłanie |
| Wysłany                    | Raport dostępny do kontroli administratora         |
| Do poprawy                 | Administrator wskazał problem i dodał komentarz    |
| Zatwierdzony               | Raport zamknięty i uwzględniony w zestawieniach    |
| Konflikt                   | Lokalna i zdalna wersja wymagają rozstrzygnięcia   |

## Raporty administratora

Administrator powinien móc filtrować raporty po budowie, osobie oraz zakresie dat. W widoku budowy powinien widzieć materiały zgłoszone, materiały wymagające weryfikacji, czas pracy osób oraz status raportu. W widoku pracownika powinien widzieć dni, budowy, godziny od–do, sumę godzin i status potwierdzenia.

## Offline-first i synchronizacja

Aplikacja pracuje na lokalnym źródle danych, więc brygadzista może utworzyć i zapisać raport bez internetu. Interfejs pokazuje stan **Offline — zapisano lokalnie** oraz liczbę zmian oczekujących. Po odzyskaniu internetu administrator lub użytkownik naciska **Synchronizuj**. Operacja wysyła kolejkę zmian, pobiera aktualizacje i pokazuje ewentualne konflikty zamiast nadpisywać je po cichu.

## Zakres pierwszej przebudowy

Pierwszy etap powinien zastąpić osobny raport dzienny i osobny moduł HR jednym formularzem raportu budowy z dwoma koszykami. Następnie panel administratora powinien otrzymać kolejkę raportów do akceptacji oraz widok raportów według budowy i pracownika. Integrację Supabase, logowanie i synchronizację sieciową można podłączyć po zatwierdzeniu lokalnego procesu.

## Zaakceptowane decyzje MVP

Administrator może zatwierdzić raport bez wcześniejszego potwierdzenia pracownika. System blokuje zapis czasu, gdy godzina zakończenia jest wcześniejsza niż godzina rozpoczęcia. Przerw nie ewidencjonujemy w pierwszej wersji. Komentarz przy materiale dodanym na budowie pozostaje opcjonalny, ale materiał otrzymuje znacznik do weryfikacji. Administrator może ponownie otworzyć zatwierdzony raport. Pracownik widzi wyłącznie własny wpis czasu. Synchronizację uruchamia brygadzista.

Panel administratora będzie responsywny. Na komputerze główny panel będzie ograniczony do maksymalnie 60% szerokości ekranu i pozostanie czytelny jako centralny obszar roboczy; na telefonie przejdzie do układu pełnej szerokości z dolną lub mobilną nawigacją.
