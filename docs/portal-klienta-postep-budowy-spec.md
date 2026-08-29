# Portal Klienta — podgląd postępu budowy (QR / link publiczny)

Specyfikacja funkcjonalna i techniczna dla działu programowania.
Projekt: ERP-Flowtex. Moduł: publiczny, read-only widok budowy dla zleceniodawcy.

---

## 1. Cel i kontekst

Zleceniodawca skanuje kod QR (np. na tablicy budowy / w umowie) i trafia na
publiczną stronę pokazującą postęp jego budowy — bez logowania do systemu
wewnętrznego. Cel: transparentność i wrażenie profesjonalizmu, bez ujawniania
danych wewnętrznych (kosztów, marży, danych kadrowych).

**Zasada nadrzędna: whitelist, nie blacklist.** Endpoint publiczny zwraca
tylko jawnie dozwolone pola. Żadne nowe pole dodane w przyszłości do
`builds`/`reports`/itp. nie trafia automatycznie do widoku klienta — trzeba
je świadomie dopisać do whitelisty (patrz sekcja 3).

---

## 2. Dostęp: token w URL, PIN opcjonalny (per budowa)

**Rekomendacja: NIE wymuszaj PIN-u globalnie.** Dane, które klient widzi
(patrz whitelist w sekcji 3), nie są danymi wrażliwymi — nie ma tam kosztów,
marży ani danych osobowych pracowników. Same z siebie nie uzasadniają
dodatkowego tarcia w postaci PIN-u przy każdym skanie kodu.

Podstawowym zabezpieczeniem jest **nieodgadywalny token w URL**, nie PIN:

- `builds.public_token` — `uuid` (losowany `gen_random_uuid()`), unikalny,
  generowany raz przy włączeniu udostępniania budowy.
- URL: `https://portal.flowtex.pl/b/{public_token}` — token wystarczająco
  długi i losowy, żeby brute-force był niepraktyczny (128 bitów entropii).
- QR koduje ten URL bezpośrednio.
- Token **nie jest** numerem budowy ani niczym zgadywalnym — to osobna
  kolumna, nigdy nie pokazywana w UI wewnętrznym poza linkiem do
  wygenerowania QR.

**PIN jako opcja per budowa, nie globalny wymóg:**

- `builds.public_pin_hash` — nullable, hash (np. bcrypt) 4–6-cyfrowego PIN-u.
- `builds.public_access_enabled` — boolean, domyślnie `false` (portal
  budowy jest wyłączony, dopóki ktoś świadomie go nie włączy).
- W ustawieniach budowy: przełącznik "Udostępnij postęp klientowi" +
  opcjonalne pole "Zabezpiecz PIN-em" — do włączenia dla konkretnych,
  bardziej wrażliwych klientów (np. budowy w obiektach chronionych,
  klienci korporacyjni z restrykcyjną polityką).
- Jeśli `public_pin_hash` jest ustawiony, strona przed pokazaniem danych
  prosi o PIN; token w URL bez PIN-u pokazuje tylko nazwę budowy i prompt
  "wprowadź kod PIN", nic więcej.

**Dodatkowe zabezpieczenia (niezależnie od PIN-u):**

- Rate limiting na endpoint publiczny (np. 30 zapytań / min / IP) —
  chroni przed skanowaniem/enumeracją tokenów i przed prostym scrapingiem.
- Token można **unieważnić i wygenerować nowy** jednym kliknięciem
  (np. po zakończeniu współpracy z klientem albo przy podejrzeniu wycieku
  linku) — `regenerate_public_token(buildId)`.
- Automatyczne wyłączenie dostępu po zamknięciu budowy (`status = 'zamknięta'`)
  po ustalonym czasie (np. 90 dni) — do decyzji biznesowej, nie blokujące na
  start.

---

## 3. Whitelist danych — co wolno pokazać

| Pole źródłowe | Tabela | Pokazywać klientowi? |
|---|---|---|
| `name`, `number` | `builds` | ✅ tak |
| `address` | `builds` | ✅ tak |
| `startDate`, `durationDays` (→ planowana data zakończenia) | `builds` | ✅ tak |
| `areaM2` | `builds` | ✅ tak (metraż to nie tajemnica) |
| `status` (aktywna/zamknięta) | `builds` | ✅ tak |
| `photosUrl` / zdjęcia z postępu | `builds` / storage | ✅ tak — najbardziej angażujący element |
| Data ostatniego raportu + jego status (submitted/approved) | `reports` | ✅ tak, jako "ostatnia aktualizacja: dd.mm" |
| Nazwy etapów technologii (np. "Gruntowanie", "Wylewka") + który etap aktualnie trwa | `technologyStages` / `buildMaterialPlan.stageName` | ✅ tak — to serce gauge'a postępu |
| `contractValue` | `builds` | ⚠️ **domyślnie NIE** — patrz sekcja 4 |
| `unitPrice`, `actualCost`, `materialsCost`, `laborCost` | `buildMaterials`, `buildSettlements` | ❌ nigdy |
| `hourlyRate`, `costRate`, dane pracowników, kto pracował | `employees`, `reportPeople` | ❌ nigdy |
| `supplier`, `documentNumber` | `materialBatches` | ❌ nigdy |
| `reportExtraCosts` (kilometrówka itp.) | `reportExtraCosts` | ❌ nigdy |
| Ilości zużytych/zamówionych materiałów w liczbach | `buildMaterials`, `materialOrders` | ❌ nigdy (nawet bez cen — to dane operacyjne firmy) |
| Notatki wewnętrzne z raportów (`adminComment`, `note`) | `reports` | ❌ nigdy — mogą zawierać uwagi niepożądane dla klienta |

