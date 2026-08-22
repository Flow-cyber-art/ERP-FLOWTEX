# Podpięcie Supabase — dostęp bezpośrednio z klienta (anon key)

Aplikacja łączy się z Supabase **bezpośrednio z klienta** przez
`@supabase/supabase-js` i publiczny `anon key` — bez pośredniczącego
serwera Express/tRPC (Railway). Zapis/odczyt chroni Row Level Security
(RLS) skonfigurowane bezpośrednio w bazie.

## 1. Zmienne środowiskowe

W `.env` (lokalnie) i w ustawieniach hostingu (Vercel itp.):

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key-z-Project-Settings-API>
```

Znajdziesz je w Supabase → Project Settings → API. To wartości **publiczne**
(trafiają do bundla aplikacji) — nigdy nie wklejaj tu `service_role` key.

## 2. Schemat tabel i RLS

Tabele **już istnieją** w Twoim projekcie Supabase (zweryfikowane
introspekcją `information_schema` — kolumny 1:1 z `drizzle/schema.ts` w
repo). Nie trzeba nic tworzyć ani migrować.

RLS **było** otwarte (`USING (true)` dla `anon`) na etapie MVP —
`003_auth_rls.sql` (punkt 5 niżej) to zamyka: wymagane logowanie,
część operacji tylko dla roli Admin.

## 3. Funkcje RPC (jednorazowo)

Część operacji (FIFO zdejmowania partii materiału, zamykanie budowy ze
snapshotem rozliczenia, przyjęcie dostawy) musi wykonać się atomowo w
jednej transakcji — nie da się tego bezpiecznie złożyć z kilku osobnych
zapytań REST z klienta (wyścig przy dwóch równoległych zapisach). Stąd
funkcje Postgresa (`supabase.rpc(...)`), zdefiniowane w
[`supabase/sql/001_rpc_functions.sql`](./supabase/sql/001_rpc_functions.sql).

Uruchom raz: Supabase Dashboard → SQL Editor → wklej całą zawartość pliku
→ Run. Bezpieczne do wielokrotnego wklejania (idempotentne). **Uruchom
ponownie, jeśli już go wcześniej wklejałeś** — `submit_daily_report`
zmienił typ zwracany (patrz punkt 6, koszty) i doszły `security definer`
+ sprawdzanie roli w każdej funkcji (patrz punkt 5).

Plik dopisuje też jedyną brakującą rzecz w schemacie: unikalny constraint
`reports(buildId, date)` — raporty nie mają osobnej kolumny `clientId`,
więc idempotentny zapis (ważne dla kolejki offline, patrz niżej) opiera
się na naturalnym kluczu "jedna budowa + jeden dzień = jeden raport".

## 4. Realtime (jednorazowo)

Żeby dwóch administratorów (albo brygadzista + admin) pracujących
równolegle widzieli nawzajem swoje zmiany bez ręcznego odświeżania
strony, klient nasłuchuje zmian w bazie przez Supabase Realtime (patrz
`lib/data/use-realtime-sync.ts`). Wymaga włączenia replikacji na
odpowiednich tabelach — uruchom raz:
[`supabase/sql/002_realtime.sql`](./supabase/sql/002_realtime.sql).
Obejmuje też `reports`/`report_materials`/`report_people`/
`report_extra_costs` (dopisane w `003_auth_rls.sql`, patrz niżej) —
stąd plakietki z liczbą w nawigacji ("Raporty" u admina, "Moje raporty"
u brygadzisty) też aktualizują się na bieżąco, nie tylko po odświeżeniu.

## 5. Logowanie i role (jednorazowo)

Od `003_auth_rls.sql` RLS wymaga zalogowania — apka ma teraz prawdziwy
ekran logowania (email + hasło, `components/screens/login-screen.tsx`),
który zastąpił dawny lokalny przełącznik roli "Dev"
(ten był świadomie tymczasowy — patrz jego usunięty opis: "Tryb lokalny
do testowania widoczności paneli przed podłączeniem Supabase Auth").

**Zanim ktokolwiek się zaloguje — jednorazowy bootstrap:**

1. Uruchom [`supabase/sql/001_rpc_functions.sql`](./supabase/sql/001_rpc_functions.sql)
   (zaktualizowany — dodane sprawdzanie roli) i
   [`supabase/sql/003_auth_rls.sql`](./supabase/sql/003_auth_rls.sql) —
   w tej kolejności, oba w SQL Editorze.
2. Załóż **pierwsze** konto (Admin) ręcznie: Supabase Dashboard →
   **Authentication → Users → Add user** → email `admin@flowtex.pl`,
   hasło testowe `123456`, zaznacz **"Auto Confirm User"** (bez tego apka
   dostanie błąd logowania, bo mail potwierdzający nigdy nie przyjdzie).
3. Dopisz mu wiersz w `profiles` (SQL Editor):
   ```sql
   insert into profiles (id, role, "employeeId")
   select id, 'Admin', null from auth.users where email = 'admin@flowtex.pl';
   ```
   Zaloguj się tym kontem — od teraz **wszystkie kolejne konta** (dla
   brygadzistów, pracowników, kolejnych adminów) zakładasz już z poziomu
   apki: **Zespół → Konta logowania → + Dodaj konto** (tam też zmienisz
   hasło albo usuniesz dostęp komuś, bez wchodzenia do Supabase).
   Krok 2–3 powyżej to jedyny raz, kiedy trzeba wejść do Dashboardu ręcznie.

   ⚠️ Zmień hasło testowe `123456` na docelowe zaraz po pierwszym
   zalogowaniu (Konta logowania → Zmień hasło) — to hasło jest jawnie
   wpisane w tym pliku.

4. Panel "Konta logowania" wymaga wdrożonej Edge Function
   `admin-users` (bo tworzenie/kasowanie kont i reset hasła to operacje
   na `auth.users`, wymagające klucza `service_role` — apka kliencka go
   nigdy nie ma, więc robi to za nią ta funkcja serwerowa). Wdrożenie:
   Supabase Dashboard → **Edge Functions → Deploy a new function** →
   nazwa `admin-users` → wklej zawartość
   [`supabase/functions/admin-users/index.ts`](./supabase/functions/admin-users/index.ts)
   → Deploy. Zmienne `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` są dostępne automatycznie w każdej Edge
   Function — nic dodatkowego nie trzeba ustawiać. Dopóki funkcja nie
   jest wdrożona, panel "Konta logowania" pokaże błąd przy próbie
   dodania/usunięcia/zresetowania konta — bootstrap z kroków 2–3 działa
   niezależnie od tego (to czysty Dashboard, bez Edge Function).

**Model ról** (mała firma, jedna brygada na jedną budowę na raz — bez
granulacji "który brygadzista widzi którą budowę"):
- **Admin** — pełny dostęp: magazyn, budowy, zamówienia, pracownicy,
  zatwierdzanie raportów.
- **Brygadzista** — wypełnia/wysyła raport dzienny, widzi czas całego
  zespołu, może dodać link do zdjęć budowy. Nie zarządza magazynem ani
  cenami.
- **Pracownik** — widzi wyłącznie własny czas pracy (`time_entries`
  filtrowane po `profiles.employeeId`).

## 6. Co jest zaimplementowane

`lib/data/*.ts` — warstwa danych (cały serwer Express/tRPC —
`server/routers.ts`, `server/data-routers.ts` — został usunięty; nic go
już nie wołało. Prawdziwy Express w `server/_core/` zostaje — obsługuje
logowanie/OAuth **tego starego, osobnego systemu** (nie Supabase Auth —
patrz uwaga w punkcie 7) i endpoint do Google Drive):

- `lib/data/auth.ts` — logowanie/wylogowanie/sesja/rola (punkt 5).
- `lib/data/builds.ts` — lista, tworzenie, zamykanie/wznawianie budowy,
  link do zdjęć.
- `lib/data/materials.ts` — magazyn: lista, nowy materiał (+ partia
  startowa), zmiana ceny, korekta stanu (FIFO).
- `lib/data/employees.ts` — pracownicy: lista, nowy, stawka godzinowa.
- `lib/data/orders.ts` — zamówienia materiałów: lista, nowe, oznaczenie
  jako złożone, przyjęcie dostawy (dopisuje partię).
- `lib/data/build-materials.ts` — przypisania materiałów do budów.
- `lib/data/reports.ts` — zapis raportu dziennego (FIFO + upsert po
  buildId+date), zatwierdzanie/odsyłanie do poprawy, **`listReports()`**
  — realna lista z bazy (wcześniej `savedReports` było czysto lokalnym
  stanem: admin logujący się z innego urządzenia niż to, z którego
  brygadzista wysłał raport, nie widział go WCALE). `contexts/app-data.tsx`
  scala wynik z lokalnymi, jeszcze niezsynchronizowanymi wpisami
  (kolejka offline) — wersja z serwera zawsze wygrywa dla tego samego
  (buildId, date), bo ma autorytatywny koszt FIFO policzony w RPC, nie
  lokalny szacunek.
- `lib/data/use-realtime-sync.ts` — nasłuch zmian na żywo (punkt 4).
- `lib/data/admin-users.ts` + `supabase/functions/admin-users/` —
  zarządzanie kontami logowania (tworzenie, reset hasła, usuwanie) z
  panelu **Zespół → Konta logowania**, patrz punkt 5.

## 7. Czego świadomie brakuje (kolejne kroki)

- **Stary Express OAuth (`server/_core/oauth.ts`, tabela `users`) nie
  został usunięty**, mimo że logowanie do apki idzie teraz przez
  Supabase Auth — to dwa NIEZALEŻNE systemy. Endpoint tworzenia folderu
  w Google Drive (`server/_core/googleDrive.ts`) nadal sprawdza sesję
  starego systemu, więc **dopóki go nie przepniesz na Supabase Auth,
  zawsze zwróci 401** — nieszkodliwe (budowa i tak się zapisuje, tylko
  bez linku), ale wymaga osobnej poprawki, jeśli/gdy odpalisz tę funkcję.
- **Kolejka offline działa tylko dla raportu dziennego.** Korekta stanu
  magazynu, zamówienia — wymagają sieci. Świadomie odłożone: to
  operacje Admina (biuro, lepszy zasięg niż plac budowy), więc ryzyko
  utraty danych jest mniejsze niż dla raportu brygadzisty w terenie.
- **`stock_movements`** — tabela istnieje w bazie, ale żadna ścieżka w
  kodzie jeszcze do niej nie pisze (dziennik ruchów magazynowych na
  później).
- **`needsReview` / `confirmedByEmployee`** (`report_materials` /
  `report_people`) — kolumny istnieją pod przyszłe funkcje z `todo.md`
  ("materiał dokupiony na budowie do weryfikacji", "pracownik
  potwierdza swój wpis czasu"), na razie zawsze `false`.
