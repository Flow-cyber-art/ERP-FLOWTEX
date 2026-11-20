-- ============================================================
-- Trzecia regresja: "invalid input value for enum batch_source:
-- zwrot z budowy" przy zamykaniu budowy.
--
-- 091_close_build_zwrot_po_lot_id.sql (nowsza niż 085) wstawiała do
-- material_batches source = 'zwrot z budowy', a enum batch_source ma tylko:
-- 'stan początkowy', 'zamówienie', 'korekta', 'zwrot' (patrz 077/085).
--
-- Naprawa jest odporna na to, która wersja close_build jest aktualnie w
-- bazie: pobiera żywą definicję i zamienia tylko tę wartość. Plik 091 też
-- został poprawiony, żeby ponowne uruchomienie go nie cofnęło naprawy.
-- Idempotentne.
-- ============================================================
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.close_build(integer,jsonb)'::regprocedure) into v_def;
  if position('''zwrot z budowy''' in v_def) > 0 then
    v_def := replace(v_def, '''zwrot z budowy''', '''zwrot''');
    execute v_def;
  end if;
end $$;
