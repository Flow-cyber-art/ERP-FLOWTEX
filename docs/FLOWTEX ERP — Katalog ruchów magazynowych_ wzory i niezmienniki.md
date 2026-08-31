# FLOWTEX ERP — Katalog ruchów magazynowych
## Notacja symboliczna, wzory, niezmienniki

> Dokument uzupełniający Specyfikację v1.0. Wszystkie wzory podane w postaci ogólnej (symbolicznej), bez wartości liczbowych. Nazwy symboli mapują się 1:1 na pola modelu danych.

---

## 0. NOTACJA

### 0.1 Zbiory

| Symbol | Znaczenie |
|---|---|
| `I` | zbiór indeksów materiałowych |
| `P` | zbiór partii; `P(i) ⊂ P` — partie indeksu `i ∈ I` |
| `B` | zbiór budów |
| `W(b)` | zbiór warstw technologii budowy `b` |
| `A` | zbiór przypisań (allocations); `A(b) ⊂ A` — przypisania budowy `b` |
| `A(b,i)` | przypisania budowy `b` dla indeksu `i` |
| `L` | zbiór lokalizacji: `L = {M} ∪ {S_b : b ∈ B}` |

`M` — magazyn główny · `S_b` — podmagazyn budowy `b`

### 0.2 Wielkości

| Symbol | Znaczenie | Cecha |
|---|---|---|
| `c(p)` | cena jednostkowa partii `p` | **niezmienna** |
| `t(p)` | moment przyjęcia partii `p` | klucz FIFO |
| `e(p)` | data ważności partii `p` | klucz FEFO |
| `u(i)` | jednostka bazowa indeksu `i` | per indeks |
| `π(p)` | przelicznik opakowania partii `p` | jedn. bazowa / opakowanie |
| `q_M(p)` | stan partii `p` w magazynie głównym | ≥ 0 |
| `q_S(a)` | stan pozostały przypisania `a` | może być < 0 |
| `c_F(a)` | cena fixowana przypisania `a` | **niezmienna** |
| `τ(a)` | moment przypisania `a` | klucz FIFO na budowie |
| `n(i,w)` | norma bazowa indeksu `i` w warstwie `w` | jedn./m² |
| `s(i,w)` | narzut strat indeksu `i` w warstwie `w` | ułamek |
| `F(w)` | powierzchnia warstwy `w` | m² |

### 0.3 Konwencja znaku

Każdy ruch to rekord `μ = (p, ℓ⁻, ℓ⁺, Δq, c, V, ref)`:

```
Δq > 0   dla lokalizacji docelowej  ℓ⁺
Δq < 0   dla lokalizacji źródłowej  ℓ⁻
V = |Δq| · c
```

---

## 1. NIEZMIENNIKI SYSTEMU

Muszą być spełnione **zawsze**, po każdym ruchu.

### N1 — Stan wynika wyłącznie z ruchów
```
q_ℓ(p) = Σ  Δq(μ)
        μ ∈ Ruchy(p, ℓ)
```
> Stan nie jest przechowywany niezależnie — jest sumą ruchów.

### N2 — Bilans globalny partii
```
q_M(p) + Σ q_S(a) + Z(p) + U(p) = q₀(p)
        a: partia(a)=p
```
gdzie `q₀(p)` — ilość przyjęta, `Z(p)` — suma zużycia, `U(p)` — suma utylizacji

### N3 — Niezmienność ceny
```
∀p ∈ P :  c(p) = const
∀a ∈ A :  c_F(a) = const  ∧  c_F(a) = c(partia(a))
```

### N4 — Nieujemność magazynu głównego
```
∀p ∈ P :  q_M(p) ≥ 0
```

### N5 — Dopuszczalność ujemnego stanu budowy
```
∃a ∈ A :  q_S(a) < 0        (dozwolone, flaga)
```

### N6 — Warunek zamknięcia budowy
```
Σ q_S(a) = 0        ⟺  budowa b może przejść do stanu zamkniętego
a ∈ A(b)
```

