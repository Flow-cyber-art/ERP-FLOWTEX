# Standard UI/UX — Budowy (FLOWTEX)

Ten dokument opisuje obowiązujący standard interfejsu aplikacji, wyprowadzony
z istniejącego kodu (`components/report-ui.tsx` i ekranów w
`components/screens/`). Ma dwa cele:

1. Ujednolicić słownictwo, którym opisujemy elementy UI, żeby nowe funkcje
   od razu trafiały we właściwy wzorzec zamiast wymyślać własny.
2. Być punktem odniesienia przy review — "czy to jest zgodne ze
   standardem?" zamiast oceny "na oko".

Nie jest to specyfikacja wizualna od zera — to spisanie tego, co już
działa w apce, plus zasady, które wypracowaliśmy przy porządkowaniu
panelu Budów.

---

## 1. Zasada nadrzędna: rodzaj interakcji wynika z funkcji

Nie ujednolicamy wszystkich elementów na siłę. W aplikacji są dokładnie
trzy rodzaje klikalnych elementów — każdy ma swoje miejsce i nie zastępuje
pozostałych:

| Wzorzec | Kiedy używać | Wygląd |
|---|---|---|
| **WIERSZ** (klikalna karta/wiersz) | Kliknięcie prowadzi do szczegółów tego samego obiektu (rozwinięcie w miejscu — apka jest jednoekranowym akordeonem, nie ma osobnych podstron) | Treść + strzałka `›` (zwinięty) / `⌄` (rozwinięty), bez tła przycisku |
| **PRZYCISK** | Użytkownik wykonuje konkretną, jednorazową akcję (zapis, wysyłka, generowanie, usunięcie) | Komponent `Button` — wypełnione tło (`primary`) lub obrys (`secondary`) |
| **LINK / akcja tekstowa** | Przejście poza aplikację (Google Drive) albo drobna, drugorzędna czynność pomocnicza | Sam tekst w kolorze akcentu, bez tła i obrysu |

Reguły, których pilnujemy przy review:

- **Nie robimy całej karty klikalnej, jeśli w środku są niezależne akcje.**
  Przykład: karta zamówienia w stanie „robocze” ma wiersz-nagłówek
  (klik → szczegóły) ORAZ osobne przyciski „Złożono u dostawcy” / „Anuluj”
  wewnątrz rozwiniętej treści — to nie koliduje, bo przyciski żyją
  *wewnątrz* rozwiniętego wiersza, nie na tej samej, jednocześnie klikalnej
  powierzchni co nagłówek.
- **Nie dublujemy tej samej funkcji wierszem i osobnym przyciskiem.**
  Przykład antywzorca, który poprawiliśmy: sekcja "Technologia" miała
  klikalny wiersz + osobny przycisk tekstowy "Zmień" robiący dokładnie to
  samo. Zostaje jedno albo drugie, nigdy oba na raz.
- **Link zewnętrzny zawsze ma `↗`.** To jedyny sygnał w tej apce, że
  użytkownik zaraz opuści aplikację (np. „Otwórz folder zdjęć ↗” →
  Google Drive). Bez niego dwa wizualnie podobne elementy (wiersz
  rozwijający szczegóły vs. link wychodzący na zewnątrz) są nie do
  odróżnienia.

---

## 2. Komponenty współdzielone (`components/report-ui.tsx`)

Zanim zbudujesz coś "od zera" w konkretnym ekranie — sprawdź, czy nie ma
tego już tutaj.

### `Button`
```tsx
<Button label="Zapisz" onPress={...} />
<Button label="Anuluj" secondary onPress={...} />
<Button label="Usuń" fullWidth disabled={busy} onPress={...} />
```
- Domyślnie: tło `COLORS.primary`, tekst w kolorze tła (kontrast) — **akcja
  główna** danego kontekstu (max jedna na widoczny obszar).
- `secondary`: obrys zamiast wypełnienia — akcja **równorzędna, ale nie
  pierwsza z brzegu** (np. "Anuluj" obok "Zatwierdź").
- Nigdy nie ma trzeciego wariantu koloru "na czerwono" dla akcji
  niszczących — te idą przez `confirmAction` (patrz niżej), sam przycisk
  zostaje `secondary` lub zwykłym tekstem w `COLORS.danger`.

