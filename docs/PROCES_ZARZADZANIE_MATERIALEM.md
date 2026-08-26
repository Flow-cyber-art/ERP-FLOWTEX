# Proces: Zarządzanie materiałem — przepływ i porównanie z best practice

Dokument analityczny — opisuje **cały** przepływ materiału w aplikacji
(magazyn ogólny → plan technologiczny → zamówienie → dostawa → przypisanie
do budowy → zużycie → zwrot/strata), wprost z kodu i migracji SQL, a
następnie zestawia go z dobrymi praktykami ERP/WMS dla branży budowlanej.
**Żadna zmiana w aplikacji nie została tu wprowadzona.** Część kroków jest
już opisana fragmentarycznie w `docs/PROCES_CYKL_ZYCIA_BUDOWY.md` (§2.2–2.8)
i `docs/PROCES_RAPORTOWANIE_BRYGADZISTA.md` — tu są zebrane w jednym miejscu
z punktu widzenia samego materiału, nie cyklu budowy, i uzupełnione o
porównanie z branżowym standardem.

---

## 1. Model danych

| Tabela | Rola |
|---|---|
| `materials` | Kartoteka materiału: nazwa, indeks (unikalny), jednostka, `stock` (suma dostępna), `min` (próg alarmowy), `unitPrice` (cena orientacyjna/ostatnia). |
| `material_batches` | Realne partie magazynu ogólnego — ilość **dostępna** (nie „przyjęta minus zużyta", tylko żywa wartość), cena, data przyjęcia, źródło, dokument, dostawca. FIFO: `fn_consume_fifo` zmniejsza/usuwa wiersz przy zejściu do zera. |
| `technology_materials` → `build_material_plan` | Plan materiałowy budowy — zamrożony snapshot w momencie przypisania technologii (etap → materiał → planowana ilość). |
| `orders` / `order_items` | Zamówienia do dostawcy — nagłówek + pozycje, status `robocze → zamówione → przyjęte` (+ `anulowane`). |
| `build_material_lots` | Pula materiału **przypisanego do konkretnej budowy**, jeszcze nie zużytego — osobny etap między „w magazynie" a „kosztem budowy". |
| `report_material_lots` | Z którego lota ile faktycznie zeszło przy danym raporcie — podstawa dokładnego zwrotu (FIFO/LIFO) przy korekcie. |
| `build_material_returns` | Zwrot na magazyn albo odpis jako strata przy zamknięciu budowy. |

---

## 2. Przepływ end-to-end

```
[Materiał w kartotece] --create_material--> [materials + 1. partia]
        |
        v
[Technologia przypisana do budowy] --assign_technology_to_build-->
        [build_material_plan — zamrożony plan: etap × materiał × ilość]
        |
        v
"+ Z planu" --generate_order_from_plan-->
        [orders/order_items status=robocze] --"Złożono u dostawcy"-->
        [status=zamówione] --"Dostawa dotarła"/receive_order-->
        [material_batches: nowa partia] + [build_material_lots: auto, dla zamówień z planu]
        |                                            |
        |                                            v
        |                              [+ Przypisz materiał (ręcznie, poza planem)]
        |                              --assign_material_batches_to_build-->
        |                              [build_material_lots += / material_batches -=]
        v
[Raport dzienny brygadzisty] --submit_daily_report-->
        FIFO z build_material_lots  ==>  build_materials.actualCost (koszt budowy NA BIEŻĄCO)
        korekta w dół ==> dokładny zwrot do lota/ceny źródłowej (LIFO), report_material_lots
        |
        v
[Zamknięcie budowy] --close_build-->
    per pozostała partia w build_material_lots: zwrot na magazyn (material_batches)
                                            albo odpis jako "Straty materiałowe"
```

Kluczowa cecha modelu: materiał ma **trzy**, nie dwa, stany posiadania —
„w magazynie ogólnym" (`material_batches`) → „przypisany do budowy, jeszcze
nie zużyty" (`build_material_lots`) → „zużyty / koszt budowy"
(`build_materials.actualCost`). To rozróżnienie jest świadome (patrz
`PROCES_RAPORTOWANIE_BRYGADZISTA.md` §1 pkt 2) i — jak niżej — dobrze
odpowiada standardowemu modelowi WMS „allocate → issue".

---

## 3. Porównanie z best practice (ERP/WMS dla budownictwa)

### 3.1 To, co jest zgodne z dobrą praktyką

- **Śledzenie partiami (lot/batch tracking) z realną ceną per partia**,
  nie jedną uśrednioną ceną materiału. To standard w WMS — pozwala liczyć
  koszt budowy po cenie faktycznie zapłaconej, nie po średniej, i widać to
  w UI (kropka ostrzegawcza przy partii droższej niż najtańsza dostępna,
  `warehouse-screen.tsx`).
- **FIFO przy zejściu ze stanu** (`fn_consume_fifo`, `fn_consume_build_lot_fifo`)
  — standardowa metoda wyceny rozchodu, zgodna z tym, jak fizycznie
  najczęściej rotuje materiał budowlany (starsze dostawy schodzą pierwsze).
- **Rozdzielenie „przyjęcia" (allocation) od „zużycia" (issue/consumption)**
  — `build_material_lots` jako etap pośredni między magazynem a kosztem
  budowy to dokładnie wzorzec WMS „reserve/allocate to job → issue to job
  cost" znany z modułów Inventory/Project Costing w SAP, Dynamics czy
  branżowych ERP budowlanych (np. Procore, CMiC). Wielu prostszych
  systemów pomija ten krok i liczy koszt już w momencie zamówienia — tu
  jest to zrobione poprawniej.
- **Zamrożony plan materiałowy per budowa** (`build_technology_snapshot`)
  — odpowiednik BOM (Bill of Materials) „as planned", niezależny od
  późniejszych zmian receptury technologii. To standardowa ochrona przed
  tym, żeby zmiana globalnej normy zużycia nie przepisała cichcem budżetu
  budowy w toku.
- **Dokładny zwrot do partii źródłowej przy korekcie** (Decyzja A,
  `PROCES_RAPORTOWANIE_BRYGADZISTA.md` §4) — lepsze niż typowe uproszczenie
  „zwróć po aktualnej cenie średniej"; zachowuje integralność kosztu FIFO.
- **Rejestr strat materiałowych przy zamknięciu budowy** (Decyzja C) —
  odpowiednik „scrap/shrinkage tracking", z rozróżnieniem zwrot vs. odpis;
  bez tego koszt „zniknięcia" materiału byłby niewidoczny w rozliczeniu.
- **Ostrzeżenie przed duplikatem nazwy przy zakładaniu materiału**
  (`matchMaterialNames` w `warehouse-screen.tsx` i `orders-screen.tsx`) —
  dobra praktyka higieny kartoteki materiałowej (master data governance),
  choć realizowana tylko jako podpowiedź UI, nie twardy constraint.
- **Automatyczne dociągnięcie brakującej ilości zamiast duplikatu**
  (Ryzyko 5, wariant 3 w `PROCES_CYKL_ZYCIA_BUDOWY.md`) — to właściwie
  uproszczona wersja **MRP net requirements calculation** (planowana ilość
  minus już zamówiona/w drodze = do zamówienia), zaimplementowana wprost
  w RPC. Dobrze zrobione jak na zakres tej aplikacji.

### 3.2 Luki względem standardowego WMS/ERP

| Obszar | Best practice | Stan w aplikacji |
|---|---|---|
| **Identyfikacja materiału przy przyjęciu** | Dopasowanie po unikalnym kluczu (SKU/ID, kod kreskowy) — nigdy po tekście. | `receive_order` dopasowuje po `name` (`where name = ... limit 1`), gdy brak `linked_material_id`. Literówka/duplikat nazwy = dostawa trafia do złego wiersza albo `v_material_id = null` bez jawnego odrzucenia. Opisane jako Ryzyko 6 w `PROCES_CYKL_ZYCIA_BUDOWY.md`. |
| **Reorder point / uzupełnianie zapasu** | Próg minimalny + **automatyczna sugestia zamówienia** (reorder suggestion), często z uwzględnieniem lead time dostawcy i zapasu bezpieczeństwa. | Jest tylko próg `min` i wizualne oznaczenie na czerwono/warning (`m.stock <= m.min`) oraz licznik "niski" na ekranie startowym. Materiał magazynu ogólnego (poza planem budowy) nie generuje żadnej sugestii/zamówienia automatycznie — inicjatywa zamówienia zawsze ręczna. Brak pojęcia lead time czy zapasu bezpieczeństwa w modelu danych. |
| **Kartoteka dostawcy** | Osobna encja `suppliers` z danymi kontaktowymi, warunkami płatności, historią cen/terminowości. | `supplier` to wolne pole tekstowe na partii (`material_batches.supplier`) — brak master data, brak porównania dostawców, brak wykrywania literówek w nazwie dostawcy (ten sam problem jak przy nazwach materiałów, ale bez nawet podpowiedzi). |
| **Trzy-drogowe dopasowanie (3-way match)** | Zamówienie ↔ dostawa ↔ faktura — rozbieżność ilości/ceny wymaga jawnej akceptacji. | Jest dwudrogowe (zamówienie ↔ przyjęcie): Admin poprawia ilość/cenę przy przyjęciu, ale to nadpisanie, nie zestawienie z zaplanowaną wartością i alarm przy rozbieżności. Brak modułu faktur w ogóle. |
| **Audyt/uzasadnienie korekty stanu** | Korekta ręczna wymaga powodu (reason code) i zostawia ślad audytowy (kto, kiedy, dlaczego, ile). | `adjustMaterialStock`/`updateMaterialStock` dopisuje partię źródła `"korekta"` (albo `fn_consume_fifo` przy spadku) — ślad ilościowy jest (partia w `material_batches`), ale nie ma pola z powodem ani jawnego „kto skorygował" poza ogólnym logiem zmian roli Admin. |
| **Lokalizacje/strefy magazynowe** | Wiele lokalizacji, regały/strefy, materiał przypisany do miejsca składowania. | Model jednomagazynowy — `materials.stock` to jedna, płaska liczba dla całej firmy. Brak pojęcia lokalizacji nawet jako proste pole tekstowe. Uzasadnione przy jednym magazynie/placu, ale warto mieć świadomość ograniczenia przy ewentualnym drugim punkcie składowania. |
| **Kody kreskowe / skanowanie** | Przyjęcie i wydanie materiału skanem, nie ręcznym wpisywaniem ilości. | Brak — wszystko ręczne wpisywanie w formularzach (React Native/Expo, mobilnie, ale bez integracji skanera). Realne ryzyko pomyłki przy większym wolumenie pozycji. |
| **Cykliczna inwentaryzacja (cycle counting)** | Regularne, częściowe liczenie fizyczne z automatycznym porównaniem do stanu systemowego i raportem rozbieżności. | Brak wbudowanego procesu — korekta stanu jest możliwa (`adjustMaterialStock`) ale ad-hoc, bez harmonogramu, bez raportu "system vs. liczenie fizyczne". |
| **Ownership przypisania materiału do budowy** | Wydanie materiału na konkretną budowę weryfikuje, że wydający/wydany ma uprawnienie do TEJ budowy (job-level access control). | Brak — opisane już jako Ryzyko 4 w `PROCES_CYKL_ZYCIA_BUDOWY.md`: każdy Brygadzista może teoretycznie zdjąć materiał z dowolnej budowy, nie tylko swojej. Dziś nieszkodliwe (jedna brygada), ale odstaje od standardu przy skalowaniu. |
| **Prognozowanie zapotrzebowania (demand forecasting)** | Zapotrzebowanie liczone z harmonogramu wielu budów naraz, uwzględniające materiał współdzielony między placami. | Plan materiałowy jest per budowa (z technologii), bez zagregowanego widoku "ile łącznie X trzeba zamówić na wszystkie aktywne budowy w tym miesiącu". Przy jednej budowie na raz to nieistotne — przy równoległych budowach będzie brakować takiego widoku. |
| **Wycena rozchodu przy braku pokrycia partiami** | Rozchód nie powinien nigdy zejść poniżej zera bez jawnej informacji o braku pokrycia. | ✅ Zgodne — sprawdzone w kodzie: `fn_consume_fifo` i `fn_consume_build_lot_fifo` (`001_rpc_functions.sql`, `009_faza5_reczny_wybor_partii.sql`, `035_dokladny_zwrot_partii.sql`) liczą `v_remaining` po przejściu wszystkich partii i **jawnie odrzucają** operację (`raise exception 'Za mało towaru na stanie...'`), gdy dostępnych partii nie starcza — żadnego cichego ujemnego stanu. |

---

## 4. Ocena ogólna

Rdzeń przepływu (plan z technologii → zamówienie → partia → przypisanie do
budowy → zużycie FIFO → zwrot/strata przy zamknięciu) jest **zaprojektowany
solidnie i zgodnie z dobrą praktyką WMS/ERP** jak na skalę firmy budowlanej
z jedną-kilkoma równoległymi budowami: partiowanie z realną ceną, FIFO,
rozdzielenie alokacji od zużycia i zamrożony BOM to elementy, które w wielu
mniejszych systemach ERP w ogóle nie występują.

Luki, które są widoczne, to w większości **typowe dla systemu, który
świadomie nie skalował się jeszcze do „pełnego" WMS**: brak kart dostawców,
brak automatycznych sugestii zamówień z uwzględnieniem lead time, brak
skanowania, brak cyklicznej inwentaryzacji, brak lokalizacji magazynowych.
Żadna z nich nie jest krytyczna przy dzisiejszej skali (jeden magazyn, mała
zaufana firma). Integralność danych ilościowych jest pilnowana poprawnie —
`fn_consume_fifo`/`fn_consume_build_lot_fifo` twardo odrzucają rozchód bez
pokrycia, więc ujemny stan magazynowy nie może powstać cicho.

Jedna luka zasługuje na uwagę wyraźnie wcześniej niż reszta, bo dotyczy
integralności danych, nie tylko wygody: **dopasowanie materiału po nazwie
przy przyjęciu dostawy** (Ryzyko 6, `PROCES_CYKL_ZYCIA_BUDOWY.md`) —
jedyne miejsce w łańcuchu, gdzie brak twardego klucza (SKU/ID) może realnie
i cicho skierować dostawę do złego wiersza magazynowego.

Reszta różnic względem pełnego WMS to świadome uproszczenia adekwatne do
skali — nie błędy projektowe.