### N7 — Zachowanie wartości
```
Σ V(μ⁺) − Σ V(μ⁻) = 0        w obrębie transferu (para ruchów)
```

---

## 2. PRZELICZNIKI I ZAPOTRZEBOWANIE

### 2.1 Ilość z raportu → jednostka bazowa
```
q = k · π(p) + r
```
`k` — liczba pełnych opakowań · `r` — resztka w jednostce bazowej

### 2.2 Zapotrzebowanie z technologii
```
D(i,w) = F(w) · n(i,w) · (1 + s(i,w))
```

### 2.3 Zapotrzebowanie łączne na budowę
```
D(i,b) =  Σ   F(w) · n(i,w) · (1 + s(i,w))
        w ∈ W(b)
```

### 2.4 Ilość zamawiana (zaokrąglenie ręczne)
```
Q_ord(i,b) = R( D(i,b) )        R — decyzja człowieka, R(x) ≥ x
```
> Brak automatycznego zaokrąglenia. Cała `Q_ord` trafia na podmagazyn budowy.

---

## 3. FUNKCJE PORZĄDKUJĄCE FIFO

### 3.1 Porządek w magazynie głównym (FEFO → FIFO)
```
p₁ ≺_M p₂  ⟺  ( e(p₁), t(p₁) )  <_lex  ( e(p₂), t(p₂) )

gdzie  e(p) = +∞  gdy partia nie ma daty ważności
```

### 3.2 Porządek w podmagazynie budowy (FIFO przypisań)
```
a₁ ≺_S a₂  ⟺  τ(a₁) < τ(a₂)
```

### 3.3 Operator rozdziału FIFO

Dla żądanej ilości `q` i uporządkowanego ciągu koszyków `x₁ ≺ x₂ ≺ … ≺ x_m` o stanach `h(x_j)`:

```
                    ⎛          j−1        ⎞
θ_j(q) = min ⎜ h(x_j),  q − Σ θ_k(q) ⎟      dla j = 1…m
                    ⎝          k=1        ⎠

θ_j(q) ≥ 0
```

Reszta nierozdzielona:
```
              m
ρ(q) = q − Σ θ_j(q)
             j=1
```

**Własności:**
```
Σ θ_j(q) = min( q, Σ h(x_j) )
ρ(q) > 0  ⟺  brak pokrycia
```

> ⭐ `θ` jest **jednoznaczne** — nie zależy od decyzji użytkownika. To formalny zapis „FIFO jako przymus".

---

## 4. KATALOG RUCHÓW

---

### R1 — PRZYJĘCIE (`RECEIPT`)

**Wyzwalacz:** dostawa materiału, dowolna lokalizacja fizyczna.

**Utworzenie partii:**
```
p_new :  c(p) := c_faktura
         t(p) := data przyjęcia
         q₀(p) := Q_rec
```

**Ruch:**
```
Δq_M(p_new) = + Q_rec
V           = Q_rec · c(p_new)
```

**Reguła tożsamości:**
```
∄ p' ∈ P(i) :  ( lot(p') = lot  ∧  c(p') = c_faktura  ∧  receipt(p') = receipt )
⟹ tworzymy nową partię
```

**Rozdział jednej faktury na wiele budów (na loty):**
```
Q_rec = Σ Q_rec^(j)        →  p_new^(j) dla każdego lotu j
        j
```

**Wpływ na koszt budowy:** `ΔK(b) = 0`

---

### R2 — PRZYPISANIE MAGAZYN → BUDOWA (`ALLOCATION`)

**Wyzwalacz:** admin przypisuje ilość `Q` indeksu `i` do budowy `b`.

**Rozdział FIFO:**
```
koszyki:  P⁺(i) = { p ∈ P(i) : q_M(p) > 0 },  porządek ≺_M
θ_p := θ(Q)  wg §3.3  z  h(p) = q_M(p)
```

