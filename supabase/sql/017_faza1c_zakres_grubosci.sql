-- ============================================================
-- Poprawka do 016_faza1b_firma_grubosc.sql — posadzka nie ma JEDNEJ
-- grubości, tylko zakres, w jakim dana technologia się stosuje (np.
-- 3-5 mm). `thickness_mm` (pojedyncza wartość) zastąpiony przez
-- `thickness_min_mm`/`thickness_max_mm`. Stara wartość (jeśli ktoś już
-- zdążył ją wpisać) migruje do obu kolumn jako punkt startowy. Uruchom
-- PO 016, bezpieczne do wielokrotnego wklejenia.
-- ============================================================

alter table technologies add column if not exists "thickness_min_mm" decimal(6, 2);
alter table technologies add column if not exists "thickness_max_mm" decimal(6, 2);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'technologies' and column_name = 'thickness_mm'
  ) then
    update technologies
      set "thickness_min_mm" = coalesce("thickness_min_mm", "thickness_mm"),
          "thickness_max_mm" = coalesce("thickness_max_mm", "thickness_mm")
      where "thickness_mm" is not null;
    alter table technologies drop column "thickness_mm";
  end if;
end $$;

drop function if exists update_technology_meta(integer, text, decimal);

create or replace function update_technology_meta(
  p_technology_id integer,
  p_company text,
  p_thickness_min_mm decimal,
  p_thickness_max_mm decimal
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_role(array['Admin']::app_role[]);

  if p_thickness_min_mm is not null and p_thickness_max_mm is not null
     and p_thickness_min_mm > p_thickness_max_mm then
    raise exception 'Grubość "od" nie może być większa niż "do".';
  end if;

  update technologies
    set company = nullif(trim(p_company), ''),
        "thickness_min_mm" = p_thickness_min_mm,
        "thickness_max_mm" = p_thickness_max_mm
    where id = p_technology_id;

  if not found then
    raise exception 'Nie znaleziono technologii #%.', p_technology_id;
  end if;
end;
$$;

grant execute on function update_technology_meta(integer, text, decimal, decimal) to authenticated;
