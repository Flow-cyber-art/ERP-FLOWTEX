# Audyt: bezpieczeństwo, wydajność, logika ERP (27.08.2026)

Audyt techniczny całej aplikacji (React Native/Expo + Supabase) pod kątem
bezpieczeństwa, wydajności i integralności logiki magazynowo-kosztowej.
Metoda: analiza statyczna kodu źródłowego, migracji SQL i istniejącej
dokumentacji procesów (`docs/PROCES_*.md`) — bez uruchamiania aplikacji na
środowisku z realnymi danymi. Numery linii odnoszą się do stanu
repozytorium w momencie audytu i mogą się przesunąć przy kolejnych
zmianach.

Pełna wersja z podziałem na sekcje i licznikami: opublikowana jako Artifact
(link w historii sesji, u autora audytu).

---

## Najpilniejsze — psuło dane już dziś ✅ NAPRAWIONE w tej sesji

**Raport dzienny cofał koszt budowy, gdy brygadzista wpisywał "ile dzisiaj",
a system oczekiwał "ile łącznie".**

Pole ilości w kroku "Zużycie materiałów" (`report-screen.tsx:225`) zawsze
startowało od `"0"` i nigdy nie było wypełniane bieżącą skumulowaną
wartością `build_materials.used` — reset do pustego stanu następował przy
każdym wyborze budowy (`report-screen.tsx:397`, `contexts/app-data.tsx:444`,
`startNewReport`). Backend (`submit_daily_report`,
`035_dokladny_zwrot_partii.sql:219`) liczy jednak
`delta = wpisana_ilość − used`, traktując wpisaną liczbę jako **nowy stan
całkowity**, nie przyrost dnia.

Naturalne zachowanie brygadzisty przy "raporcie dziennym" to wpisanie
ilości zużytej *tego dnia* (np. 20), a nie sumy narastająco (np. 50 po
trzech dniach). System odczytywał to jako `delta = 20 − 50 = −30`,
uruchamiając ścieżkę korekty w dół: "oddawał" materiał do puli budowy i
pomniejszał `actualCost` — mimo że fizycznie nic nie wróciło. Efekt narastał
z każdym kolejnym dniem raportowania na tej samej budowie.

**Naprawa (wdrożona):** dodano `getReportDefaults(buildId)` w
`contexts/app-data.tsx`, które zwraca `{ [materialId]: String(used) }` dla
wszystkich materiałów przypisanych do budowy. Wywołane teraz w obu miejscach,
które wcześniej resetowały pole do `{}`: `startNewReport()` oraz wybór
budowy z listy w `report-screen.tsx`. Brygadzista widzi teraz bieżący stan
skumulowany i dopisuje dzisiejszą ilość na wierzchu sumy, zamiast wpisywać
ją od zera.

---

## A. Bezpieczeństwo

