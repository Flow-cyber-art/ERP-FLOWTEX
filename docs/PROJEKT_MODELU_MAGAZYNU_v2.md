# FLOWTEX ERP — Projekt modelu magazynu v2 (do akceptacji)

> Status: **projekt — nic nie jest jeszcze wdrożone.** Dokument opisuje docelowy model
> gospodarki materiałowej i decyzje do zatwierdzenia przed implementacją.
> Podstawa: testy E2E z 23.11.2026 (`docs/RAPORT_TESTOW_E2E_2026-11-23.md`),
> uzgodnienia z właścicielem (punkty 1, 3, 4 jako priorytet) oraz obecny schemat bazy.
> Baza jest wyczyszczona (0 budów, 0 materiałów) — model wdrażamy **bez migracji historii**.

---

## 0. Uzgodnione zasady (z rozmowy)

1. **Księga ruchów jest jedynym źródłem stanu.** Szybkie odczyty (saldo partii, `materials.stock`) mogą istnieć, ale zmieniają się tylko razem z zapisem ruchu, w tej samej transakcji, i zawsze dają się odtworzyć z księgi.
2. **Jeden mechanizm przyjęć, dwa wejścia** („Z planu budowy”, „Uzupełnij braki”). Dostawa wprost na budowę jest prawidłowa — przyjęcie rejestrujemy od razu w lokalizacji budowy.
3. **Trwała partia** z PZ, dostawcą, numerem partii producenta i dokumentami jakościowymi; partii się nie kasuje.
4. **Niedobór**: raport zapisuje rzeczywiste zużycie, brak oznacza „do wyjaśnienia”; wyjaśnienie to dostawa, transfer, korekta stanu albo poprawka raportu. Wbudowany materiał = koszt zużycia; strata tylko przy faktycznym zniszczeniu/utracie.
5. **Zwrot częściowy i strata w trakcie budowy.** Pobranie przez uprawnionego brygadzistę od razu zmienia stan; admin weryfikuje później.
6. Spójność **kosztów** to osobna zmiana (krok 5) — ten model daje jej fundament: koszt wynika wyłącznie z wycenionych ruchów.

---

## 1. Stan obecny — dlaczego zmiana

| Problem | Skąd się bierze | Błędy z testów |
|---|---|---|
| Stan zapisany w 4 miejscach | `materials.stock`, `material_batches.quantity`, `build_materials` (issued/used/actualCost), `build_material_lots` — każde aktualizowane osobno | F22, F17 (częściowo) |
| 15 funkcji zapisuje stan bezpośrednio | `apply_order_item_free_stock`, `assign_material_batches_to_build`, `close_build`, `correct_material`, `fn_add_material_batch(_ext)`, `fn_consume_build_lot_fifo`, `fn_consume_fifo`, `fn_recalc_material`, `receive_material_order`, `receive_order`, `set_material_active`, `submit_daily_report`, `transfer_material_between_builds`, `unassign_material_from_build` — część pisze do księgi, część nie | F1, F4, F19 |
| Partie kasowane po wyzerowaniu | `delete from build_material_lots / material_batches` przy zerze | F5 (utrata PZ, dostawcy) |
| Niedobór jako ujemna partia | partia −X i +X nie kojarzą się; zamknięcie blokuje na zawsze | F23 |
| Dwa obiegi zamówień | `material_orders` (braki) i `orders`/`order_items` (z planu) — inne statusy, inne przyjęcia | — |
| Księga to typ tekstowy | `stock_movements.type` = dowolny tekst, brak lokalizacji „skąd → dokąd” | — |

---

## 2. Pojęcia

| Pojęcie | Znaczenie |
|---|---|
| **Indeks** | materiał w kartotece (`materials`) — nazwa, jednostka, minimum. **Nie** przechowuje stanu ani ceny jako prawdy. |
| **Partia** | konkretna dostawa indeksu: ilość przyjęta, **cena stała**, PZ, dostawca, nr partii producenta, data ważności, dokumenty jakościowe. Nigdy nie kasowana. |
| **Lokalizacja** | magazyn główny albo budowa X. |
| **Saldo** | ilość danej partii w danej lokalizacji = suma ruchów. |
| **Ruch** | jeden wiersz księgi: zmiana salda jednej partii w jednej lokalizacji (+/−) i ewentualny skutek kosztowy dla budowy. |
| **Operacja** | biznesowe zdarzenie (przyjęcie, wydanie, zużycie…) = 1..N ruchów zapisanych atomowo, ze wspólnym `operation_id`. |
| **Niedobór** | zużycie zaraportowane ponad saldo budowy — osobny rekord „do wyjaśnienia”, **nie** ujemne saldo. |

