# Proces: Koszt planowany vs rzeczywisty (materiał + robocizna)

Dokument z Fazy dołożenia planowanego kosztu robocizny (27.08.2026) — co
było już poprawne w systemie przed tą zmianą, jaką lukę znaleziono i co
dokładnie zostało zaimplementowane. Pisany do wglądu/audytu, nie jako
instrukcja obsługi.

---

## 1. Co było już poprawne (zweryfikowane, nietknięte)

- **Receptura (`technologies`/`technology_stages`/`technology_materials`)**
  jest czystym opisem zużycia (`consumption_per_m2`), bez żadnej ceny —
  cena nie należy do receptury, tylko do zakupu. Zgodnie z decyzją
  właściciela, nie ruszane.
- **Cena rzeczywista materiału** żyje w `material_batches` (partia = ilość
  + cena + data + dostawca), FIFO. `materials.unitPrice` to średnia ważona
  BIEŻĄCEGO stanu, przeliczana funkcją `fn_recalc_material()` przy każdej
  zmianie partii (przyjęcie zamówienia, korekta, zwrot) —
  `supabase/sql/001_rpc_functions.sql`. To już była właściwa „aktualna
  cena zakupu"; nic tu nie wymagało naprawy.
- **Koszt rzeczywisty budowy** (materiał + robocizna) już działał: zużycie
  materiału na raporcie schodzi z `build_material_lots` (partia+cena
  zamrożone w momencie wydania) do `build_materials.actualCost`;
  `time_entries` (godziny per pracownik/budowa/dzień) × `employees.
  hourlyRate` daje `laborCost` w `close_build()`
  (`supabase/sql/013_faza9_zamkniecie_budowy.sql`), zapisywane do
  `build_settlements`/`build_settlement_materials` przy zamknięciu budowy.
  Ta ścieżka nie została zmieniona.
- **Plan materiałowy budowy** (`build_material_plan` = m² × zużycie z
  receptury, zamrożony przy przypisaniu technologii) już istniał i już
  był widoczny per etap w karcie budowy (`builds-screen.tsx`).

## 2. Luki znalezione

1. **Brak planowanego kosztu robocizny w ogóle.** Istniał tylko koszt
   RZECZYWISTY (`time_entries` → `laborCost`). Nie było żadnego sposobu
   policzyć, ile robocizna miała kosztować z góry, więc porównanie
   plan/wykonanie (analogiczne do materiałów) nie istniało dla robocizny.
2. **`teams` bez składu.** Tabela `teams` miała tylko `leadEmployeeId`
   (lidera), żadnej listy członków, żadnego UI do jej edycji i — co
   ważniejsze — **żadnej polityki RLS do zapisu** (`003_auth_rls.sql`
   dawał `teams` tylko `select_authenticated`). Zakładka Admin „Zespół i
   dniówka" zarządza wyłącznie pracownikami (`employees`), nie brygadami.
3. **`build_materials."unitPrice"` nie odzwierciedlał aktualnej ceny.**
   Ta kolumna (na przypisaniu materiału DO budowy, inna niż plan
   technologii) była ustawiana wyłącznie raz, przy pierwszym WYDANIU
   partii na budowę (średnia ważona wydanych partii — wzorzec powtórzony
   w kilku migracjach: 009/018/024/037/038), i nigdy odświeżana później.
   Efekt: `materialsCostPlanned = Σ(planned × unitPrice)`
   (`builds-screen.tsx`) potrafił pokazywać cenę sprzed tygodni, mimo że
   w międzyczasie przyszła nowa dostawa po innej cenie.
