# FLOWTEX ERP — Moduł Magazyn / Materiały

## Specyfikacja implementacyjna v1.0

> **ZASADA NADRZĘDNA:** aplikacja dla małej firmy. Brak formalnych dokumentów magazynowych, brak zamykania miesiąca. Cel systemu: **mieć DANE**, nie papiery rozliczeniowe. Każda funkcja, która nie służy zbieraniu danych o koszcie i zużyciu — nie wchodzi.

* * *

## 1. Model pojęciowy

```
INDEKS (Material)
   └── PARTIA (Batch)            ← indeks + lot + przyjęcie + cena
          └── PRZYPISANIE (Allocation) → podmagazyn budowy (WIP)
                 └── ZUŻYCIE (ConsumptionAllocation) → KOSZT BUDOWY

TECHNOLOGIA → WARSTWY → materiały z normą (kg/m² + % strat)
BUDOWA → podmagazyn + raporty per warstwa + koszty dodatkowe
```

**Lokalizacje zapasu:** `MAIN` (jeden magazyn główny) | `SITE:{id}` (podmagazyn budowy)

* * *

## 2. Encje

### 2.1 `materials` — indeks materiałowy

| Pole | Typ | Uwagi |
| --- | --- | --- |
| id | uuid PK |  |
| code | varchar UNIQUE | **indeks** — klucz biznesowy |
| name | varchar | atrybut opisowy, **NIE część klucza tożsamości** |
| kind | enum | `CONSUMABLE` | `TOOL` |
| base_unit | enum | `KG` | `L` | `PCS` | `MB` — **per indeks** |
| group_id | fk | grupa asortymentowa |
| dwu_file_id | fk null | Deklaracja Właściwości Użytkowych |
| is_active | bool |  |

> Kolory/odcienie = **osobne indeksy**.

### 2.2 `batches` — partia (rdzeń modelu)

| Pole | Typ | Uwagi |
| --- | --- | --- |
| id | uuid PK |  |
| material_id | fk |  |
| lot | varchar null | nr partii dostawcy |
| receipt_id | fk | zdarzenie przyjęcia |
| unit_price | decimal(12,4) | **NIEZMIENNA** |
| package_size | decimal null | przelicznik opakowania **na partii** |
| received_at | timestamp | **klucz sortowania FIFO** |
| expiry_date | date null |  |
| attest_file_id | fk null | atest dla lotu |
| qty_initial | decimal |  |
| qty_main | decimal | stan w magazynie głównym |

**Klucz tożsamości:** `material_id + lot + receipt_id + unit_price`  
**Reguła:** ten sam indeks + inna cena ⇒ **nowa partia**.  
**Reguła:** `unit_price` jest **immutable** — brak korekt ceny w całym systemie.

### 2.3 `receipts` — przyjęcie

| Pole | Typ |
| --- | --- |
| id, receipt_date, supplier_id, invoice_no, target_location, created_by |  |

> Jeden typ zdarzenia — **nieważne gdzie fizycznie**. Jedna faktura na wiele budów → rozdzielana **na loty**.

### 2.4 `technologies` / `technology_layers` / `layer_materials`

| `layer_materials` | Typ | Uwagi |
| --- | --- | --- |
| layer_id, material_id | fk |  |
| norm_per_m2 | decimal | **norma bazowa** |
| waste_pct | decimal | **osobny narzut strat** |
| unit | enum | jednostka w technologii |

`layers`: `seq`, `name`, `area_m2` (własne m² per warstwa)
**Zapotrzebowanie:** `area_m2 × norm_per_m2 × (1 + waste_pct/100)`

### 2.5 `sites` — budowa

| Pole | Typ |
| --- | --- |
| id, name, client_id, technology_id, area_m2 |  |
| status | enum: `ACTIVE` | `CLOSED_OPERATIONALLY` | `CLOSED_FINANCIALLY` | `ARCHIVED` |
| parent_site_id | fk null — **budowa-matka** dla zleceń serwisowych |
| is_service_order | bool |

### 2.6 `allocations` — przypisanie = stan podmagazynu (WIP)