### `Field` / `QuantityStepper`
Standardowe pole tekstowe i stepper ilości (−/wpisz/+). Używane wszędzie,
gdzie wpisuje się ilość (magazyn, budowy, zamówienia) — nie robimy
osobnego `TextInput` z ręcznym stylowaniem.

### `StatusBadge`
```tsx
<StatusBadge status="ok" label="Zatwierdzony" />
<StatusBadge status="warning" label="Do sprawdzenia" />
<StatusBadge status="danger" label="Anulowane" />
```
Jedyny sposób sygnalizowania stanu (kropka + etykieta). Trzy stany:
`ok` (zielony), `warning` (pomarańczowy), `danger` (czerwony). Nie
mieszamy z emoji ani kolorowanym samym tekstem.

### `IconBadge`
Okrągła plakietka z ikoną `MaterialIcons` — wizualna kotwica wiersza
(budowa / raport / materiał), gdy sam tekst to za mało.

### `DetailSection`
```tsx
<DetailSection label="Zespół" count={`${n} osoby · ${h} godz.`}>
  {...}
</DetailSection>
```
Nagłówek sekcji ze stałym rytmem odstępu (`marginTop: 24`) — używany do
grupowania treści **informacyjnej**, nie klikalnej (np. „Koszty na
bieżąco”). Separator MIĘDZY pozycjami wewnątrz sekcji jest gestem
wywołującego (borderTop na każdym wierszu) — celowo nie ma go między
całymi sekcjami, tylko odstęp (zasada Gestalt: bliskość = przynależność).

### `confirmAction` / `notify`
```ts
confirmAction("Anulować zamówienie?", "…", "Anuluj zamówienie", () => cancel());
notify("Nie udało się wysłać zdjęć", message);
```
Jedyny sposób pytania o potwierdzenie akcji nieodwracalnej/kosztownej
(anulowanie, usunięcie, zamknięcie budowy) i jedyny sposób pokazania
komunikatu błędu. **Nigdy** `Alert.alert` bezpośrednio — na webie jest
no-opem (patrz komentarz w kodzie), więc trzeba przejść przez te funkcje.

### `ScreenHeader`
Nagłówek ekranu: duży tytuł + opcjonalny opis + jeden przycisk akcji w
prawym górnym rogu (np. „+ Nowa”). Nie stawiamy dwóch przycisków akcji w
nagłówku — jeśli potrzeba więcej niż jednej akcji na starcie ekranu, to
znak, że któraś powinna zejść niżej, bliżej kontekstu, którego dotyczy.

---

## 3. Wzorzec: lista klikalnych wierszy

Dotyczy: Materiały dodatkowe, Zamówienia, Raporty (i każdej przyszłej listy
obiektów tego samego typu w karcie budowy).

```
NAGŁÓWEK SEKCJI (n)                    + Akcja tworząca

Pozycja 1                        [badge]   ›
Pozycja 2                        [badge]   ›
```

Zasady:

- **Nagłówek sekcji** = etykieta wielkimi literami + licznik w nawiasie,
  **nietekstowa** (nie jest przyciskiem/linkiem), chyba że cała sekcja
  ma sens jako jeden zbiorowy akordeon (patrz `Raporty` niżej).
- **Akcja tworząca nowy element** (np. „+ Przypisz materiał”,
  „+ Z planu”) stoi obok nagłówka, jako osobna akcja tekstowa —
  niezależna od tego, czy lista jest pusta czy rozwinięta.
- **Każdy wiersz listy jest samodzielnie klikalny** i rozwija/pokazuje
  swoje własne szczegóły — nie ma jednego wspólnego zwijania/rozwijania
  całej listy naraz (wyjątek: `Raporty`, patrz niżej). Dzięki temu
  otwarcie jednej pozycji nie chowa reszty.
- Stan zwinięty: strzałka `›`. Stan rozwinięty: `⌄`. Kolor:
  `COLORS.primary`.
- Jeśli wiersz w rozwiniętym stanie zawiera własne przyciski akcji
  (np. „Złożono u dostawcy”, „Anuluj”) — to nie jest sprzeczne z tym, że
  cały nagłówek wiersza jest klikalny: klik w nagłówek rozwija/zwija,
  przyciski w środku wykonują akcję. Nie stawiamy przycisku akcji w tym
  samym poziomym pasku, co klikalny nagłówek wiersza.

