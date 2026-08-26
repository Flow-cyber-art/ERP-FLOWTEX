# Proces: Raportowanie brygadzisty

Status: **decyzje A, B i C wdrożone** (SQL: `supabase/sql/033_straty_materialowe.sql`,
`034_raport_notatka_i_konsolidacja.sql`, `035_dokladny_zwrot_partii.sql`
— uruchomić w tej kolejności na bazie Supabase; front już z nich korzysta).
Reszta dokumentu opisuje też to, co działało już wcześniej (oznaczone
„✅ działa”), dla pełnego obrazu procesu.

---

## 1. Założenia

1. **Jedna budowa = jedna brygada** (docelowo; obecnie i tak działa tylko
   jedna brygada w całej firmie). Konsekwencja: raport dzienny jest
   identyfikowany przez `(budowa, data)` — jeden raport na budowę na
   dzień, nie per-brygadzista. Przy jednej brygadzie na budowę to
   bezpieczne założenie; gdyby kiedyś dwie brygady miały pracować na tej
   samej budowie tego samego dnia, trzeba by to przeprojektować (dziś
   drugi zapis nadpisałby pierwszy, nie stworzyłby drugiego raportu).
2. Materiał ma **dwa etapy zejścia z zasobów firmy**, nie jeden:
   - **Przypisanie do budowy** (Admin, ręczny wybór partii) — materiał
     fizycznie trafia z ogólnego magazynu na plac budowy. Znika z
     magazynu głównego, ląduje w puli „przypisane do tej budowy, jeszcze
     nie zużyte” (`build_material_lots`).
   - **Zużycie** (raport dzienny brygadzisty) — materiał znika z puli
     przypisanej do budowy i dopiero **teraz** staje się realnym kosztem
     budowy (`build_materials.actualCost`).
   Rozdzielenie tych dwóch momentów jest świadome i poprawne: pozwala
   odróżnić „dowieźliśmy na plac” od „zużyliśmy” — różnica to dokładnie
   „Pozostałość materiałowa”, widoczna przy zamykaniu budowy.

---

## 2. Cykl życia raportu — krok po kroku (✅ działa)

1. Brygadzista wybiera budowę (`report-screen.tsx`, krok 1).
2. **Zużycie materiałów** — dla każdego materiału przypisanego do budowy
   (z planu technologii + pomocniczych) wpisuje ilość zużytą danego dnia.
   Może też dopisać nowy materiał pomocniczy wprost z magazynu.
3. **Zespół** (krok 2) — dodaje osoby + godziny pracy (od–do).
4. **Kilometrówka i koszty dodatkowe** — opcjonalnie, przy kroku 1.
5. **Podsumowanie** (krok 3) — przegląd przed wysłaniem.
6. **Zapisz raport dzienny** → `saveDailyReport` → RPC `submit_daily_report`.

## 3. Co dzieje się przy zapisie (✅ działa)

Wszystko w jednej transakcji SQL (`submit_daily_report`,
`supabase/sql/035_dokladny_zwrot_partii.sql` — najnowsza wersja):

1. Budowa musi być aktywna (nie zamknięta) — inaczej twardy błąd.
2. Jeśli raport na ten dzień/budowę już istnieje i ma status
   `approved` — edycja zablokowana.
3. **Dla każdego materiału**, licząc różnicę (`delta`) między nowo
   wpisaną ilością a tym, co było zapisane poprzednio:
   - **delta > 0** (zużyto więcej) → `fn_consume_build_lot_fifo` zdejmuje
     brakującą ilość z puli **przypisanej do TEJ budowy**
     (`build_material_lots`, FIFO wg daty wydania), licząc koszt po
     realnej cenie tamtej partii. Koszt dolicza się do
     `build_materials.actualCost` (czyli do kosztu budowy „na bieżąco”).
     Zapisuje przy okazji, z którego konkretnie lota ile wzięto
     (`report_material_lots`) — do ewentualnego dokładnego zwrotu niżej.
   - **delta < 0** (korekta w dół) → ✅ **wdrożone (Decyzja A, §4):**
     dokładny zwrot do tych samych lotów/cen, z których zeszło (LIFO),
     zmniejszenie `build_materials.actualCost` o dokładnie tyle samo.
4. Godziny pracy → `time_entries` (nadpisywane w całości dla tego dnia/
   budowy — nie sumowane z poprzednią wersją raportu).
5. Koszty dodatkowe → `report_extra_costs`, doliczane do kosztu budowy.
6. Notatka (Decyzja B, §5) → `reports.note`, nadpisywana przy każdej edycji.
7. Wszystko widoczne **od razu** w panelu Admina (Rozliczenia, Budowy) —
   patrz §7.

---

## 4. Edycja/korekta raportu — DECYZJA A ✅ wdrożona

