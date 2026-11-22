-- ============================================================
-- 114: Podwykonawca — jedna zwykła stawka za m² (uproszczenie).
--
-- Ustalone z właścicielem: stawka podwykonawcy NIE zależy od technologii
-- ani etapu — to po prostu "X zł za m²". Cennik per technologia/etap
-- (subcontractor_rates, 111) przestaje być używany przez aplikację;
-- tabela zostaje w bazie (pusta w chwili tej zmiany), żeby nie usuwać
-- danych migracją.
--
-- subcontractors.rate — stawka netto zł/m². Zlecenie na budowie
-- (build_subcontracts, 113) kopiuje ją w chwili zlecenia (zamrożenie bez
-- zmian), domyślnie jako jedna pozycja "cała budowa" = metraż × stawka.
--
-- Uruchom PO 113_podwykonawcy_zlecenia_i_odbiory.sql. Bezpieczne do
-- wielokrotnego wklejenia. Jak uruchomić: Supabase Dashboard -> SQL
-- Editor -> wklej całość -> Run.
-- ============================================================

alter table subcontractors
  add column if not exists rate decimal(12, 2) not null default 0;

alter table subcontractors drop constraint if exists subcontractors_rate_check;
alter table subcontractors add constraint subcontractors_rate_check check (rate >= 0);
