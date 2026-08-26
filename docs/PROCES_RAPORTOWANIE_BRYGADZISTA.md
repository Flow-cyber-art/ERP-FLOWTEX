# Proces: Raportowanie brygadzisty

Status: dokument roboczy — porządkuje ustalenia z rozmowy o tym, jak
powinno działać złożenie raportu dziennego i co się wtedy dzieje z
magazynem/kosztami budowy. **Część poniższych zasad już działa w kodzie
(oznaczone „✅ działa”), część to ustalone decyzje jeszcze do wdrożenia
(oznaczone „🔧 do zrobienia”)** — nic z tego drugiego nie zostało jeszcze
zaimplementowane, to zapis decyzji, nie changelog.

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
`supabase/sql/025_moje_raporty_autor.sql`):

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
   - **delta < 0** (korekta w dół) → dziś: **tylko** nadpisuje `used` na
     niższą wartość. Nic nie wraca do puli budowy, koszt się nie zmniejsza.
     👉 to jest dokładnie punkt do zmiany, patrz §5.
4. Godziny pracy → `time_entries` (nadpisywane w całości dla tego dnia/
   budowy — nie sumowane z poprzednią wersją raportu).
5. Koszty dodatkowe → `report_extra_costs`, doliczane do kosztu budowy.
6. Wszystko widoczne **od razu** w panelu Admina (Rozliczenia, Budowy) —
   patrz §7.

---

## 4. Edycja/korekta raportu — DECYZJA A 🔧 do zrobienia

**Ustalenie:** edycja raportu (przed zatwierdzeniem) ma również
korygować stan magazynowy — nie tylko liczbę `used` na papierze.

**Rekomendowany, sprawdzony sposób** (zamiast wymyślać nowy mechanizm —
użycie tego, co już istnieje w systemie do dokładnie tego samego
problemu, patrz §6 "Pozostałość materiałowa"):

- Przy **delta < 0** (korekta w dół), zamiast tylko nadpisywać `used`:
  1. Policz proporcjonalny zwrot kosztu z tego, co już zaksięgowano dla
     tej pozycji w tym raporcie (`report_materials.cost` — to już dziś
     jest zapisywane per pozycja, więc mamy dokładną cenę, po jakiej
     zeszło).
  2. **Zwróć** różnicę ilości do puli `build_material_lots` **tej samej
     budowy** — jako nowy wpis (bo oryginalna partia mogła się w
     międzyczasie już wyczerpać/zniknąć), po uśrednionej cenie z kroku 1.
  3. **Odejmij** ten sam koszt z `build_materials.actualCost`.
  4. Zaktualizuj `report_materials.cost` tej pozycji (żeby ślad audytowy
     w samym raporcie też się zgadzał, nie tylko suma na budowie).
- Efekt: materiał „wraca” do puli przypisanej do budowy (nie od razu do
  ogólnego magazynu — bo fizycznie nadal stoi na placu). Jeśli finalnie
  nigdy nie zostanie zużyty, dostanie tę samą decyzję co każda inna
  pozycja "pozostałości" przy zamykaniu budowy (zwrot/wyrzucenie, §6) —
  **żadnego nowego mechanizmu, tylko reużycie istniejącego**.
- Ograniczenie: to działa tylko **przed zatwierdzeniem** raportu — po
  zatwierdzeniu edycja i tak jest zablokowana (bez zmian, zgodnie z
  obecnym zachowaniem).

**Do potwierdzenia:** czy zwrot ma trafiać jako nowa partia w
`build_material_lots` z uśrednioną ceną (rekomendacja), czy wolisz inny
sposób ustalania ceny zwrotu.

---

## 5. Notatka do raportu — DECYZJA B 🔧 do zrobienia

**Ustalenie:** nie wprowadzamy formalnej ścieżki „odrzuć raport” —
rozbieżności między brygadzistą a adminem rozwiązuje się telefonicznie.
Zamiast tego: **jedno pole tekstowe na końcu raportu** (krok 3,
podsumowanie) — dowolna notatka brygadzisty do tego konkretnego dnia
(np. „deszcz do 11, brygada 2h krócej”, „czekaliśmy na dostawę”).