**Ustalenie:** edycja raportu (przed zatwierdzeniem) ma również
korygować stan magazynowy — nie tylko liczbę `used` na papierze.

**Doprecyzowanie po pytaniu „czy nie może wrócić tak na magazyn (do tej
samej partii/ceny)?” — TAK, i to jest lepszy sposób niż uśrednianie.**
`build_material_lots` już dziś normalnie trzyma dla jednego materiału na
jednej budowie kilka odrębnych wpisów z różnymi cenami (bo Faza 5
przypisuje partie ręcznie, jedna po drugiej) — więc nie ma potrzeby nic
uśredniać. Wystarczy zapamiętać, **z której konkretnie partii/lota
zeszła dana ilość w danym raporcie**, i przy korekcie w dół cofnąć
dokładnie to, skąd to wzięło — z tą samą, realną ceną.

**Sprawdzony sposób (bez uśredniania):**

1. Nowa tabela, np. `report_material_lots (reportId, materialId,
   lotId lub sourceBatchId, quantity, unitPrice)` — rozbicie „z jakiego
   lota ile zeszło” dla KAŻDEGO wywołania `submit_daily_report`, nie
   tylko suma kosztu jak dziś w `report_materials.cost`.
   `fn_consume_build_lot_fifo` już i tak idzie partia po partii — zamiast
   zwracać tylko sumę kosztu, ma dodatkowo zapisać ten rozkład.
2. Przy **delta < 0** (korekta w dół): cofamy zapisany rozkład tego
   RAPORTU dla tego materiału, **od najnowszego wpisu wstecz** (LIFO —
   cofamy to, co ten raport sam dołożył jako ostatnie), aż zejdziemy z
   potrzebną ilością:
   - Jeśli oryginalny lot (`lotId`) **nadal istnieje** w
     `build_material_lots` → po prostu zwiększ jego `quantity` z
     powrotem — dokładnie ta sama partia, dokładnie ta sama cena.
   - Jeśli lot **już nie istnieje** (bo w międzyczasie w pełni zszedł w
     innym raporcie) → odtwórz go jako nowy wiersz w
     `build_material_lots` z tym samym `sourceBatchId` i `unitPrice`, co
     zapisany rozkład — cena i tak jest realna, tylko wiersz "nowy".
3. **Odejmij** dokładnie tyle samo kosztu z `build_materials.actualCost`
   (suma z cofniętych kawałków rozkładu — żadnego przybliżenia).
4. Zaktualizuj `report_materials.cost` tej pozycji o tę samą kwotę (ślad
   audytowy w raporcie ma się zgadzać z tym, co realnie zaksięgowano).
- Efekt: materiał wraca do puli **tej budowy** (nie od razu do ogólnego
  magazynu — fizycznie nadal stoi na placu), po dokładnie tej cenie, po
  jakiej z niej zszedł. Jeśli finalnie nigdy nie zostanie zużyty,
  dostanie tę samą decyzję co każda inna pozycja "pozostałości" przy
  zamykaniu budowy (zwrot/wyrzucenie, §6) — **żadnego nowego mechanizmu
  wyceny, tylko dokładne odtworzenie tego, co już wiadomo**.
- Ograniczenie: działa tylko **przed zatwierdzeniem** raportu — po
  zatwierdzeniu edycja i tak jest zablokowana (bez zmian).

---

## 5. Notatka do raportu — DECYZJA B ✅ wdrożona

**Ustalenie:** nie wprowadzamy formalnej ścieżki „odrzuć raport” —
rozbieżności między brygadzistą a adminem rozwiązuje się telefonicznie.
Zamiast tego: **jedno pole tekstowe na cały raport** (krok 3,
podsumowanie) — dowolna notatka brygadzisty do tego konkretnego dnia
(np. „deszcz do 11, brygada 2h krócej”, „czekaliśmy na dostawę”).
Potwierdzone: **jedna notatka na cały raport**, nie osobna per materiał
— współistnieje z istniejącym polem „Dlaczego wystąpiła różnica?” przy
konkretnym materiale (to zostaje bez zmian, to inna rzecz: powód
konkretnego odchylenia od planu, nie ogólna notatka dnia).

- Widoczne dla Admina przy przeglądaniu/zatwierdzaniu raportu.
- Czysto informacyjne — nie wpływa na żadne wyliczenia (magazyn, koszt).
- Wymaga: nowej kolumny (np. `reports.note`) + pola `Field`/`TextInput`
  w kroku 3 UI brygadzisty + wyświetlenia w `ReportCard`
  (`report-ui.tsx`) po stronie Admina.

---

## 6. Zamknięcie budowy i pozostałość materiałowa — DECYZJA C ✅ wdrożona

