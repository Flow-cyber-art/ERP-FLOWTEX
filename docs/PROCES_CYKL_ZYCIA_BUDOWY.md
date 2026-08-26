# Proces: Cykl życia budowy (od założenia do zamknięcia)

Dokument analityczny — opisuje, jak działa cały łańcuch zdarzeń w
aplikacji **dziś**, wprost z kodu i migracji SQL (nie z założeń), oraz
ryzyka i decyzje, które z tego wynikają. **Żadna zmiana w aplikacji nie
została tu wprowadzona** — to materiał do przemyślenia, analogicznie do
`docs/PROCES_RAPORTOWANIE_BRYGADZISTA.md` (który opisuje szczegółowo
jeden wycinek tego łańcucha — punkt 5 niżej).

---

## 1. Role i realne uprawnienia

Trzy role (`app_role`: `Admin`, `Brygadzista`, `Pracownik`), wymuszane
funkcją `assert_role()` w każdej funkcji RPC oraz politykami RLS na
tabelach (`supabase/sql/003_auth_rls.sql`):

| Rola | Może |
|---|---|
| **Admin** | Wszystko: budowy, magazyn, ceny, zamówienia, technologie, zamykanie budów, zarządzanie kontami. |
| **Brygadzista** | Wypełnia/edytuje raport dzienny, przypisuje materiał pomocniczy do budowy z magazynu, widzi/edytuje `builds` (patrz Ryzyko 3), dodaje link do zdjęć. |
| **Pracownik** | Tylko podgląd własnego czasu pracy. |

Model zakłada **jedną brygadę na jedną budowę na raz** — nie ma
granulacji "który brygadzista widzi/może edytować którą budowę" (ustalone
wcześniej w rozmowie o raportowaniu, punkt "Założenia" w
`PROCES_RAPORTOWANIE_BRYGADZISTA.md`). To upraszcza dzisiejszy model, ale
ma konsekwencje przy skalowaniu — patrz Ryzyko 4.

---

## 2. Pełny łańcuch — krok po kroku

### 2.1 Założenie budowy
`builds-screen.tsx` → `saveBuild()` → RPC `createBuild` (INSERT,
`lib/data/builds.ts`). Wymagane: numer, nazwa, osoba odpowiedzialna,
data startu, czas trwania. Opcjonalnie: klient, adres, wartość
kontraktu. Numer budowy ma unikalny constraint w bazie — duplikat
kończy się czytelnym komunikatem, nie surowym błędem SQL.

### 2.2 Przypisanie technologii → plan materiałowy
Sekcja "Technologia" w karcie budowy → `assignBuildTechnology()` → RPC
`assign_technology_to_build` (opisana w `SUPABASE_SETUP.md`, Faza 2 —
**plik samej migracji nie istnieje w repo**, patrz Ryzyko 1). Liczy plan
materiałowy (etap → materiał → zużycie/m² × powierzchnia) i **zamraża
go jako snapshot** w momencie przypisania (`build_technology_snapshot`,
`build_material_plan`) — późniejsza zmiana/nowa wersja technologii nie
rusza już przypisanego planu tej budowy.

### 2.3 Zamówienie materiału z planu
"+ Z planu" → RPC `generate_order_from_plan` (`007_faza3_zamowienia.sql`)
agreguje `build_material_plan` w jedno zamówienie (nagłówek `orders` +
pozycje `order_items`), status `robocze`. Admin może poprawić ilość
zamawianą (zaokrąglenie do opakowań). "Złożono u dostawcy" → status
`zamówione`. Żadnej blokady przed wygenerowaniem **drugiego** zamówienia
z tego samego planu — patrz Ryzyko 5.

### 2.4 Przyjęcie dostawy
"Dostawa dotarła" → RPC `receive_order` — per pozycja: własna ilość i
cena, dopisuje **osobną partię** do `material_batches` ORAZ (dla
zamówień z planu, Faza 5) **automatycznie** do `build_material_lots` tej
budowy — materiał "fizycznie trafia na plac" w tym samym momencie, bez
osobnego kroku ręcznego przypisania. Jeśli pozycja zamówienia nie ma
`linked_material_id`, dopasowanie do materiału magazynowego idzie **po
nazwie** — kruche przy literówce/duplikacie nazwy, patrz Ryzyko 6.
Zamówienie zamyka się statusem `przyjęte`.

### 2.5 Materiał pomocniczy (spoza planu)
"+ Przypisz materiał" (Admin, karta budowy) albo "Dodaj materiał z
magazynu" (Brygadzista, w trakcie raportu) → RPC
`assign_material_batches_to_build` — ręczny wybór **konkretnej partii**
(różne ceny/daty tego samego materiału), zdejmuje od razu z magazynu
ogólnego do puli tej budowy. Ta sama funkcja, obie role — bez
sprawdzania, czy wywołujący "ma coś wspólnego" z tą akurat budową (patrz
Ryzyko 4).