| Pole | Typ | Uwagi |
| --- | --- | --- |
| id, site_id, batch_id |  |  |
| qty_allocated | decimal |  |
| qty_remaining | decimal | **stan na budowie** |
| unit_price_fixed | decimal | ⭐ **FIXACJA** — kopia ceny |
| allocated_at | timestamp | **klucz FIFO na budowie** |
| transfer_group_id | uuid null | znacznik transferu budowa→budowa |

> `unit_price_fixed` jest kopiowane z partii i **nigdy się nie zmienia**.

### 2.7 `consumption_reports` + `consumption_lines` + `consumption_allocations`

| `consumption_reports` |  |
| --- | --- |
| id, site_id, layer_id, report_date, created_by, status: `DRAFT` | `CLOSED` |  |

| `consumption_lines` |  |
| --- | --- |
| id, report_id, material_id, qty_packages, qty_remainder, **qty_base** (wyliczone) |  |

| `consumption_allocations` | ⭐ rozbicie FIFO |
| --- | --- |
| id, line_id, allocation_id, qty, unit_price, value |  |

> **KRYTYCZNE:** relacja `consumption_lines` → `consumption_allocations` jest **1:N**.  
> Jeden raport brygadzisty ≠ jedna pozycja kosztowa.

### 2.8 `stock_movements` — jedna księga ruchów (audyt)

| Pole | Typ |
| --- | --- |
| id, batch_id, material_id, qty (+/−), from_location, to_location |  |
| type | enum: `RECEIPT` | `ALLOCATION` | `CONSUMPTION` | `RETURN` | `DISPOSAL` | `CORRECTION` |
| unit_price, value, site_id, ref_id, transfer_group_id, created_by, created_at |  |

**Niezmiennik:** `stan = SUM(movements.qty)` dla danej partii i lokalizacji.

### 2.9 `additional_costs`

| Pole | Typ |
| --- | --- |
| id, site_id, amount, description, source: `BRIGADE` | `SITE_CLOSING`, created_by, created_at |  |

* * *

## 3. Algorytm FIFO (przymus)

> **Nikt nie wybiera partii** — ani brygadzista, ani admin. System zawsze bierze najstarszą.

### 3.1 Przypisanie magazyn → budowa

```
allocate(material_id, site_id, qty_requested):
    batches = SELECT * FROM batches
              WHERE material_id = ? AND qty_main > 0
              ORDER BY COALESCE(expiry_date, '9999-12-31'), received_at   -- FEFO → FIFO
    remaining = qty_requested
    for b in batches:
        take = min(remaining, b.qty_main)
        b.qty_main -= take
        INSERT allocations(site_id, batch_id, qty_allocated=take,
                           qty_remaining=take, unit_price_fixed=b.unit_price)
        INSERT stock_movements(type=ALLOCATION, MAIN → SITE:id, qty=-take)
        remaining -= take
        if remaining == 0: break
    if remaining > 0: → ostrzeżenie dla admina (brak stanu)
```

### 3.2 Zużycie na budowie

```
consume(site_id, material_id, qty_base, layer_id):
    allocs = SELECT * FROM allocations
             WHERE site_id = ? AND material.id = ? AND qty_remaining > 0
             ORDER BY allocated_at              -- FIFO w podmagazynie
    remaining = qty_base
    for a in allocs:
        take = min(remaining, a.qty_remaining)
        a.qty_remaining -= take
        INSERT consumption_allocations(allocation_id=a.id, qty=take,
                                       unit_price=a.unit_price_fixed,
                                       value=take*a.unit_price_fixed)
        INSERT stock_movements(type=CONSUMPTION, qty=-take)
        remaining -= take
    if remaining > 0:
        # STAN UJEMNY — dozwolony, NIE blokujemy
        wycena po unit_price OSTATNIEJ użytej partii
        (jeśli brak partii: ostatnia cena zakupu indeksu)
        flaga: is_negative = true → widoczne dla admina
```

**Przykład rozbicia:**

```
Stan:  partia 12.03 →  40 kg × 20,00 zł
       partia 28.04 → 200 kg × 21,40 zł
Raport: 70 kg

→ 40 kg × 20,00 =   800,00 zł   (partia zamknięta)
→ 30 kg × 21,40 =   642,00 zł   (zostaje 170 kg)
   RAZEM         = 1 442,00 zł
```

