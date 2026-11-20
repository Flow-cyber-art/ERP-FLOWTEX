-- ============================================================
-- Uzupełnienie grubości (mm) dla dwóch kart, które nie dostały jej w
-- 102_faza0_grubosc_posadzek.sql. Wartości odczytane z tytułów plików
-- Księgi Technicznej na Dysku:
--   SST/EPO/1  "Peran ESD SL 2,0 mm"      -> 2.0 - 2.0
--   ST/PU/23   "Flowfresh HF 6 mm"        -> 6.0 - 6.0
-- Wypełnia tylko puste pola (nie nadpisuje wartości wpisanych ręcznie).
--
-- Cofnięcie: update technologies set thickness_min_mm = null,
-- thickness_max_mm = null where code in ('SST/EPO/1', 'ST/PU/23');
-- ============================================================

update technologies set
  thickness_min_mm = coalesce(thickness_min_mm, case code when 'SST/EPO/1' then 2.0 when 'ST/PU/23' then 6.0 end),
  thickness_max_mm = coalesce(thickness_max_mm, case code when 'SST/EPO/1' then 2.0 when 'ST/PU/23' then 6.0 end)
where code in ('SST/EPO/1', 'ST/PU/23');