### 2.6 Raportowanie dzienne
Opisane szczegółowo w `docs/PROCES_RAPORTOWANIE_BRYGADZISTA.md` —
skrót: zużycie materiału zdejmuje się z puli **tej budowy**
(`build_material_lots`, FIFO) i staje się kosztem budowy
(`build_materials.actualCost`) **w momencie zapisu raportu**, nie
zatwierdzenia. Korekta w dół (Decyzja A) zwraca dokładnie do partii, z
której zeszło. Notatka do raportu (Decyzja B). Materiał wyrzucony przy
zamknięciu budowy dolicza się jako "Straty materiałowe" (Decyzja C, patrz
2.8 niżej).

### 2.7 Zatwierdzanie raportów
Admin → "Zatwierdź raport" → `approveReport()` → status `approved`,
edycja zablokowana raz na zawsze (nawet dla Admina). **Zatwierdzenie nie
rusza magazynu/kosztu** — to już się stało przy zapisie (2.6); zatwierdzenie
to czysto administracyjna bramka i **warunek konieczny zamknięcia
budowy** (2.8 wymaga zera niezatwierdzonych raportów).

Model danych ma też status `do_poprawy` (+ `reports.adminComment`) —
istnieje w typach/bazie, licznik `reportsNeedingFixCount` jest nawet
liczony w `contexts/app-data.tsx` — ale **żaden ekran nigdy go nie
wyświetla ani nie pozwala go ustawić**. To martwy, w połowie zbudowany
kod. Nie koliduje z Decyzją B (świadomie zrezygnowaliśmy z formalnego
"odrzuć raport" na rzecz telefonu + notatki) — ale warto podjąć decyzję,
czy ten martwy fragment zostawić "na później", czy usunąć, żeby nie mylił
kogoś, kto będzie czytał kod. Patrz Decyzja do podjęcia #5.

### 2.8 Zamknięcie budowy
Wymaga: **wszystkie raporty budowy zatwierdzone** + (opcjonalnie) poprawny
PIN wpisany w UI. RPC `close_build`:
1. Per pozostała partia (`build_material_lots`) — decyzja Admina: zwrot
   na magazyn (realna cena, ta sama partia) albo wyrzucenie (dolicza się
   jako "Straty materiałowe" do kosztu budowy, Decyzja C).
2. Liczy i zapisuje **jednorazowy snapshot** rozliczenia
   (`build_settlements` + `build_settlement_materials`): godziny, koszt
   materiałowy, robocizna, koszty dodatkowe, straty materiałowe.
3. Status budowy → `zamknięta`. Można wznowić (`reopenBuild`) — kolejne
   zamknięcie nadpisze snapshot świeżym przeliczeniem.

**PIN nie jest realnym zabezpieczeniem** — patrz Ryzyko 2, to ważne do
zrozumienia zanim ktokolwiek zacznie polegać na nim jak na kontroli
dostępu.

**Zamrożony snapshot (`build_settlements`) nigdy nie jest odczytywany z
powrotem do frontu** — `lib/data/builds.ts` (`listBuilds`) go nie
pobiera, więc `build.settlement` w aplikacji jest zawsze `undefined` po
odświeżeniu/ponownym zalogowaniu. To dlatego decyzja C (Straty
materiałowe) została policzona jako **żywe zapytanie** o
`build_material_returns`, a nie z tego snapshotu — działa poprawnie mimo
tej luki, ale sama luka zostaje i dotyczy też reszty snapshotu
(godziny/koszt materiałowy/robocizna zamkniętej budowy również nie są
nigdzie odczytywane z powrotem). Patrz Ryzyko 7.

### 2.9 Analiza / Rozliczenie
`settlement-screen.tsx` — liczy **na żywo** z danych operacyjnych
(realtime na `build_materials`, `reports`+podtabele, `time_entries`,
`build_material_lots`, `build_material_returns`), niezależnie od statusu
budowy (dla zamkniętej budowy dane te już się nie zmieniają, więc wynik
jest identyczny z tym, co dałby prawdziwy odczyt zamrożonego snapshotu —
tylko liczony na nowo za każdym razem zamiast raz zapisany).

---

## 3. Ryzyka zidentyfikowane

