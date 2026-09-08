-- ============================================================
-- Grubość (mm) dla katalogu pilotażu — od-do, parsowane wprost z nazw
-- technologii (np. "Flowfresh SR 6mm" -> 6.0-6.0, "STB Compact
-- (2,5-3,0mm)" -> 2.5-3.0). Wypełnia te same kolumny
-- technologies.thickness_min_mm/thickness_max_mm, których już używa
-- prawdziwa zakładka "Technologie" (jej filtr od-do) — więc krok 2
-- Wizardu Ofert może dostać dokładnie ten sam filtr bez nowych kolumn.
--
-- Świadomie NIE dotyczy N/1, N/2, N/3 mimo że ich nazwy też zawierają
-- "mm" — tam "mm" to szerokość pęknięcia (fizycznie inna wielkość),
-- nie grubość warstwy posadzki, więc nie powinny wpadać w filtr
-- grubości posadzki.
--
-- Cofnięcie: update technologies set thickness_min_mm = null,
-- thickness_max_mm = null where code in (...) -- (te same 49 kodów).
-- ============================================================

update technologies set thickness_min_mm = case code
  when 'SS/PU/10' then 9.0
  when 'SS/PU/11' then 9.0
  when 'SS/PU/2' then 6.0
  when 'SS/PU/3' then 9.0
  when 'SS/PU/4' then 6.0
  when 'SS/PU/5' then 9.0
  when 'SS/PU/6' then 2.0
  when 'SS/PU/7' then 9.0
  when 'SS/PU/8' then 4.0
  when 'SS/PU/9' then 9.0
  when 'ST/EPO/1' then 2.5
  when 'ST/EPO/10' then 2.0
  when 'ST/EPO/11' then 2.0
  when 'ST/EPO/2' then 3.0
  when 'ST/EPO/3' then 1.5
  when 'ST/EPO/5' then 2.0
  when 'ST/EPO/6' then 2.0
  when 'ST/EPO/8' then 2.5
  when 'ST/EPO/9' then 2.0
  when 'ST/MMA/1' then 2.0
  when 'ST/MMA/2' then 2.0
  when 'ST/MMA/3' then 4.0
  when 'ST/NWL/1' then 1.5
  when 'ST/PU/1' then 6.0
  when 'ST/PU/10' then 4.0
  when 'ST/PU/11' then 2.0
  when 'ST/PU/12' then 4.0
  when 'ST/PU/13' then 8.0
  when 'ST/PU/14' then 11.0
  when 'ST/PU/15' then 1.5
  when 'ST/PU/16' then 3.0
  when 'ST/PU/17' then 3.0
  when 'ST/PU/18' then 1.5
  when 'ST/PU/19' then 2.5
  when 'ST/PU/2' then 4.0
  when 'ST/PU/20' then 2.0
  when 'ST/PU/21' then 1.5
  when 'ST/PU/22' then 2.0
  when 'ST/PU/24' then 3.0
  when 'ST/PU/25' then 5.0
  when 'ST/PU/3' then 9.0
  when 'ST/PU/4' then 4.0
  when 'ST/PU/5' then 6.0
  when 'ST/PU/6' then 9.0
  when 'ST/PU/7' then 6.0
  when 'ST/PU/8' then 9.0
  when 'ST/PU/9' then 1.5
  when 'ST/VE/1' then 2.5
  when 'ST/VE/2' then 2.5
end, thickness_max_mm = case code
  when 'SS/PU/10' then 9.0
  when 'SS/PU/11' then 9.0
  when 'SS/PU/2' then 6.0
  when 'SS/PU/3' then 9.0
  when 'SS/PU/4' then 6.0
  when 'SS/PU/5' then 9.0
  when 'SS/PU/6' then 2.0
  when 'SS/PU/7' then 9.0
  when 'SS/PU/8' then 4.0
  when 'SS/PU/9' then 9.0
  when 'ST/EPO/1' then 3.0
  when 'ST/EPO/10' then 2.0
  when 'ST/EPO/11' then 2.0
  when 'ST/EPO/2' then 3.0
  when 'ST/EPO/3' then 1.5
  when 'ST/EPO/5' then 2.0
  when 'ST/EPO/6' then 2.0
  when 'ST/EPO/8' then 2.5
  when 'ST/EPO/9' then 2.0
  when 'ST/MMA/1' then 2.0
  when 'ST/MMA/2' then 2.0
  when 'ST/MMA/3' then 4.0
  when 'ST/NWL/1' then 1.5
  when 'ST/PU/1' then 6.0
  when 'ST/PU/10' then 4.0
  when 'ST/PU/11' then 2.0
  when 'ST/PU/12' then 4.0
  when 'ST/PU/13' then 8.0
  when 'ST/PU/14' then 11.0
  when 'ST/PU/15' then 1.5
  when 'ST/PU/16' then 3.0
  when 'ST/PU/17' then 3.0
  when 'ST/PU/18' then 1.5
  when 'ST/PU/19' then 2.5
  when 'ST/PU/2' then 4.0
  when 'ST/PU/20' then 2.0
  when 'ST/PU/21' then 1.5
  when 'ST/PU/22' then 2.0
  when 'ST/PU/24' then 3.0
  when 'ST/PU/25' then 6.0
  when 'ST/PU/3' then 9.0
  when 'ST/PU/4' then 4.0
  when 'ST/PU/5' then 6.0
  when 'ST/PU/6' then 9.0
  when 'ST/PU/7' then 6.0
  when 'ST/PU/8' then 9.0
  when 'ST/PU/9' then 1.5
  when 'ST/VE/1' then 2.5
  when 'ST/VE/2' then 2.5
end
where code in ('SS/PU/10','SS/PU/11','SS/PU/2','SS/PU/3','SS/PU/4','SS/PU/5','SS/PU/6','SS/PU/7','SS/PU/8','SS/PU/9','ST/EPO/1','ST/EPO/10','ST/EPO/11','ST/EPO/2','ST/EPO/3','ST/EPO/5','ST/EPO/6','ST/EPO/8','ST/EPO/9','ST/MMA/1','ST/MMA/2','ST/MMA/3','ST/NWL/1','ST/PU/1','ST/PU/10','ST/PU/11','ST/PU/12','ST/PU/13','ST/PU/14','ST/PU/15','ST/PU/16','ST/PU/17','ST/PU/18','ST/PU/19','ST/PU/2','ST/PU/20','ST/PU/21','ST/PU/22','ST/PU/24','ST/PU/25','ST/PU/3','ST/PU/4','ST/PU/5','ST/PU/6','ST/PU/7','ST/PU/8','ST/PU/9','ST/VE/1','ST/VE/2');

