# Automatyczny podfolder w Google Drive dla każdej nowej budowy

Przy zapisaniu nowej budowy apka tworzy w Google Drive nowy podfolder
o **takiej samej nazwie jak budowa**, wewnątrz jednego, skonfigurowanego
folderu nadrzędnego, i zapisuje link do niego jako "link do zdjęć" tej
budowy. Kod: `server/_core/googleDrive.ts` (serwer — trzyma sekret
konta serwisowego) + `lib/data/drive.ts` (klient, woła serwer) +
`contexts/app-data.tsx` → `saveBuild` (wywołuje to po zapisaniu budowy).

To jedyna operacja w apce, która wciąż idzie przez Twój serwer Express
(Railway), a nie bezpośrednio do Supabase — klucz prywatny konta
serwisowego Google **nie może** trafić do bundla klienta (byłby
publicznie widoczny), więc musi zostać po stronie serwera.

## 1. Twój folder musi być Dyskiem współdzielonym (Shared Drive)

Link, który podałeś:
```
https://drive.google.com/drive/folders/1na_sgoiO2Z4EAUi19ZH7OaAQvunD3xB3
```
ID folderu to `1na_sgoiO2Z4EAUi19ZH7OaAQvunD3xB3`.

**Ważne:** jeśli to zwykły folder w Twoim "Moim dysku" (a nie folder
wewnątrz Dysku współdzielonego), tworzenie w nim plików przez konto
serwisowe **nie zadziała** — konta serwisowe nie mają własnego limitu
miejsca, a Google nie pozwala im tworzyć plików w zwykłym "Moim dysku"
nawet po udostępnieniu z prawami edytora (błąd "Service Accounts do
not have storage quota"). Rozwiązanie: przenieś ten folder do Dysku
współdzielonego (Shared Drive) — w Google Drive: **Dyski współdzielone
→ Nowy → przenieś tam folder** (albo utwórz Dysk współdzielony i
przenieś do niego zawartość). Jeśli już korzystasz z Google Workspace
(nie zwykłego prywatnego Gmaila), masz do tego dostęp.

## 2. Google Cloud: konto serwisowe + Drive API

1. Wejdź na https://console.cloud.google.com/ (możesz użyć
   istniejącego projektu albo założyć nowy).
2. **APIs & Services → Library** → wyszukaj "Google Drive API" → **Enable**.
3. **APIs & Services → Credentials → Create Credentials → Service account**.
   Nazwa dowolna, np. `flowtex-drive-bot`.
4. Wejdź w utworzone konto serwisowe → zakładka **Keys** → **Add Key →
   Create new key → JSON**. Pobierze się plik `.json` — to jedyny
   moment, kiedy zobaczysz klucz prywatny, przechowuj go bezpiecznie.
5. W pobranym pliku JSON znajdziesz dwa potrzebne pola:
   - `client_email` — coś w stylu `flowtex-drive-bot@twoj-projekt.iam.gserviceaccount.com`
   - `private_key` — długi blok zaczynający się od `-----BEGIN PRIVATE KEY-----`

## 3. Udostępnij folder kontu serwisowemu

W Google Drive: kliknij prawym na folder (ten z Dysku współdzielonego,
patrz punkt 1) → **Udostępnij** → wklej `client_email` z kroku 2.5 →
ustaw uprawnienia **Menedżer treści** (Content manager) lub **Edytor**
→ Wyślij (bez powiadomienia mailem, konto serwisowe i tak go nie odbierze).

## 4. Zmienne środowiskowe (Vercel i/lub Railway — tam gdzie działa
   serwer Express, `dev:server` / `pnpm run build` + `pnpm start`)

```
GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL=flowtex-drive-bot@twoj-projekt.iam.gserviceaccount.com
GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"
GOOGLE_DRIVE_PARENT_FOLDER_ID=1na_sgoiO2Z4EAUi19ZH7OaAQvunD3xB3
```

**Klucz prywatny:** wklej go **dokładnie tak, jak jest w pliku JSON**
(z `\n` jako dosłownymi dwoma znakami, nie prawdziwymi nowymi liniami)
— większość paneli hostingowych (Railway, Vercel) trzyma zmienne
środowiskowe jako pojedynczą linię, więc to naturalny format; kod sam
zamienia `\n` z powrotem na prawdziwe nowe linie przed użyciem. Całość
w cudzysłowie, żeby panel nie obciął spacji/znaków specjalnych.

## 5. Redeploy serwera Express

Zmienne środowiskowe wchodzą w życie dopiero po restarcie/redeployu
procesu serwera (nie tylko frontendowego builda na Vercelu — to osobny
serwis, tam gdzie faktycznie działa `pnpm run build` + `pnpm start`
z `server/_core/index.ts`).

## Zachowanie przy błędzie

Jeśli cokolwiek w kroku tworzenia folderu zawiedzie (zła konfiguracja,
serwer niedostępny, folder nie jest Dyskiem współdzielonym...) — **budowa
i tak zostaje zapisana** w Supabase, tylko pole "link do zdjęć" zostaje
puste i można je uzupełnić ręcznie później (przycisk "+ Dodaj link" na
ekranie budowy). Błąd trafia do konsoli serwera (`[GoogleDrive] ...`),
nie blokuje pracy brygadzisty/admina.
