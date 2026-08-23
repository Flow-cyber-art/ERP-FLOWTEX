-- ============================================================
-- Uzupełnienie modułu Technologia — firma (producent receptury) i
-- grubość posadzki (mm) jako metadane technologii, wyłącznie pod
-- filtrowanie listy w Technologie (dwa filtry u góry: firma, zakres
-- grubości). To NIE jest część receptury (etapy/materiały) — zmiana
-- nie bumpuje wersji jak `save_technology`, stąd osobna, prosta funkcja
-- zamiast rozszerzania tamtej. Uruchom raz, bezpieczne do wielokrotnego
-- wklejenia.
--
-- Uwaga: oryginalna migracja tworząca `technologies`
-- (005_faza1_technologie.sql) nie jest w tym repo — RLS/RPC tej tabeli
-- już istnieją na żywo w Supabase z wcześniejszego etapu, ten plik
-- tylko dokłada dwie kolumny i jedną nową funkcję, nie rusza reszty.
-- ============================================================

alter table technologies add column if not exists company text;
alter table technologies add column if not exists "thickness_mm" decimal(6, 2);

create or replace function update_technology_meta(
  p_technology_id integer,
  p_company text,
  p_thickness_mm decimal
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_role(array['Admin']::app_role[]);

  update technologies
    set company = nullif(trim(p_company), ''),
        "thickness_mm" = p_thickness_mm
    where id = p_technology_id;

  if not found then
    raise exception 'Nie znaleziono technologii #%.', p_technology_id;
  end if;
end;
$$;

grant execute on function update_technology_meta(integer, text, decimal) to authenticated;