---

## 3. Model danych (szkic)

```
materials (indeks)                 — bez zmian w roli; stock = pole odczytowe (cache)
batches (partie)                   — zastępuje material_batches
  id, material_id, qty_received, unit_price (stała), received_at,
  receipt_id → receipts, supplier, document_no (PZ), producer_lot_no,
  expiry_date, quality_docs (linki/ścieżki), created_by
receipts (przyjęcia)               — jeden dokument przyjęcia dla obu wejść
  id, order_id?, location_build_id (NULL = magazyn), supplier, document_no, received_at, created_by
stock_ledger (księga ruchów)       — zastępuje stock_movements
  id, operation_id, op_type (enum), occurred_at, posted_at,
  batch_id, location_build_id (NULL = magazyn), qty_delta (±),
  unit_price (= cena partii), value_delta (= qty_delta × cena),
  cost_build_id, cost_effect (enum: brak | zuzycie | strata | rewycena),
  report_id, stage_name, shortage_id, reason, reversal_of, created_by
batch_balances (saldo — cache)     — zastępuje build_material_lots i salda partii
  batch_id, location_build_id, qty   (PK: batch_id + lokalizacja)
  CHECK (qty >= 0)  ← saldo nigdy nie jest ujemne
shortages (niedobory)
  id, build_id, material_id, report_id, stage_name, qty, provisional_price,
  status (do_wyjasnienia | wyjasniony), resolution (dostawa | transfer | korekta_raportu | roznica_inwentaryzacyjna),
  resolved_by, resolved_at, note
```

**Znika:** `build_material_lots` (→ `batch_balances` w lokalizacji budowy), `build_materials` jako tabela z liczbami (→ widok liczony z księgi i planu), `report_material_lots` (→ ruchy zużycia w księdze z `report_id` i `stage_name`), `build_material_returns` (→ ruchy zwrotu/straty z powodem), `material_orders` (→ `orders` z `source = 'braki'`).

**Widoki (tylko odczyt):**
- `v_material_stock` — stan indeksu w magazynie = Σ `batch_balances` z lokalizacją NULL.
- `v_build_materials` — per budowa i indeks: plan, wydano, zużyto, zwrócono, strata, saldo, niedobór, koszt.
- `v_build_material_cost` — koszt materiałowy budowy = Σ `value` ruchów z `cost_effect` ≠ brak (fundament pod krok 5).

---

## 4. Jedna funkcja zapisu i blokada obejść

- `post_stock_operation(op jsonb)` — **jedyna** funkcja zmieniająca stan. W jednej transakcji: waliduje, wybiera partie (FIFO), zapisuje ruchy w `stock_ledger`, aktualizuje `batch_balances` i `materials.stock`, zakłada/zamyka niedobory.
- Funkcje biznesowe (przyjęcie, wydanie, raport, zamknięcie budowy…) budują operację i wołają `post_stock_operation`. Nie piszą do tabel stanu same.
- **Uprawnienia:** `authenticated` traci INSERT/UPDATE/DELETE na `batches`, `batch_balances`, `stock_ledger`, `shortages` i UPDATE kolumny `materials.stock`. Zapis tylko przez funkcje (SECURITY DEFINER z kontrolą roli).
- **Księga append-only:** brak UPDATE/DELETE wierszy księgi (także dla Admina) — błąd poprawia się ruchem odwracającym (`reversal_of`).
- **Uzgodnienie:** `check_stock_integrity()` porównuje każde saldo z Σ ruchów i zwraca rozbieżności. Uruchamiana co noc (pg_cron) — rozbieżność zapisuje alert widoczny dla Admina. Ta sama funkcja w testach CI po każdym scenariuszu.

---

## 5. Katalog operacji

