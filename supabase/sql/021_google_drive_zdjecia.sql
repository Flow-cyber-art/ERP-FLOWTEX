-- ============================================================
-- Katalogi ze zdjęciami budowy na Google Drive (Shared Drive + service
-- account, konfiguracja poza bazą — patrz supabase/functions/drive-photos
-- i GOOGLE_DRIVE_SETUP.md).
--
-- builds.drive_folder_id: ID folderu tej budowy na Shared Drive, zwrócone
-- przez Google przy tworzeniu (drive-photos: action "createBuildFolder").
-- Trzymane osobno od już istniejącego builds.photosUrl (link do
-- otwarcia w przeglądarce) — folder_id jest tym, czego edge function
-- potrzebuje, żeby wiedzieć GDZIE wrzucić kolejne zdjęcie/podfolder, bez
-- konieczności parsowania ID z samego URL-a.
--
-- build_photos: czysto informacyjny log tego, co wylądowało na Drive —
-- pozwala pokazać w apce, kto i kiedy dorzucił zdjęcia do budowy, bez
-- odpytywania Google Drive API z klienta. Sam plik zawsze żyje na Drive,
-- nie w Supabase — ta tabela nie przechowuje żadnych danych obrazu.
--
-- Uruchom w dowolnym momencie (niezależna od pozostałych faz). Bezpieczne
-- do wielokrotnego wklejenia.
-- ============================================================

alter table builds add column if not exists drive_folder_id text;

create table if not exists build_photos (
  id serial primary key,
  "buildId" integer not null references builds(id) on delete cascade,
  "uploadedByName" text not null,
  "driveFileId" text not null,
  "driveFileUrl" text not null,
  "driveFolderName" text not null,
  "createdAt" timestamp not null default now()
);

alter table build_photos enable row level security;
grant select, insert on build_photos to authenticated;
revoke all on build_photos from anon;

drop policy if exists "build_photos_select_authenticated" on build_photos;
create policy "build_photos_select_authenticated" on build_photos
  for select to authenticated using (true);

-- Wstawia wyłącznie edge function drive-photos (service_role, omija RLS),
-- nie apka wprost — więc apka nie dostaje policy na insert.

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'build_photos'
  ) then
    execute 'alter publication supabase_realtime add table build_photos';
  end if;
end $$;