| # | Ryzyko | Miejsce | Status |
|---|---|---|---|
| A1 | **Wysokie.** Stawka godzinowa każdego pracownika czytelna dla każdego zalogowanego konta — RLS filtruje wiersze, nie kolumny (`select_authenticated … using (true)` na `employees`). Zwykły "Pracownik" może odczytać wynagrodzenia kolegów bezpośrednim zapytaniem REST/JS SDK. | `lib/data/employees.ts:17`, `003_auth_rls.sql:142` | ✅ Naprawione — `044_ukryj_stawki_pracownikow.sql` (kolumnowy REVOKE + `get_employees()`), `lib/data/employees.ts` |
| A2 | **Średnie.** Osierocony szablon logowania OAuth ("Manus") wciąż zbudowany i wystawiony — serwer Express z CORS odbijającym dowolny `Origin` + `Access-Control-Allow-Credentials: true`. Nic w aplikacji już tych tras nie wywołuje (realny login idzie przez Supabase Auth). | `server/_core/*`, `lib/_core/auth.ts`, `app/oauth/callback.tsx`, `server/_core/index.ts:32-45` | ✅ Naprawione — cały moduł usunięty, `package.json` doprowadzony do spójności |
| A3 | **Średnie.** Migracje "Faza 0-2" (fundament schematu) nigdy nie trafiły do repo — istnieją tylko na żywym Supabase. Odtworzenie bazy od zera z `supabase/sql/*` dziś się wywali. | `SUPABASE_SETUP.md`, brakujące `004-006_*.sql` | Otwarte (świadomie zaakceptowane, warto zamknąć — wymaga `supabase db dump` z produkcji, poza zakresem zmian kodu) |
| A4 | Niskie. Zdjęcia budów na Google Drive dostępne dla każdego z linkiem, bez logowania do FlowTex — świadomy kompromis techniczny konta serwisowego. | `drive-photos/index.ts:128-142` | Świadomie przyjęte |
| A5 | Niskie. Minimalna długość hasła to 6 znaków. | `admin-users/index.ts:136,158` | ✅ Naprawione — podniesiona do 10 (edge function + kliencka walidacja) |
| A6 | Niskie, zaakceptowane. RLS filtruje wiersze, nie kolumny — Brygadzista technicznie może zaktualizować dowolne pole `builds` przez bezpośrednie API. | `003_auth_rls.sql` (`builds_update_admin_brygadzista`) | Świadomie przyjęte (`PROCES_CYKL_ZYCIA_BUDOWY.md`, Ryzyko 3) |

**Co jest zrobione poprawnie:** klucz `service_role` nigdy nie trafia do
klienta; obie Edge Functions (`admin-users`, `drive-photos`) weryfikują JWT
i rolę wywołującego przed operacją uprzywilejowaną; konto głównego admina
jest jawnie chronione przed przejęciem/usunięciem; RPC magazynowe blokują
wiersze `for update` przy zejściu ze stanu (brak wyścigu przy równoległym
zużyciu tej samej partii); brak klasycznych podatności SQL injection
(dynamiczny SQL w migracjach używa wyłącznie `format(%I)` na stałych
identyfikatorach).

---

## B. Wydajność

| # | Ryzyko | Miejsce | Status |
|---|---|---|---|
| B1 | **Wysokie.** `AppDataProvider` (2569 linii, ~18 równoległych zapytań React Query, ~37 `useState`) zwraca `value` Providera jako niezmemoizowany literał obiektu — każda zmiana re-renderuje wszystkie ekrany korzystające z `useAppData()`. | `contexts/app-data.tsx:2358, 2557` | **Otwarte — świadomie odłożone.** Prawdziwa naprawa (`useMemo` na zwracanym obiekcie) nic nie da bez owinięcia w `useCallback` dziesiątek funkcji zdefiniowanych w tym samym pliku (inaczej memo unieważnia się przy każdym renderze, bo funkcje i tak dostają nową tożsamość) — to inwazyjny refaktor całego pliku bez możliwości przetestowania na żywej aplikacji z tej sesji. Do zrobienia w osobnej sesji z możliwością odpalenia apki, najlepiej stopniowo (rozbicie na mniejsze konteksty), nie jednym wielkim commitem na `main`. |
| B2 | **Wysokie.** Prawie brak indeksów bazodanowych — tylko 3 dedykowane indeksy na ~20 tabelach z kolumnami FK. FIFO (`fn_consume_fifo`) skanuje `material_batches` bez indeksu przy każdym raporcie dziennym. | `supabase/sql/*.sql`, `001_rpc_functions.sql:90-97` | ✅ Naprawione — `042_indeksy_wydajnosciowe.sql` |
| B3 | Średnie. Brak paginacji na rosnących listach: `time_entries`, `build_material_lots`, `build_material_returns`. | `lib/data/time-entries.ts:27`, `build-materials.ts:96,126` | Otwarte |
| B4 | Średnie. Pełny stan aplikacji (`JSON.stringify` + AsyncStorage) zapisywany synchronicznie przy każdej zmianie, także wywołanej realtime-update od innego użytkownika. | `contexts/app-data.tsx:1133-1146` | Otwarte |
| B5 | Średnie. Duże ekrany (`builds-screen.tsx` — 2169 linii, `admin-screen.tsx`, `technologies-screen.tsx`) bez `useMemo`/`useCallback`/`React.memo` — filtrowanie/sortowanie liczone przy każdym renderze. | `components/screens/builds-screen.tsx` | Otwarte |
| B6 | Niskie. Brak wirtualizacji list (`FlatList`) — nieszkodliwe dziś, ryzykowne przy wzroście katalogu materiałów. | `components/screens/*.tsx` | Otwarte |