---

## 4. Budżet / wartość kontraktu

Zgodnie z ustaleniem: **domyślnie nie pokazujemy `contractValue` ani żadnej
kwoty w PLN.** Powody:

1. Klient zna wartość kontraktu (podpisał umowę) — pokazanie jej nic nie
   wnosi merytorycznie.
2. Sama obecność liczby w PLN obok paska postępu zachęca do liczenia
   "ile to ich kosztuje na dzień" i domyślania się marży — czego chcemy
   uniknąć, nawet nie pokazując kosztu rzeczywistego wprost.
3. Postęp da się w pełni zakomunikować bez pieniędzy — etapami i czasem.

**Implementacja:** `builds.show_contract_value_to_client` — boolean,
domyślnie `false`. Opcjonalny przełącznik per budowa w tych samych
ustawieniach co PIN, na wypadek pojedynczych klientów, dla których firma
świadomie zdecyduje inaczej. Jeśli `true`, endpoint publiczny dodatkowo
zwraca `contractValue` — front pokazuje ją jako statyczną informację
("Wartość kontraktu: X PLN"), **nigdy** jako gauge czy w zestawieniu z
kosztem.

---

## 5. Wzór na % postępu

Rekomendacja: **postęp etapowy jako źródło podstawowe**, z fallbackiem
czasowym, gdy budowa nie ma jeszcze przypisanej technologii/etapów.

### 5.1 Metoda podstawowa — postęp etapowy (technology stages)

Źródła: `technologyStages` (kolejność etapów, `orderIndex`),
`buildMaterialPlan.stageName` (plan per etap), `report_materials.stage_name`
(do którego etapu przypisano zużyty materiał w danym raporcie dziennym).

```
completedStages = liczba etapów z technologyStages (posortowanych po orderIndex),
                   dla których w report_materials pojawił się choć jeden wpis
                   z tym stage_name (czyli etap został "ruszony" na budowie)

currentStageIndex = najwyższy orderIndex wśród ukończonych etapów

progressPercent = (completedStages / totalStages) * 100
```

Dodatkowo, w ramach aktualnego etapu, można pokazać **postęp cząstkowy**
porównując zużycie materiału do planu dla tego etapu:

```
stageProgress = SUM(report_materials.usedQuantity WHERE stage_name = X)
                / SUM(buildMaterialPlan.plannedQuantity WHERE stageName = X)
              (capped na 100%, bo nadwyżka zużycia to nie "121% postępu")
```

To daje dwupoziomowy widok: "Etap 3 z 6: Wylewka (62% tego etapu)".

### 5.2 Metoda zapasowa — postęp czasowy (gdy brak przypisanej technologii)

Dla budów bez `buildTechnologySnapshot` (starszy model, bez etapów):

```
plannedEndDate = startDate + durationDays (dni robocze)
daysElapsed = liczba unikalnych dat w `reports` dla tej budowy
              (czyli faktycznie przepracowane dni, nie kalendarzowe)

progressPercent = min(daysElapsed / durationDays, 1) * 100
```

To słabsza metoda (czas ≠ realny postęp), więc **traktować jako fallback**,
nie jako docelowe rozwiązanie. Warto premiować (biznesowo) przypisywanie
technologii do każdej nowej budowy właśnie dlatego, że odblokowuje lepszy
portal klienta.

### 5.3 Status "na czasie / opóźnienie" (kolor gauge'a)

```
expectedProgressByNow = daysElapsed / durationDays * 100
delta = progressPercent - expectedProgressByNow

delta >= -5pp  → zielony ("na czasie")
delta -5..-15pp → żółty ("lekkie opóźnienie")
delta < -15pp  → czerwony ("opóźnienie")
```

Próg (5pp/15pp) do dostrojenia z zespołem — to punkt startowy, nie sztywna
reguła.

---

## 6. Widoki / rodzaje gauge — układ ekranu

1. **Hero gauge (duży, na górze)** — okrągły wskaźnik postępu ("zegar"),
   0–100%, wartość = `progressPercent` z sekcji 5, kolor wg 5.3. Pod nim
   tekst: nazwa aktualnego etapu ("Trwa: Wylewka") lub, przy metodzie
   czasowej, "Dzień X z Y".
   - **Nie mnożyć gauge'ów.** Jeden hero, nie osobne zegary dla materiałów/
     robocizny/harmonogramu — to jest właśnie to, przed czym przestrzegałem
     wcześniej: dashboard-kokpit myli, nie informuje.