**Ustalenie:** przy zamykaniu budowy Admin decyduje per pozycja
pozostałości: zwrot na magazyn albo do wyrzucenia (np. materiał traci
ważność). Zwrot → **odejmujemy** od kosztów budowy. Wyrzucenie →
**dodajemy** do kosztów budowy.

**Wdrożone:**
- Mechanizm wyboru zwrot/wyrzucenie (`close_build`, `builds-screen.tsx`)
  bez zmian — jak dawniej.
- **Zwrot** zwiększa `material_batches.quantity` (wraca na magazyn) —
  koszt tej pozycji nigdy nie wszedł do `build_materials.actualCost`
  (rośnie tylko przy faktycznym *zużyciu* w raporcie, §3), więc nie ma
  czego odejmować — zgodne z ustaleniem bez dodatkowej zmiany.
- **Wyrzucenie** dolicza `quantity × unitPrice` tej partii (realna cena,
  ta sama zasada co w §4 — bez uśredniania) do nowej, osobnej kolumny
  `build_settlements."wasteCost"` — NIE do `materialsCost`, żeby nie
  mieszać "zużyto zgodnie z planem pracy" ze "zmarnowało się przy
  zamknięciu". `wasteCost` wlicza się też do `totalCost` budowy.
- Front liczy „Straty materiałowe” **na żywo** z trwałego logu
  `build_material_returns` (dostał kolumnę `unitPrice` i Realtime) —
  ten sam wzorzec co reszta `settlement-screen.tsx`, nie z zamrożonego
  `build_settlements` (ten snapshot i tak nigdzie nie jest jeszcze
  odczytywany z powrotem do frontu — osobny, wcześniejszy dług, poza
  zakresem tej zmiany). Widoczne jako osobny wiersz „Straty materiałowe”
  w podsumowaniu i na wykresie struktury kosztów.

**Na przyszłość (nie teraz):** skoro ma to być „dobra zakładka do
analizy” — docelowo osobny widok zbierający straty materiałowe
**przekrojowo po wszystkich budowach** (który materiał marnuje się
najczęściej, na której budowie, ile to kosztuje w skali roku), po
wzorze istniejącego ekranu Rozliczeń/Raportów. To osobne zadanie.

---

## 7. Gdzie to wszystko widać (✅ działa, zweryfikowane)

Panel Admina → **Rozliczenie budowy** (`settlement-screen.tsx`) liczy
się **na żywo**, dopóki budowa jest aktywna — wszystkie źródła danych
(`build_materials`, `reports`+podtabele, `time_entries`,
`build_material_lots`) mają włączony Supabase Realtime
(`lib/data/use-realtime-sync.ts`) i po każdej zmianie odświeżają
odpowiednie zapytanie. Po **zamknięciu** budowy widok przestaje liczyć
na żywo i pokazuje zamrożony `build.settlement` (jednorazowy snapshot
z `close_build`).

---

## 8. Status wdrożenia

Wszystkie trzy decyzje **wdrożone**. Migracje SQL (uruchomić w tej
kolejności na bazie Supabase, każda bezpieczna do wielokrotnego
wklejenia):

1. `supabase/sql/033_straty_materialowe.sql` — §6: `build_material_returns.unitPrice`,
   `build_settlements.wasteCost`, `close_build` liczy i zapisuje koszt
   wyrzucenia.
2. `supabase/sql/034_raport_notatka_i_konsolidacja.sql` — §5:
   `reports.note` + **konsolidacja `submit_daily_report`** (przy okazji
   naprawia realny, wcześniej istniejący bug: od migracji 025 w bazie
   równolegle żyły DWIE wersje tej funkcji — 5-argumentowa z 025 i
   6-argumentowa z 012 — i ta druga, faktycznie wołana przez klienta,
   nigdy nie ustawiała `submittedByProfileId`, więc "Moje raporty"
   pokazywało brygadziście WSZYSTKIE raporty budowy, nie tylko jego
   własne).
3. `supabase/sql/035_dokladny_zwrot_partii.sql` — §4: tabela
   `report_material_lots` (rozbicie „z jakiego lota ile”),
   `fn_consume_build_lot_fifo` zapisuje ten rozkład, `submit_daily_report`
   cofa go dokładnie (LIFO) przy korekcie w dół.

Front (kontekst `contexts/app-data.tsx`, `report-screen.tsx`,
`report-ui.tsx`, `settlement-screen.tsx`) już korzysta z nowych kolumn/
tabel — notatka w kroku 3 raportu i w `ReportCard`, „Straty materiałowe”
w Rozliczeniu. Decyzja A (§4) jest w całości po stronie bazy — front nie
wymagał żadnej zmiany, bo dla użytkownika wygląda to tak samo jak dziś
(wpisz mniejszą ilość, zapisz), tylko księgowość w tle jest teraz
poprawna.
