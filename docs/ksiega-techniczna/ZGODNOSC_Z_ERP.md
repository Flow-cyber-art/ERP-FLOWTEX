# Zgodność kart Księgi Technicznej z ERP (stan na 2026-11-21)

Źródło kart: Google Drive „00_Księga Techniczna Flowtex - poprawione" (105 technologii, md w tym katalogu).
Porównanie z: `supabase/sql/` (094, 095, 099, 101, 106, 107) i `lib/data/technologies.ts`.

## Wynik
- **Kody:** wszystkie 100 kodów technologii z SQL ERP mają kartę md. Kart md bez kodu w ERP: `P/6`, `P/12`, `ST/PU/25`.
- **Receptury w ERP:** tylko 22 technologie mają etapy i materiały (seed 094/095/099). Dla pozostałych (~78) ERP ma sam wpis w `technologies` bez `technology_stages`/`technology_materials` (patrz komentarz w 101). Karty md zawierają komplet warstw i dawek - można z nich zasilić ERP.
- **Dawki 22 istniejących receptur:** zgodne z kartami. Różnice tylko opisowe/jednostkowe:
  - `SST/EPO/1`: ERP StoPox KU 614 = 2.0 kg/m², karta = 1.8-2.2 kg/m² (zakres); ERP pomija taśmę miedzianą (1 mb/m²) i StoPox WL 110 0.15.
  - `ST/PU/24`: ten sam kod w dwóch kartach (Flowfresh SF 3 mm oraz Deckshield LBD 5-6 mm). ERP trzyma tylko Flowfresh SF 3 mm. LBD czeka na nową numerację (komentarz w 101).
  - `ST/EPO/4`: dwie karty (TIKSO i ściany pionowe) pod jednym kodem; ERP linkuje wersję „OK".
  - Nazwy materiałów różnią się zapisem (np. „Masa poliuretanowa Boll" vs „Poliuretanowa masa uszczelniająca Boll"; beton C25/30 w WL/K/1 jest w ERP jako materiał).
- **ACO/K/2 (wzorzec z zadania):** źródło podaje SikaGrout-314 jako 2.20 kg/dm³, wzorzec użytkownika 2.2 kg/mb - do decyzji, jaka jednostka ma być w ERP.
- **Jednostki (106):** `N/1, N/2, N/3, N/8, N/12, P/2` jako mb - zgodne z kartami (dawki na mb rysy/dylatacji). `N/13` i `ST/S/1` czekają na decyzję.

## Anomalie w źródłach (do poprawy w Księdze)
Szczegóły w sekcjach „Uwagi" poszczególnych kart (51 kart). Najważniejsze:
- `SS/PU/8` (Ucrete DP10 4 mm) ma treść kopii `SS/PU/2` (6 mm).
- `ST/MMA/3` ma warstwy takie jak `ST/PU/20`.
- `SST/EPO/1`: plik opisany jako Tremco Peran ESD SL, treść to system STO.
- Jedna z kopii P/12 w `WL_K_1` zawiera treść karty ACO/K/2.
- Brakujące numery faz: P/1, N/2, P/10, SP/EPO/1, ST/S/1.

## Proponowane kolejne kroki
1. Decyzja: jednostka SikaGrout-314 (kg/dm³ vs kg/mb) i dawki `ACO/K/1, ACO/K/2, ACO/W/1`.
2. Wygenerować migrację SQL (następna po 109) z etapami/materiałami dla ~78 technologii bez receptury, z kart md (kolumna Warstwa = etap, Materiał, Dawka).
3. Dodać `P/6`, `P/12`, `ST/PU/25` do katalogu, rozstrzygnąć duplikaty `ST/PU/24`, `ST/EPO/4`.
