# Raport z testów E2E w przeglądarce — 23.11.2026

Wykonanie scenariuszy E2E-01…E2E-12 z `docs/PLAN_TESTOW.md`.

- **Środowisko:** aplikacja webowa uruchomiona lokalnie (`expo start --web`) podpięta do **produkcyjnej** bazy Supabase `ERP-Flowtex` (decyzja właściciela: „produkcja z danymi QA”).
- **Przeglądarka:** Chromium (Playwright), desktop 1400×1000 i telefon 390×844.
- **Konta:** `qa-admin`, `qa-bryg`, `qa-prac`, `qa-lider-pw` (`@flowtex-qa.test`); dane z prefiksem `QA_`.
- **Weryfikacja:** każdy krok sprawdzony w UI **oraz** zapytaniem SQL do bazy (stany, partie, ruchy, koszty).

---

## 1. Wynik scenariuszy

| ID | Scenariusz | Wynik | Najważniejsze błędy |
|---|---|---|---|
| E2E-01 | Złota ścieżka budowy | ⚠️ przechodzi, z błędami | F6, F7, F12, F17, F18, F19, F20/21 |
| E2E-02 | Niedobór na budowie | ❌ | F23 — budowy z niedoborem nie da się zamknąć |
| E2E-03 | Raport offline | ❌ | F28 — raport offline nie wysyła się sam |
| E2E-04 | Transfer między budowami | ✅ | (brak komunikatu przy ilości > stan — P3) |
| E2E-05 | Wznowienie zamkniętej budowy | ⚠️ | wznowienie ✔, ponowne zamknięcie zablokowane przez F23; F22 |
| E2E-06 | Wolny magazyn („pobrać?”) | ⚠️ | F4 — brak ruchu w księdze; F5 |
| E2E-07 | Podwykonawca | ⚠️ | F25, F26, F27 |
| E2E-08 | Urlopy | ⚠️ | F29 (święta liczone jako dni robocze), F16 (brygadzista zatwierdza własny urlop) |
| E2E-09 | Oferta → PDF | ✅ | drobne P3 (słowo „adres” w PDF, numeracja faz) |
| E2E-10 | Portal klienta | ⚠️ | F13, F14 |
| E2E-11 | Płace (zamrożenie stawki) | ✅ | F31 (nakładające się godziny bez ostrzeżenia) |
| E2E-12 | Zarządzanie kontami | ✅ | uwaga do ADM-03 (patrz §4) |

Dodatkowo przetestowano bezpieczeństwo przez API (SEC) — **F1-SEC, F8, F15, F16**.

---

## 2. Błędy — P1 (pieniądze, dane osobowe, utrata danych)