- Widoczne dla Admina przy przeglądaniu/zatwierdzaniu raportu.
- Czysto informacyjne — nie wpływa na żadne wyliczenia (magazyn, koszt).
- Wymaga: nowej kolumny (np. `reports.note` albo `report_people`-owy
  odpowiednik na poziomie raportu) + pola `Field`/`TextInput` w kroku 3
  UI brygadzisty + wyświetlenia w `ReportCard` (`report-ui.tsx`) po
  stronie Admina.

---

## 6. Zamknięcie budowy i pozostałość materiałowa — DECYZJA C

**Ustalenie:** przy zamykaniu budowy Admin decyduje per pozycja
pozostałości: zwrot na magazyn albo do wyrzucenia (np. materiał traci
ważność). Zwrot → **odejmujemy** od kosztów budowy. Wyrzucenie →
**dodajemy** do kosztów budowy.

**Stan dziś (✅ część, ⚠️ luka):**
- Mechanizm wyboru zwrot/wyrzucenie **już istnieje** i działa
  (`close_build`, `builds-screen.tsx` — ekran zamykania budowy z
  decyzją per partia).
- ✅ **Zwrot** faktycznie zwiększa `material_batches.quantity` (wraca na
  magazyn) — zgodne z ustaleniem.
- ⚠️ **Ale:** dziś koszt pozostałości (i zwracanej, i wyrzucanej) **nigdy
  nie trafił** do `build_materials.actualCost` — bo licznik kosztu
  budowy rośnie tylko przy faktycznym *zużyciu* w raporcie (§3), a
  pozostałość z definicji nie została zużyta. Więc:
  - „Odejmujemy od kosztów budowy” przy zwrocie — dziś **nie ma czego
    odejmować**, bo nic tam nie weszło. Efektywnie już zgodne z
    ustaleniem (0 - 0 = 0), ale przez przypadek, nie przez działanie.
  - „Dodajemy do kosztów budowy” przy wyrzuceniu — 🔧 **to jest luka do
    zrobienia**. Dziś wyrzucenie tylko usuwa pozycję z
    `build_material_lots` i zapisuje ją w `build_material_returns`
    (ślad audytowy „co się stało”), ale **nie dolicza jej wartości do
    kosztu budowy nigdzie** — więc zmarnowany materiał dziś znika bez
    śladu z rozliczenia finansowego budowy.

**Do zrobienia:** w `close_build`, gdy `decision = 'wyrzucenie'`, doliczyć
`quantity × unitPrice` tej pozycji do `v_materials_cost` (albo osobnej
kolumny „koszt strat materiałowych” w `build_settlements`, żeby było to
widoczne osobno od zwykłego zużycia — czytelniejsze dla właściciela niż
schowanie tego w tej samej liczbie co normalne zużycie).

**Do potwierdzenia:** osobna linia „Straty materiałowe” w rozliczeniu
(rekomendacja — łatwiej zobaczyć skalę marnowania materiału na
przestrzeni budów) czy wrzucamy do tej samej sumy co zwykłe zużycie
materiałowe?

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

## 8. Otwarte decyzje (do potwierdzenia przed wdrożeniem)

1. **§4 (korekta w dół):** zwrot do `build_material_lots` po uśrednionej
   cenie z tego raportu — OK, czy inny sposób wyceny?
2. **§5 (notatka):** czy notatka ma być jedna na cały raport (dzień), czy
   też chcesz możliwość notatki per materiał/pozycja (dziś jest już pole
   „Dlaczego wystąpiła różnica?” przy przekroczeniu planu — czy notatka
   ogólna ma to zastąpić, czy współistnieć)?
3. **§6 (straty materiałowe):** osobna linia kosztowa czy wrzucone do
   zwykłego kosztu materiałowego budowy?
4. Czy §4 i §6 wdrażamy razem (bo współdzielą tę samą logikę „zwrot do
   puli budowy / koszt strat”), czy jako dwa osobne, niezależne zadania?
