# FLOWTEX ERP — Plan testów (mapa wszystkich ścieżek testowych)

> Dokument QA. Opisuje **co**, **kim**, **w jakiej kolejności** i **jak** testować,
> żeby pokryć wszystkie ścieżki aplikacji: od logowania, przez cykl życia budowy
> i magazyn, po portal klienta, HR, podwykonawców i oferty.
> Źródła: kod (`app/`, `components/screens/`, `contexts/app-data.tsx`, `lib/data/`,
> `lib/offline-outbox.ts`), migracje `supabase/sql/000–117`, edge functions
> `supabase/functions/*` oraz dokumenty procesowe w `docs/`.

---

## Spis treści

0. [Strategia i zasady](#0-strategia-i-zasady)
1. [Środowiska, dane testowe, konta](#1-środowiska-dane-testowe-konta)
2. [Macierz ról i widoczności](#2-macierz-ról-i-widoczności)
3. [Ścieżki E2E (scenariusze biznesowe end-to-end)](#3-ścieżki-e2e)
4. [Moduły — przypadki testowe](#4-moduły--przypadki-testowe)
5. [Niezmienniki magazynowe — testy księgowe](#5-niezmienniki-magazynowe)
6. [Bezpieczeństwo, RLS, uprawnienia](#6-bezpieczeństwo-rls-uprawnienia)
7. [Offline, synchronizacja, realtime, współbieżność](#7-offline-synchronizacja-realtime-współbieżność)
8. [PWA, powiadomienia, wersjonowanie](#8-pwa-powiadomienia-wersjonowanie)
9. [Integracje zewnętrzne (edge functions)](#9-integracje-zewnętrzne)
10. [Testy niefunkcjonalne](#10-testy-niefunkcjonalne)
11. [Migracje SQL i dane](#11-migracje-sql-i-dane)
12. [Automatyzacja — piramida i harmonogram](#12-automatyzacja)
13. [Priorytety, kryteria wejścia/wyjścia, raportowanie błędów](#13-priorytety-i-kryteria)

---

## 0. Strategia i zasady

### 0.1 Cel
Udowodnić, że:
1. **Dane księgowe są zawsze spójne** — stan magazynu, podmagazynów budów, koszt budowy
   i rozliczenie wynikają wyłącznie z ruchów (niezmienniki N1–N7).
2. **Każda rola widzi i może zrobić tylko to, co powinna** — zarówno w UI, jak i bezpośrednio
   przez API Supabase (RLS + `assert_role()`).
3. **Brygadzista nigdy nie traci raportu** — także offline, przy podwójnym kliknięciu,
   przy zamknięciu aplikacji.
4. **Klient w portalu widzi tylko to, co Admin mu udostępnił.**

### 0.2 Techniki projektowania testów (stosowane w całym dokumencie)
| Technika | Gdzie stosujemy |
|---|---|
| Przejścia stanów | raport, zamówienie, budowa, urlop, odbiór podwykonawcy, oferta |
| Klasy równoważności + wartości brzegowe | ilości (0, ułamki, ujemne, ogromne), godziny od–do, daty, PIN, stawki, m² |
| Tablice decyzyjne | zamknięcie budowy (raporty zatwierdzone × saldo 0 × PIN), zwrot/utylizacja |
| Macierz ról (CRUD × rola) | sekcja 2 i 6 |
| Testy oparte na niezmiennikach (property-based) | sekcja 5 |
| Testy eksploracyjne (sesje 60–90 min z kartą) | każdy moduł po zmianie |
| Testy regresji | zestaw „smoke” + „krytyczne ścieżki” przed każdym deployem |

### 0.3 Oznaczenia
- **ID**: `MOD-NN` (np. `RAP-07`). Priorytet: **P1** (blokujący / pieniądze / utrata danych),
  **P2** (ważna funkcja), **P3** (kosmetyka, wygoda).
- Typ: **+** pozytywny, **−** negatywny, **B** brzegowy, **S** bezpieczeństwo.

---

## 1. Środowiska, dane testowe, konta

### 1.1 Środowiska
| Środowisko | Do czego | Uwagi |
|---|---|---|
| Lokalnie `pnpm dev` (web) | testy manualne, dev | Supabase testowy, nigdy produkcyjny |
| **Supabase branch / osobny projekt testowy** | testy RPC, RLS, migracji | wszystkie migracje `000→117` po kolei, potem seed |
| Preview Vercel | E2E Playwright, testy akceptacyjne | build `pnpm build:web` |
| Urządzenia fizyczne | PWA, aparat, offline, push | iPhone (Safari, PWA z ekranu głównego), Android (Chrome), desktop Chrome/Edge/Firefox/Safari |

### 1.2 Konta testowe (minimalny zestaw)
| Konto | Rola | Specyfika |
|---|---|---|
| `qa-superadmin` | Admin + wpis w `superadmins` | zarządzanie kontami, ochrona przed zmianą roli |
| `qa-admin` | Admin | zwykły admin |
| `qa-bryg-1`, `qa-bryg-2` | Brygadzista | dwie brygady, różne budowy |
| `qa-prac-1`, `qa-prac-2` | Pracownik | powiązani z `employeeId` |
| `qa-lider-pw` | Brygadzista/konto lidera brygady podwykonawcy | `isSubcontractorLead = true` |
| `qa-bez-profilu` | konto Auth bez wiersza w `profiles` | ścieżka błędu logowania |
| anonim | brak sesji | portal klienta `/portal/[token]`, `/oferta` |

### 1.3 Dane testowe (seed)
- Materiały: z partiami o **różnych cenach** (FIFO), z datą ważności (FEFO), materiał z zerowym
  stanem, zarchiwizowany, z niską wartością < stan minimalny, dwa o prawie tej samej nazwie
  (test dopasowania Levenshteina).
- Technologie: z jedną miarą (m²), z drugą miarą (mb cokołu), z wersjami, z kartą PDF.
- Budowy: aktywna z technologią, aktywna bez technologii, zamknięta, z portalem (z PIN / bez PIN),
  z podwykonawcą, z brygadą.
- Pracownicy: aktywni, zarchiwizowani, ze stawką kosztową, z pulą urlopu.
- Skrypty resetu: `scripts/reset-data-keep-employees.sql`,
  `scripts/reset-builds-materials-keep-technologies.sql` — **tylko** na bazie testowej.

---

## 2. Macierz ról i widoczności

### 2.1 Nawigacja (z `app/(tabs)/index.tsx`)
| Zakładka | Admin | Brygadzista | Lider podwyk. | Pracownik | Anonim |
|---|:-:|:-:|:-:|:-:|:-:|
| Start | ✔ | ✔ | ✔ | ✔ | – |
| Budowy / Archiwum | ✔ | ✔ (wg RLS) | ? | – | – |
| Rozliczenie | ✔ | – | – | – | – |
| Magazyn / Technologie | ✔ | – | – | – | – |
| Zamówienia | ✔ (badge) | – | – | – | – |
| Raporty (manager – zatwierdzanie) | ✔ (badge „do zatwierdzenia”) | – | – | – | – |
| Raporty (moje / nowy raport) | ✔ (w imieniu podwyk.) | ✔ (badge „do poprawy”) | ✔ | – | – |
| Czas zespołu | – | ✔ | ✔ | – | – |
| HR / Płace / Urlopy (panel) | ✔ | – | – | – | – |
| Urlopy (wniosek) | – | ✔ | ✔ | ✔ | – |
| Mój czas | – | – | – | ✔ | – |
| Podwykonawcy | ✔ | – | – | – | – |
| Admin / Ustawienia / Konta | ✔ (+ superadmin) | ✔ (ograniczone) | ✔ | ✔ | – |
| Oferta `/oferta` | ✔ (edycja) | wg uprawnień | – | – | wg konfiguracji |
| Portal `/portal/[token]` | – | – | – | – | ✔ |

**Testy (`NAV`)**
| ID | Opis | Typ | P |
|---|---|---|---|
| NAV-01 | Dla każdej roli zalogować się i porównać listę zakładek z macierzą (desktop ≥ 900 px — sidebar). | + | P1 |
| NAV-02 | To samo na mobile < 900 px — dolny pasek; przyciski łączone (Budowy⇄Rozliczenie, Magazyn⇄Technologie, Zamówienia⇄Raporty, HR⇄Podwyk.) przełączają się przy powtórnym kliknięciu. | + | P2 |
| NAV-03 | Badge: Magazyn = liczba materiałów poniżej minimum; Zamówienia = „do realizacji” + braki bez zamówienia + zamówienia z planu „robocze”; Raporty = do zatwierdzenia / do poprawy. Zmiana danych → badge aktualizuje się bez przeładowania (realtime). | + | P2 |
| NAV-04 | Zmiana szerokości okna (900 px ± 1) w locie przełącza układ; brak błędu hydratacji React #418 w konsoli po `expo export`. | B | P2 |
| NAV-05 | Ręczne ustawienie stanu `tab` na zakładkę niedostępną dla roli (np. przez devtools/URL) — ekran nie renderuje danych, RLS nie zwraca wierszy. | S | P1 |

---

## 3. Ścieżki E2E

Każda ścieżka to scenariusz od początku do końca, z **weryfikacją liczbową** na końcu
(stan magazynu, stan budowy, koszt budowy, rozliczenie). To są testy o najwyższej wartości.

### E2E-01 „Złota ścieżka budowy” (P1)
1. Admin: tworzy materiały A, B; przyjmuje 2 dostawy A (10 szt. × 10 zł, 10 szt. × 12 zł).
2. Admin: tworzy technologię T (etapy: grunt, warstwa zasadnicza) z normami zużycia.
3. Admin: kreator budowy 6 kroków — dane → technologia T + 100 m² → materiały dodatkowe →
   zamówienie z planu → katalog zdjęć → portal klienta (PIN).
4. Admin: zamówienie „robocze” → korekta ilości (zaokrąglenie do opakowań) → „Złożono u dostawcy”
   → „Dostawa dotarła” z inną ceną niż w zamówieniu → przyjęcie.
5. Brygadzista: raport dzień 1 (zużycie per etap, 2 osoby z godzinami, km, koszt dodatkowy, notatka).
6. Pracownik: widzi swój wpis w „Mój czas”.
7. Brygadzista: raport dzień 2; poprawka raportu dnia 2 (zmniejszenie ilości).
8. Admin: zatwierdza oba raporty; portal klienta pokazuje postęp **tylko z zatwierdzonych**.
9. Admin: zamyka budowę — resztki: część zwrot, część utylizacja; PIN.
10. **Weryfikacja**: koszt materiałowy = Σ zużycie × cena FIFO partii; straty = utylizacja × cena;
    stan magazynu = przyjęcia − przypisania + zwroty; podmagazyn budowy = 0; rozliczenie
    (`settlement-screen`) zgodne z ręcznym wyliczeniem w arkuszu.

### E2E-02 „Niedobór na budowie” (P1)
Brygadzista raportuje więcej niż przypisano → raport się zapisuje, stan budowy ujemny, flaga
niedoboru → zamknięcie zablokowane komunikatem „podmagazyn nie jest wyzerowany” → Admin dopisuje
materiał przez „Materiały dodatkowe” → saldo 0 → zamknięcie przechodzi.

### E2E-03 „Raport offline” (P1)
Tryb samolotowy → raport → komunikat „Brak połączenia… wyśle się automatycznie” → zamknięcie
i ponowne otwarcie aplikacji → przywrócenie sieci → raport dociera **dokładnie raz**,
stany zgodne.

### E2E-04 „Transfer między budowami” (P1)
Materiał przypisany do budowy X → transfer do Y → wartość: −q·c w X, +q·c w Y (N7),
koszt żadnej z budów nie rośnie, cena partii zachowana.

### E2E-05 „Wznowienie zamkniętej budowy” (P1)
Zamknij → wznów → dodaj raport → zamknij ponownie → rozliczenie przeliczone od nowa,
bez podwójnego odjęcia partii (regresja `043`, `053`, `091`).

### E2E-06 „Wolny magazyn” (P2)
Zamówienie ogólne (bez budowy) → przyjęcie → przypisanie z wolnego magazynu do budowy
(`apply_order_item_free_stock`, dopasowanie po nazwie — `086/087/088`).

### E2E-07 „Podwykonawca” (P1)
Admin dodaje firmę podwykonawczą (wyszukiwanie GUS) → wybór firmy przy zakładaniu budowy →
zlecenie (stawka m², materiał po stronie flowtex/podwykonawcy) → lider brygady podwykonawcy
składa raport m² → Admin składa raport „w imieniu” → korekta m² → odbiór (etapy, dodatkowe,
potrącenia) → oznaczenie „zapłacono” → rozliczenie budowy zawiera koszt podwykonawcy.

### E2E-08 „Urlop” (P2)
Pracownik wnioskuje (każdy typ: wypoczynkowy, na żądanie, L4, okolicznościowy, bezpłatny) →
Admin zatwierdza/odrzuca → pula dni się zmienia (dni robocze z pominięciem świąt, `workdays.ts`)
→ edycja → anulowanie → pula wraca.

### E2E-09 „Oferta → budowa” (P2)
Admin tworzy ofertę z technologii pilotażowych → PDF (polskie znaki, czcionka DejaVu) →
karta technologiczna PDF z bucketu → zapis/wyszukanie/usunięcie oferty.

### E2E-10 „Portal klienta” (P1)
Admin włącza portal, ustawia PIN, przełączniki (wartość kontraktu, zdjęcia, notatki, AI) →
klient otwiera link na telefonie → PIN → postęp etapów, galeria, notatki, podsumowanie AI →
Admin regeneruje token → stary link przestaje działać → Admin wyłącza portal → link zwraca brak dostępu.

### E2E-11 „Płace” (P2)
Godziny z raportów (stawka zamrożona w chwili zapisu — `055`) → zmiana stawki pracownika →
stare godziny zachowują starą stawkę → lista płac / koszt robocizny budowy zgodny.

### E2E-12 „Zarządzanie kontami” (P1)
Superadmin tworzy konto (rola, pracownik, email, hasło) → logowanie nowym kontem → zmiana roli,
emaila, nazwy, hasła → usunięcie → logowanie niemożliwe. Zwykły Admin nie może zmienić roli superadmina.

---

## 4. Moduły — przypadki testowe

### 4.1 Logowanie i sesja (`AUTH`) — `login-screen.tsx`, `auth-gate.tsx`, `lib/data/auth.ts`
| ID | Opis | Typ | P |
|---|---|---|---|
| AUTH-01 | Poprawny email+hasło dla każdej roli → właściwy ekran startowy. | + | P1 |
| AUTH-02 | Złe hasło / nieistniejący email / puste pola / email z wielkimi literami i spacjami. | − | P1 |
| AUTH-03 | „Zapamiętaj mnie” ON → zamknięcie przeglądarki → sesja trwa; OFF → sesja w sessionStorage, znika po zamknięciu karty. | + | P1 |
| AUTH-04 | Konto bez profilu w `profiles` → czytelny komunikat, brak białego ekranu. | − | P1 |
| AUTH-05 | Wygaśnięcie tokena w trakcie pracy (np. podczas wypełniania raportu) → odświeżenie lub ponowne logowanie bez utraty szkicu. | B | P1 |
| AUTH-06 | Wylogowanie → czyszczenie cache (AsyncStorage) danych poprzedniego użytkownika; zalogowanie innym kontem na tym samym urządzeniu nie pokazuje cudzych danych. | S | P1 |
| AUTH-07 | Zmiana hasła/emaila z „Ustawień konta” (`account-settings-section`). | + | P2 |
| AUTH-08 | Zmiana roli konta przez superadmina, gdy użytkownik jest zalogowany → po odświeżeniu nowa nawigacja. | B | P2 |

### 4.2 Budowy (`BUD`) — `builds-screen.tsx`, `lib/data/builds.ts`
| ID | Opis | Typ | P |
|---|---|---|---|
| BUD-01 | Kreator 6 kroków: przejście dalej/wstecz zachowuje dane; anulowanie w połowie nie tworzy budowy. | + | P1 |
| BUD-02 | Pola wymagane (numer, nazwa, odpowiedzialny, data startu, czas trwania) — każdy brak osobno. | − | P1 |
| BUD-03 | Duplikat numeru budowy → czytelny komunikat (unique constraint), nie surowy SQL. | − | P1 |
| BUD-04 | Data końca liczona w **dniach roboczych** (święta, weekendy, start w sobotę). | B | P2 |
| BUD-05 | Adres przez Google Places (podpowiedzi, brak sieci, brak wyników). | + / − | P3 |
| BUD-06 | Edycja budowy, wartość kontraktu (0, ułamki, separator `,` vs `.`). | B | P2 |
| BUD-07 | Wyszukiwarka + filtr Aktywne/Archiwum. | + | P3 |
| BUD-08 | Przypisanie technologii + m² (+ druga miara mb) → plan materiałowy; zmiana technologii po przypisaniu **nie zmienia** zamrożonego planu (snapshot). | + | P1 |
| BUD-09 | m² = 0, ujemne, bardzo duże; technologia bez materiałów. | B | P2 |
| BUD-10 | Brygady budowy (`build-teams-section`): przypisanie, usunięcie, ta sama brygada na dwóch budowach. | + / B | P2 |
| BUD-11 | Wybór podwykonawcy wprost w kreatorze (`117`). | + | P2 |
| BUD-12 | Zdjęcia (`build-photos-section`) — utworzenie katalogu Google Drive, upload, brak katalogu → komunikat. | + / − | P2 |
| BUD-13 | „Koszty na bieżąco” na karcie budowy = suma z `Rozliczenie`. | + | P1 |
| BUD-14 | Licznik „N raporty do sprawdzenia” na karcie. | + | P3 |

### 4.3 Zamknięcie budowy (`ZAM`) — RPC `close_build`, PIN `019`
Tablica decyzyjna:

| Wszystkie raporty zatwierdzone | Saldo podmagazynu = 0 po decyzjach | PIN poprawny | Wynik |
|:-:|:-:|:-:|---|
| N | – | – | blokada „Zatwierdź wszystkie raporty…” |
| T | N (niedobór) | – | blokada „podmagazyn nie jest wyzerowany: …” z nazwą i ilością |
| T | T | N | odmowa, budowa aktywna |
| T | T | T | ZAMKNIĘTA, archiwum |

| ID | Opis | Typ | P |
|---|---|---|---|
| ZAM-01..04 | Wiersze tablicy powyżej. | +/− | P1 |
| ZAM-05 | Resztki: 100% zwrot / 100% utylizacja / mieszane / częściowy zwrot z partii usuniętej (`028`, `053`). | B | P1 |
| ZAM-06 | Zwrot wraca do **tej samej partii** z tą samą ceną (`035`, `091`). | + | P1 |
| ZAM-07 | Utylizacja → pozycja „Straty materiałowe” w koszcie. | + | P1 |
| ZAM-08 | Wznowienie → raporty możliwe → ponowne zamknięcie bez podwójnego odjęcia. | + | P1 |
| ZAM-09 | Brygadzista próbuje raportu na zamkniętej budowie → „Budowa zamknięta — nie można już dodawać raportów”; budowa nie jest na liście wyboru. | − | P1 |
| ZAM-10 | Podwójne kliknięcie „Zatwierdź” zamknięcia. | B | P1 |

### 4.4 Raport dzienny brygadzisty (`RAP`) — `report-screen.tsx`, `report-ui.tsx`, RPC `submit_daily_report`
**Stany:** szkic lokalny → oczekuje w outboxie → wysłany („Do edycji”) → do poprawy → zatwierdzony (zablokowany).

| ID | Opis | Typ | P |
|---|---|---|---|
| RAP-01 | Nowy raport: wybór budowy (tylko aktywne), 3 kroki Zużycie → Zespół → Podsumowanie. | + | P1 |
| RAP-02 | **Zużycie dzienne, nie skumulowane** (`047`): dzień 1 = 12, dzień 2 = 15 → stan 40−27; regresja audytu (wpisanie „ile dziś” nie może cofać kosztu). | + | P1 |
| RAP-03 | Ten sam materiał w kilku etapach — osobne wartości per etap (`093`, `material-report-key`). | + | P1 |
| RAP-04 | Pozycja „oczekuje na dostawę” — nie da się raportować. | − | P2 |
| RAP-05 | Checkbox „etap zakończony” → portal 100% dla etapu; odznaczenie cofa. | + | P2 |
| RAP-06 | Materiały pomocnicze + wyszukiwarka przy długiej liście. | + | P2 |
| RAP-07 | „Dodaj materiał z magazynu” → wybór partii → „Przypisz N do budowy” → pojawia się w pomocniczych (`024`). | + | P1 |
| RAP-08 | Krzyżyk przy pomocniczym → odpięcie i zwrot całej ilości do magazynu (`026/027`); gdy część już zużyta? | B | P1 |
| RAP-09 | Zużycie > stan budowy → zapis przechodzi, niedobór oflagowany (`078`). | B | P1 |
| RAP-10 | Ilości: 0, puste, ułamki `0,5` i `0.5`, ujemne, tekst, 10^9, przyciski −/+ poniżej 0. | B | P1 |
| RAP-11 | Brak zużycia → ostrzeżenie; drugi „Dalej” przechodzi. Brak osób → analogicznie. | B | P2 |
| RAP-12 | Zespół: „Dodaj osobę”, „Dodaj wszystkich”, godziny od–do; **koniec < start → blokada**; koniec = start; przez północ; 24h. | B | P1 |
| RAP-13 | Ta sama osoba dwa razy w raporcie / na dwóch budowach tego dnia z nakładającymi się godzinami. | B | P2 |
| RAP-14 | Kilometrówka (stawka Admina), koszty dodatkowe (nocleg/parking/zakup/inne/własna) — kwoty 0, ujemne. | B | P2 |
| RAP-15 | Notatka + „Generuj notatkę AI” (`generate-report-note`) — sukces, timeout, błąd. | + / − | P3 |
| RAP-16 | Zapis → komunikat „Raport zapisany — materiały zdjęte z magazynu…”; koszt budowy rośnie od razu. | + | P1 |
| RAP-17 | **Jeden raport = budowa + dzień**: ponowne otwarcie dzisiejszego raportu tej budowy = edycja, nie duplikat. Data zawsze dzisiejsza. | + | P1 |
| RAP-18 | Edycja „Do edycji”: mniejsza ilość → różnica wraca na stan budowy po tej samej cenie; większa → schodzi (`082` korekta dopisuje, nie kasuje). | + | P1 |
| RAP-19 | Raport zatwierdzony → edycja niemożliwa (UI i RPC). | − / S | P1 |
| RAP-20 | Raport „do poprawy” z komentarzem Admina → badge u brygadzisty → poprawka → ponowne wysłanie. | + | P1 |
| RAP-21 | Podwójne kliknięcie „Zapisz raport dzienny” → jeden raport, jedno zdjęcie ze stanu. | B | P1 |
| RAP-22 | Zdjęcia w raporcie — aparat, galeria, duży plik, brak uprawnień do aparatu. | + / − | P2 |
| RAP-23 | Raport północ: zaczęty 23:58, zapisany 00:01 — jaka data? | B | P2 |
| RAP-24 | „Moje raporty” (`saved-reports-screen`, `025`) — brygadzista widzi tylko swoje. | S | P1 |
| RAP-25 | Lider podwykonawcy: raport m² dla swojej brygady; brak przypisanej brygady na budowie → blokada. | + / − | P1 |
| RAP-26 | Admin: raport „w imieniu” podwykonawcy (`115`) i korekta m². | + | P1 |
| RAP-27 | Powiadomienie push/web-push do Admina po nowym raporcie (`send-report-notification`). | + | P2 |

### 4.5 Zatwierdzanie raportów — panel Admina (`MGR`) — `manager-screen.tsx`, `admin-screen.tsx`
| ID | Opis | Typ | P |
|---|---|---|---|
| MGR-01 | Lista do zatwierdzenia, filtry: budowa, osoba, zakres dat. | + | P1 |
| MGR-02 | Szczegóły: materiały, zespół, godziny, km, koszty, notatka, ostrzeżenie „⚠ Przekracza plan o …”. | + | P1 |
| MGR-03 | Zatwierdź → **nie zmienia** kosztów ani stanów (porównać przed/po). | + | P1 |
| MGR-04 | Odeślij do poprawy z komentarzem (pusty komentarz?). | + / B | P1 |
| MGR-05 | Zatwierdzenie nieodwracalne — także dla Admina. | − | P1 |
| MGR-06 | Zatwierdzenie bez potwierdzenia pracownika — dozwolone. | + | P2 |
| MGR-07 | Dwóch adminów zatwierdza/odsyła ten sam raport jednocześnie. | B | P2 |

### 4.6 Magazyn (`MAG`) — `warehouse-screen.tsx`, `materials.ts`, `material-batches.ts`, `stock-movements.ts`
| ID | Opis | Typ | P |
|---|---|---|---|
| MAG-01 | Utworzenie materiału (`create_material`): nazwa, jednostka, stan minimalny (`065`), podpowiedzi nazw przy literówce (Levenshtein). | + | P1 |
| MAG-02 | Duplikat nazwy / różnica wielkości liter / polskie znaki / spacje. | − | P2 |
| MAG-03 | Lista partii z ceną i datą; FEFO→FIFO przy przypisaniu (`assign_material_batches_to_build`). | + | P1 |
| MAG-04 | Ręczny wybór partii (`009`, `092`). | + | P2 |
| MAG-05 | Przypisanie > stan wolny → ostrzeżenie, ruch częściowy. | B | P1 |
| MAG-06 | Korekta z **obowiązkowym powodem** (`correct_material`, `116`), korekta przy stanie zerowym wymaga ceny; historia korekt (`list_material_corrections`). | + / − | P1 |
| MAG-07 | Archiwizacja tylko przy stanie 0 (`039`); przywrócenie (`set_material_active`). | + / − | P2 |
| MAG-08 | Poniżej minimum → badge i lista braków. | + | P2 |
| MAG-09 | Księga ruchów: każdy ruch (przyjęcie, przypisanie, zużycie, zwrot, transfer, korekta, utylizacja) ma wpis (`079`, `084`). | + | P1 |
| MAG-10 | Scalanie partii o tej samej tożsamości (`081`). | B | P2 |
| MAG-11 | Transfer budowa→budowa (`transfer_material_between_builds`): ilość > stan źródła, ta sama budowa, budowa zamknięta. | B / − | P1 |

### 4.7 Technologie (`TEC`) — `technologies-screen.tsx`, `technology-picker.tsx`, `technology-sql-import.ts`
| ID | Opis | Typ | P |
|---|---|---|---|
| TEC-01 | Nowa technologia: etapy, materiały, normy zużycia/m², straty %. | + | P1 |
| TEC-02 | Edycja bez nowej wersji (`073`) vs zmiana tworząca wersję; budowy z planem nie zmieniają się. | + | P1 |
| TEC-03 | Jednostka technologii i materiał główny (`106`), druga miara (`107`, `111` cokoły). | + | P2 |
| TEC-04 | Import SQL / receptury z księgi technicznej (`110`) — poprawny, uszkodzony, duplikaty. | + / − | P2 |
| TEC-05 | Grubość/zakres grubości (`016/017`, `102`). | B | P3 |
| TEC-06 | Realtime: zmiana technologii widoczna u innego admina (`030`). | + | P3 |

### 4.8 Zamówienia (`ORD`) — `orders-screen.tsx`, `orders.ts`, `build-orders.ts`
Stany zamówienia z planu: **robocze → zamówione → przyjęte** (+ anulowane → usunięte).
Stany zamówienia materiałowego (braki): **brak → do realizacji → w drodze → dostarczone**.

| ID | Opis | Typ | P |
|---|---|---|---|
| ORD-01 | „+ Z planu” (`generate_order_from_plan`) — tylko reszta niezamówiona (`036`); drugi raz → „Cały plan materiałowy jest już zamówiony”. | + / B | P1 |
| ORD-02 | Budowa bez technologii → brak „+ Z planu”. | − | P2 |
| ORD-03 | Edycja ilości w roboczym, usunięcie pozycji, ilość 0. | B | P2 |
| ORD-04 | Przyjęcie (`receive_order`, `receive_material_order`): ilość < / = / > zamówionej, inna cena, **brak ceny** → blokada/ostrzeżenie, częściowe przyjęcie. | B | P1 |
| ORD-05 | Każda pozycja przyjęcia tworzy **osobną partię** z ceną z faktury. | + | P1 |
| ORD-06 | Zabezpieczenia podwójnego przyjęcia (`076`), podwójne liczenie zamówień budowy (`075`). | B | P1 |
| ORD-07 | Anulowanie i usunięcie (`015`, `023`, `delete_build_order`, `delete_material_order`) — nie zostawia sierot. | + | P2 |
| ORD-08 | Dopasowanie materiału przy odbiorze po nazwie (`037`, `045`) dla nowego materiału w zamówieniu (`074`). | B | P2 |
| ORD-09 | Status „W drodze” i badge. | + | P3 |

### 4.9 Rozliczenie i koszty (`ROZ`) — `settlement-screen.tsx`, `charts.tsx`
| ID | Opis | Typ | P |
|---|---|---|---|
| ROZ-01 | Koszt materiałowy = Σ zużycie × cena partii (FIFO) — porównać z arkuszem referencyjnym. | + | P1 |
| ROZ-02 | Robocizna: godziny × stawka kosztowa zamrożona (`048`, `055`); stawki ukryte przed brygadzistą (`044`). | + / S | P1 |
| ROZ-03 | Koszt planowany vs rzeczywisty (`040`, `PROCES_KOSZT_PLANOWANY_VS_RZECZYWISTY.md`). | + | P1 |
| ROZ-04 | Km × stawka, koszty dodatkowe, straty materiałowe, koszty podwykonawców. | + | P1 |
| ROZ-05 | Marża = wartość kontraktu − koszty; wartość kontraktu 0 / brak. | B | P2 |
| ROZ-06 | Wykresy: brak danych, jedna budowa, dużo budów, wartości ujemne. | B | P3 |
| ROZ-07 | Filtr archiwum, budowa wznowiona. | + | P2 |

### 4.10 HR, czas pracy, płace, urlopy (`HR`) — `hr-panel`, `payroll`, `leave`, `team-time`, `worker`
| ID | Opis | Typ | P |
|---|---|---|---|
| HR-01 | Pracownicy: dodaj, edytuj, stawka kosztowa, archiwizacja (`051`) — zarchiwizowany nie pojawia się w wyborze zespołu raportu. | + | P1 |
| HR-02 | „Mój czas” — Pracownik widzi **wyłącznie** swoje wpisy; potwierdzenie wpisu. | + / S | P1 |
| HR-03 | „Czas zespołu” brygadzisty — tylko jego ludzie. | S | P1 |
| HR-04 | Płace: suma godzin per pracownik/miesiąc, przełom miesiąca, raport edytowany po zamknięciu miesiąca. | B | P2 |
| HR-05 | Urlop: każdy typ, zakres przez weekend/święto (liczone dni robocze), 1 dzień, zakres odwrócony, nakładające się wnioski, przekroczenie puli. | B | P1 |
| HR-06 | Decyzja admina (`decide_leave_request`, `050`) — zatwierdź/odrzuć; edycja zatwierdzonego; anulowanie przez pracownika. | + | P1 |
| HR-07 | Pula dni (`updateEmployeeLeaveDays`) — zmiana, wartości ujemne. | B | P2 |
| HR-08 | Pracownik na urlopie dodany do raportu tego dnia — ostrzeżenie? | B | P3 |

### 4.11 Podwykonawcy (`PW`) — `subcontractors-screen.tsx`, `build-subcontracts-section.tsx`
| ID | Opis | Typ | P |
|---|---|---|---|
| PW-01 | Firma: dodanie przez wyszukiwarkę GUS (`gus-search-company`) — NIP poprawny, błędny, brak sieci; ręcznie. | + / − | P2 |
| PW-02 | Stawka m² (`114`): `parseRateInput` — `12,5`, `12.5`, `abc`, puste, 0. | B | P1 |
| PW-03 | Dezaktywacja firmy — znika z wyboru, historia zostaje. | + | P2 |
| PW-04 | Brygada podwykonawcy → konto lidera (`setTeamSubcontractor`). | + | P1 |
| PW-05 | Zlecenie na budowie: materiał po stronie flowtex vs podwykonawca — wpływ na koszt i magazyn. | + | P1 |
| PW-06 | Odbiór: pozycje etap/dodatkowe/potrącenie (potrącenie zmniejsza), oznaczenie zapłaty i cofnięcie, usunięcie odbioru. | + / B | P1 |
| PW-07 | Suma odbiorów > wartość zlecenia — ostrzeżenie? | B | P2 |

### 4.12 Portal klienta (`POR`) — `app/portal/[token].tsx`, `build-portal-section.tsx`, RPC `get_public_build`
| ID | Opis | Typ | P |
|---|---|---|---|
| POR-01 | Link z tokenem bez PIN → widok; z PIN → ekran PIN; zły PIN; wielokrotne złe próby (brute force — czy jest limit?). | + / S | P1 |
| POR-02 | Nieistniejący / zregenerowany / wyłączony token → komunikat, brak danych. | S | P1 |
| POR-03 | Postęp: tylko z **zatwierdzonych** raportów (`066`), procent etapu ważony ilością (`090`), procent całości z etapów (`089`), checkbox „etap zakończony” = 100%. | + | P1 |
| POR-04 | Przełączniki Admina: wartość kontraktu, zdjęcia, notatki, AI — każdy ON/OFF zmienia widok portalu (i odpowiedź RPC, nie tylko UI!). | + / S | P1 |
| POR-05 | Galeria wszystkich dni (`062`), brak zdjęć. | + | P2 |
| POR-06 | Klient generuje podsumowanie AI (`064`, `generate-client-summary`) — limit wywołań, błąd. | + / − | P2 |
| POR-07 | Portal na telefonie (Safari/Chrome), wolna sieć. | + | P2 |
| POR-08 | Odpowiedź RPC nie zawiera danych wewnętrznych (ceny materiałów, stawki, nazwiska jeśli niepożądane). | S | P1 |

### 4.13 Oferty (`OFE`) — `oferta-screen.tsx`, `offers.ts`, `build-offer-pdf.ts`
| ID | Opis | Typ | P |
|---|---|---|---|
| OFE-01 | Nowa oferta z technologii pilotażowych, sugerowany numer (`suggestOfferRef`), domyślna cena sprzedaży (`100`). | + | P2 |
| OFE-02 | Pozycje: m², cena, rabat?, suma; zero pozycji. | B | P2 |
| OFE-03 | PDF: polskie znaki, długie nazwy, wiele stron, logo/certyfikat. | + | P2 |
| OFE-04 | Karta technologiczna PDF — podpisany URL, wygasły URL, brak pliku. | + / − | P2 |
| OFE-05 | Wyszukiwanie, edycja, usunięcie oferty; status „szkic”. | + | P3 |
| OFE-06 | Dostęp nie-Admina do edycji oferty → blokada. | S | P1 |

### 4.14 Admin / Ustawienia / Konta (`ADM`) — `admin-screen`, `settings-screen`, `super-admin-accounts-section`
| ID | Opis | Typ | P |
|---|---|---|---|
| ADM-01 | Ustawienia: stawka km, PIN zamknięcia, inne `settings`. | + | P2 |
| ADM-02 | Superadmin: lista kont, tworzenie, zmiana roli/emaila/nazwy/hasła, usuwanie (`admin-users` edge function). | + | P1 |
| ADM-03 | Zwykły Admin wywołuje `admin-users` bezpośrednio → odmowa. | S | P1 |
| ADM-04 | Trigger chroniący superadmina przed degradacją (`105`). | S | P1 |
| ADM-05 | Usunięcie własnego konta / ostatniego admina. | B | P1 |
| ADM-06 | Hasło za krótkie, email zajęty, email niepoprawny. | − | P2 |

---

## 5. Niezmienniki magazynowe

Na podstawie `docs/FLOWTEX ERP — Katalog ruchów magazynowych_ wzory i niezmienniki.md`.
**Każdy test z sekcji 3 i 4 dotyczący materiału kończy się zapytaniem SQL sprawdzającym
wszystkie niezmienniki** (gotowy skrypt `qa/invariants.sql` — do przygotowania).

| ID | Niezmiennik | Sprawdzenie |
|---|---|---|
| INV-N1 | Stan = Σ ruchów | stan z `material_batches`/`build_materials` == suma z `stock_movements` per partia/lokacja |
| INV-N2 | Bilans partii | `q_M + Σ q_S + zużycie + utylizacja = ilość przyjęta` |
| INV-N3 | Niezmienność ceny | cena partii i przypisań nigdy się nie zmienia po przyjęciu |
| INV-N4 | Magazyn główny ≥ 0 | brak partii z ujemnym stanem w magazynie |
| INV-N5 | Budowa może być < 0 | tylko z flagą niedoboru |
| INV-N6 | Zamknięcie ⇔ Σ q_S = 0 | żadna zamknięta budowa nie ma salda ≠ 0 |
| INV-N7 | Transfer zachowuje wartość | Σ V(+) − Σ V(−) = 0 dla pary ruchów |

**Testy ruchów R1–R9** (każdy: Δ magazynu, Δ budowy, Δ WIP, Δ kosztu zgodne z tabelą §6 katalogu):
R1 przyjęcie · R2 przypisanie · R3 zużycie (rozbicie 1:N na partie!) · R4 utylizacja · R5 zwrot ·
R6 transfer · R7 korekta · R8 koszty dodatkowe · R9 higiena kartoteki.

**Test właściwości (property-based, P1):** generator losowej sekwencji 200 operacji
(przyjęcia, przypisania, raporty, edycje raportów, zwroty, transfery, korekty, zamknięcia,
wznowienia) na bazie testowej → po każdej operacji sprawdzić N1–N7. Każde naruszenie =
minimalizacja sekwencji i błąd P1.

---

## 6. Bezpieczeństwo, RLS, uprawnienia

Testy wykonywane **bezpośrednio przez supabase-js / REST z tokenem danej roli** — z pominięciem UI.

| ID | Opis | P |
|---|---|---|
| SEC-01 | Macierz: każda tabela × (anon, Pracownik, Brygadzista, Admin) × (select, insert, update, delete) — wynik zgodny z `003_auth_rls.sql` i późniejszymi. Generować automatycznie. | P1 |
| SEC-02 | Każde RPC z listy (36 funkcji, m.in. `close_build`, `receive_order`, `correct_material`, `decide_leave_request`, `transfer_material_between_builds`) wywołane z niższą rolą → odmowa przez `assert_role()`. | P1 |
| SEC-03 | Pracownik czyta cudze `time_entries`, cudze urlopy, stawki (`044`) → pusto/odmowa. | P1 |
| SEC-04 | Brygadzista: modyfikacja `builds` (Ryzyko 3 w `PROCES_CYKL_ZYCIA_BUDOWY.md`), raporty innego brygadzisty, edycja zatwierdzonego raportu przez RPC. | P1 |
| SEC-05 | Anon: tylko `get_public_build` z poprawnym tokenem/PIN; enumeracja tokenów; brak dostępu do tabel. | P1 |
| SEC-06 | Edge functions bez JWT / z JWT niższej roli (`admin-users`, `drive-photos`, `generate-*`, `google-places-search`, `gus-search-company`). | P1 |
| SEC-07 | Klucze w bundlu webowym — tylko `anon key`, brak `service_role`, brak kluczy Google/AI. | P1 |
| SEC-08 | Wstrzyknięcia: pola tekstowe (notatka, nazwa materiału, komentarz) z `'; drop`, `<script>`, emoji, 10 000 znaków — w UI, PDF, portalu. | P2 |
| SEC-09 | Storage: bucket „karty technologiczne” — dostęp tylko przez podpisany URL; zdjęcia Drive — brak publicznych linków poza portalem. | P1 |
| SEC-10 | Supabase advisors (security + performance) — zero błędów krytycznych. | P2 |

---

## 7. Offline, synchronizacja, realtime, współbieżność

`lib/offline-outbox.ts` (klucz `offline-outbox:reports`, deduplikacja po budowa+data+brygada),
`use-realtime-sync.ts`, cache AsyncStorage w `contexts/app-data.tsx`.

| ID | Opis | P |
|---|---|---|
| OFF-01 | Start aplikacji offline → ostatni znany stan z cache, brak crasha. | P1 |
| OFF-02 | Raport offline → kolejka → licznik oczekujących → powrót sieci → automatyczny flush. | P1 |
| OFF-03 | Dwa raporty offline na dwie budowy → oba wysłane, w kolejności. | P1 |
| OFF-04 | Ten sam raport (budowa+data) zapisany dwa razy offline → jeden wpis (deduplikacja `reportKey`). | P1 |
| OFF-05 | Błąd serwera (nie sieciowy, np. budowa zamknięta w międzyczasie) → raport nie zapętla się, użytkownik widzi błąd. | P1 |
| OFF-06 | Sieć „miga” w trakcie flusha (zerwanie po wysłaniu, przed odpowiedzią) → brak duplikatu (idempotencja `clientId`). | P1 |
| OFF-07 | Wyczyszczenie danych przeglądarki z niewysłanym raportem → ostrzeżenie? (ryzyko utraty — udokumentować). | P2 |
| OFF-08 | Wylogowanie z niewysłanym raportem. | P1 |
| RT-01 | Admin A i B: zmiana u A widoczna u B bez odświeżenia (materiały, partie `014`, technologie, czas `032`, raporty). | P2 |
| RT-02 | Utrata websocketu → reconnect → brak przegapionych zmian. | P2 |
| CON-01 | Dwóch brygadzistów raportuje ten sam materiał na tej samej budowie w tej samej sekundzie. | P1 |
| CON-02 | Admin przypisuje partię, którą w tym czasie zużywa inna budowa / przyjmuje się korekta. | P1 |
| CON-03 | Admin zamyka budowę, gdy brygadzista wysyła raport. | P1 |

---

## 8. PWA, powiadomienia, wersjonowanie

| ID | Opis | P |
|---|---|---|
| PWA-01 | Instalacja (Android Chrome — prompt `use-install-prompt`; iOS — „Dodaj do ekranu głównego”), ikony, manifest, splash. | P2 |
| PWA-02 | Service worker `public/sw.js` — cache, działanie offline powłoki aplikacji. | P1 |
| PWA-03 | Nowa wersja (`version.json`, `useVersionCheck`) → baner „Dostępna aktualizacja” → odświeżenie ładuje nową wersję, bez pętli. | P1 |
| PUSH-01 | Web push iOS Safari (PWA, iOS ≥ 16.4) i Android — subskrypcja, odmowa uprawnień, ponowne włączenie (`068`). | P2 |
| PUSH-02 | Natywny push token (`register_push_token`) tylko dla Admina. | P2 |
| PUSH-03 | Treść powiadomienia o nowym raporcie, kliknięcie otwiera właściwy ekran. | P3 |

---

## 9. Integracje zewnętrzne

Dla każdej: **sukces, timeout, 4xx, 5xx, brak sieci, brak klucza/sekretu, limit (429)** — UI nie może się zawiesić ani pokazać surowego błędu.

| Funkcja | Wykorzystanie | P |
|---|---|---|
| `drive-photos` | katalog i zdjęcia budowy (Google Drive, `GOOGLE_DRIVE_SETUP.md`) | P2 |
| `generate-report-note` | notatka AI do raportu | P3 |
| `generate-client-summary` | podsumowanie AI w portalu | P2 |
| `google-places-search` | adres budowy | P3 |
| `gus-search-company` | dane firmy podwykonawcy | P3 |
| `send-report-notification` | push po raporcie | P2 |
| `admin-users` | zarządzanie kontami | P1 |
| GitHub Action `supabase-keepalive` | ping co 3 dni — sprawdzić ręcznym `workflow_dispatch` | P3 |

---

## 10. Testy niefunkcjonalne

| Obszar | Test | Cel |
|---|---|---|
| Wydajność | 200 budów, 2 000 materiałów, 50 000 ruchów, 10 000 raportów — czas otwarcia Magazynu, Rozliczenia, listy raportów | < 2 s na desktopie, < 4 s na średnim Androidzie |
| Wydajność SQL | `EXPLAIN ANALYZE` kluczowych RPC; indeksy `042` | brak seq scan na dużych tabelach |
| Bundle | rozmiar `dist/`, lazy loading ekranów (`lazy()` w `index.tsx`) | Lighthouse Performance ≥ 70 mobile |
| Responsywność | 360 px, 390 px, 768 px, 899/900 px, 1280 px, 1920 px; panel ≤ 60% szerokości na desktopie | brak ucinania, przewijania w poziomie |
| Dostępność | kontrast, rozmiar celów dotyku ≥ 44 px (rękawice na budowie!), czytnik ekranu na kluczowych przyciskach | WCAG AA dla kluczowych ekranów |
| Użyteczność terenowa | raport w słońcu, jedną ręką, słaby zasięg (throttling „Slow 3G”) | raport < 3 min |
| Przeglądarki | Chrome, Safari iOS, Firefox, Edge, Samsung Internet | smoke na każdej |
| Lokalizacja | separator dziesiętny `,`, formaty dat, waluta PLN, polskie znaki w PDF/CSV | spójnie w całej aplikacji |
| Strefy czasowe | urządzenie w innej strefie / zmiana czasu letni↔zimowy (godziny od–do, data raportu) | brak przesunięcia dnia |

---

## 11. Migracje SQL i dane

| ID | Opis | P |
|---|---|---|
| MIG-01 | Czysta baza: migracje `000 → 117` po kolei bez błędów (uwaga: dwa pliki `111_*` — kolejność!). | P1 |
| MIG-02 | Idempotencja: ponowne uruchomienie każdej migracji (`create or replace`, `if not exists`). | P2 |
| MIG-03 | Migracja na kopii danych produkcyjnych (anonimizowanej) → niezmienniki N1–N7 przed i po. | P1 |
| MIG-04 | Brakująca migracja `assign_technology_to_build` (Ryzyko 1 w `PROCES_CYKL_ZYCIA_BUDOWY.md`) — zweryfikować, że funkcja istnieje w bazie i odtworzyć plik. | P1 |
| MIG-05 | Skrypty resetu — działają tylko na testowej, zachowują pracowników/technologie zgodnie z nazwą. | P2 |

---

## 12. Automatyzacja

### 12.1 Piramida (stan dziś → cel)
Dziś: **1 plik testów** (`lib/workdays.test.ts`, vitest), brak CI dla testów.

| Poziom | Narzędzie | Co automatyzujemy najpierw |
|---|---|---|
| Jednostkowe | vitest | `workdays.ts`, `material-name-match.ts` (normalizacja, Levenshtein), `material-report-key.ts`, `parseRateInput`, `offline-outbox.ts` (z mockiem AsyncStorage i supabase), wyliczenia kosztów w `app-data.tsx` (wydzielić do czystych funkcji) |
| Bazodanowe / RPC | vitest + supabase-js na bazie testowej (lub pgTAP) | wszystkie RPC × role (SEC-01/02), ruchy R1–R9, niezmienniki N1–N7, test property-based |
| E2E | Playwright (już dostępny w środowisku) | E2E-01, 02, 03 (offline przez `context.setOffline`), 05, 10, NAV-01 |
| Wizualne | Playwright screenshots | 360 px / 1280 px dla 10 głównych ekranów |

### 12.2 Pipeline CI (propozycja `.github/workflows/test.yml`)
1. `pnpm check` (TypeScript) + `pnpm lint`
2. `pnpm test` (unit)
3. Supabase lokalny (`supabase start`) → migracje → seed → testy RPC/RLS/niezmienników
4. `pnpm build:web` → Playwright smoke (E2E-01, NAV-01, AUTH-01)

### 12.3 Zestawy uruchomień
| Zestaw | Zawartość | Kiedy | Czas |
|---|---|---|---|
| **Smoke** | AUTH-01, NAV-01, RAP-01/16, MGR-03, MAG-03, POR-01 | każdy deploy | 10 min |
| **Krytyczny (P1)** | wszystkie P1 + E2E-01..05, 07, 10, 12 + INV | przed wydaniem / po migracji SQL | 1 dzień |
| **Pełny** | wszystko | co miesiąc / duża zmiana | 3–4 dni |
| **Eksploracyjny** | sesje z kartą per moduł | po każdej zmianie modułu | 60–90 min |

### 12.4 Mapa „zmiana → co przetestować” (regresja celowana)
| Zmieniono | Uruchom |
|---|---|
| `submit_daily_report` / `report-screen.tsx` | RAP-*, INV-*, ROZ-01, POR-03, OFF-* |
| `close_build` | ZAM-*, INV-N6, E2E-02, E2E-05 |
| `receive_order` / zamówienia | ORD-*, MAG-03/05, INV-N2/N3 |
| `correct_material` / magazyn | MAG-*, INV-*, ROZ-01 |
| RLS / `assert_role` | SEC-*, NAV-01 |
| Portal (`get_public_build`) | POR-*, SEC-05 |
| `app-data.tsx` | smoke + OFF-* + RT-* |
| `sw.js` / `version.json` | PWA-* |

---

## 13. Priorytety i kryteria

### 13.1 Kolejność wykonania (pierwsza runda)
1. **MIG-01, MIG-04** — czy baza testowa w ogóle odpowiada kodowi.
2. **SEC-01..07** — uprawnienia (wyciek danych = najwyższe ryzyko biznesowe).
3. **E2E-01 + INV-*** — złota ścieżka z weryfikacją liczbową.
4. **RAP-* + OFF-*** — codzienna praca brygadzistów.
5. **ZAM-*, E2E-02, E2E-05** — zamknięcie i rozliczenie.
6. **POR-*** — to, co widzi klient.
7. Pozostałe P2, potem P3.

### 13.2 Kryteria wejścia
- Baza testowa z migracjami do `117` + seed; konta z sekcji 1.2; build na preview.

### 13.3 Kryteria wyjścia (wydanie)
- 100% P1 wykonanych, 0 otwartych błędów P1, ≤ 3 otwarte P2 z akceptacją właściciela.
- Niezmienniki N1–N7 zielone na bazie po pełnym przebiegu.
- Smoke zielony na Chrome desktop, Safari iOS (PWA), Chrome Android.

### 13.4 Zgłoszenie błędu — szablon
```
ID testu:            RAP-18
Rola / konto:        qa-bryg-1
Urządzenie / przegl: iPhone 13, iOS 18, PWA
Kroki:               1. … 2. … 3. …
Oczekiwane:          stan budowy 14, koszt 140,00 zł
Rzeczywiste:         stan budowy 13, koszt 152,00 zł
Dane:                budowa B/QA/001, materiał „Klej X”, partie #12 (10 zł), #13 (12 zł)
Niezmienniki:        N2 naruszony (wynik qa/invariants.sql w załączniku)
Załączniki:          zrzut, nagranie, log konsoli, response z sieci
Priorytet:           P1 (pieniądze)
```

### 13.5 Ryzyka już znane z dokumentacji (testować w pierwszej kolejności)
- Brak pliku migracji `assign_technology_to_build` (`PROCES_CYKL_ZYCIA_BUDOWY.md`, Ryzyko 1).
- Brygadzista może edytować `builds` (Ryzyko 3).
- Brak granulacji „który brygadzista widzi którą budowę” (Ryzyko 4).
- Wielokrotne zamówienie z tego samego planu (Ryzyko 5) — częściowo naprawione w `036`.
- Historyczne regresje enumu zwrotu (`077`, `085`, `108`) — test ZAM-05 po każdej zmianie `close_build`.
