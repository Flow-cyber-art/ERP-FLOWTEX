-- ============================================================
-- Admin wgrał 109 realnych PDF-ów kart technicznych do bucketu
-- `karty technologiczne` (ze spacją) — inny niż `karty-techniczne`
-- (z myślnikiem), który przygotowałem w 097. Ten plik:
--   1. dodaje RLS dla PRAWDZIWEGO bucketu (private + zero polityk =
--      nikt, łącznie z appką, nie mógł nic z niego odczytać),
--   2. usuwa mój nieużywany, pusty bucket-duplikat i jego polityki,
--   3. podpina 27 kart z pilotażu do realnych plików PDF w
--      technology_documents, dopasowanych po kodzie z prefiksu nazwy
--      pliku (Admin nazwał pliki dokładnie kodem karty).
-- ============================================================

-- Uwaga: storage.buckets nie da się skasować zwykłym DELETE (Supabase
-- blokuje to na poziomie triggera — "Use the Storage API instead").
-- Pusty bucket `karty-techniczne` (z myślnikiem) zostaje więc jako
-- nieszkodliwy, nieużywany relikt; polityki na nim usuwamy, żeby nie
-- mylić z prawdziwym bucketem poniżej.
drop policy if exists "karty_techniczne_select_authenticated" on storage.objects;
drop policy if exists "karty_techniczne_write_admin" on storage.objects;

drop policy if exists "karty_technologiczne_select_authenticated" on storage.objects;
create policy "karty_technologiczne_select_authenticated" on storage.objects
  for select to authenticated
  using (bucket_id = 'karty technologiczne');

drop policy if exists "karty_technologiczne_write_admin" on storage.objects;
create policy "karty_technologiczne_write_admin" on storage.objects
  for all to authenticated
  using (bucket_id = 'karty technologiczne' and app_role() = 'Admin'::app_role)
  with check (bucket_id = 'karty technologiczne' and app_role() = 'Admin'::app_role);

insert into technology_documents (technology_id, storage_path, original_filename)
select distinct on (t.id) t.id, o.name, o.name
from technologies t
join offer_pilot_technologies opt on opt.technology_id = t.id
join storage.objects o
  on o.bucket_id = 'karty technologiczne'
  and o.name ~* ('^' || regexp_replace(lower(t.code), '/', '[-_]', 'g') || '[^0-9a-z]')
  and o.name ilike '%.pdf'
  -- wyjątek: ST/PU/24 w naszej bazie to Flowfresh SF 3mm (z folderu
  -- ST:0), nie karta "Deckshield LBD" z innego, starszego źródła, mimo
  -- że oba pliki zaczynają się tym samym kodem (numeracja kart się
  -- kiedyś powtórzyła) — wybieramy właściwy plik jawnie.
  and o.name not ilike '%deckhield-lbd%'
order by t.id, o.name
on conflict (technology_id) do update set storage_path = excluded.storage_path, original_filename = excluded.original_filename;