4. Wartości `builds.durationDays` i planowanych godzin dziennych istniały
   częściowo — `durationDays` już oznaczał dni ROBOCZE (używany razem z
   globalną „dniówką" w `builds-screen.tsx`), ale nie było pola „planowane
   godziny/dzień" NA BUDOWĘ (tylko globalne ustawienie w Admin).

## 3. Co zostało zaimplementowane

### 3.1 Skład brygady — `team_members`

Nowa tabela (`supabase/sql/040_planowany_koszt_robocizny.sql`,
`drizzle/schema.ts`): `team_members(team_id, employee_id, "createdAt")`,
PK złożony. RLS: odczyt dla każdego zalogowanego, zapis tylko dla Admina
(ten sam wzorzec co `employees_write_admin`). Przy okazji dopisana
brakująca polityka zapisu na `teams` samej (`teams_write_admin`) — do tej
pory nikt nie mógł nawet założyć nowej brygady z klienta.

UI: nowa podsekcja „Brygady" w Admin → „Zespół i dniówka"
(`AdminTeamsSubsection`, `components/screens/admin-screen.tsx`) — dodanie
brygady (nazwa + opcjonalny lider), rozwijana lista z dodawaniem/usuwaniem
członków. Warstwa danych: `lib/data/teams.ts`.

### 3.2 Planowane godziny dziennie na budowę

`builds.plannedHoursPerDay` (decimal, domyślnie `8`) — dochodzi obok
istniejącego `durationDays` (etykieta w formularzu doprecyzowana na
„Czas trwania — dni robocze"). Wybór brygady w formularzu „Nowa budowa"
używa już istniejącego `builds.teamId`.

### 3.3 Planowany koszt robocizny

Wzór (ustalony z właścicielem), liczony po stronie klienta z surowych
tabel — ten sam wzorzec co reszta modułu Technologia (`build_material_
plan`, `build_technology_snapshot` — klient dociąga tabele i liczy sam,
bez osobnego widoku SQL):

```
plannedLaborCost = Σ(hourlyRate członków brygady przypisanej do budowy)
                    × plannedHoursPerDay × durationDays
```

Pokazywany obok kosztu rzeczywistego robocizny w trzech miejscach:
podgląd na żywo w formularzu „Nowa budowa”, sekcja „Koszty na bieżąco” w
karcie budowy, i „Podsumowanie” w Rozliczeniu budowy
(`settlement-screen.tsx`) — dokładnie tam, gdzie już wcześniej pokazywany
był `laborCost` rzeczywisty.

### 3.4 Naprawa ceny planowanej materiału

`fn_recalc_material()` (wołana już wcześniej po KAŻDEJ zmianie partii)
dodatkowo odświeża `build_materials."unitPrice"` na aktualną `materials.
"unitPrice"` — ale tylko dla pozycji na budowach jeszcze **aktywnych**
(`status = 'aktywna'`). Budowy zamknięte mają rozliczenie już zamrożone w
`build_settlement_materials` i nie są ruszane. Koszt rzeczywisty
(`actualCost`, liczony z `build_material_lots` — partia+cena zamrożone w
momencie wydania) tą zmianą nie jest dotknięty.

### 3.5 Koszt materiałowy planowany — ekspozycja

Dodano koszt (ilość planowana × `materials.unitPrice`) per pozycja planu
technologii ORAZ sumę „Koszt materiałowy planowany razem” w karcie budowy
(`builds-screen.tsx`, sekcja TECHNOLOGIA) — bez nowej kolumny/widoku w
bazie, bo `materials.unitPrice` już był tą „aktualną ceną zakupu”, o którą
chodziło (patrz §1).

## 4. Pliki zmienione/dodane

- `drizzle/schema.ts` — `teamMembers`, `builds.plannedHoursPerDay`.
- `supabase/sql/040_planowany_koszt_robocizny.sql` — `team_members`, RLS,
  `builds.plannedHoursPerDay`, naprawiona `fn_recalc_material()`.
- `lib/data/teams.ts` (nowy) — CRUD brygad i składu.
- `lib/data/builds.ts` — `teamId`/`plannedHoursPerDay` w tworzeniu budowy,
  `updateBuildLaborPlan()`.
- `contexts/app-data.tsx` — zapytania/mutacje/stan dla `teams`/
  `teamMembers`, rozszerzony `newBuild`.
- `components/screens/admin-screen.tsx` — `AdminTeamsSubsection`.
- `components/screens/builds-screen.tsx` — wybór brygady/godzin w
  formularzu, plan vs rzeczywisty w „Koszty na bieżąco”, koszt materiałowy
  planowany w sekcji TECHNOLOGIA.
- `components/screens/settlement-screen.tsx` — plan vs rzeczywisty w
  „Podsumowanie”.
- `components/report-ui.tsx` — `teamId`/`plannedHoursPerDay` w typie
  `Build`.

## 5. Co NIE zostało zmienione

- Model receptury (`technologies`/`technology_stages`/
  `technology_materials`) — bez cen, jak było.
- `time_entries`, `close_build()`, `build_settlements`/
  `build_settlement_materials` — ścieżka kosztu RZECZYWISTEGO działa jak
  dotąd, bez zmian logiki.
- `build_materials."unitPrice"` dla budów zamkniętych — zostaje zamrożona.

## 6. 2026-08-27 — naprawa `linked_material_id` i uproszczenie Rozliczenia

### 6.1 Znaleziony błąd

W tabeli per-etap w Rozliczeniu budowy (`settlement-screen.tsx`) kolumny
Przypisano/Zużyto/Koszt renderowały się jako 0 dla pozycji planu, których
`technology_materials.linked_material_id` (skopiowane na
`build_material_plan.linked_material_id` przy przypisaniu technologii do
budowy) było `NULL` — mimo że realne zużycie istniało. Powód: dopasowanie
rzeczywistego zużycia (`assignments`) do wiersza planu odbywa się po
`materialId`, więc brak powiązania = brak dopasowania. To samo realne
zużycie trafiało wtedy do sekcji „Materiały pomocnicze (spoza planu
technologii)” (dopasowanie tam idzie po zbiorze `linkedMaterialId`
wszystkich wierszy planu budowy) — dla użytkownika wyglądało to jak
zdublowane/rozjechane dane, choć źródło (`build_materials`) było jedno.
`linked_material_id` to pole ręczne, ustawiane tylko gdy admin przy
edycji technologii jawnie wybierze materiał magazynowy z listy — wiele
istniejących pozycji recepr miało je puste mimo zgodnej nazwy z realnym
materiałem magazynowym.

### 6.2 Naprawa danych

`supabase/sql/041_napraw_linked_material_id.sql` — jednorazowa naprawa:
dowiązuje po **dokładnej** nazwie (`materials.name = material_name`),
tylko gdy trafienie jest jednoznaczne (dokładnie jeden pasujący materiał).
Obejmuje `technology_materials` (recepta — źródło dla przyszłych
przypisań) oraz retroaktywnie `build_material_plan` dla budów, które nie
są jeszcze zamknięte (`status <> 'zamknięta'`) — zamknięte mają
rozliczenie już zamrożone i nie są ruszane. Migracja loguje przez
`RAISE NOTICE` liczby: dowiązanych, niejednoznacznych (>1 dopasowanie) i
bez dopasowania (0 dopasowań) — dokładne liczby zależą od danych w danej
instancji bazy i pojawiają się w logu przy uruchomieniu migracji na
Supabase; migracja kończy się też zapytaniem listującym pozycje wciąż
bez powiązania, do ręcznego dowiązania w edytorze technologii.

### 6.3 Zapobieganie nawrotowi

`components/screens/technologies-screen.tsx` — `save()` odrzuca teraz
zapis technologii, jeśli którakolwiek pozycja materiałowa nie ma
wybranego `linkedMaterialId` (komunikat: „Wybierz materiał magazynowy
dla pozycji: …”). Walidacja jest wyłącznie po stronie klienta — reszta
schematu w tym obszarze jest równie liberalna (brak `NOT NULL` na
`linked_material_id` w bazie), a dodanie twardego ograniczenia bazowego
wymagałoby wcześniej 100% skutecznej naprawy wszystkich istniejących
wierszy, co nie jest gwarantowane przy dopasowaniu po nazwie — czyszczenie
pozostałych przypadków zostaje w UI, zgodnie z tym jak reszta modułu
Technologia już działa (edycja zawsze tworzy nową wersję, nie nadpisuje).

### 6.4 Uproszczenie widoku Rozliczenia

Tabela per-etap: kolumny **Materiał / Plan / Przypisano / Zużyto /
Pozostało / Koszt** → **Materiał / Plan / Zużyto / Koszt** — „Przypisano”
i „Pozostało” to stany pośrednie przydatne przy śledzeniu budowy na
żywo (zostają bez zmian w karcie budowy, `builds-screen.tsx`, sekcja
„Koszty na bieżąco”), ale w końcowym rozliczeniu tylko rozmywały obraz
plan → zużycie → koszt. Sekcja „Materiały pomocnicze” analogicznie:
zamiast `zużyto / plan X · koszt` pokazuje `zużyto [jednostka] · koszt`
(plan nie ma tu sensu z definicji — to materiały spoza planu technologii).
Po naprawie z §6.2 ta sekcja powinna zawierać już tylko materiały
faktycznie spoza planu technologii, nie pozycje planu z brakującym
powiązaniem.

### 6.5 Pliki zmienione

- `supabase/sql/041_napraw_linked_material_id.sql` (nowy) — naprawa
  danych opisana w §6.2.
- `components/screens/technologies-screen.tsx` — walidacja
  `linkedMaterialId` przy zapisie (§6.3).
- `components/screens/settlement-screen.tsx` — uproszczone kolumny
  tabeli per-etap i sekcji materiałów pomocniczych (§6.4).
