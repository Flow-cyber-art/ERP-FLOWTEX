-- Usunięcie danych testowych z testu interfejsu magazynu v2 (23.11.2026).
-- Dotyczy WYŁĄCZNIE: budów QA_*, materiałów QA_*, kont qa-*@flowtex-qa.test,
-- pracowników i brygad QA_*. Prawdziwe dane (np. budowa „EPL WI”) nietknięte.
-- Uruchom w Supabase → SQL Editor.
do $$
declare qb int[]; qm int[]; qu uuid[]; qops uuid[];
begin
  select array_agg(id) into qb from builds where name like 'QA\_%';
  select array_agg(id) into qm from materials where name like 'QA\_%';
  select array_agg(id) into qu from auth.users where email like 'qa-%@flowtex-qa.test';
  select array_agg(distinct operation_id) into qops from stock_ledger
   where material_id = any(qm) or location_build_id = any(qb) or cost_build_id = any(qb);
  delete from material_loss_requests where build_id = any(qb) or material_id = any(qm);
  delete from stock_ledger where operation_id = any(qops);
  delete from shortages where build_id = any(qb) or material_id = any(qm);
  delete from stock_operations where id = any(qops) or build_id = any(qb);
  delete from batch_balances where material_id = any(qm);
  delete from batches where material_id = any(qm);
  delete from time_entries where "buildId" = any(qb);
  delete from reports where "buildId" = any(qb);
  delete from orders where build_id = any(qb);
  delete from material_orders where "materialId" = any(qm) or "materialName" like 'QA\_%';
  delete from builds where id = any(qb);
  delete from materials where id = any(qm);
  delete from team_members where team_id in (select id from teams where name like 'QA\_%');
  delete from teams where name like 'QA\_%';
  delete from leave_requests where "employeeId" in (select id from employees where name like 'QA\_%');
  delete from profiles where id = any(qu);
  delete from auth.users where id = any(qu);
  delete from employees where name like 'QA\_%';
end $$;
-- Kontrola: zostają tylko prawdziwe budowy, 0 kont qa-*, spójność = 0.
select json_build_object('budowy', (select json_agg(name) from builds), 'konta_qa', (select count(*) from auth.users where email like 'qa-%'),
  'spojnosc', (select count(*) from check_stock_integrity()));
