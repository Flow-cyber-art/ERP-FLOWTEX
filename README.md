# Patch: Supabase reports.submit + offline outbox

Nadpisz/dodaj te pliki w projekcie ERP-Flowtex, zachowując strukturę katalogów:

- drizzle/schema.ts        (nadpisz — dodane pole `clientId` w tabeli `reports`)
- server/routers.ts        (nadpisz — zarejestrowane nowe routery)
- server/data-routers.ts   (NOWY — builds/materials/employees.list + reports.submit)
- lib/trpc-vanilla.ts      (NOWY — klient tRPC poza Reactem, do flush kolejki)
- lib/offline-outbox.ts    (NOWY — kolejka offline dla raportów, AsyncStorage)
- app/_layout.tsx          (nadpisz — podpięty initOfflineOutbox() + wcześniejsza poprawka hydration #418)
- app/(tabs)/index.tsx     (nadpisz — poprawka hydration #418, hasMounted)

Po podmianie:
  npx drizzle-kit generate
  npx drizzle-kit push

Co dalej (nieobjęte tym patchem):
  contexts/app-data.tsx nadal używa zahardkodowanych initialBuilds/
  initialMaterials/initialEmployees (id "b1", "m1"...) niepowiązanych z bazą.
  Żeby formularz raportu realnie wołał enqueueReport() z prawdziwymi ID,
  trzeba: (1) wgrać dane startowe (drizzle/seed.ts) do Supabase,
  (2) podmienić te trzy useState() w app-data.tsx na trpc.*.list.useQuery(),
  (3) spiąć handler wysyłki raportu z enqueueReport() z lib/offline-outbox.ts.

## Aktualizacja (etap 2+3)

- contexts/app-data.tsx (nadpisz) — teraz:
  1. builds/materials/employees ładują się z Supabase (trpc.*.list) przy
     starcie i nadpisują dotychczasowy cache AsyncStorage, gdy jest sieć.
     Offline — zostaje ostatni znany stan z AsyncStorage (mechanizm już
     tam był, nic nie ruszałem).
  2. saveDailyReport() po lokalnym zapisie raportu dodatkowo woła
     enqueueReport() z lib/offline-outbox.ts — realnie wysyła raport do
     Supabase (reports.submit), z automatycznym retry offline.

Świadomie NIE ruszone w tym etapie (zostaje czysto lokalne, w
AsyncStorage): dodawanie/edycja materiałów, budów, pracowników,
zamówienia, partie materiałowe, rozliczenia budów, zatwierdzanie
raportów przez admina. Wymaga to portu logiki FIFO/rozliczeń na serwer
i osobnych mutacji tRPC dla każdej encji — świadomie zostawione jako
kolejny, oddzielny krok (żeby nie robić dużej, nieprzetestowanej zmiany
w jednym rzucie na działającej dziś aplikacji).