**Dla każdej partii `p` z `θ_p > 0`:**
```
Δq_M(p)     = − θ_p
a_new :  q_S(a_new) = + θ_p
         c_F(a_new) := c(p)                 ⭐ FIXACJA
         τ(a_new)   := teraz
V(a_new) = θ_p · c(p)
```

**Niedobór:**
```
ρ(Q) > 0  ⟹  ostrzeżenie dla admina, brak ruchu na resztę
```

**Wpływ na koszt:**
```
ΔK(b)   = 0                        (materiał wchodzi w WIP)
ΔWIP(b) = + Σ θ_p · c(p)
```

---

### R3 — ZUŻYCIE NA BUDOWIE (`CONSUMPTION`)

**Wyzwalacz:** raport brygadzisty: budowa `b`, warstwa `w`, indeks `i`, ilość `q` (z §2.1).

**Rozdział FIFO:**
```
koszyki:  A⁺(b,i) = { a ∈ A(b,i) : q_S(a) > 0 },  porządek ≺_S
θ_a := θ(q)  wg §3.3  z  h(a) = q_S(a)
```

**Dla każdego przypisania `a`:**
```
Δq_S(a) = − θ_a
V_a     = θ_a · c_F(a)
```

**Wartość pozycji raportu (rozbicie 1 : N):**
```
V_line =  Σ  θ_a · c_F(a)
        a ∈ A⁺(b,i)
```

**Obsługa niedoboru (stan ujemny — dozwolony):**
```
ρ(q) > 0  ⟹  Δq_S(a_last) −= ρ(q)          (stan schodzi poniżej zera)
             c_neg = c_F(a_last)
             gdy A⁺(b,i) = ∅ :  c_neg = c( p_ostatnia_dostawa(i) )
             V_neg = ρ(q) · c_neg
             flaga:  ujemny = TRUE
```

**Wpływ na koszt:**
```
ΔK(b)   = + V_line + V_neg          ⭐ koszt powstaje TUTAJ
ΔWIP(b) = − V_line
```

---

### R4 — UTYLIZACJA (`DISPOSAL`)

**Wyzwalacz:** decyzja o utylizacji ilości `q` przy rozliczeniu budowy.

Formalnie **identyczna z R3** w skutkach:
```
Δq_S(a) = − θ_a
V_disp  = Σ θ_a · c_F(a)

ΔK(b)   = + V_disp
ΔWIP(b) = − V_disp
Δq_M    = 0                    ⭐ materiał NIE wraca na magazyn
```

**Różnica względem R3:** tylko `typ` ruchu (brak powiązania z warstwą).

---

### R5 — ZWROT BUDOWA → MAGAZYN (`RETURN`)

**Wyzwalacz:** rozliczenie podmagazynu przy zamykaniu budowy.

```
Δq_S(a)             = − q_S(a)
Δq_M( partia(a) )   = + q_S(a)
V                   = q_S(a) · c_F(a)
```

**Warunek scalania (zawsze spełniony):**
```
c_F(a) = c( partia(a) )        z N3
⟹ zwrot wraca do partii macierzystej, bez tworzenia nowej pozycji
```

**Wpływ na koszt:**
```
ΔK(b)   = 0                    ⭐ kosztu nigdy nie było → brak storna
ΔWIP(b) = − q_S(a) · c_F(a)
```

**Reguła z opisu wyjściowego — w ujęciu formalnym:**
```
zgodny indeks ∧ zgodna cena  ⟹  sumowanie do istniejącej partii
niezgodność                   ⟹  osobna pozycja
```
> Przy N3 niezgodność nie może wystąpić dla zwrotu.

---

### R6 — TRANSFER BUDOWA → BUDOWA (`TRANSFER`, para ruchów)

**Wyzwalacz:** admin przenosi materiał z budowy `b₁` na `b₂`.

**Definicja: złożenie R5 ∘ R2 z jednym identyfikatorem grupy `g`:**
```
KROK 1 (R5):   Δq_S(a)   = − q
               Δq_M(p)   = + q                     [grupa g]

KROK 2 (R2):   Δq_M(p)   = − q
               a_new na b₂ :  q_S = + q
                              c_F(a_new) := c(p)   [grupa g]
```

