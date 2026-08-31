# FLOWTEX ERP — Rejestr decyzji projektowych

## Moduł: Magazyn / Materiały / Przepływ materiału

> Dokument towarzyszący specyfikacji implementacyjnej v1.0.  
> Zawiera **wszystkie** decyzje podjęte w trakcie analizy, wraz z uzasadnieniem, oraz świadome pominięcia.

* * *

## D0. ZASADA NADRZĘDNA

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D0.1** | Aplikacja dla **małej firmy** — maksymalna prostota | Nie odtwarzamy dużego ERP |
| **D0.2** | **Brak formalnych dokumentów magazynowych** (PZ, WZ, MM, RW) | Nie ma potrzeby papierów obiegowych |
| **D0.3** | **Brak zamykania miesiąca / okresów rozliczeniowych** | Księgowość poza systemem |
| **D0.4** | Cel systemu: **mieć DANE**, nie papiery rozliczeniowe | Filtr dla każdej nowej funkcji |
| **D0.5** | Odrzucamy mechanizmy kontrolne: dwustronne potwierdzenia, limity akceptacji, słowniki wymuszane | Zbyt ciężkie dla 3–8 osób w terenie |

* * *

## D1. TOŻSAMOŚĆ MATERIAŁU I PARTII

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D1.1** | Klucz tożsamości partii = **indeks + lot + zdarzenie przyjęcia + cena** | Jednoznaczna identyfikacja warstwy zapasu |
| **D1.2** | **Nazwa NIE jest częścią klucza** — jest atrybutem indeksu | Inaczej „Cement CT-30" / „cement CT30" tworzą 3 stany |
| **D1.3** | Ten sam indeks + **inna cena = NOWA PARTIA** (nowy wpis w magazynie) | Podstawa wyceny partiowej |
| **D1.4** | Kolory i odcienie rozróżniane **osobnym INDEKSEM** | Zamiast mechanizmu jednorodności partii |
| **D1.5** | Jednostka bazowa **per indeks** (kg, l, szt., mb) — nie globalna | Asortyment: żywice (kg), grunty (l), odbojnice (mb), tarcze (szt.) |
| **D1.6** | Jednostki zapisane w **technologii** lub wybierane **przy zamawianiu** |  |
| **D1.7** | **Przelicznik opakowania na PARTII**, nie na indeksie | Dopuszcza worki 25 kg i 20 kg tego samego cementu |

* * *

## D2. CENA I WYCENA

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D2.1** | Cena partii = **kwota z faktury**, wpisywana przy przyjęciu |  |
| **D2.2** | ⭐ **CENA NIE JEST KOREGOWANA** — jest ostateczna, immutable | „Przychodzi do nas i taka ma być" |
| **D2.3** | Nowa dostawa z nową ceną **nie zmienia wcześniejszej partii** | Historia niezmienna |
| **D2.4** | ⭐ **FIXACJA**: materiał i cena zamrożone w momencie przypisania do budowy | Marża budowy stabilna, raz policzona |
| **D2.5** | Materiał **wraca z budowy po cenie, w jakiej go kupiono** | Dzięki temu zwrot **zawsze scala się** z partią macierzystą |
| **D2.6** | Wycena **partiowa** |  |

### Co ta decyzja wyeliminowała

*   ❌ korekty wsteczne kosztu budowy
    
*   ❌ rozjeżdżanie się zamkniętych okresów
    
*   ❌ duplikaty partii z tego samego lotu w dwóch cenach
    
*   ✅ wartość budowy odtwarzalna z historii bez wiedzy „kto co kliknął"
    

* * *

## D3. WYBÓR PARTII — FIFO

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D3.1** | ⭐ **FIFO/FEFO JAKO PRZYMUS** — system sam zdejmuje najstarszą partię | Żywice i chemia **się starzeją** |
| **D3.2** | **Nikt nie wybiera partii** — ani brygadzista, ani admin | Usuwa 2 ekrany decyzyjne |
| **D3.3** | Sortowanie: `expiry_date` → `received_at` (FEFO przed FIFO) |  |
| **D3.4** | Jeden raport zużycia może **rozbić się na wiele partii** (relacja 1:N) | Krytyczne dla modelu danych |

### Decyzje unieważnione przez D3.1

*   ~~Admin wybiera partię i cenę przy przypisaniu~~ → FIFO
    
*   ~~Brygadzista wybiera partię przy zużyciu~~ → FIFO
    

### Co to wyeliminowało

*   ❌ problem „czym brygadzista rozróżnia dwie identycznie nazwane partie"
    
