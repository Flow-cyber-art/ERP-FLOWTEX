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
| A1 | **Wysokie.** Stawka godzinowa każdego pracownika czytelna dla każdego zalogowanego konta — RLS filtruje wiersze, nie kolumny (`select_authenticated … using (true)` na `employees`). Zwykły "Pracownik" może odczytać wynagrodzenia kolegów bezpośrednim zapytaniem REST/JS SDK. | `lib/data/employees.ts:17`, `003_auth_rls.sql:142` | Otwarte |
| A2 | **Średnie.** Osierocony szablon logowania OAuth ("Manus") wciąż zbudowany i wystawiony — serwer Express z CORS odbijającym dowolny `Origin` + `Access-Control-Allow-Credentials: true`. Nic w aplikacji już tych tras nie wywołuje (realny login idzie przez Supabase Auth). | `server/_core/*`, `lib/_core/auth.ts`, `app/oauth/callback.tsx`, `server/_core/index.ts:32-45` | Otwarte |
| A3 | **Średnie.** Migracje "Faza 0-2" (fundament schematu) nigdy nie trafiły do repo — istnieją tylko na żywym Supabase. Odtworzenie bazy od zera z `supabase/sql/*` dziś się wywali. | `SUPABASE_SETUP.md`, brakujące `004-006_*.sql` | Otwarte (świadomie zaakceptowane, warto zamknąć) |
| A4 | Niskie. Zdjęcia budów na Google Drive dostępne dla każdego z linkiem, bez logowania do FlowTex — świadomy kompromis techniczny konta serwisowego. | `drive-photos/index.ts:128-142` | Świadomie przyjęte |
| A5 | Niskie. Minimalna długość hasła to 6 znaków. | `admin-users/index.ts:136,158` | Otwarte |
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

| # | Ryzyko | Miejsce |
|---|---|---|
| B1 | **Wysokie.** `AppDataProvider` (2569 linii, ~18 równoległych zapytań React Query, ~37 `useState`) zwraca `value` Providera jako niezmemoizowany literał obiektu — każda zmiana re-renderuje wszystkie ekrany korzystające z `useAppData()`. | `contexts/app-data.tsx:2358, 2557` |
| B2 | **Wysokie.** Prawie brak indeksów bazodanowych — tylko 3 dedykowane indeksy na ~20 tabelach z kolumnami FK. FIFO (`fn_consume_fifo`) skanuje `material_batches` bez indeksu przy każdym raporcie dziennym. | `supabase/sql/*.sql`, `001_rpc_functions.sql:90-97` |
| B3 | Średnie. Brak paginacji na rosnących listach: `time_entries`, `build_material_lots`, `build_material_returns`. | `lib/data/time-entries.ts:27`, `build-materials.ts:96,126` |
| B4 | Średnie. Pełny stan aplikacji (`JSON.stringify` + AsyncStorage) zapisywany synchronicznie przy każdej zmianie, także wywołanej realtime-update od innego użytkownika. | `contexts/app-data.tsx:1133-1146` |
| B5 | Średnie. Duże ekrany (`builds-screen.tsx` — 2169 linii, `admin-screen.tsx`, `technologies-screen.tsx`) bez `useMemo`/`useCallback`/`React.memo` — filtrowanie/sortowanie liczone przy każdym renderze. | `components/screens/builds-screen.tsx` |
| B6 | Niskie. Brak wirtualizacji list (`FlatList`) — nieszkodliwe dziś, ryzykowne przy wzroście katalogu materiałów. | `components/screens/*.tsx` |

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

