-- ============================================================
-- 123: Nocna kontrola spójności magazynu (pg_cron)
-- Codziennie 02:23 UTC (03:23 / 04:23 czasu polskiego) porównuje salda
-- partii z księgą ruchów (check_stock_integrity). Każda rozbieżność
-- trafia do stock_integrity_alerts (widoczne tylko dla Admina).
-- Wgrane na produkcję 23.11.2026.
-- ============================================================
create extension if not exists pg_cron;
select cron.schedule('flowtex-stock-integrity', '23 2 * * *', 'select public.run_stock_integrity_check()');