**Wyjątek: `Raporty`.** Cała sekcja ma nagłówek-akordeon
(`RAPORTY (n) ▼/▲`), bo lista raportów bywa długa i domyślnie chowana w
całości ma sens (rzadko przegląda się wszystkie na raz). Wewnątrz,
każdy raport (`ReportCard`) jest z kolei samodzielnym klikalnym wierszem
z własnym `›`/`⌄`. Te dwa poziomy zwijania nie są tym samym wzorcem i nie
należy ich mylić przy kopiowaniu kodu do nowych sekcji.

---

## 4. Wzorzec: pojedynczy obiekt "1:1" z budową (nie lista)

Dotyczy: Technologia.

Gdy w karcie budowy jest dokładnie **jeden** powiązany obiekt (a nie lista),
cały blok jest jednym klikalnym wierszem prowadzącym do jego
przypisania/zmiany — bez osobnego przycisku "Zmień" obok:

```
ETYKIETA

Treść / wartość
Metadane                                    ›
```

Jeśli obiekt jeszcze nie istnieje (np. brak przypisanej technologii),
wiersz nadal jest klikalny i tekst wprost mówi, co się stanie po
kliknięciu (np. „Brak przypisanej technologii — dotknij, żeby
przypisać.”), zamiast osobnego przycisku „Przypisz” obok pustego stanu.

---

## 5. Wzorzec: sekcja czysto informacyjna

Dotyczy: Koszty na bieżąco / Rozliczenie końcowe.

```
NAGŁÓWEK

Etykieta wiersza                          Wartość
Etykieta wiersza                          Wartość
────────────────────────────────────────────────
RAZEM                                     Wartość
```

- Wartości **nie są klikalne**, jeśli nie prowadzą do dodatkowych
  szczegółów. Sama liczba nie potrzebuje interakcji tylko dlatego, że
  "wygląda ważnie".
- Suma/razem oddzielona linią (`borderTopWidth: 1`) i pogrubiona — to
  jedyny wizualny akcent w tej sekcji, bez kolorowania na zielono/czerwono
  (to zarezerwowane dla `StatusBadge`).
- Buduj przez `DetailSection`, nie przez ręczny nagłówek.

---

## 6. Wzorzec: hierarchia akcji zależna od scenariusza użytkownika

Ten sam typ danych (zdjęcia budowy) ma **dwa różne układy** w zależności od
tego, kto patrzy — i to jest zamierzone, nie niespójność do naprawienia:

**Panel administratora** (`builds-screen.tsx`) — admin najpierw *sprawdza*
to, co już jest wysłane:
```
Otwórz folder zdjęć ↗   (duża, wyróżniona karta — akcja najczęstsza)
        ↓
+ Dodaj zdjęcia z galerii   (przycisk)
        ↓
📷 Zrób zdjęcie   (mała, drugorzędna akcja tekstowa — najrzadsza)
```

**Panel brygadzisty** (`report-screen.tsx`) — brygadzista najpierw
*dokłada* zdjęcia, nie ma powodu wychodzić do Drive:
```
+ Dodaj zdjęcia z galerii   (przycisk)
        ↓
📷 Zrób zdjęcie   (przycisk, równorzędny)
```

**Zasada ogólna:** kolejność i wielkość akcji w danej sekcji odzwierciedla,
która czynność jest tam najczęstsza dla TEJ roli, a nie jeden uniwersalny
układ narzucony wszystkim. Komponent może być współdzielony (`variant`
prop, patrz `BuildPhotosSection`), ale układ — nie musi.

Konsekwencje praktyczne z tego akurat przypadku (do powielania gdziekolwiek
indziej pojawi się podobny "widok czegoś zewnętrznego"):

- Nazwa akcji mówi, co user **dostanie** ("Otwórz folder zdjęć ↗"), nie co
  system **zrobi w tle** ("Zmień link"). Jeśli nazwa akcji brzmi jak
  operacja techniczna, a nie efekt dla użytkownika — to sygnał do zmiany.
- Rzadka czynność konserwacyjna (poprawienie błędnie wpisanego linku) nie
  znika, ale zostaje zminimalizowana wizualnie (mały, wyciszony tekst w
  rogu — "Edytuj link"), zamiast konkurować o uwagę z główną akcją.
