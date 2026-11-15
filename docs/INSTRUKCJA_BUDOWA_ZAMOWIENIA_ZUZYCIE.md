# FLOWTEX ERP — Instrukcja użytkownika

## Od założenia budowy, przez zamówienie materiału, do meldowania zużycia

**Dla kogo:** Administrator (biuro) i Brygadzista (plac budowy)
**Wersja:** 1.0, listopad 2026

---

## Spis treści

0. [Zanim zaczniesz: role i nawigacja](#0-zanim-zaczniesz-role-i-nawigacja)
1. [Przygotowanie: magazyn i technologia](#1-przygotowanie-magazyn-i-technologia-admin)
2. [Zakładanie budowy (kreator 6 kroków)](#2-zakładanie-budowy--kreator-6-kroków-admin)
3. [Zamawianie materiału i przyjęcie dostawy](#3-zamawianie-materiału-i-przyjęcie-dostawy-admin)
4. [Materiał dodatkowy (spoza planu)](#4-materiał-dodatkowy-spoza-planu)
5. [**Brygadzista: meldowanie zużycia materiału**](#5-brygadzista-meldowanie-zużycia-materiału--raport-dzienny)
6. [Zatwierdzanie raportów](#6-zatwierdzanie-raportów-admin)
7. [Zamknięcie i rozliczenie budowy](#7-zamknięcie-i-rozliczenie-budowy-admin)
8. [Najczęstsze problemy i pytania](#8-najczęstsze-problemy-i-pytania)
9. [Ściąga na jedną stronę](#9-ściąga-na-jedną-stronę)

---

## Jak materiał „płynie” przez system (przeczytaj raz, zanim zaczniesz)

Każdy materiał przechodzi przez **trzy stany**. Rozumiejąc je, zrozumiesz całą resztę:

```
 ┌───────────────────┐   przyjęcie dostawy   ┌─────────────────────┐   raport dzienny   ┌──────────────────┐
 │  MAGAZYN OGÓLNY   │ ───────────────────▶  │  PRZYPISANY DO      │ ────────────────▶  │  ZUŻYTY          │
 │  (firma)          │   lub „przypisz       │  BUDOWY (na placu)  │   brygadzisty      │  = KOSZT BUDOWY  │
 │                   │   materiał”           │  jeszcze nie zużyty │                    │                  │
 └───────────────────┘                       └─────────────────────┘                    └──────────────────┘
          ▲                                             │
          └──────── zwrot przy zamknięciu budowy ───────┘   (albo odpis jako „Straty materiałowe”)
```

- **Koszt budowy rośnie dopiero wtedy, gdy brygadzista zamelduje zużycie** — nie w chwili zamówienia ani dostawy.
- Koszt liczony jest **po realnej cenie konkretnej dostawy (partii)**, metodą FIFO — najpierw schodzi najstarsza partia.

---

## 0. Zanim zaczniesz: role i nawigacja

| Rola | Co robi w tym procesie |
|---|---|
| **Admin** | Zakłada budowy, przypisuje technologię, zamawia i przyjmuje materiał, zatwierdza raporty, zamyka budowę. |
| **Brygadzista** | Codziennie wysyła raport: zużycie materiału, zespół i godziny, km, koszty dodatkowe, zdjęcia. Może też dobrać materiał z magazynu na budowę. |
| **Pracownik** | Nie bierze udziału w tym procesie (widzi tylko swój czas pracy). |

**Menu Admina** (kolejność odpowiada cyklowi budowy):
`Budowy` → `Technologie` → `Magazyn` → `Zamówienia` → `Raporty` → `Rozliczenie` → `HR` → `Admin`

> 📱 **Na telefonie** dolny pasek ma mniej miejsca, więc niektóre przyciski są „podwójne” —
> **naciśnij ten sam przycisk drugi raz**, aby przełączyć:
> - `Budowy` ⇄ `Rozliczenie`
> - `Magazyn` ⇄ `Technologie`
> - `Zamówienia` ⇄ `Raporty`

**Menu Brygadzisty:** `Raporty` · `Czas zespołu` · `Urlopy` · `Admin`

---

## 1. Przygotowanie: magazyn i technologia (Admin)

Robi się to **raz** (i uzupełnia w miarę potrzeby), nie przy każdej budowie.

### 1.1 Kartoteka materiałów — `Magazyn`
Każdy materiał, który ma być zamawiany lub raportowany, musi istnieć w Magazynie (nazwa, indeks, jednostka, próg minimalny).

> ⚠️ **Nazwy materiałów pisz zawsze tak samo.** System przy przyjęciu dostawy potrafi dopasowywać materiał po nazwie — „Klej C2TE” i „klej C2TE ” (ze spacją) to dla niego dwa różne materiały. Gdy system podpowiada istniejącą nazwę — wybierz podpowiedź zamiast wpisywać nową.

### 1.2 Technologia (receptura) — `Technologie`
Technologia = lista **etapów** (np. gruntowanie, warstwa zasadnicza, zamknięcie) i **materiałów z normą zużycia na 1 m²**.
Po przypisaniu technologii do budowy i podaniu powierzchni system sam wylicza **plan materiałowy** budowy.

> ℹ️ Plan materiałowy jest **„zamrażany”** w chwili przypisania. Późniejsza zmiana technologii nie zmieni planu budów, które już trwają.

---

## 2. Zakładanie budowy — kreator 6 kroków (Admin)

**Gdzie:** `Budowy` → przycisk **`+ Nowa`**

Na górze widzisz pasek kroków: **Budowa → Technologia → Materiały → Zamówienie → Zdjęcia → Portal**.
Kroki 2–6 są **opcjonalne** — każdy z nich można pominąć przyciskiem `Dalej` i dokończyć później z karty budowy.

### Krok 1 — Budowa (dane podstawowe)

| Pole | Wymagane | Uwagi |
|---|---|---|
| Nazwa budowy | ✅ | np. „Hala magazynowa Kowalski” |
| Numer budowy | ✅ | **musi być unikalny** — system nie pozwoli na duplikat |
| Osoba odpowiedzialna | ✅ | `Wybierz` → wyszukaj pracownika |
| Klient | — | |
| Adres | — | |
| Wartość kontraktu (PLN) | — | potrzebna do analizy marży w Rozliczeniu |
| Data rozpoczęcia | ✅ | |
| Czas trwania — dni robocze | ✅ | system pokaże planowaną datę końca i łączną liczbę godzin |
| Brygada | — | po wyborze system pokaże **planowany koszt robocizny** |

➡️ Naciśnij **`Zapisz i dalej`**. Od tej chwili budowa **już istnieje** w systemie — nawet jeśli przerwiesz kreator.

> 💡 Brak brygad na liście? Dodaj je w `Admin` → **Zespół i dniówka**.

### Krok 2 — Technologia
1. Wybierz technologię z listy.
2. Wpisz **Powierzchnię (m²)**.
3. `Dalej` → system przypisuje technologię i wylicza plan materiałowy.

Bez technologii nie da się później wygenerować zamówienia „z planu”.

### Krok 3 — Materiały (dodatkowe)
Materiały **z magazynu, spoza receptury** (np. taśmy, folia, sprzęt jednorazowy). Opcjonalne.
1. **Materiał / partia** → `Wybierz partię` (widać datę dostawy, cenę i dostępną ilość).
2. **Ilość z tej partii** → `+ Dodaj do listy`.
3. Powtórz dla kolejnych pozycji, potem `Dalej` — materiał zostaje zdjęty z magazynu ogólnego i przypisany do budowy.

### Krok 4 — Zamówienie
Zaznacz **„Wygeneruj zamówienie z planu materiałowego technologii”** → `Dalej`.
System utworzy zamówienie w statusie **Robocze** — do przejrzenia w zakładce `Zamówienia` (patrz rozdz. 3).

### Krok 5 — Zdjęcia
Zaznacz **„Stwórz katalog na Google Drive na zdjęcia z postępu prac”** → `Dalej`.
Bez katalogu brygadzista **nie będzie mógł dodawać zdjęć** z raportu.

### Krok 6 — Portal klienta
Domyślnie **wyłączony**. Włącz tylko, jeśli chcesz od razu przekazać klientowi link / kod QR do podglądu postępu prac.
➡️ **`Zakończ`**.

✅ **Budowa jest gotowa.** Wszystko, co pominąłeś, uzupełnisz z karty budowy (`Budowy` → dotknij budowy).

---

## 3. Zamawianie materiału i przyjęcie dostawy (Admin)

### 3.1 Cykl życia zamówienia

```
 Robocze  ──[Złożono u dostawcy]──▶  Zamówione  ──[Dostawa dotarła → Przyjmij na magazyn]──▶  Przyjęte
    │
    └──[Anuluj]──▶ Anulowane
```

### 3.2 Utworzenie zamówienia z planu
Jeśli nie zrobiłeś tego w kreatorze (krok 4):
`Budowy` → karta budowy → sekcja **ZAMÓWIENIA** → **`+ Z planu`**

> ✅ **Nie bój się kliknąć drugi raz.** System zamawia tylko to, **czego jeszcze brakuje** do planu
> (plan minus to, co już zamówiono). Gdy cały plan jest zamówiony, pokaże komunikat zamiast tworzyć duplikat.
> Dzięki temu po niepełnej dostawie `+ Z planu` utworzy zamówienie **tylko na brakującą resztę**.

### 3.3 Przejrzenie zamówienia (status Robocze)
**Gdzie:** `Zamówienia` → sekcja **Zamówienia z planu budów** → dotknij zamówienia.

1. **Popraw ilości** — dotknij ilości przy pozycji, wpisz nową (np. zaokrąglenie do pełnych opakowań) → `OK`.
2. **Sprawdź, co już masz w magazynie** — przy pozycji może pojawić się zielony napis
   **„Na magazynie: X — pobrać?”**. Dotknij go, aby pokryć tę ilość z magazynu zamiast kupować.
   Dla wszystkich pozycji naraz: **„Uwzględnij stany magazynowe dla wszystkich pozycji”**.
   > Jeśli po tym komunikat brzmi „Cały plan pokrywa magazyn — nie musisz nic zamawiać” — użyj **`Anuluj to zamówienie`**.
3. Wyślij zamówienie do dostawcy (telefon / e-mail — poza systemem).
4. Naciśnij **`Złożono u dostawcy`** → status **Zamówione**.

### 3.4 Przyjęcie dostawy (status Zamówione)
Gdy materiał fizycznie dotrze:
1. Dotknij zamówienia → **`Dostawa dotarła`**.
2. Dla każdej pozycji wpisz **faktyczną ilość** i **faktyczną cenę (PLN)** z dokumentu dostawy.
   > ⚠️ Wpisz to, co **naprawdę przyjechało**, a nie to, co zamówiono. Cena z tego kroku trafia do kosztu budowy.
3. Opcjonalnie: **Nr dokumentu (PZ)** i **Dostawca**.
4. **`Przyjmij na magazyn`** → status **Przyjęte**.

✅ Materiał z zamówienia „z planu” trafia **automatycznie na budowę** (stan „przypisany do budowy”). Brygadzista od razu widzi go w raporcie — nie trzeba niczego dodatkowo przypisywać.

### 3.5 Inne zamówienia
- **Braki magazynowe** — `Zamówienia` pokazuje materiały poniżej progu minimalnego (licznik na ikonie). Obsługa tak samo: `Złożono u dostawcy` → `Dostawa dotarła` → `Przyjmij na magazyn`. Taki materiał trafia do **magazynu ogólnego**, nie na konkretną budowę.
- **Zamówienie ręczne** — `Zamówienia` → **`+ Nowe zamówienie`** → „Zamów materiał spoza listy” → dodaj do koszyka → `Utwórz zamówienie`.

---

## 4. Materiał dodatkowy (spoza planu)

Gdy na budowę trzeba wydać coś z magazynu, czego nie ma w recepturze.

**Admin:** `Budowy` → karta budowy → **MATERIAŁY DODATKOWE** → wybierz partię → ilość → `+ Dodaj do listy` → **`Zatwierdź N materiałów`**.

**Brygadzista** (bezpośrednio z raportu): patrz krok 5.3, punkt „Brakuje materiału na liście?”.

> ℹ️ Wybierasz **konkretną partię** (data dostawy + cena). Jeśli ten sam materiał jest w kilku cenach, kropka ostrzegawcza w Magazynie podpowiada, która partia jest droższa.

---

## 5. Brygadzista: meldowanie zużycia materiału — raport dzienny

> **Złota zasada: raport wysyłasz codziennie, na koniec dnia pracy, i wpisujesz to, co zużyto TEGO DNIA — nie sumę od początku budowy.**

### 5.1 Zasady w pigułce

| Zasada | Co to oznacza w praktyce |
|---|---|
| **Jeden raport = jedna budowa + jeden dzień** | Ponowne otwarcie dzisiejszego raportu tej budowy to **edycja** tego samego raportu, a nie nowy raport. |
| **Wpisujesz zużycie dzienne** | Wczoraj 3 worki, dziś 5 worków → dziś wpisujesz **5**, nie 8. |
| **Raport zawsze ma dzisiejszą datę** | Raportu za wczoraj nie da się „dosłać” z dzisiejszą datą — dlatego raportuj codziennie. |
| **Zapis = zdjęcie materiału ze stanu budowy** | W chwili zapisu materiał staje się kosztem budowy. |
| **Można poprawiać aż do zatwierdzenia** | Po zatwierdzeniu przez Admina raport jest zablokowany na stałe. |
| **Działa bez zasięgu** | Raport zapisany bez internetu wyśle się sam, gdy wróci sieć. |

### 5.2 Rozpoczęcie raportu
1. Menu → **`Raporty`**.
2. Naciśnij **`+ Nowy raport`** w nagłówku.
3. Na górze zobaczysz 3 kroki: **Zużycie → Zespół → Podsumowanie**.

### 5.3 Krok 1 — Zużycie

**a) Wybierz budowę**
Dotknij pola **Budowa** → wybierz z listy (widoczne są tylko budowy aktywne).

**b) Zdjęcia budowy** *(opcjonalnie, ale zalecane)*
W sekcji **ZDJĘCIA BUDOWY** dodaj zdjęcia z postępu prac.
Jeśli widzisz komunikat o braku katalogu — poproś Admina o założenie katalogu zdjęć dla budowy.

**c) Technologia — materiały z planu, etap po etapie**
- Dotknij nazwy etapu, aby go rozwinąć.
- Przy każdym materiale wpisz **ilość zużytą dziś** (przyciski `−` / `+` albo wpisanie liczby).
- Ten sam materiał może występować w **kilku etapach** (np. piasek pod gruntowanie i pod warstwę zamykającą) — wpisz zużycie **osobno w każdym etapie**, w którym go dziś użyto. Dzięki temu procent postępu etapów i koszty są liczone poprawnie.
- Pozycja z dopiskiem **„oczekuje na dostawę”** — materiału nie ma jeszcze na budowie, nie da się go raportować. Zgłoś to Adminowi, jeśli materiał faktycznie jest na placu.
- **Kwadracik obok nazwy etapu** = „etap zakończony”. Zaznacz go, gdy brygada skończy dany etap — klient w portalu zobaczy wtedy 100% dla tego etapu. Pomyłkę można odznaczyć.

**d) Materiały pomocnicze**
Lista materiałów spoza receptury przypisanych do budowy — wpisz zużycie tak samo jak wyżej.
(Gdy lista jest długa, pojawia się wyszukiwarka.)

**e) Brakuje materiału na liście? — „Dodaj materiał z magazynu”**
1. Dotknij **Dodaj materiał z magazynu**.
2. Wyszukaj materiał (np. „tarcze”, „wałki”) i wybierz partię.
3. Wpisz ilość, którą **zabierasz na budowę** → dodaj do listy.
4. Naciśnij **`Przypisz N do budowy`**.
5. Materiał pojawi się w „Materiałach pomocniczych” — **dopiero teraz** wpisz, ile z niego zużyto dziś.

> ⚠️ **Wpisuj zawsze prawdziwe zużycie** — nawet jeśli w systemie jest go „mniej na stanie”. Raport zapisze się zawsze; brakująca ilość zostanie oznaczona jako **niedobór** do wyjaśnienia przez Admina (Ty nic więcej nie robisz). Jeśli jednak wiesz, że materiał przywiozłeś z magazynu — dopisz go przez „Dodaj materiał z magazynu”, wtedy niedoboru nie będzie.

> ⚠️ Przypisanie ≠ zużycie. Przypisanie mówi „ten materiał jest na placu”, zużycie mówi „to zostało dziś wbudowane”. Jeśli przywiozłeś 10 rolek, a zużyłeś 4 — przypisz 10, wpisz zużycie 4. Pozostałe 6 zostaje na budowie na kolejne dni.

> 🗑️ Krzyżyk przy materiale pomocniczym odpina go od budowy i **zwraca całą przypisaną ilość do magazynu**. Używaj tylko przy pomyłce w przypisaniu.

**f) Kilometrówka i Dodatkowe koszty** *(opcjonalnie)*
- **Kilometrówka** — wpisz liczbę przejechanych km (stawkę ustawia Admin).
- **Dodatkowe koszty** — kwota + kategoria: nocleg / parking / zakup / inne (lub własna).

➡️ **`Dalej`**. Jeśli nie wpisałeś żadnego zużycia, system ostrzeże. Dzień bez zużycia materiału? Naciśnij `Dalej` drugi raz.

### 5.4 Krok 2 — Zespół
1. **`Dodaj osobę`** (albo **`Dodaj wszystkich`** z brygady).
2. Dla każdej osoby ustaw godziny **od – do**.
3. `Dalej` (bez osób system ostrzeże — drugi `Dalej` przechodzi mimo to).

### 5.5 Krok 3 — Podsumowanie i zapis
1. Sprawdź listę materiałów, osób, km i kosztów.
2. **Notatka do raportu** *(opcjonalnie)* — wszystko, co warto zapamiętać o tym dniu, np.
   *„Deszcz do 11:00, brygada 2 h krócej”*, *„Czekaliśmy na dostawę kleju”*, *„Na placu zostało 6 rolek siatki”*.
3. Naciśnij **`Zapisz raport dzienny`**.
4. Potwierdzenie: **„Raport zapisany — materiały zdjęte z magazynu, godziny zapisane”**.

> 📶 Komunikat **„Brak połączenia z serwerem — raport wyśle się automatycznie, gdy pojawi się internet”** jest normalny na placu bez zasięgu. **Nie wpisuj raportu drugi raz.** Otwórz aplikację, gdy będziesz w zasięgu.

### 5.6 Poprawianie raportu
1. `Raporty` → dotknij raportu ze statusem **Do edycji**.
2. Zmień ilości / osoby / notatkę.
3. **`Zapisz zmiany`**.

- **Wpisanie mniejszej ilości** niż wcześniej → różnica wraca na stan budowy, dokładnie po tej samej cenie, a koszt budowy się zmniejsza. Nic więcej nie musisz robić.
- **Wpisanie większej ilości** → różnica schodzi ze stanu budowy i powiększa koszt.
- Status **Zatwierdzony** → edycja niemożliwa. Pomyłkę w zatwierdzonym raporcie zgłoś telefonicznie Adminowi.

### 5.7 Przykład z życia

> Budowa **B/2026/014**. Na placu jest 40 worków kleju (dostawa z zamówienia „z planu”).
>
> | Dzień | Co się dzieje | Co wpisuje brygadzista | Stan kleju na budowie |
> |---|---|---|---|
> | Pon | zużyto 12 worków | Klej: **12** | 28 |
> | Wt | zużyto 15 worków | Klej: **15** (nie 27!) | 13 |
> | Wt, wieczorem | okazało się, że 1 worek wrócił do auta | edycja wtorku: **14** → `Zapisz zmiany` | 14 |
> | Śr | brakuje taśmy — bierze 5 rolek z magazynu, zużywa 3 | `Dodaj materiał z magazynu` → Taśma 5 → `Przypisz` → zużycie Taśma **3** | taśma: 2 |

---

## 6. Zatwierdzanie raportów (Admin)

**Gdzie:** `Raporty` (licznik na ikonie = raporty czekające na zatwierdzenie). Karta budowy też pokazuje „N raporty do sprawdzenia”.

1. Otwórz raport — zobaczysz materiały, zespół, godziny, km, koszty i **notatkę brygadzisty**.
2. Przy materiałach, gdzie zużycie odbiega od planu, widać ostrzeżenie **„⚠ Przekracza plan o …”** i ewentualny powód.
3. Wszystko się zgadza → **`Zatwierdź raport`**.
   Coś się nie zgadza → **zadzwoń do brygadzisty**, poproś o poprawkę i zatwierdź dopiero po niej.

> ⚠️ **Zatwierdzenia nie da się cofnąć** — raport zostaje zablokowany także dla Admina.
> ℹ️ Zatwierdzenie **nie zmienia** kosztów ani stanów — to już się stało przy zapisie raportu. Zatwierdzenie to kontrola i **warunek zamknięcia budowy**.

**Podgląd kosztów na bieżąco:** `Rozliczenie` (lub karta budowy → „Koszty na bieżąco”) — aktualizuje się na żywo po każdym raporcie.

---

## 7. Zamknięcie i rozliczenie budowy (Admin)

**Warunek:** wszystkie raporty budowy są zatwierdzone. Inaczej zobaczysz: *„Zatwierdź wszystkie raporty tej budowy, żeby móc ją zamknąć.”*

**Drugi warunek:** stan materiału na budowie musi się „zerować” dla każdego materiału. Jeśli brygadzista zaraportował więcej, niż było przypisane (**niedobór**, stan ujemny), system nie pozwoli zamknąć budowy i pokaże komunikat *„Nie można zamknąć budowy — podmagazyn nie jest wyzerowany: …”* z nazwą materiału i ilością.
→ Rozwiązanie: karta budowy → **MATERIAŁY DODATKOWE** → przypisz brakującą ilość tego materiału z magazynu (rozdz. 4). Saldo wróci do zera.

1. `Budowy` → karta budowy → **`Zamknij i rozlicz budowę`**.
2. Dla każdej pozycji materiału, który **został na budowie** (przypisany, niezużyty), wybierz:
   - **Zwrot na magazyn** — materiał wraca do magazynu ogólnego (po swojej cenie), nie obciąża budowy;
   - **Do wyrzucenia** — wartość doliczy się do kosztu budowy jako **„Straty materiałowe”**.
3. Wpisz **PIN** (zabezpieczenie przed przypadkowym zamknięciem) → `Zatwierdź`.
4. Budowa otrzymuje status **ZAMKNIĘTA** i trafia do Archiwum. Rozliczenie końcowe widać na karcie budowy i w `Rozliczenie`.

Pomyłka? **`Wznów budowę`** — ponowne zamknięcie przeliczy rozliczenie od nowa.

---

## 8. Najczęstsze problemy i pytania

| Problem / pytanie | Przyczyna | Rozwiązanie |
|---|---|---|
| Brygadzista zużył więcej, niż było przypisane do budowy | Materiał przyjechał „bokiem” (z magazynu, z innej budowy) bez przypisania w systemie. | Raport **zapisuje się normalnie**, a różnica jest wyceniana i oznaczana jako **niedobór** (ujemny stan budowy). Brygadzista: najpierw sprawdź, czy nie wpisałeś sumy od początku budowy zamiast zużycia dziennego. Admin: dopisz brakującą ilość przez „Materiały dodatkowe” na karcie budowy — to wyrównuje stan. |
| Materiał w raporcie ma dopisek „oczekuje na dostawę” | Zamówienie nie zostało przyjęte w systemie. | Admin: `Zamówienia` → `Dostawa dotarła` → `Przyjmij na magazyn`. |
| Brygadzista nie widzi budowy na liście | Budowa jest zamknięta. | Admin: `Wznów budowę` (jeśli prace trwają). |
| „Budowa zamknięta — nie można już dodawać raportów” | j.w. | j.w. |
| Nie da się dodać zdjęć z raportu | Brak katalogu zdjęć budowy. | Admin: karta budowy → utwórz katalog na zdjęcia (krok 5 kreatora). |
| `+ Z planu` pokazuje „Cały plan materiałowy jest już zamówiony” | Wszystko z planu jest już w zamówieniach. | To prawidłowe. Na dodatkowy materiał użyj „Materiały dodatkowe” albo zamówienia ręcznego. |
| `+ Z planu` nie jest widoczne | Budowa nie ma przypisanej technologii. | Karta budowy → TECHNOLOGIA → wybierz + m² → `Zapisz plan materiałowy`. |
| Raport wysłany bez zasięgu — czy dotarł? | Raport czeka w kolejce w telefonie. | Otwórz aplikację w zasięgu; raport wyśle się sam. Nie wpisuj go drugi raz. |
| Brygadzista pomylił się w zatwierdzonym raporcie | Raport zatwierdzony jest zablokowany. | Ustalić telefonicznie z Adminem; korektę stanu robi Admin w Magazynie. Dlatego: **czytaj raport przed zatwierdzeniem**. |
| „Nie można zamknąć budowy — podmagazyn nie jest wyzerowany” | Na budowie zostały nierozliczone resztki albo jest niedobór. | Resztki: wybierz zwrot / wyrzucenie. Niedobór: dopisz materiał przez „Materiały dodatkowe” (rozdz. 7). |
| Nie ma raportu za wczoraj | Raport zawsze dostaje dzisiejszą datę. | Raportuj codziennie. Zużycie z pominiętego dnia wpisz w najbliższym raporcie i opisz w **Notatce**. |
| Dwa materiały o prawie tej samej nazwie | Literówka przy zakładaniu materiału. | Admin: ujednolić kartotekę w `Magazyn`. Na przyszłość wybierać podpowiedzi nazw. |

---

## 9. Ściąga na jedną stronę

### 🏢 ADMIN — nowa budowa
1. `Budowy` → **`+ Nowa`**
2. Dane podstawowe → **`Zapisz i dalej`**
3. Technologia + m² → `Dalej`
4. (Materiały dodatkowe) → `Dalej`
5. ☑ Wygeneruj zamówienie z planu → `Dalej`
6. ☑ Katalog na zdjęcia → `Dalej`
7. (Portal klienta) → **`Zakończ`**

### 🚚 ADMIN — zamówienie i dostawa
1. `Zamówienia` → zamówienie **Robocze** → popraw ilości, „Uwzględnij stany magazynowe”
2. Wyślij do dostawcy → **`Złożono u dostawcy`**
3. Przyjechało → **`Dostawa dotarła`** → realna ilość + cena + PZ → **`Przyjmij na magazyn`**
4. Materiał jest automatycznie na budowie ✔

### 👷 BRYGADZISTA — raport dzienny (codziennie, na koniec dnia)
1. `Raporty` → **`+ Nowy raport`**
2. **Zużycie:** budowa → zdjęcia → przy każdym materiale **ilość zużyta DZIŚ** → ☑ etap skończony → km / koszty → `Dalej`
3. **Zespół:** `Dodaj osobę` / `Dodaj wszystkich` → godziny od–do → `Dalej`
4. **Podsumowanie:** sprawdź → notatka → **`Zapisz raport dzienny`**
5. Brak materiału na liście → `Dodaj materiał z magazynu` → `Przypisz` → dopiero wtedy wpisz zużycie
6. Zawsze wpisuj **prawdziwe** zużycie — raport zapisze się nawet przy braku na stanie
7. Pomyłka → otwórz raport „Do edycji” → popraw → `Zapisz zmiany`

### ✅ ADMIN — kontrola i zamknięcie
1. `Raporty` → przeczytaj → **`Zatwierdź raport`** (nieodwracalne!)
2. Niedobory na budowie → „Materiały dodatkowe” → dopisz brakującą ilość
3. Koniec prac → karta budowy → **`Zamknij i rozlicz budowę`** → per resztka: zwrot / wyrzucenie → PIN