*   ❌ koszt budowy sterowalny przez człowieka w terenie
    
*   ✅ koszt deterministyczny
    

* * *

## D4. NORMY I TECHNOLOGIA

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D4.1** | Norma **rozdzielona**: norma bazowa (kg/m²) **+ osobny narzut strat (%)** | Rozróżnia błąd wyceny od błędu wykonania |
| **D4.2** | Materiały przypisane do **WARSTW** w technologii | Posadzka = grunt / nośna / posypka / topcoat |
| **D4.3** | Każda warstwa może mieć **własne m²** | Grunt 480 m², topcoat 460 m² |
| **D4.4** | Brygadzista raportuje zużycie **per warstwa** | Wiadomo, na której warstwie powstało odchylenie |

* * *

## D5. ZAMÓWIENIA I PRZYJĘCIE

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D5.1** | Zamówienia zaokrąglane **RĘCZNIE** — system nie zaokrągla sam | Decyzja człowieka |
| **D5.2** | **Cała zamówiona ilość** (także nadwyżka z zaokrąglenia) idzie na **podmagazyn budowy** | Prostota; koszt i tak powstaje przy zużyciu |
| **D5.3** | **Przyjęcie to JEDNO zdarzenie** — nieważne gdzie fizycznie | „Przyjęcie to przyjęcie". Brak osobnego dokumentu dostawy na budowę |
| **D5.4** | Jedna faktura na wiele budów → rozdzielana **na LOTY** |  |

* * *

## D6. PRZYPISANIE I STAN

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D6.1** | Każda budowa = **podmagazyn** |  |
| **D6.2** | Magazyn główny trzyma materiał wspólny, używany na różnych budowach |  |
| **D6.3** | Materiał częściowo przypisany: 3 z 10 szt. → budowa, **7 „nieprzypisane"** i dostępne dla innych budów | Z opisu wyjściowego |
| **D6.4** | Stan podmagazynu = przypisano − zaraportowane zużycie | 100 kg − 30 kg = 70 kg |
| **D6.5** | **Jeden magazyn główny** (nie wiele lokalizacji) |  |
| **D6.6** | Brak mechanizmu **rezerwacji** — „przypisane" = wydane | Świadome uproszczenie |

* * *

## D7. RAPORT ZUŻYCIA

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D7.1** | ⭐ Brygadzista raportuje **REALNE DANE**. System **nic nie podpowiada** | Raport ma być niezależnym pomiarem |
| **D7.2** | ⭐ Brygadzista **NIE WIDZI normy** ani planowanego zużycia | Inaczej raporty zbiegają się do normy i odchylenie przestaje istnieć |
| **D7.3** | Brygadzista **widzi technologię** i materiały, które ma u siebie | Musi wiedzieć, czym pracuje |
| **D7.4** | Raport ilości: **pełne opakowania + resztka** | Tak, jak realnie widzi towar |
| **D7.5** | **Zużycie > stan NIE JEST BLOKOWANE** | Blokada zatrzymałaby raportowanie w ogóle |
| **D7.6** | Stany są **ORIENTACYJNE** | Świadome założenie |
| **D7.7** | Odchylenie plan/wykonanie analizuje **tylko admin/controlling** |  |

* * *

## D8. KOREKTY I NAPRAWA DANYCH

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D8.1** | Brygadzista edytuje **własny raport do momentu zamknięcia** |  |
| **D8.2** | ⭐ **Admin/właściciel MOŻE korygować raport już zatwierdzony** | Wymóg zgłoszony wprost |
| **D8.3** | **Stany ujemne naprawia ADMIN SAM** — brygadzista nic nie wskazuje | „Będą dzwonić do siebie" |
| **D8.4** | Jeśli zużyto więcej niż przypisano → materiał musiał pochodzić z **innej budowy** → transfer wykonuje admin |  |
| **D8.5** | **Raport z datą wsteczną dozwolony** bez ograniczeń | Brak zamykania okresów |
| **D8.6** | Terminowość wpisów **nadzoruje admin** ręcznie |  |

* * *

## D9. RUCH MATERIAŁU

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D9.1** | ⭐ Transfer **budowa → budowa WIRTUALNIE przez magazyn główny** | Reużywa istniejące ruchy, zero nowej logiki |
| **D9.2** | Admin **zamyka jedną budowę i przerzuca materiał na drugą** |  |
| **D9.3** | Ten sam mechanizm = **naprawa stanów ujemnych** |  |
| **D9.4** | Zwrot z budowy: zgodny **indeks + cena → SUMOWANIE**; niezgodny → **nowa pozycja** | Z opisu wyjściowego |
| **D9.5** | Po zakończeniu budowy decyzja: **na magazyn** albo **UTYLIZACJA** |  |
| **D9.6** | **Utylizacja = jak zużycie** — wartość w koszt budowy, zejście ze stanu |  |
| **D9.7** | Materiał zutylizowany **automatycznie wycofany** z magazynu |  |