### Ryzyko 1 — Brakujące migracje fundamentu (krytyczne, disaster recovery)
`SUPABASE_SETUP.md` opisuje Fazy 0–2 i wprost odsyła do plików
`supabase/sql/004_faza0_fundament.sql`, `005_faza1_technologie.sql`,
`006_faza2_plan_budowy.sql` — **żaden z nich nie istnieje w repozytorium
ani nigdy w nim nie istniał** (sprawdzone: `git log --all` nie zna tych
plików). Schemat, który tworzą (tabela `technologies`,
`technology_stages`, `technology_materials`, `build_technology_snapshot`,
`build_material_plan`, kolumny `materials.category`,
`builds.clientName/address/areaM2/contractValue`, `settings`) **istnieje
tylko w żywej bazie Supabase**, zastosowany ręcznie i nigdy niecommitnięty.

**Realna konsekwencja:** gdyby trzeba było odtworzyć bazę od zera
(nowe środowisko, katastrofa, staging, onboarding kogoś nowego) —
uruchomienie plików z `supabase/sql/` po kolei **nie zadziała**: `007`
i kolejne odwołują się do tabel/funkcji, których `001`–`003` nie tworzą.
To nie jest tylko porządek w dokumentacji — to brak jedynego źródła
prawdy dla części schematu.

### Ryzyko 2 — PIN zamknięcia budowy to UI, nie zabezpieczenie
`close_build_pin` (`019_pin_zamkniecia_budowy.sql`) to zwykła kolumna
tekstowa w `settings`, **czytelna dla każdej zalogowanej roli** (komentarz
w migracji: "odczyt dla wszystkich zalogowanych"), porównywana **po
stronie klienta** (`if (pinInput !== closeBuildPin)` w
`builds-screen.tsx`). Sama funkcja `close_build` **nie przyjmuje ani nie
sprawdza żadnego PIN-u** — jedyna faktyczna kontrola to
`assert_role(['Admin'])`. Efekt: PIN chroni przed przypadkowym
kliknięciem na współdzielonym urządzeniu przez kogoś, kto już jest
zalogowany jako Admin — nie chroni przed niczym więcej (każdy, kto umie
odpytać REST API bezpośrednio, może odczytać PIN z `settings` albo po
prostu wywołać RPC z pominięciem UI). Jeśli intencją było "drugi
czynnik", dziś go nie ma.

### Ryzyko 3 — RLS filtruje wiersze, nie kolumny
`builds_update_admin_brygadzista` pozwala roli Brygadzista na UPDATE
**całego wiersza** `builds`, nie tylko `photosUrl` (jedyne pole, które
UI faktycznie mu udostępnia). Ktoś, kto potrafi wywołać REST API wprost
(nie przez apkę), zalogowany jako Brygadzista, mógłby technicznie zmienić
numer budowy, wartość kontraktu, datę, kierownika. Dziś niskie ryzyko
(mała, zaufana firma, jedna brygada) — warto mieć świadomość, że to
ograniczenie istnieje tylko na poziomie UI, nie bazy.

### Ryzyko 4 — Brak przypisania "ta budowa należy do tej brygady"
Żadna funkcja RPC (`assign_material_batches_to_build`,
`submit_daily_report` i inne) nie sprawdza, czy wywołujący Brygadzista
ma cokolwiek wspólnego z daną budową — tylko rolę. Dziś to nieszkodliwe
(jedna brygada w całej firmie), ale wprost koliduje z celem "docelowo
jedna budowa = jedna brygada" wspomnianym w ustaleniach: jeśli pojawi się
**druga** brygada, dzisiejszy model pozwoli jednej brygadzie raportować
zużycie i zdejmować materiał z **cudzej** budowy, przez pomyłkę albo nie.
To realna decyzja projektowa do podjęcia zanim dojdzie druga brygada, nie
coś, co samo się "doda" przy skalowaniu.

### Ryzyko 5 — Zamówienia z planu bez blokady duplikatu
`generate_order_from_plan` nie sprawdza, czy dla tej budowy istnieje już
zamówienie z tego planu (w statusie `robocze`/`zamówione`) — każde
kliknięcie "+ Z planu" tworzy **nowe** zamówienie na **pełną** planowaną
ilość każdego materiału, niezależnie od tego, ile już zamówiono/przyjęto
wcześniej. Dwukrotne kliknięcie (np. z pomyłki albo dlatego że
pierwsze "wisiało") realnie podwaja zamówienie.

### Ryzyko 6 — Dopasowanie materiału po nazwie przy przyjęciu dostawy
`receive_order`, gdy pozycja zamówienia nie ma `linked_material_id`,
szuka materiału `where name = v_row.material_name limit 1` — przy literówce,
zmianie nazwy materiału w międzyczasie, albo dwóch materiałach o tej
samej nazwie, dostawa może trafić do **złego** wiersza magazynowego
(albo do żadnego — `limit 1` na pustym wyniku zostawia `v_material_id`
jako `null`, co dalej w funkcji może się zachować nieoczywiście zamiast
jawnie odrzucić operację).