**Wynik netto:**
```
Δq_M(p) = 0                                     magazyn tylko pośredniczy
c_F(a_new) = c_F(a) = c(p)                      ⭐ cena idzie za materiałem
ΔK(b₁) = ΔK(b₂) = 0
ΔWIP(b₁) = − q·c(p)  ;  ΔWIP(b₂) = + q·c(p)
```

**Filtr raportowy (odfiltrowanie ruchów sztucznych):**
```
Rotacja_magazynu =  Σ  |Δq(μ)|        dla μ : grupa(μ) = ∅
```

**Zastosowanie 2 — naprawa stanu ujemnego:**
```
q_S(a) < 0  na b₂   ⟹  transfer(b₁ → b₂, q ≥ |q_S(a)|)
```

---

### R7 — KOREKTA ADMINA (`CORRECTION`)

**Wyzwalacz:** admin poprawia raport (także już zatwierdzony) lub stan.

**Model: ruch odwrotny + ruch nowy**
```
storno:   Δq = + q_błędne ,  V = q_błędne · c_użyta       (odwrócenie R3)
nowy:     Δq = − q_poprawne  wg pełnej procedury R3

ΔK(b) = − q_błędne · c_użyta  +  V_line(q_poprawne)
```

**Reguła:** korekta **nigdy nie modyfikuje** rekordu historycznego — dopisuje ruchy.
```
c(p), c_F(a) pozostają nietknięte           z N3
```

---

### R8 — KOSZTY DODATKOWE (ruch kosztowy, nie magazynowy)

**Wyzwalacz:** brygadzista w trakcie budowy **lub** pytanie systemu przy zamykaniu.

```
Δq = 0                          brak wpływu na stany
ΔK(b) = + Σ x_j                 x_j — kwoty pozycji
```

**Podział wg źródła:**
```
K_add(b) = K_add^brygada(b) + K_add^zamknięcie(b)
```

---

### R9 — HIGIENA KARTOTEKI (operacja techniczna)

```
q_M(p) = 0  ∧  Σ q_S(a) = 0    ⟹  partia p ukryta / usuwalna
                 a: partia(a)=p
```
Brak wpływu na `q`, `V`, `K`.

---

## 5. WIELKOŚCI POCHODNE

### 5.1 Stan magazynu głównego dla indeksu
```
Q_M(i) =  Σ  q_M(p)
        p ∈ P(i)
```

### 5.2 Stan „nieprzypisany" (dostępny dla dowolnej budowy)
```
Q_free(i) = Q_M(i)
```
> Przy braku rezerwacji (D6.6) cały stan magazynu głównego jest dostępny.

### 5.3 Stan podmagazynu budowy
```
Q_S(i,b) =  Σ   q_S(a)
          a ∈ A(b,i)
```

### 5.4 Produkcja w toku (WIP)
```
WIP(b) =  Σ   q_S(a) · c_F(a)
        a ∈ A(b)
```

### 5.5 Koszt materiału budowy
```
K_mat(b) =  Σ    Σ   θ_a(μ) · c_F(a)
          μ∈Z(b) a
```
gdzie `Z(b)` — ruchy typu `CONSUMPTION` ∪ `DISPOSAL` budowy `b`

### 5.6 Koszt bezpośredni budowy (poziom 1)
```
K₁(b) = K_mat(b) + K_add(b)
```

### 5.7 Rozliczenie tożsamościowe budowy
```
Σ  q_allocated(a) · c_F(a)  =  K_mat(b) + Σ q_ret(a)·c_F(a) + WIP(b)
a∈A(b)
```
> Po zamknięciu `WIP(b) = 0` (z N6) — równanie kontrolne rozliczenia.

### 5.8 Odchylenie plan / wykonanie
```
Δ(i,w) = q_zużyte(i,w) − D(i,w)

δ(i,w) = Δ(i,w) / D(i,w)                     odchylenie relatywne
```