* * *

## D10. KOSZTY

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D10.1** | ⭐ Koszt materiału powstaje **przy raporcie zużycia** |  |
| **D10.2** | Podmagazyn budowy = **WIP** (produkcja w toku), nie koszt | Zwrot nie generuje storna |
| **D10.3** | **Brygadzista może dołożyć koszty dodatkowe** |  |
| **D10.4** | ⭐ **Przy ZAMYKANIU BUDOWY system pyta o dodatkowe koszty końcowe** | Wywóz odpadu, transport powrotny. **Własny pomysł — rozwiązuje 3 problemy jednym ekranem** |
| **D10.5** | **NARZĘDZIA/TARCZE** = materiały szybko zużywające się: **„gdzie przypisane, tam zużyte"** |  |
| **D10.6** | **Brak licznika przerobu** narzędzi (mb/m²/mth) i stanu zużycia % | Świadomie odrzucone |

* * *

## D11. UPRAWNIENIA

| ID | Decyzja |
| --- | --- |
| **D11.1** | ⭐ **Ceny i marże widzi TYLKO ADMIN/WŁAŚCICIEL** |
| **D11.2** | Brygadzista **nie widzi wartości** ani cen |
| **D11.3** | Brygadzista **nie widzi norm** |
| **D11.4** | Zużycie u podwykonawcy raportuje **brygadzista podwykonawcy** |
| **D11.5** | Przyjęcie, przypisanie, transfer, zamknięcie budowy — **tylko admin** |

* * *

## D12. ZAMKNIĘCIE I ARCHIWIZACJA

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D12.1** | Statusy budowy: **zamknięta operacyjnie / zamknięta finansowo / zarchiwizowana** | Faktura przyjdzie po zakończeniu robót |
| **D12.2** | Wszystkie raporty budowy → **automatycznie do archiwum** | Z opisu wyjściowego |
| **D12.3** | **Brak inwentaryzacji okresowej** podmagazynów |  |
| **D12.4** | Różnica ujawnia się **dopiero przy zamknięciu budowy** |  |
| **D12.5** | Powód różnicy → użytkownik **SAM WPISUJE** (wolny tekst, nie słownik) |  |
| **D12.6** | Zamknięcie wymaga **wyzerowania podmagazynu** | Inaczej „sierocy" stan |
| **D12.7** | ⭐ Reklamacje/gwarancja po zamknięciu = **osobne zlecenie serwisowe z linkiem do budowy-matki** | Nie odblokowujemy starej budowy |

* * *

## D13. DOKUMENTACJA I DANE JAKOŚCIOWE

| ID | Decyzja | Uzasadnienie |
| --- | --- | --- |
| **D13.1** | ⭐ **ATESTY / DWU PER PARTIA (lot)** — WAŻNE, wysoki priorytet | Inwestor wymaga do dokumentacji odbiorowej |
| **D13.2** | Pole na **DWU na indeksie**, pole na **atest na partii** |  |
| **D13.3** | Przycisk **„Dokumentacja odbiorowa"** = zestawienie warstwa / materiał / lot / ilość + spakowane pliki | Tydzień pracy → jedno kliknięcie |

* * *

## D14. HIGIENA DANYCH I START SYSTEMU

| ID | Decyzja |
| --- | --- |
| **D14.1** | Partie o stanie **0 usuwane lub ukrywane** |
| **D14.2** | **Start systemu od zera** — brak bilansu otwarcia |
| **D14.3** | Każdy ruch materiału → wpis w księdze ruchów z `created_by` |

* * *

# ❌ POMINIĘTE ŚWIADOMIE

