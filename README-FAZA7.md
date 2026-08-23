# Faza 7 — Kilometrówka i koszty dodatkowe

Paczka do nadpisania w repo (ścieżki względem korzenia projektu).
Kolejność wdrożenia:

1. **Migracja SQL** — wklej i uruchom w Supabase SQL editor:
   `supabase/sql/012_faza7_km_koszty.sql`
   Tworzy tabelę `settings` (stawka za km, RLS: odczyt każdy zalogowany,
   zapis tylko Admin), dodaje kolumny `km`/`kmRateApplied`/`kmCost` do
   `reports` i `category` do `report_extra_costs`, przepisuje
   `submit_daily_report` o nowy parametr `p_km`.

2. **Pliki do nadpisania** (8):
   - `lib/data/settings.ts` — **nowy plik**: `getSettings()` / `updateKmRate()`
   - `lib/data/reports.ts` — `km` w wejściu/wyjściu RPC, `category` w kosztach dodatkowych
   - `lib/offline-outbox.ts` — kolejka offline przenosi teraz też `km`/`category`
   - `components/report-ui.tsx` — `ExtraCostsSection` z wyborem kategorii (chipy: nocleg/parking/zakup/inne + własna)
   - `components/screens/report-screen.tsx` — pole „Liczba km” w formularzu raportu + podgląd w kroku podsumowania
   - `components/screens/admin-screen.tsx` — pole „Stawka za km” w zakładce Ustawienia (tylko Admin, dzięki RLS)
   - `contexts/app-data.tsx` — `draftKm`, `kmRate` (z `settings`), `updateKmRate`, wpięcie km do zapisu/wysyłki raportu i mapowania danych z bazy

3. Po wdrożeniu:
   - Test ręczny: Admin → Ustawienia → wpisz stawkę → Zapisz.
   - Test ręczny: Brygadzista → Raport dzienny → wpisz km → wyślij →
     sprawdź w bazie `reports.km/kmRateApplied/kmCost`, że stawka
     zgadza się z tą ustawioną w kroku wyżej.
   - Sprawdź kolejkę offline: wyłącz sieć, wyślij raport z km i kosztem
     z kategorią, włącz sieć, potwierdź że `flushOutbox()` wysyła oba
     pola poprawnie (podgląd w Supabase table editor).
   - `build.settlement` (Faza 8) będzie mógł doliczyć `kmCost` i sumę
     `report_extra_costs.amount` do kosztu budowy — to poza zakresem tej
     paczki.