### 3.3 Zwrot budowa → magazyn (po zamknięciu budowy)

```
return_to_main(allocation):
    # cena = unit_price_fixed = unit_price partii → scalanie ZAWSZE działa
    batches.qty_main += allocation.qty_remaining
    allocation.qty_remaining = 0
    INSERT stock_movements(type=RETURN, SITE → MAIN)
```

> Dzięki niezmiennej cenie zwrot **zawsze scala się z partią macierzystą**. Nie powstają duplikaty.

### 3.4 Transfer budowa → budowa (wirtualny)

```
transfer(site_a, site_b, material, qty):
    g = uuid()
    return_to_main(...)   with transfer_group_id = g
    allocate(...)         with transfer_group_id = g
```

*   Zawsze **przez magazyn główny**
    
*   Wykonuje **tylko admin**
    
*   `transfer_group_id` pozwala odfiltrować sztuczne ruchy z raportów rotacji
    
*   To także **mechanizm naprawy stanów ujemnych**
    

### 3.5 Utylizacja

```
dispose(allocation, qty):
    → identycznie jak CONSUMPTION w skutkach finansowych
    → wartość w koszt budowy, zejście ze stanu, BEZ zwrotu na magazyn
```

* * *

## 4. Uprawnienia

| Funkcja | ADMIN / OWNER | BRYGADZISTA |
| --- | --- | --- |
| Ceny, wartości, marże | ✅ | ❌ **nigdy** |
| Normy zużycia / plan | ✅ | ❌ **nie widzi** |
| Lista materiałów na swojej budowie | ✅ | ✅ (ilości, bez cen) |
| Technologia + warstwy | ✅ | ✅ |
| Wybór partii | — (FIFO) | — (FIFO) |
| Raport zużycia | ✅ | ✅ |
| Edycja raportu | ✅ **także po zatwierdzeniu** | tylko własny, do `CLOSED` |
| Koszty dodatkowe | ✅ | ✅ (dodawanie) |
| Przyjęcie, przypisanie, transfer, zamknięcie budowy | ✅ | ❌ |

> Brygadzista podwykonawcy = rola `BRYGADZISTA`, przypisany do budowy.

* * *

## 5. Ekran brygadzisty — raport zużycia

```
BUDOWA: Hala Kowalski        WARSTWA: [ Warstwa nośna ▾ ]

Materiał                    Mam    Zużyłem
Żywica EP Primer (kg)      148    [ ___ ] opak. + [ ___ ] kg
Kwarc 0,4–0,8 (kg)       3 800    [ ___ ] opak. + [ ___ ] kg

[ Zapisz ]   [ Zamknij raport ]
[ + Dodaj koszt dodatkowy ]
```

**Zasady UI:**

*   ❌ brak normy, brak „powinno być", brak cen
    
*   ❌ brak wyboru partii
    
*   ✅ ilość wpisywana jako **pełne opakowania + resztka** → przeliczana na `base_unit`
    
*   ✅ zużycie > stan → **przechodzi**, bez blokady
    

* * *

## 6. Zamknięcie budowy — przepływ

```
1. status → CLOSED_OPERATIONALLY
2. Ekran rozliczenia podmagazynu, dla każdej pozycji:
   [ Zwrot na magazyn ] | [ Utylizacja ]
3. Różnica stan systemowy vs fizyczny → pole "powód różnicy" (WOLNY TEKST)
4. ⭐ PYTANIE O KOSZTY DODATKOWE KOŃCOWE
   (wywóz odpadu, transport powrotny, ...) → additional_costs
5. WALIDACJA: podmagazyn musi być = 0
6. status → CLOSED_FINANCIALLY → ARCHIVED
7. Raporty automatycznie do archiwum (read-only)
```

**Reklamacja po zamknięciu:** nowa `site` z `is_service_order = true` + `parent_site_id` → koszt nie rusza zamkniętej budowy.

* * *