### Ryzyko 7 — Zamrożony snapshot rozliczenia nigdy nie wraca z bazy
Jak w 2.8 — `build.settlement` w aplikacji jest zawsze puste po
odświeżeniu. Dziś "działa", bo `settlement-screen.tsx` liczy wszystko na
żywo niezależnie od statusu budowy — ale to oznacza, że sam snapshot
zapisywany przez `close_build` (`build_settlements`,
`build_settlement_materials`) jest dziś **martwym zapisem**: nikt go
nigdy nie czyta. Jeśli kiedyś dane operacyjne (raporty, godziny) miałyby
się zmienić/skasować po zamknięciu budowy (retencja, RODO, porządkowanie
archiwum) — "zamrożone" rozliczenie zniknęłoby razem z nimi, bo w
praktyce nie jest niezależnym zapisem, tylko nieużywaną tabelą.

### Ryzyko 8 — Offline tylko dla raportu dziennego
Świadomie udokumentowane już w `SUPABASE_SETUP.md` (§7) — przypisanie
materiału, zamówienia, przyjęcie dostawy, zamknięcie budowy wymagają
sieci. Powtarzam tu tylko dlatego, że w pełnym łańcuchu (punkt 2) to
jedyne miejsce bez siatki bezpieczeństwa "offline" — akceptowalne, bo to
operacje biurowe (Admin), nie polowe, ale warto mieć to świadomie, nie
przez przypadek.

### Ryzyko 9 — Brak walidacji sensowności danych przy zakładaniu budowy
`saveBuild` waliduje tylko "czy pole jest wypełnione", nie "czy wartość
ma sens" — ujemna/zerowa wartość kontraktu, data startu w przeszłości/
przyszłości bez ostrzeżenia, czas trwania w dniach bez górnego limitu.
Niskie ryzyko operacyjne, ale łatwe do poprawienia, gdyby ktoś zaczął
wpisywać dane z literówką (dodatkowe zero w kontrakcie itp.) i nikt by
tego nie złapał aż do rozliczenia.

---

## 4. Decyzje do podjęcia

1. **Migracje fundamentu (Ryzyko 1).** Czy odtworzyć brakujące pliki
   `004`/`005`/`006` retroaktywnie (introspekcja żywej bazy → zapis jako
   migracje, żeby repo było kompletnym źródłem prawdy), czy zaakceptować
   ryzyko i tylko to udokumentować jako świadomy stan?
2. **PIN zamknięcia budowy (Ryzyko 2).** Czy PIN ma być tylko wygodą
   ("nie kliknij przez pomyłkę na wspólnym tablecie") — wtedy obecny
   stan jest OK, tylko nazwa/opis w UI nie powinny sugerować, że to
   zabezpieczenie. Czy ma być realną kontrolą dostępu — wtedy wymaga
   przeniesienia sprawdzenia do samego `close_build` (hash PIN-u, nie
   plaintext, sprawdzany po stronie bazy).
3. **Ownership budowa↔brygada (Ryzyko 4).** Czy i kiedy planujecie drugą
   brygadę? Jeśli tak w rozsądnej perspektywie — warto zaprojektować
   przypisanie "ta budowa → ta brygada" **zanim** druga brygada zacznie
   pracować, nie po fakcie (naprawianie tego z danymi produkcyjnymi w
   środku jest trudniejsze).
4. **Blokada duplikatu zamówienia z planu (Ryzyko 5).** Czy
   `generate_order_from_plan` powinien ostrzegać/blokować przy istniejącym
   już zamówieniu roboczym/zamówionym z tego samego planu, czy zostawić
   to jako świadomą odpowiedzialność Admina (widzi listę zamówień, sam
   decyduje)?
5. **Martwy kod `do_poprawy`/`adminComment` (§2.7).** Usunąć jako
   niespójny z Decyzją B, czy zostawić jako zalążek pod ewentualną
   przyszłą zmianę zdania?
6. **Zamrożony snapshot rozliczenia (Ryzyko 7).** Czy dokończyć odczyt
   `build_settlements`/`build_settlement_materials` z powrotem do
   frontu (żeby zamknięta budowa faktycznie pokazywała zapisany
   snapshot, a nie tylko przypadkiem identyczne liczenie na żywo), czy
   uznać "licz zawsze na żywo" za docelowy, prostszy model i **usunąć**
   nieużywany zapis snapshotu zamiast go kończyć?