| Operacja | Kto | Ruchy w księdze | Skutek kosztowy budowy |
|---|---|---|---|
| **Przyjęcie do magazynu** | Admin | +Q partia @ magazyn | — |
| **Przyjęcie na budowę** (dostawa wprost) | Admin | +Q partia @ budowa | — (koszt przy zużyciu) |
| **Wydanie magazyn → budowa** | Admin | −q @ magazyn, +q @ budowa (FIFO partii) | — |
| **Pobranie przez brygadzistę** | Brygadzista (uprawniony) | jak wydanie, z flagą `do_weryfikacji` | — |
| **Zużycie z raportu** | Brygadzista / lider / Admin | −q @ budowa (FIFO po partiach na budowie, rozbicie 1:N) | + wartość zużycia |
| — część ponad saldo | (automatycznie) | brak ruchu partii; rekord **niedoboru** z ceną tymczasową | + wartość tymczasowa |
| **Korekta raportu w dół** | autor raportu przed zatwierdzeniem | +q @ budowa na **te same partie** (LIFO ruchów tego raportu) albo zmniejszenie niedoboru | − wartość |
| **Zwrot budowa → magazyn** (częściowy, w każdej chwili) | Admin | −q @ budowa, +q @ magazyn, ta sama partia | — |
| **Strata** (zniszczenie, kradzież, termin) w każdej chwili | Admin (brygadzista zgłasza) | −q @ lokalizacja, powód obowiązkowy | + wartość jako „straty” |
| **Transfer budowa → budowa** | Admin | −q @ A, +q @ B, ta sama partia, wspólne `operation_id` | — |
| **Korekta inwentaryzacyjna** (magazyn) | Admin | ±q @ magazyn, powód obowiązkowy | — |
| **Rozliczenie niedoboru** | Admin | patrz §6 | rewycena: (cena rzeczywista − tymczasowa) × q |
| **Zamknięcie budowy** | Admin + PIN | każda reszta: zwrot albo strata | jak wyżej |

**Niezmienniki (sprawdzane przez `check_stock_integrity` i testy):**
- N1: saldo(partia, lokalizacja) = Σ `qty_delta` ruchów.
- N2: Σ salda partii we wszystkich lokalizacjach + zużycie + straty = ilość przyjęta.
- N3: cena partii się nie zmienia; każdy ruch partii ma jej cenę.
- N4: saldo ≥ 0 wszędzie (niedobór żyje osobno).
- N6: zamknięcie budowy ⇔ saldo każdej partii na budowie = 0 **i** brak otwartych niedoborów.
- N7: transfer i zwrot nie zmieniają wartości zapasu firmy ani kosztu budowy.

---

## 6. Niedobór — przebieg

1. Raport: zużyto 25 kg, na budowie 20 kg → 20 kg schodzi z partii (FIFO), **5 kg = niedobór „do wyjaśnienia”**, wyceniony tymczasowo ceną ostatniej dostawy indeksu. Koszt budowy rośnie o pełne 25 kg (tymczasowo).
2. Admin widzi listę niedoborów (karta budowy, badge). Wyjaśnienie — jedna z czterech przyczyn:

| Przyczyna | Co robi system | Koszt |
|---|---|---|
| **Nieujęta dostawa / zakup na budowie** | przyjęcie na budowę (nowa partia z ceną i PZ) → automatyczne zużycie 5 kg z tej partii | rewycena do ceny partii |
| **Transfer z innej budowy / pobranie z magazynu** | transfer/wydanie na budowę → zużycie 5 kg | rewycena do ceny przeniesionej partii |
| **Błąd raportu** (wpisano za dużo) | korekta raportu przed zatwierdzeniem (albo ruch korygujący po zatwierdzeniu przez Admina) | − wartość tymczasowa |
| **Różnica inwentaryzacyjna** (nie da się ustalić) | brak ruchu partii; decyzja Admina: zostaje kosztem zużycia albo przechodzi do strat | bez zmiany kwoty, ewentualnie przeniesienie do „straty” |

3. Budowy z otwartym niedoborem **nie da się zamknąć** — komunikat wskazuje materiał, ilość i raport.

---

## 7. Zamówienia — jeden mechanizm przyjęć