| # | Ryzyko | Miejsce |
|---|---|---|
| C0 | **Naprawione w tej sesji** — patrz sekcja "Najpilniejsze" powyżej. | `contexts/app-data.tsx`, `report-screen.tsx` |
| C1 | **Wysokie.** Dopasowanie materiału po nazwie liczone na trzy różne sposoby: `receive_order` (SQL) robi dokładne, wrażliwe na wielkość liter porównanie `name = …`; `app-data.tsx:1843` robi własne `.trim().toLowerCase()`; podpowiedzi w magazynie/zamówieniach i `app-data.tsx:2057` używają w pełni znormalizowanej `normalizeMaterialName()`. Ten sam materiał dopasuje się w jednym miejscu, a w drugim nie — dokładnie ta klasa błędu, którą łatano w trzech ostatnich commitach tej sesji roboczej. | `receive_order`, `technologies-screen.tsx`, `app-data.tsx:1843` vs `:2057`, `lib/material-name-match.ts` |
| C2 | Średnie. `updateMaterialStock()`/`updateMaterialPrice()` odpalane równolegle bez `await` na siebie nawzajem przy edycji materiału — wynik wyścigu dwóch zapisów do tej samej kolumny (`materials.unitPrice`) jest niedeterministyczny. | `warehouse-screen.tsx:371-374`, `lib/data/materials.ts:57` |
| C3 | Średnie. `close_build`: `UPDATE build_material_lots … where buildId=… and materialId=… and sourceBatchId is not distinct from …` bez `LIMIT`/dopasowania po `id` — jeśli materiał z tej samej partii trafił na budowę dwoma osobnymi przypisaniami, oba wiersze zostaną zmodyfikowane naraz (podwójne odjęcie). | `033_straty_materialowe.sql:112-115` |
| C4 | Niskie. Tabela `stock_movements` (dziennik ruchów magazynowych) istnieje w schemacie, ale żadna funkcja RPC nigdy do niej nie pisze — po skasowaniu partii nie da się odtworzyć jej historii. | `drizzle/schema.ts:252` |
| C5 | Niskie. Zamrożony snapshot rozliczenia (`build_settlements`/`build_settlement_materials`, zapisywany przez `close_build`) nigdy nie jest czytany z powrotem przez UI — dziś nieużywany zapis. | `PROCES_CYKL_ZYCIA_BUDOWY.md`, Ryzyko 7 |
| C6 | Niskie, świadomie przyjęte. Brak własności "ta budowa należy do tej brygady"; brak walidacji sensowności danych przy zakładaniu budowy (ujemny kontrakt, daty bez ograniczeń). | `PROCES_CYKL_ZYCIA_BUDOWY.md`, Ryzyka 4 i 9 |
| C7 | Średnie. Zero testów automatycznych mimo skonfigurowanego `vitest` — dla logiki tej klasy (FIFO, transakcyjne zamknięcie budowy) to bezpośrednio tłumaczy, dlaczego błędy typu C0/C2/C3 mogły powstać i przetrwać niezauważone. Historia migracji zawiera kilkanaście plików `fix_*`/`napraw_*` łatających tę samą klasę problemów wielokrotnie. | `package.json` |

Braki względem pełnego WMS (kartoteka dostawców, reorder point/lead time,
skanowanie kodów kreskowych, cykliczna inwentaryzacja, lokalizacje
magazynowe) są świadomymi uproszczeniami adekwatnymi do obecnej skali, nie
błędami — opisane już wyczerpująco w `docs/PROCES_ZARZADZANIE_MATERIALEM.md`
§3.2.

---

## Plan działania (kolejność wg realnego ryzyka, nie tylko teorii)

1. ~~Napraw seedowanie ilości w raporcie dziennym~~ — **zrobione w tej
   sesji** (patrz "Najpilniejsze" powyżej).
2. Zamknij dostęp do wynagrodzeń — ogranicz odczyt `employees.hourlyRate`
   do Admina (A1).
3. Usuń wyścigi zapisu w magazynie — scal `updateMaterialPrice`/
   `updateMaterialStock` w jedną operację (C2); dodaj `LIMIT`/`id` do
   `UPDATE` w `close_build` (C3).
4. Skonsoliduj dopasowanie materiału po nazwie do jednej, znormalizowanej
   funkcji, wszędzie — SQL i klient (C1).
5. Posprzątaj powierzchnię ataku — usuń martwy moduł OAuth/szablonu, zawęź
   CORS (A2); zacommituj brakujące migracje fundamentu (A3).
6. Zaadresuj wydajność, zanim dane urosną — zmemoizuj wartość
   `AppDataContext` (B1), dodaj indeksy na kolumnach kluczy obcych (B2),
   dodaj paginację do `time_entries` (B3).
7. Napisz pierwsze testy tam, gdzie boli najbardziej — `fn_consume_fifo`,
   `submit_daily_report`, `close_build` (C7).