**Co jest zrobione poprawnie:** wszystkie ekrany ładowane przez `lazy()` +
`Suspense` zależnie od roli (code-splitting już działa); jeden kanał
realtime obsługujący 16 tabel z poprawnym `removeChannel` i invalidacją
scope'owaną per zasób (brak wycieku pamięci, brak kaskadowego resetu
cache'a); brak `select('*')` i brak klasycznego N+1 — agregacje idą przez
RPC po stronie bazy.

---

## C. Logika ERP i integralność danych

Rdzeń przepływu materiału — partiowanie z realną ceną, FIFO z blokadą
wierszy, rozdzielenie "przypisano do budowy" od "zużyto", zamrożony plan
technologiczny per budowa, twarde odrzucenie rozchodu bez pokrycia — jest
zaprojektowany zgodnie z dobrą praktyką WMS, lepiej niż w wielu prostszych
systemach ERP (patrz też `docs/PROCES_ZARZADZANIE_MATERIALEM.md`).

| # | Ryzyko | Miejsce | Status |
|---|---|---|---|
| C0 | **Naprawione w tej sesji** — patrz sekcja "Najpilniejsze" powyżej. | `contexts/app-data.tsx`, `report-screen.tsx` | ✅ Naprawione |
| C1 | **Wysokie.** Dopasowanie materiału po nazwie liczone na trzy różne sposoby: `receive_order` (SQL) robi dokładne, wrażliwe na wielkość liter porównanie `name = …`; `app-data.tsx:1843` robi własne `.trim().toLowerCase()`; podpowiedzi w magazynie/zamówieniach i `app-data.tsx:2057` używają w pełni znormalizowanej `normalizeMaterialName()`. Ten sam materiał dopasuje się w jednym miejscu, a w drugim nie — dokładnie ta klasa błędu, którą łatano w trzech ostatnich commitach tej sesji roboczej. | `receive_order`, `technologies-screen.tsx`, `app-data.tsx:1843` vs `:2057`, `lib/material-name-match.ts` | ✅ Naprawione — `045_ujednolic_dopasowanie_materialu.sql` (`normalize_material_name()` w SQL) + `app-data.tsx`/`settlement-screen.tsx` wołają teraz `normalizeMaterialName()` |
| C2 | Średnie. `updateMaterialStock()`/`updateMaterialPrice()` odpalane równolegle bez `await` na siebie nawzajem przy edycji materiału — wynik wyścigu dwóch zapisów do tej samej kolumny (`materials.unitPrice`) jest niedeterministyczny. | `warehouse-screen.tsx:371-374`, `lib/data/materials.ts:57` | ✅ Naprawione — sekwencyjny `await`, cena ręczna idzie po korekcie stanu |
| C3 | Średnie. `close_build`: `UPDATE build_material_lots … where buildId=… and materialId=… and sourceBatchId is not distinct from …` bez `LIMIT`/dopasowania po `id` — jeśli materiał z tej samej partii trafił na budowę dwoma osobnymi przypisaniami, oba wiersze zostaną zmodyfikowane naraz (podwójne odjęcie). | `033_straty_materialowe.sql:112-115` | ✅ Naprawione — `043_fix_close_build_podwojne_odjecie_partii.sql` (`SELECT … FOR UPDATE … LIMIT 1`) |
| C4 | Niskie. Tabela `stock_movements` (dziennik ruchów magazynowych) istnieje w schemacie, ale żadna funkcja RPC nigdy do niej nie pisze — po skasowaniu partii nie da się odtworzyć jej historii. | `drizzle/schema.ts:252` | Otwarte |
| C5 | Niskie. Zamrożony snapshot rozliczenia (`build_settlements`/`build_settlement_materials`, zapisywany przez `close_build`) nigdy nie jest czytany z powrotem przez UI — dziś nieużywany zapis. | `PROCES_CYKL_ZYCIA_BUDOWY.md`, Ryzyko 7 | Otwarte (decyzja projektowa, nie tylko techniczna) |
| C6 | Niskie, świadomie przyjęte. Brak własności "ta budowa należy do tej brygady"; brak walidacji sensowności danych przy zakładaniu budowy (ujemny kontrakt, daty bez ograniczeń). | `PROCES_CYKL_ZYCIA_BUDOWY.md`, Ryzyka 4 i 9 | Świadomie przyjęte |
| C7 | Średnie. Zero testów automatycznych mimo skonfigurowanego `vitest` — dla logiki tej klasy (FIFO, transakcyjne zamknięcie budowy) to bezpośrednio tłumaczy, dlaczego błędy typu C0/C2/C3 mogły powstać i przetrwać niezauważone. Historia migracji zawiera kilkanaście plików `fix_*`/`napraw_*` łatających tę samą klasę problemów wielokrotnie. | `package.json` | Otwarte |