| # | Błąd | Gdzie / dowód |
|---|---|---|
| **F1-SEC** | **Bez logowania** (sam publiczny klucz anon z bundla) RPC `get_employees` i `get_time_entries` zwracają imiona i nazwiska wszystkich pracowników oraz pełny rejestr godzin pracy na budowach (RODO). Stawki są poprawnie ukryte (null). | `anon` → `rpc('get_employees')` = 6 osób; `rpc('get_time_entries')` = 14 wpisów. Funkcje `SECURITY DEFINER`, `EXECUTE` dla `anon`. |
| **F8** | Pracownik w „Mój czas” widzi **godziny innego pracownika** (pierwszego z rolą „Pracownik”), nie swoje. Do tego baza zwraca Pracownikowi wszystkie wpisy czasu wszystkich osób. | `components/screens/worker-screen.tsx:24-28` ignoruje `myEmployeeId`. qa-prac widział „Maciej Panasewicz”. |
| **F15** | Brygadzista może przez API **zmienić dowolne pole budowy** (np. wartość kontraktu). | `qa-bryg`: `update builds set contractValue=1` → przeszło (przywrócone). „Ryzyko 3” z `PROCES_CYKL_ZYCIA_BUDOWY.md`. |
| **F16** | Brygadzista może przez API **zatwierdzić własny urlop** i decydować o urlopach innych. | `decide_leave_request` dopuszcza rolę Brygadzista. |
| **F28** | **Raport offline nie wysyła się automatycznie.** (a) brak sieci klasyfikowany jako „serwer odrzucił” (`code` = `""`, nie `undefined`) → mylący komunikat „serwer go odrzucił: TypeError: Failed to fetch”; (b) `initOfflineOutbox()` **nigdzie nie jest wywoływane** — kolejka nie flushuje się ani przy starcie, ani po evencie `online`; raport poleci dopiero przy wysyłce **następnego** raportu z tego urządzenia; w międzyczasie znika z listy raportów. | `lib/offline-outbox.ts:79-83`, brak wywołania `initOfflineOutbox` w `app/`. Potwierdzone: raport id 9 dotarł dopiero po wysłaniu kolejnego. |
| **F23** | **Budowy z niedoborem nie da się zamknąć** ścieżką z instrukcji. Dopisanie materiału tworzy osobną partię +3 obok −3; dialog zamknięcia wymusza dla +3 „zwrot” lub „wyrzucenie” (obie usuwają +3), więc −3 zostaje i `close_build` blokuje na zawsze. | QA_Budowa1: lots `−3` i `+3` (QA_Grunt); komunikat „podmagazyn nie jest wyzerowany: QA_Grunt: −3”. |
| **F12** | `report_materials.cost` po edycji raportu zapisuje **różnicę ostatniej edycji**, a nie koszt dnia. Admin przy zatwierdzaniu widzi np. „QA_Klej 11 kg → **−12,00 zł**”, grunt „0,00 zł”. | Raport id 6: koszty −12 / 0 / 0 zamiast 112 / 90 / 5. Sumy budowy (`build_materials`) są poprawne. |
| **F17 / F18** | „Koszty na bieżąco” na **karcie budowy** liczą materiał po średniej cenie (472,40 zamiast FIFO 466,00) i **pomijają kilometrówkę i podwykonawców** (2092,40 vs 2311,00 w ekranie Rozliczenie; QA_Budowa3: 5 zł vs 330 zł). | Karta budowy → Rozliczenie vs zakładka Rozliczenie. |
| **F6** | Po „Przypisz do budowy” pole **zużycia** materiału pomocniczego jest wstępnie wypełnione całą przypisaną ilością — łatwo zaraportować zużycie wszystkiego, co przywieziono. | Raport → Dodaj materiał z magazynu → Przypisz 5 → pole zużycia = 5 (po przeładowaniu 0). |
| **F7** | „Dodaj wszystkich” w kroku Zespół dodaje **wszystkich pracowników firmy** (6), a nie brygadę (2). | Brygada QA_Brygada = 2 osoby, dodało 6 (w tym realnych pracowników). |
| **F19** | Zamknięcie budowy **nie zapisuje w księdze ruchów** zwrotów ani utylizacji (są tylko w `build_material_returns`). Narusza N1 („stan wynika z ruchów”). | `stock_movements` po zamknięciu QA_Budowa1 — brak typów zwrot/utylizacja. |
| **F29** | Urlop liczy **Wigilię i Boże Narodzenie jako dni robocze** (23–28.12 = 4 dni zamiast 2). Funkcja `count_business_days` wyklucza tylko weekendy; `lib/workdays.ts` (budowy) liczy poprawnie. | Wniosek id 2: `businessDays = 4`. |

## 3. Błędy — P2

| # | Błąd |
|---|---|
| F1 | Materiał ze „stanem początkowym” nie zapisuje ruchu „przyjęcie” w `stock_movements`. |
| F2 | Pusta cena przy przyjęciu dostawy → przyjęto **bez ostrzeżenia** po cenie z kartoteki. |
| F4 | Pobranie z wolnego magazynu („Na magazynie: X — pobrać?”) nie zapisuje ruchu „wydanie”. |
| F5 | Wyzerowane partie i przypisania są **fizycznie kasowane** — ruchy/raporty tracą `batchId`/`lotId`, a z nimi nr PZ i dostawcę (identyfikowalność, atesty). |
| F9 | Data raportu liczona w **UTC** (`toISOString`, `report-ui.tsx:337`) — raport między 00:00 a 01:00 (latem 02:00) dostaje wczorajszą datę. Serwer przyjmuje dowolną `p_date` (brak egzekwowania „zawsze dziś”). |
| F13 | Portal: zakończenie 26.11 vs karta budowy 25.11 (dni kalendarzowe vs robocze). |
| F14 | Portal: **brak limitu prób PIN** (30 prób w 5 s; 4 cyfry ≈ 30 min). |
| F20 / F21 | `build_settlements` (zapis końcowy): `laborCost` liczony stawką godzinową (1280) zamiast kosztowej (1600) i **bez kilometrówki** w `totalCost` (1892 vs 2437). UI liczy poprawnie — błąd dotyczy danych w tabeli. |
| F22 | Po wznowieniu budowy `build_materials` (przypisano − zużyto) nie uwzględnia zwrotów z zamknięcia — UI pokazuje „QA_Tasma 7 szt.” na budowie, której stan = 0. |
| F24 | W bazie dwie wersje `close_build` — `(integer)` i `(integer, jsonb)`; wywołanie z samym ID → błąd niejednoznaczności; stara wersja może omijać nowe kontrole. |
| F26 | Raport podwykonawcy: 50 m² na budowie 40 m² — brak ostrzeżenia. |
| F27 | Zlecenie „Cała budowa”: „zatwierdzono w raportach 40 m²” i podpowiedź odbioru 40 m², choć warstwa zasadnicza ma 20 m² → ryzyko przepłaty. |
| F31 | Ta sama osoba 3× 07:00–15:00 tego samego dnia na 3 budowach — przyjęte bez ostrzeżenia. |
| — | Brygadzista widzi w raporcie **wszystkie aktywne budowy** (Ryzyko 4). Lider podwykonawcy — poprawnie tylko swoje. |
| — | Potencjalnie (z kodu, niezweryfikowane): `submit_daily_report` kasuje `time_entries` tylko gdy raport ma osoby — usunięcie wszystkich osób przy edycji zostawi stare godziny. |

