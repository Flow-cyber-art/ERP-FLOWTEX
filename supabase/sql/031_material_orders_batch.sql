-- ============================================================
-- Dodaje `batchId` do `material_orders` — pozwala zgrupować kilka
-- pozycji zamówionych naraz z koszyka ("Zamów materiał spoza listy",
-- patrz orders-screen.tsx / submitOrderCart w contexts/app-data.tsx) w
-- JEDNO zamówienie wizualnie i w akcjach ("Złożono u dostawcy" / "Usuń"
-- działa wtedy na całej grupie naraz), zamiast każdej pozycji osobno.
--
-- Świadomie NIE jest to nowa tabela nagłówka (jak orders/order_items dla
-- zamówień z planu budowy) — material_orders zostaje płaskie, batchId to
-- tylko wspólny identyfikator generowany po stronie klienta w momencie
-- zatwierdzenia koszyka. Zamówienia sprzed tej zmiany mają batchId=null
-- i są traktowane jako własna, jednoelementowa grupa.
--
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej -> Run.
-- Bezpieczne do wielokrotnego uruchomienia.
-- ============================================================

alter table material_orders
  add column if not exists "batchId" varchar(64);

create index if not exists material_orders_batch_id_idx
  on material_orders ("batchId");
