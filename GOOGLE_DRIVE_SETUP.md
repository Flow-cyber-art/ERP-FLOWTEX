# Konfiguracja Google Drive (zdjęcia budów)

Ten dokument opisuje jednorazową konfigurację po stronie Google, potrzebną
do działania katalogów ze zdjęciami budów. Wcześniejsza wersja tej
integracji szła przez serwer Express (Railway) — została usunięta i
zastąpiona w całości Supabase Edge Function (`supabase/functions/drive-photos`),
zgodnie z resztą aplikacji, która łączy się z Supabase bezpośrednio.
Kod aplikacji jest już gotowy — brakuje tylko kroków po Twojej stronie
opisanych niżej.

## 1. Włącz Google Drive API

1. Wejdź na [Google Cloud Console](https://console.cloud.google.com/) tym
   samym kontem Google Workspace, którego używacie do firmowego Drive.
2. Stwórz nowy projekt (albo użyj istniejącego) — np. "ERP zdjęcia budów".
3. Menu → **APIs & Services → Library** → wyszukaj "Google Drive API" →
   **Enable**.

## 2. Stwórz konto serwisowe (service account)

1. **APIs & Services → Credentials → Create Credentials → Service account**.
2. Nazwa np. `erp-drive-photos`, dowolny opis. Nie trzeba nadawać żadnej
   roli IAM na poziomie projektu (dostęp nadamy na poziomie Shared Drive
   w kroku 4).
3. Po utworzeniu wejdź w to konto serwisowe → zakładka **Keys** → **Add
   key → Create new key → JSON**. Pobierze się plik JSON — to jest sekret,
   traktuj go jak hasło.
4. Zanotuj adres e-mail konta serwisowego (wygląda jak
   `erp-drive-photos@twoj-projekt.iam.gserviceaccount.com`) — będzie
   potrzebny w kroku 4.

## 3. Stwórz Shared Drive

1. W Google Drive (drive.google.com) → **Shared drives** (Dyski
   współdzielone) → **New** → np. "Budowy — zdjęcia".
2. Konto serwisowe NIE MA własnego miejsca na dysku na zwykłym koncie
   Gmail — Shared Drive jest wymagany (miejsce liczy się do puli
   organizacji, nie konta serwisowego). Próba użycia zwykłego folderu w
   "Moim dysku" kończy się błędem `storageQuotaExceeded`.

## 4. Dodaj konto serwisowe do Shared Drive

1. Otwórz nowo utworzony Shared Drive → **Manage members** → dodaj adres
   e-mail konta serwisowego z kroku 2.4 → rola **Content Manager** (albo
   **Manager**, jeśli chcesz, żeby mogło też usuwać/reorganizować).

## 5. Znajdź ID Shared Drive

1. Otwórz Shared Drive w przeglądarce — w adresie URL jest coś w stylu:
   `https://drive.google.com/drive/folders/0AbCdEfGhIjKlMnOp`
2. Ten ciąg po `/folders/` to `GOOGLE_DRIVE_ROOT_ID`.

## 6. Dodaj sekrety w Supabase

1. Supabase Dashboard → **Project Settings → Edge Functions → Secrets**.
2. Dodaj:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — wklej **całą zawartość** pliku JSON
     z kroku 2.3 (jedna wartość, cały JSON jako tekst).
   - `GOOGLE_DRIVE_ROOT_ID` — ID z kroku 5.

## 7. Wdróż Edge Function

1. Supabase Dashboard → **Edge Functions → Deploy new function**.
2. Nazwa: `drive-photos`.
3. Wklej zawartość `supabase/functions/drive-photos/index.ts` → Deploy.

## 8. Uruchom migrację SQL

Wklej i uruchom `supabase/sql/021_google_drive_zdjecia.sql` w
SQL Editor (dodaje kolumnę `builds.drive_folder_id` i tabelę
`build_photos`).

## 9. Zainstaluj bibliotekę do zdjęć w apce

`expo-image-picker` jest już dodane do `package.json` — uruchom:

```
npx expo install expo-image-picker
```

żeby Expo dociągnęło wersję dokładnie pasującą do Twojego SDK i
natywne zależności (potrzebne do przebudowania natywnej apki, nie tylko
web).

## Gotowe — jak to działa dalej

- **Admin** → karta budowy → **"Stwórz katalog na zdjęcia"** — tworzy
  folder `{numer} - {nazwa}` na Shared Drive i zapisuje jego ID/link w
  budowie. Świadomy, ręczny krok — nie dzieje się automatycznie przy
  zakładaniu budowy.
- **Brygadzista** → raport dzienny → **"Zrób zdjęcie" / "Dołącz z
  galerii"** — zdjęcia lądują w podfolderze `{data}_{jego nazwa}`
  wewnątrz folderu tej budowy. Wymaga, żeby Admin wcześniej stworzył
  katalog — inaczej apka pokaże czytelny komunikat.
- Każde przesłane zdjęcie zostaje też zapisane (link, kto, kiedy) w
  tabeli `build_photos` — do ewentualnej galerii w apce w przyszłości.

## Rozwiązywanie problemów

- **"storageQuotaExceeded"** — konto serwisowe nie ma dostępu do Shared
  Drive (krok 4 pominięty) albo próbujesz użyć zwykłego folderu zamiast
  Shared Drive.
- **"Integracja z Google Drive nie jest skonfigurowana"** — sekrety z
  kroku 6 nie zostały ustawione albo funkcja nie została wdrożona po ich
  dodaniu (trzeba redeployować funkcję po zmianie sekretów).
- **"Ta budowa nie ma jeszcze katalogu na zdjęcia"** — Admin musi
  najpierw kliknąć "Stwórz katalog na zdjęcia" na tej budowie.