## 4. P3 / UX i uwagi

- Konsola: „Unexpected text node … cannot be a child of a <View>” (Technologie); „Invalid DOM property transform-origin” (Rozliczenie).
- Komunikat informacyjny „Cały plan … już zamówiony” ma tytuł „Nie udało się zapisać”.
- Na przyjętym zamówieniu nadal widnieje „Na magazynie: 20 kg — pobrać?”.
- Edycja raportu nie wczytuje istniejącej notatki (notatka nie ginie w bazie).
- W widoku zatwierdzania brak kilometrówki.
- Brak komunikatów przy: za krótkim haśle konta, odwróconym zakresie urlopu, transferze > stan.
- Kreator oferty przepuszcza krok 1 bez pól wymaganych (*); PDF drukuje słowo „adres” przy pustym adresie; karta ST/EPO/3 numeruje fazy 1, 2, 5.
- F25: NIP podwykonawcy bez walidacji („123”, „fdafa”).
- ADM-03: każdy **Admin** (nie tylko superadmin) może przez API zarządzać kontami nie-superadminów; sekcja jest ukryta tylko w UI. Do decyzji, czy to zamierzone.

## 5. Co działa poprawnie (potwierdzone liczbowo)

- FIFO przy przypisaniu i zużyciu (np. 25 kg = 10×10 + 10×10 + 5×12 → 10,40 zł/kg; zużycie dnia 2 rozbite 10×10 + 2×12).
- Korekta raportu w dół zwraca materiał po tej samej cenie do tej samej partii (12 → 11 kg: −1×12 zł).
- Zwroty przy zamknięciu wracają do właściwej partii (z PZ i dostawcą); straty materiałowe 7×18 = 126 zł.
- Ekran Rozliczenie: 466 + 225 + 1600 + 20 + 126 = 2437 zł — zgodny z ręcznym wyliczeniem.
- Blokady: zatwierdzony raport (UI i RPC), zamknięcie bez zatwierdzonych raportów, zamknięcie z niezerowym saldem, zły PIN zamknięcia, zła rola dla RPC raportu/urlopu.
- Podwójne kliknięcie „Zapisz raport” → jeden raport.
- Walidacje: puste pola budowy, duplikat numeru budowy, godzina końca < początku, nakładające się urlopy.
- Portal: PIN, postęp tylko z zatwierdzonych raportów (65% / 84% / 75% ważone ilością), przełączniki, unieważnienie i wyłączenie linku.
- Transfer budowa→budowa: para ruchów z jednym `transferId`, wartość zachowana (N7).
- Stawka godzinowa zamrożona w `time_entries`; lista płac bez zmian po podwyżce.
- Oferta: przeliczenia materiału, robocizny, rabatu; PDF z polskimi znakami.

## 6. Pozostałości w produkcyjnej bazie (do posprzątania)

Konta `qa-admin`, `qa-bryg`, `qa-prac` (+ możliwy wpis `qa-admin` w `superadmins`), pracownicy `QA_*`, brygady `QA_Brygada`, `QA_BrygadaPW`, podwykonawca `QA_Podwykonawca`, materiały `QA_Klej`, `QA_Grunt`, `QA_Tasma`, technologia `QA_Technologia`, budowy `QA_Budowa1-3` (+ raporty, godziny, ruchy, partie, zamówienia, rozliczenie), urlopy QA, oferta `QA-OF-1`. Raporty QA mogły wysłać push do prawdziwych adminów.

