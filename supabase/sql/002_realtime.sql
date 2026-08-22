-- ============================================================
-- Włącza Supabase Realtime (postgres_changes) na tabelach, które klient
-- odpytuje przez React Query (materials, employees, builds,
-- material_orders, build_materials) — żeby dwóch administratorów
-- pracujących równolegle widzieli nawzajem swoje zmiany bez ręcznego
-- odświeżania strony. Patrz lib/data/use-realtime-sync.ts, który
-- subskrybuje te tabele i po każdej zmianie unieważnia odpowiedni klucz
-- React Query (refetch, nie ręczne łatanie cache'u — prościej i zawsze
-- spójne z tym, co faktycznie zwróci RLS).
--
-- Jak uruchomić: Supabase Dashboard -> SQL Editor -> wklej -> Run.
-- Bezpieczne do wielokrotnego uruchomienia.
-- ============================================================

do $$
declare
  tbl text;
begin
  for tbl in
    select unnest(array[
      'materials', 'employees', 'builds', 'material_orders', 'build_materials'
    ])
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table %I', tbl);
    end if;
  end loop;
end $$;
