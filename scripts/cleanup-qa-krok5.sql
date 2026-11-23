-- Sprzątanie danych testowych kroku 5 (konta qa-admin / qa-bryg, budowa QA-5).
-- Uruchom w Supabase -> SQL Editor. Nie dotyka żadnych prawdziwych danych.
begin;
delete from report_review_log where report_id in (select r.id from reports r join builds b on b.id = r."buildId" where b.number = 'QA-5');
delete from time_entries where "buildId" in (select id from builds where number = 'QA-5');
delete from report_stage_progress where report_id in (select r.id from reports r join builds b on b.id = r."buildId" where b.number = 'QA-5');
delete from report_materials where "reportId" in (select r.id from reports r join builds b on b.id = r."buildId" where b.number = 'QA-5');
delete from report_people where "reportId" in (select r.id from reports r join builds b on b.id = r."buildId" where b.number = 'QA-5');
delete from report_extra_costs where "reportId" in (select r.id from reports r join builds b on b.id = r."buildId" where b.number = 'QA-5');
delete from reports where "buildId" in (select id from builds where number = 'QA-5');
delete from build_stage_status where build_id in (select id from builds where number = 'QA-5');
delete from build_material_plan where build_id in (select id from builds where number = 'QA-5');
delete from builds where number = 'QA-5';
delete from team_members where team_id in (select id from teams where name = 'QA_Brygada');
delete from teams where name = 'QA_Brygada';
delete from profiles where id in (select id from auth.users where email like 'qa-%@flowtex-qa.test');
delete from employees where name in ('QA_Admin', 'QA_Brygadzista');
delete from auth.identities where user_id in (select id from auth.users where email like 'qa-%@flowtex-qa.test');
delete from auth.users where email like 'qa-%@flowtex-qa.test';
delete from period_locks where note = 'QA';
commit;