- `orders` + `order_items` dla wszystkich zamówień; pole `source` (`plan_budowy` | `braki` | `reczne`) i `destination` (magazyn | budowa X) na pozycji.
- Wejścia w UI zostają: „+ Z planu” na karcie budowy (domyślnie dostawa na budowę), „Uzupełnij braki” / „Nowe zamówienie” w Zamówieniach (domyślnie magazyn).
- Statusy: `robocze → zamówione → częściowo przyjęte → przyjęte` (+ `anulowane`).
- Przyjęcie (`receive_goods`): per pozycja ilość, **cena (wymagana)**, PZ, dostawca, nr partii producenta, data ważności, załączniki jakościowe → `receipts` + `batches` + ruch przyjęcia w lokalizacji docelowej. Brak ceny = błąd, nie cicha cena z kartoteki (F2).
- „Na magazynie: X — pobrać?” zostaje: zamiast zamawiać, robi **wydanie** z magazynu na budowę (pełny ruch w księdze, F4).

---

## 8. Co widzi użytkownik (zmiany UI)

- **Karta budowy → Materiały:** saldo na budowie per partia (z PZ i dostawcą), niedobory do wyjaśnienia, przyciski „Zwrot na magazyn” i „Zgłoś stratę” dostępne w trakcie budowy.
- **Raport brygadzisty:** bez zmian w obsłudze; przy zużyciu ponad saldo informacja „X do wyjaśnienia przez Admina”.
- **Magazyn:** partie nie znikają po zużyciu (filtr „z saldem / wszystkie”); historia ruchów partii; dokumenty jakościowe przy partii.
- **Zamknięcie budowy:** lista reszt per partia + blokada przy otwartych niedoborach.
- **Admin:** lista pobrań „do weryfikacji” i alert z nocnego uzgodnienia stanów.

---

## 9. Plan wdrożenia (na czystej bazie)

| Etap | Zakres | Wynik |
|---|---|---|
| 9.1 | Migracja: nowe tabele, enumy, widoki, `post_stock_operation`, `check_stock_integrity`, uprawnienia | schemat v2 obok starego |
| 9.2 | Przepięcie funkcji biznesowych na `post_stock_operation` (przyjęcia, wydanie, raport, korekta, zwrot, strata, transfer, zamknięcie) | 15 starych zapisów zastąpione jednym |
| 9.3 | Aplikacja: odczyty z widoków v2, nowe akcje (zwrot/strata w trakcie, niedobory, weryfikacja pobrań, pola partii przy przyjęciu) | UI na nowym modelu |
| 9.4 | Usunięcie starych tabel i funkcji; testy scenariuszy E2E-01…07 + `check_stock_integrity` w CI | stary model wycofany |

Testy akceptacyjne: scenariusze z planu testów (złota ścieżka, niedobór, transfer, zwroty, wznowienie) z weryfikacją N1–N7 po każdym kroku.

**Usuwane błędy:** F1, F4, F5, F19, F22, F23 (+ F2 przez wymaganą cenę). **Fundament pod krok 5** (F17, F18, F20, F21 — wspólna kalkulacja kosztów).

---

## 10. Decyzje do zatwierdzenia

| # | Pytanie | Rekomendacja |
|---|---|---|
| D1 | Kolejność pobierania partii: FIFO (data przyjęcia) czy FEFO (najpierw krótsza data ważności, potem FIFO)? | **FEFO → FIFO** dla materiałów z datą ważności (żywice), FIFO dla reszty. |
| D2 | Cena tymczasowa niedoboru | **ostatnia cena dostawy indeksu**; gdy brak — cena z kartoteki. |
| D3 | Czy brygadzista może sam pobierać z magazynu? | **Tak**, ruch od razu; pozycja trafia do „do weryfikacji” u Admina. |
| D4 | Wymagane pola partii przy przyjęciu | **wymagane:** ilość, cena; **opcjonalne:** PZ, dostawca, nr partii producenta, data ważności, dokumenty (wymagalność per materiał do ustawienia w kartotece, np. „wymaga atestu”). |
| D5 | Kto zgłasza stratę w trakcie budowy | brygadzista **zgłasza**, Admin **zatwierdza** (dopiero wtedy ruch). |
| D6 | Korekta zatwierdzonego raportu | tylko Admin, **ruchem korygującym** z powodem (raport zostaje zablokowany, historia widoczna). |
| D7 | Ujemny stan magazynu głównego | **zakazany** (N4); wydanie ponad stan = błąd z komunikatem. |
| D8 | Stare tabele po przejściu | **usunąć** w etapie 9.4 (baza i tak jest pusta). |