| Obszar | Decyzja | Konsekwencja, gdy zaboli |
| --- | --- | --- |
| **Materiały dwuskładnikowe A+B** | pomijamy | Żywice: zostaje komponent B bez partnera, widnieje jako pełny zapas |
| **Status opakowania naruszonego** | pomijamy | Resztki z otwartych worków wracają jako pełnowartościowe → wartość magazynu zawyżona |
| **Zwrot do dostawcy** | pomijamy — „na magazynie to na magazynie" | Reklamacje ilościowe rozliczane poza systemem |
| **Inwentaryzacja okresowa** | pomijamy | Rozbieżność narasta i wychodzi jednorazowo przy zamknięciu |
| **Licznik zużycia narzędzi** | pomijamy | Budowa, gdzie tarcza „umarła", płaci za cudze zużycie |
| **Flaga zużycie / strata** | pomijamy | Budowa, która wyrzuciła 300 kg, wygląda jak ta, która je zużyła |
| **Korekta ceny** | pomijamy | Różnica faktura vs cena wpisana nie trafia nigdzie automatycznie |
| **Waluty obce, kursy** | pomijamy | Zakupy w EUR bez ewidencji kursu |
| **VAT, netto/brutto** | pomijamy |  |
| **Etykiety / QR na paletach** | pomijamy | Nie boli, bo FIFO usunął potrzebę wyboru partii |
| **Rezerwacje materiału** | pomijamy | Nie zarezerwujesz materiału na budowę startującą za 2 tygodnie |
| **Wiele magazynów** | pomijamy — jeden magazyn główny |  |
| **Praca offline** | do przemyślenia | „Już nie te czasy" |
| **Terminy ważności / alerty FEFO** | częściowo (FEFO w sortowaniu, bez alertów) | Chemia może przeterminować się bez ostrzeżenia |
| **Bilans otwarcia** | pomijamy — start od zera |  |
| **Osobne role poza admin/brygadzista** | pomijamy | Admin = wąskie gardło przy 8+ budowach |

* * *

# 🕐 DO PRZEMYŚLENIA (schowek)

### Materiał powierzony przez inwestora

Propozycja gotowa do wdrożenia w przyszłości:
| Aspekt | Materiał nasz | Materiał powierzony |
| --- | --- | --- |
| Cena partii | z faktury | **0 zł** |
| Wchodzi w koszt budowy | ✅ | ❌ |
| Stan na podmagazynie | ✅ | ✅ |
| Raport zużycia | ✅ | ✅ |
| Zwrot na magazyn główny | ✅ | ❌ (wraca do inwestora) |

Implementacja: `allocations.owner` = `OURS` | `INVESTOR`

> ⚠️ **Flagę warto dodać od początku w bazie** — dorabianie później wymaga przeliczenia historycznych marż.

Wartość: pozwala rozliczyć się z inwestorem („dał 2 400 kg, zużyliśmy 2 620 kg → dopłata lub refaktura").

### Praca offline

Raczej niepotrzebna, ale do rozważenia przy pracy w halach bez zasięgu.

* * *

# ⚠️ RYZYKA PRZYJĘTE ŚWIADOMIE

| # | Ryzyko | Skutek |
| --- | --- | --- |
| R1 | Brak korekty ceny | Różnica faktura vs cena wpisana nie trafia nigdzie automatycznie — potrzebny ręczny przegląd na poziomie 3 marży |
| R2 | Brak statusu opakowania | Wartość magazynu zawyżona, ryzyko wydania zbrylonego materiału |
| R3 | Narzędzia bez licznika | Zaburzona porównywalność marży między budowami |
| R4 | Brak flagi strat | Nie policzysz „% strat per budowa / brygada / technologia" |
| R5 | Brak inwentaryzacji | Rozbieżność trudna do wyjaśnienia po fakcie |
| R6 | Admin jako wąskie gardło | Przy 8+ równoległych budowach — ryzyko obchodzenia systemu |
| R7 | Brygadzista widzi stan podmagazynu | Pośrednio widzi plan; przyjęte świadomie („tak jest") |
| R8 | Stany orientacyjne | Wartość WIP nie jest wiarygodna księgowo — tylko zarządczo |

* * *

# 📊 PROBLEMY WYELIMINOWANE PRZEZ DECYZJE

Sprzeczności znalezione w analizie i usunięte **uproszczeniem**, nie obejściem:
| Problem | Jak zniknął |
| --- | --- |
| Czym brygadzista rozróżnia dwie identyczne partie | **D3.1** FIFO przymus — nie widzi partii wcale |
| Duplikaty partii z jednego lotu w dwóch cenach | **D2.2** brak korekt ceny — partia niezmienna |
| Zwrot z budowy nie scala się z partią macierzystą | **D2.5** materiał wraca po cenie zakupu |
| Koszt budowy sterowalny przez człowieka | **D3.1** FIFO deterministyczne |
| Zużycie płaskie, bez rozbicia na etapy | **D4.2/D4.4** zużycie per warstwa |
| Koszty utylizacji i transportu powrotnego bez miejsca | **D10.4** pytanie o koszty przy zamykaniu budowy |
| Reklamacja psuje marżę zamkniętej budowy | **D12.7** osobne zlecenie serwisowe |