- Miniaturki/podglądy nie są dublowane w apce, jeśli docelowe miejsce
  (Google Drive) i tak je pokazuje poprawnie — po co utrzymywać dwa
  źródła prawdy dla tego samego widoku.

---

## 7. Kolory (`COLORS`, `components/report-ui.tsx`)

Jedno źródło prawdy dla kolorów — nigdy hexy wpisane ręcznie w danym
ekranie, zawsze `COLORS.*`.

| Token | Użycie |
|---|---|
| `COLORS.primary` (`#E2A73B`) | Akcje główne, aktywne stany, strzałki `›`/`⌄`, wartości pieniężne wyróżnione |
| `COLORS.background` (`#1B1B1D`) | Tło ekranu, pola formularzy |
| `COLORS.surface` (`#242427`) | Tło kart (`bg-surface`) |
| `COLORS.foreground` (`#F8F5EE`) | Tekst główny |
| `COLORS.muted` (`#A8A39A`) | Etykiety, tekst drugorzędny, nagłówki sekcji |
| `COLORS.border` (`#3A3A3D`) | Obrysy, separatory (`borderTopWidth: 1`) |
| `COLORS.success` / `successBg` | `StatusBadge status="ok"`, komunikaty powodzenia |
| `COLORS.warning` / `warningBg` | `StatusBadge status="warning"`, ostrzeżenia nie-blokujące |
| `COLORS.danger` / `dangerBg` | `StatusBadge status="danger"`, akcje niszczące, błędy |

Zasada: kolor **zawsze** niesie znaczenie stanu (sukces/ostrzeżenie/błąd)
albo hierarchii (primary = ważniejsze, muted = mniej ważne). Nie używamy
koloru wyłącznie dekoracyjnie.

---

## 8. Odstępy i separatory

Powtarzalny wzorzec sekcji wewnątrz rozwiniętej karty budowy:

```tsx
<View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border }}>
  ...
</View>
```

Każda kolejna sekcja (Technologia → Zamówienia → Materiały dodatkowe →
Zdjęcia → Koszty) używa dokładnie tego odstępu i separatora — nowa sekcja
w tym miejscu w kodzie kopiuje ten sam wzorzec, nie wymyśla własnego
marginesu "bo wygląda OK".

Wewnątrz listy wierszy (Materiały dodatkowe, pozycje zamówienia) —
mniejszy odstęp między pozycjami: `marginTop: 10, paddingTop: 10`.

---

## 9. Wzorzec: jeden formularz/panel edycji na raz

W obrębie jednej karty budowy tylko **jeden** formularz edycji/przypisania
może być otwarty naraz (technologia, materiały dodatkowe, zdjęcia —
edycja linku, zamknięcie budowy). Stan trzymany jako
`useState<string | null>` z id aktualnie edytowanego obiektu, nie jako
osobny `boolean` per wiersz. Otwarcie nowego panelu **nie musi** jawnie
zamykać innych — to celowe uproszczenie tego ekranu, nie ogólna zasada do
kopiowania bez zastanowienia gdzie indziej.

---

## 10. Checklist przy dodawaniu nowego elementu UI

1. Czy to prowadzi do szczegółów tego samego obiektu? → **WIERSZ** (`›`/`⌄`).
2. Czy to wykonuje konkretną akcję (zapis/wysyłka/usunięcie)? → **PRZYCISK**
   (`Button`, `secondary` jeśli drugorzędny).
3. Czy to wyprowadza użytkownika poza aplikację? → **LINK** z `↗`.
4. Czy ta sama funkcja jest już dostępna innym elementem w tym samym
   widoku? Jeśli tak — usuń duplikat, zostaw jeden.
5. Czy używam gotowego komponentu z `report-ui.tsx` zamiast pisać własny
   `TextInput`/przycisk/plakietkę od zera?
6. Czy kolor, który dodaję, niesie znaczenie stanu, czy jest tylko
   dekoracją? Jeśli dekoracja — użyj `COLORS.muted`/`COLORS.foreground`.
7. Czy hierarchia i kolejność akcji odpowiada temu, co ta konkretna rola
   (Admin / Brygadzista / Pracownik) robi najczęściej w tym miejscu —
   a nie jednemu uniwersalnemu układowi skopiowanemu z innego panelu?