2. **Pasek etapów (stepper/timeline)** pod hero gauge — pozioma lista
   etapów z `technologyStages`, ukończone podświetlone, aktualny
   wyróżniony, przyszłe wyszarzone. To odpowiada na "co dokładnie się
   dzieje", czego sam okrągły gauge nie pokazuje.
3. **Karta "Ostatnia aktualizacja"** — data ostatniego zatwierdzonego
   raportu (`reports.status = 'approved'` lub `'submitted'`), np.
   "Ostatnia aktualizacja: 27.08.2026".
4. **Galeria zdjęć** — z `photosUrl` / storage, chronologicznie,
   najnowsze na górze. Jeśli zdjęć dużo, ograniczyć do np. ostatnich 12 +
   link "zobacz więcej".
5. **Nagłówek budowy** — nazwa, adres, metraż (`areaM2`), planowana data
   zakończenia (`startDate + durationDays` dni roboczych).
6. **(Opcjonalnie, per budowa)** Wartość kontraktu — patrz sekcja 4,
   tylko jeśli `show_contract_value_to_client = true`, pokazana jako
   statyczna informacja, nie gauge.

---

## 7. Zmiany w schemacie bazy danych

Nowe kolumny w `builds`:

```sql
ALTER TABLE builds ADD COLUMN public_token uuid UNIQUE DEFAULT gen_random_uuid();
ALTER TABLE builds ADD COLUMN public_access_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE builds ADD COLUMN public_pin_hash text; -- nullable, bcrypt hash
ALTER TABLE builds ADD COLUMN show_contract_value_to_client boolean NOT NULL DEFAULT false;
```

RLS: nowa, osobna **publiczna, anonimowa** rola/polityka na widoku
(nie na tabeli `builds` bezpośrednio), która:
- czyta wyłącznie po `public_token` (nigdy po `id`/`number`),
- zwraca wyłącznie kolumny z whitelisty (sekcja 3) — najbezpieczniej jako
  osobny `VIEW` (`public.client_build_view`) albo `SECURITY DEFINER`
  RPC (`get_public_build(token uuid, pin text default null)`), nie surowy
  `SELECT *` na tabeli.
- wymaga `public_access_enabled = true`, inaczej 404 (nie 403 — nie
  zdradzać, że token istnieje, ale dostęp jest wyłączony).
- jeśli `public_pin_hash IS NOT NULL`, RPC weryfikuje PIN po stronie
  bazy (bcrypt compare), nie zwraca danych bez poprawnego PIN-u.

---

## 8. Endpoint / warstwa danych (frontend)

Nowa, oddzielna, **nieautoryzowana** trasa Expo Router, poza istniejącym
`(tabs)` (bo to publiczna strona web, nie ekran aplikacji wewnętrznej):

```
app/portal/[token].tsx
```

Wywołuje wyłącznie `get_public_build(token, pin?)` przez `supabase-js`
z kluczem `anon` — bez sesji, bez logowania. Żadnego importu z
`contexts/app-data.tsx` (tam żyją wewnętrzne query z pełnymi danymi —
ryzyko przypadkowego przecieku pola przy refaktorze).

Response type (przykład):

```ts
type PublicBuildView = {
  name: string;
  number: string;
  address: string | null;
  areaM2: string | null;
  startDate: string;
  plannedEndDate: string; // wyliczone po stronie RPC
  status: "aktywna" | "zamknięta";
  progressPercent: number;
  currentStageName: string | null;
  stages: { name: string; completed: boolean; current: boolean }[];
  lastUpdateDate: string | null;
  photos: { url: string; takenAt: string }[];
  contractValue?: number; // tylko gdy show_contract_value_to_client = true
};
```

---

## 9. Checklist wdrożeniowy

- [ ] Migracja: nowe kolumny w `builds` (sekcja 7)
- [ ] SQL: widok/RPC `get_public_build` z whitelistą pól i weryfikacją PIN
- [ ] RLS: polityka dla roli anon ograniczona do RPC, brak bezpośredniego
      dostępu do tabel bazowych
- [ ] Rate limiting na endpoint publiczny
- [ ] Backend: `regenerate_public_token(buildId)` do unieważniania linku
- [ ] UI wewnętrzne: przełącznik w ustawieniach budowy — "Udostępnij
      klientowi" / "Zabezpiecz PIN-em" / "Pokaż wartość kontraktu" +
      generowanie i podgląd kodu QR
- [ ] Frontend: `app/portal/[token].tsx` — hero gauge, stepper etapów,
      galeria, karta ostatniej aktualizacji
- [ ] Kalkulacja `progressPercent` — metoda etapowa (5.1) + fallback
      czasowy (5.2), wg dostępności `buildTechnologySnapshot`
- [ ] Testy: dostęp bez `public_access_enabled` → 404; z PIN-em bez
      podania PIN-u → brak danych; token nieistniejący → 404