---

## 7. Status poprawek — krok 1: uprawnienia (23.11.2026)

Migracja `supabase/sql/118_uprawnienia_bezpieczenstwo.sql` **wgrana na produkcję** + zmiany w aplikacji. Zweryfikowane przez API kontami każdej roli i w przeglądarce.

| Błąd | Poprawka | Weryfikacja |
|---|---|---|
| SEC | `anon` bez prawa wykonania funkcji (poza portalem i funkcjami RLS); domyślnie nowe funkcje też bez `anon` | `anon` → `get_employees` / `get_time_entries`: permission denied; portal działa |
| SEC-2 (nowy) | stawki `hourlyRate`/`costRate` nieczytelne wprost z tabel `employees` i `time_entries`; tylko przez funkcje (maskowane dla nie-Admina) | Pracownik/Brygadzista: permission denied; Admin widzi stawki w HR |
| F8 | `get_employees`/`get_time_entries` zwracają Pracownikowi tylko jego dane; ekran „Mój czas” bierze pracownika zalogowanego konta (`worker-screen.tsx`) | Pracownik widzi „QA_Pracownik” i tylko swoje godziny |
| F15 | zapis do `builds` tylko Admin; link do zdjęć przez RPC `set_build_photos_url` (`lib/data/builds.ts`) | Brygadzista: UPDATE zmienia 0 wierszy; link do zdjęć działa |
| F16 | `decide_leave_request` blokuje decyzję o własnym wniosku; lista do zatwierdzenia nie pokazuje własnych wniosków | „Nie możesz rozpatrzyć własnego wniosku urlopowego.” |
| Oferty | INSERT `offers` i zapis `offer_items` tylko Admin | Pracownik: odmowa RLS |

**Pozostaje (osobne kroki):**
- SEC-3 (P2): funkcja `generate-client-summary` w ścieżce portalu sprawdza token, ale nie PIN — wymaga wdrożenia edge function.
- Pracownik nadal czyta przez API tabele budów, raportów, magazynu i ofert (bez stawek pracowników). Do zawężenia razem z nowym modelem magazynu.
- F14 (limit prób PIN) — niezmienione.

## 8. Status poprawek — krok 2: poprawki P1 niezależne od modelu magazynu

Migracje `119_dni_robocze_swieta_urlopy.sql` i `120_koszt_dnia_w_raporcie.sql` **wgrane na produkcję** + zmiany w aplikacji.

| Błąd | Poprawka | Weryfikacja |
|---|---|---|
| F28 | brak sieci rozpoznawany poprawnie (także `code: ""` i „Load failed”); kolejka startuje z aplikacją (`app/_layout.tsx`) i ponawia wysyłkę po odzyskaniu sieci, przy powrocie do aplikacji i co minutę; lista raportów odświeża się po wysłaniu; na ekranie „Raporty” baner z raportami czekającymi w telefonie | testy `lib/offline-outbox.test.ts` (5) |
| F7 | „Dodaj wszystkich” dodaje brygadę budowy (brygady własne z `build_teams` + brygada główna; gdy brak — brygada, której liderem jest zalogowany) | kompilacja; do sprawdzenia w aplikacji po wdrożeniu |
| F6 | po „Przypisz do budowy” pole zużycia nie jest wypełniane przywiezioną ilością | kompilacja; do sprawdzenia w aplikacji po wdrożeniu |
| F9 | data raportu, pola wyboru daty i zakresy listy płac liczone w czasie lokalnym (`localISODate`) zamiast UTC — przy okazji naprawione przesuwanie dat o dzień w kalendarzu i na liście płac | testy `lib/utils.test.ts` (3) |
| F29 | `count_business_days` pomija polskie święta (te same reguły co budowy); podgląd w aplikacji też; istniejące wnioski przeliczone | SQL: 23–28.12.2026 = 2, Wielkanoc 2027 = 2, tydzień z Bożym Ciałem = 4; testy w `lib/workdays.test.ts` |
| F12 | koszt materiału w raporcie = koszt dnia z rozbicia na partie (`fn_report_day_cost`), a nie różnica ostatniej edycji | scenariusz w wycofanej transakcji: 12 kg → 124 zł, edycja 11 kg → 112 zł (wcześniej −12 zł) |

Nadal otwarte z kroku 2: serwer przyjmuje dowolną datę raportu (rozdzielenie daty wykonania od daty wysłania — w kroku 5).