## 7. Dokumentacja odbiorowa (atesty/DWU) — funkcja o wysokim priorytecie

Przycisk na budowie → zestawienie z `consumption_allocations`:
| Warstwa | Materiał | Lot | Ilość | DWU | Atest |
| --- | --- | --- | --- | --- | --- |
| Grunt | Primer EP | L-2401 | 148 kg | 📄 | 📄 |
| Warstwa nośna | Żywica EP | L-2455 | 1 240 kg | 📄 | 📄 |

*   eksport PDF/ZIP ze wszystkimi plikami.
    

* * *

## 8. Rachunek kosztu budowy

```
KOSZT MATERIAŁU  = Σ consumption_allocations.value        (zużycie + utylizacja)
KOSZT DODATKOWY  = Σ additional_costs.amount              (brygada + zamknięcie)
                 ────────────────────────────────
KOSZT BEZPOŚREDNI (poziom 1)
```

*   Materiał w podmagazynie (`qty_remaining > 0`) = **WIP**, nie koszt
    
*   Koszt powstaje **w momencie raportu zużycia**
    
*   Narzędzia/tarcze: „gdzie przypisane, tam zużyte" — bez licznika przerobu
    

* * *

## 9. Walidacje i reguły

| Reguła | Zachowanie |
| --- | --- |
| `batches.unit_price` | **immutable** |
| `allocations.unit_price_fixed` | **immutable** |
| Zużycie > stan | **dozwolone**, flaga `is_negative` |
| Zamknięcie budowy z podmagazynem ≠ 0 | **blokada** |
| Partia `qty = 0` | ukrywana / usuwalna |
| Wybór partii przez użytkownika | **niemożliwy** (FIFO) |
| Zamykanie miesiąca | **nie istnieje** |
| Raport z datą wsteczną | dozwolony bez ograniczeń |
| Każdy ruch | wpis w `stock_movements` + `created_by` |

* * *

## 10. Poza zakresem v1 (świadomie)

Materiały dwuskładnikowe A+B · status opakowania naruszonego · zwrot do dostawcy · inwentaryzacja okresowa · licznik zużycia narzędzi · osobna flaga strat · waluty obce · VAT · etykiety/QR · rezerwacje · wiele magazynów · praca offline · bilans otwarcia (start od zera)
**Do przemyślenia później:**

*   **Materiał powierzony przez inwestora** — propozycja: `allocations.owner` = `OURS` | `INVESTOR`; cena 0, nie wchodzi w koszt, nie wraca na magazyn główny. ⚠️ Flaga warta dodania **od początku** — dorabianie później wymaga przeliczenia historycznych marż.
    
*   Praca offline
    

* * *

## 11. Ryzyka przyjęte świadomie

| Ryzyko | Skutek |
| --- | --- |
| Brak korekty ceny | Różnica faktura vs cena wpisana nie trafia nigdzie automatycznie |
| Brak statusu opakowania | Resztki wracają jako pełnowartościowe → wartość magazynu zawyżona |
| Narzędzia bez licznika | Budowa, gdzie tarcza „umarła", płaci za cudze zużycie |
| Brak flagi strat | Budowa, która wyrzuciła materiał, wygląda jak ta, która go zużyła |
| Brak inwentaryzacji | Rozbieżność wychodzi jednorazowo przy zamknięciu |
| Admin jako wąskie gardło | Przy 8+ równoległych budowach obciążenie jednej osoby |

* * *

## 12. Kolejność implementacji

1.  `materials`, `groups`, jednostki
    
2.  `receipts` + `batches` (immutable price)
    
3.  `stock_movements` jako jedyne źródło stanów
    
4.  `technologies` → `layers` → `layer_materials` (norma + straty)
    
5.  Zamówienie (ręczne zaokrąglanie) → `allocations` + **FIFO**
    
6.  Raport brygadzisty per warstwa → **rozbicie FIFO 1:N**
    
7.  Rachunek kosztu budowy + WIP
    
8.  Zamknięcie budowy (zwrot / utylizacja / koszty końcowe)
    
9.  Transfer budowa→budowa + korekty admina
    
10.  Dokumentacja odbiorowa (atesty/DWU)