-- ============================================================
-- Miniatury zdjęć budowy (in-app galeria, bez otwierania Google Drive).
--
-- Admini/brygadziści logują się do apki przez Supabase Auth, nie mają
-- (i nie muszą mieć) własnego dostępu do Shared Drive konta serwisowego
-- — dlatego link "Otwórz folder" wymaga logowania Gmailem i prośby o
-- dostęp, na którą nikt nie odpowie (konto serwisowe to nie osoba).
-- Rozwiązanie: apka pokazuje miniatury wprost, nikt nie musi wchodzić
-- do Drive na co dzień — `thumbnailLink` z odpowiedzi Google Drive API
-- po uploadzie (drive-photos: action "uploadPhoto").
--
-- Uruchom w dowolnym momencie po 021_google_drive_zdjecia.sql.
-- Bezpieczne do wielokrotnego wklejenia.
-- ============================================================

alter table build_photos add column if not exists "thumbnailUrl" text;
