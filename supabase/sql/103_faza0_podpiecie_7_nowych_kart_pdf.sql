-- ============================================================
-- Podpięcie 7 kart PDF dorzuconych do bucketu `karty technologiczne`
-- po aktualizacji Księgi Technicznej:
--   ST/PU/8, ST/PU/9, ST/VE/1, ST/VE/2, ST/S/1, SWW/PU/1, WL/K/1
-- Same technologie (i przypisanie do pilotażu) już są w bazie — z 095
-- i 101; brakowało tylko plików w Storage. Ten plik jest bezpieczny do
-- ponownego uruchomienia (upsert) — najpierw wgraj PDF-y do bucketu.
-- Metoda dopasowania jak w 101: po kodzie na początku nazwy pliku.
-- ============================================================

insert into technology_documents (technology_id, storage_path, original_filename)
select distinct on (t.id) t.id, o.name, o.name
from technologies t
join offer_pilot_technologies opt on opt.technology_id = t.id
join storage.objects o
  on o.bucket_id = 'karty technologiczne'
  and o.name ~* ('^' || regexp_replace(lower(t.code), '/', '[-_]', 'g') || '[^0-9a-z]')
  and o.name ilike '%.pdf'
where t.code in ('ST/PU/8', 'ST/PU/9', 'ST/VE/1', 'ST/VE/2', 'ST/S/1', 'SWW/PU/1', 'WL/K/1')
order by t.id, o.name
on conflict (technology_id) do update set storage_path = excluded.storage_path, original_filename = excluded.original_filename;
