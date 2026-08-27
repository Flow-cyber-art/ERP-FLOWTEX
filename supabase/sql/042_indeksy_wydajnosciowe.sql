-- ============================================================
-- Indeksy wydajnościowe na kolumnach kluczy obcych najczęściej
-- odpytywanych w RPC i przez klienta — patrz
-- docs/AUDYT_BEZPIECZENSTWO_WYDAJNOSC_ERP.md, punkt B2.
--
-- Bez indeksu Postgres skanuje całą tabelę przy każdym takim zapytaniu.
-- Dziś (mała firma, kilka-kilkanaście budów naraz) niezauważalne — ale
-- FIFO (`fn_consume_fifo`) i `close_build` wykonują te zapytania przy
-- KAŻDYM raporcie dziennym/zamknięciu budowy, więc koszt rośnie liniowo
-- z ilością danych, nie z ruchem. Tabele z kolumnami (buildId,
-- materialId) już mające PRIMARY KEY na tej parze (build_materials,
-- report_materials, report_people) i tabela `orders`/`order_items`
-- (indeksy z 007_faza3_zamowienia.sql) — celowo pominięte, mają już
-- pokrycie.
--
-- Czysto addytywne — CREATE INDEX nie zmienia żadnych danych ani
-- istniejącego zachowania. Bezpieczne do wielokrotnego wklejenia.
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej całość -> Run.
-- ============================================================

-- fn_consume_fifo/fn_consume_build_lot_fifo: "where materialId = ...
-- order by receivedAt asc, id asc" przy KAŻDYM zejściu ze stanu.
create index if not exists material_batches_material_received_idx
  on material_batches ("materialId", "receivedAt");

-- close_build/receive_order: "where buildId = ... and materialId = ...
-- and sourceBatchId is not distinct from ...".
create index if not exists build_material_lots_build_material_batch_idx
  on build_material_lots ("buildId", "materialId", "sourceBatchId");

-- close_build: join report_extra_costs -> reports where reports.buildId = ...
create index if not exists report_extra_costs_report_idx
  on report_extra_costs ("reportId");

-- close_build: "join employees on ... where t.buildId = p_build_id".
create index if not exists time_entries_build_idx
  on time_entries ("buildId");

-- Rozliczenia/widoki per pracownik.
create index if not exists time_entries_employee_idx
  on time_entries ("employeeId");

-- Edytor technologii/plan budowy: drzewo etap -> materiał ładowane per
-- technologia/etap.
create index if not exists technology_stages_technology_idx
  on technology_stages (technology_id);

create index if not exists technology_materials_stage_idx
  on technology_materials (stage_id);

-- Plan materiałowy budowy (settlement-screen.tsx, builds-screen.tsx,
-- generate_order_from_plan) — zawsze odpytywany per buildId.
create index if not exists build_material_plan_build_idx
  on build_material_plan (build_id);