Braki względem pełnego WMS (kartoteka dostawców, reorder point/lead time,
skanowanie kodów kreskowych, cykliczna inwentaryzacja, lokalizacje
magazynowe) są świadomymi uproszczeniami adekwatnymi do obecnej skali, nie
błędami — opisane już wyczerpująco w `docs/PROCES_ZARZADZANIE_MATERIALEM.md`
§3.2.

---

## Plan działania (kolejność wg realnego ryzyka, nie tylko teorii)

1. ~~Napraw seedowanie ilości w raporcie dziennym~~ — ✅ **zrobione**
   (patrz "Najpilniejsze" powyżej).
2. ~~Zamknij dostęp do wynagrodzeń~~ — ✅ **zrobione** (A1).
3. ~~Usuń wyścigi zapisu w magazynie~~ — ✅ **zrobione** (C2, C3).
4. ~~Skonsoliduj dopasowanie materiału po nazwie~~ — ✅ **zrobione** (C1).
5. ~~Posprzątaj powierzchnię ataku~~ — ✅ **zrobione** (A2). Podniesiono
   też minimalną długość hasła (A5) i dodano indeksy bazodanowe (B2) przy
   okazji tej samej sesji.
6. **Otwarte:** `AppDataContext` (B1) — świadomie odłożone, patrz sekcja
   B powyżej (wymaga refaktora z możliwością testu na żywej apce, nie
   ślepego pushu). Reszta wydajności: paginacja `time_entries` (B3),
   debounce zapisu do AsyncStorage (B4), memoizacja dużych ekranów (B5).
7. **Otwarte:** napisz pierwsze testy tam, gdzie boli najbardziej —
   `fn_consume_fifo`, `submit_daily_report`, `close_build` (C7).
8. **Otwarte, poza zakresem zmian kodu:** zacommituj brakujące migracje
   fundamentu (A3) — wymaga `supabase db dump --schema-only` z produkcji.

### Migracje SQL z tej sesji — uruchomić w Supabase Dashboard, w kolejności

- `042_indeksy_wydajnosciowe.sql` — czysto addytywna, bezpieczna w dowolnym momencie.
- `043_fix_close_build_podwojne_odjecie_partii.sql` — bezpieczna, nie wymaga zmiany klienta.
- `044_ukryj_stawki_pracownikow.sql` — ✅ uruchomiona.
- `045_ujednolic_dopasowanie_materialu.sql` — bezpieczna, nie wymaga zmiany klienta.