**Dekompozycja odchylenia (możliwa dzięki rozdziałowi normy i strat):**
```
Δ_norma(i,w) = q_zużyte(i,w) − F(w)·n(i,w)
Δ_straty(i,w) = F(w)·n(i,w)·s(i,w)

Δ = Δ_norma − Δ_straty
```

### 5.9 Wartość zapasu firmy
```
V_zapas =  Σ  q_M(p)·c(p)  +  Σ  WIP(b)
         p∈P                  b∈B
```

---

## 6. TABELA ZBIORCZA RUCHÓW

| ID | Ruch | `Δq_M` | `Δq_S` | `ΔWIP(b)` | `ΔK(b)` | Kto |
|---|---|---|---|---|---|---|
| **R1** | Przyjęcie | `+Q` | 0 | 0 | 0 | admin |
| **R2** | Przypisanie M→S | `−θ_p` | `+θ_p` | `+Σθ_p·c(p)` | 0 | admin |
| **R3** | Zużycie | 0 | `−θ_a` | `−V_line` | `+V_line` | brygadzista |
| **R4** | Utylizacja | 0 | `−θ_a` | `−V_disp` | `+V_disp` | admin |
| **R5** | Zwrot S→M | `+q_S(a)` | `−q_S(a)` | `−q·c_F` | 0 | admin |
| **R6** | Transfer S→S | `0` (netto) | `−q / +q` | `−q·c / +q·c` | 0 | admin |
| **R7** | Korekta | wg storna | wg storna | ± | ± | admin |
| **R8** | Koszty dodatk. | 0 | 0 | 0 | `+Σx_j` | oba |
| **R9** | Higiena | 0 | 0 | 0 | 0 | system |

---

## 7. WARUNKI BRZEGOWE I ROZSTRZYGNIĘCIA

| Sytuacja | Warunek formalny | Zachowanie |
|---|---|---|
| Brak pokrycia przy przypisaniu | `ρ(Q) > 0` w R2 | ostrzeżenie, ruch częściowy |
| Zużycie > stan | `ρ(q) > 0` w R3 | ruch pełny, stan ujemny, flaga |
| Brak jakiejkolwiek partii na budowie | `A⁺(b,i) = ∅` | wycena po `c` ostatniej dostawy indeksu |
| Zużycie obejmuje wiele partii | `#{a : θ_a > 0} > 1` | **rozbicie 1 : N** — obowiązkowe w modelu |
| Zamknięcie z niezerowym stanem | `Σ q_S(a) ≠ 0` | **blokada** (N6) |
| Różnica przy zamknięciu | `q_fizyczne ≠ Σ q_S(a)` | R7 + opis powodu (wolny tekst) |
| Reklamacja po zamknięciu | — | nowa budowa `b'` z `parent(b') = b` |

---

## 8. MAPA WZORÓW NA CYKL ŻYCIA BUDOWY

```
      D(i,b) = Σ F(w)·n(i,w)·(1+s(i,w))          §2.3   zapotrzebowanie
                        │
                        ▼
      Q_ord = R( D(i,b) )                        §2.4   zamówienie (ręczne)
                        │
                        ▼
      R1:  q_M += Q_rec ,  c(p) := c_faktura      §4.R1  przyjęcie
                        │
                        ▼
      R2:  θ_p wg ≺_M ,  c_F(a) := c(p)           §4.R2  przypisanie + FIXACJA
                        │                                 WIP ↑
                        ▼
      R3:  θ_a wg ≺_S ,  K_mat += Σθ_a·c_F(a)     §4.R3  zużycie per warstwa
                        │                                 WIP ↓ , KOSZT ↑
                        ▼
      R8:  K_add += Σx_j                          §4.R8  koszty dodatkowe
                        │
                        ▼
      R4 / R5:  utylizacja albo zwrot             §4.R4/R5
                        │
                        ▼
      N6:  Σ q_S(a) = 0                           §1.N6  warunek zamknięcia
                        │
                        ▼
      K₁(b) = K_mat(b) + K_add(b)                 §5.6   koszt bezpośredni
```
