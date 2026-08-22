# Scalona paczka: safe-area-fix + three-fixes + supabase-full-crud

11 plików do nadpisania w repo (ścieżki względem korzenia projektu).
Rozwiązane konflikty — z każdej pary nadpisujących się plików wybrana
została nowsza / nadrzędna wersja:

## Z erp-flowtex-supabase-full-crud-patch (priorytet — CRUD Supabase)
- server/data-routers.ts
- server/routers.ts
- drizzle/schema.ts
- lib/offline-outbox.ts
- contexts/app-data.tsx  ← wybrana ta wersja (nie z three-fixes), bo jest
  zbudowana NA BAZIE app-data.tsx z three-fixes-patch i dodatkowo podpina
  mutacje tRPC. Wersja z three-fixes byłaby więc krokiem wstecz.

## Z three-fixes-patch
- components/report-ui.tsx
- components/screens/admin-screen.tsx
- components/screens/hr-screen.tsx
- components/screens/orders-screen.tsx
- (POMINIĘTO app/(tabs)/index.tsx i contexts/app-data.tsx z tej paczki —
  patrz wyżej i niżej)

## Z safe-area-fix-patch
- app/_layout.tsx
- app/(tabs)/index.tsx  ← wybrana ta wersja (nie z three-fixes), bo poza
  poprawką safe area zawiera też przełącznik zakładek Admin/HR, którego
  brakuje w wersji z three-fixes-patch (ta wygląda na zbudowaną na
  starszej bazie, sprzed dodania przełącznika HR).

## Dodatkowy fix: React error #418 (hydration mismatch)
W `app/(tabs)/index.tsx` `Dimensions.get("window").width` był wołany w
inicjalizatorze `useState`, czyli brał udział w PIERWSZYM renderze —
tym samym, który React porównuje z HTML-em z `expo export -p web`.
Przy eksporcie nie ma prawdziwego okna przeglądarki, więc ta wartość
różniła się od realnej szerokości w przeglądarce klienta. `isDesktop`
zależy od tej szerokości i zmienia całe drzewo JSX (sidebar vs. pasek
dolny, inny zestaw przycisków) → różne drzewa serwer/klient → błąd 418.

Fix: dodano `mounted` (zawsze `false` przy pierwszym renderze, identycznie
po obu stronach), realna szerokość jest ustawiana i stosowana dopiero w
`useEffect`, czyli wyłącznie po stronie klienta, już po udanej hydratacji.

Jeśli błąd 418 nadal się pojawia po tym fixie, sprawdź też
`todayLabelPL()` / `todayISO()` z `components/report-ui.tsx` — nie są
używane w renderze żadnego z plików w tej paczce, ale mogą być wołane
bezpośrednio w JSX w `report-screen.tsx` (poza zakresem tych patchy);
tam też trzeba by je przenieść z pierwszego renderu do `useEffect`.

## Po wdrożeniu
1. Migracja bazy: `npx drizzle-kit generate && npx drizzle-kit push`
2. Test ręczny każdego ekranu osobno: Magazyn, Budowy, HR, Zamówienia, Raport
3. Szczególna uwaga na `reports.submit` (FIFO + build_materials +
   time_entries w jednej transakcji) i `builds.close` — kod ten NIE był
   testowany na żywej instancji Supabase (patrz oryginalny README patcha
   CRUD, dołączony pod inną nazwą jeśli potrzebny).
4. `build.settlement` nie jest jeszcze odczytywany z powrotem do UI po
   zamknięciu budowy — jeśli ekran ma to pokazywać, potrzebny dodatkowy
   query (buildSettlements.get).
