begin;
select plan(28);
select tests.make_users();

-- ---------------------------------------------------------------- fixtures (as manager)
select tests.as_user('manager@test.local');
insert into public.campaigns (workspace_id, name) values (public.auth_workspace(), 'RLS campaign');
insert into public.campaigns (workspace_id, name) values (public.auth_workspace(), 'Other campaign');
insert into public.journeys (campaign_id, name) select id, 'Consumer' from public.campaigns where name = 'RLS campaign';
insert into public.campaign_members (campaign_id, user_id, campaign_role)
  select c.id, tests.uid('team1@test.local'), 'designer' from public.campaigns c where c.name = 'RLS campaign';
insert into public.campaign_members (campaign_id, user_id, campaign_role)
  select c.id, tests.uid('viewer@test.local'), 'member' from public.campaigns c where c.name = 'RLS campaign';
insert into public.tasks (campaign_id, title, assignee_id)
  select id, 'Fix OTP screen', tests.uid('team1@test.local') from public.campaigns where name = 'RLS campaign';

select is((select count(*)::int from public.campaigns where name in ('RLS campaign', 'Other campaign')), 2, 'manager sees every campaign, assigned or not');
select is((select ref from public.tasks where title = 'Fix OTP screen'), 'T-001', 'tasks get a per-campaign ref');
select ok(exists (select 1 from public.activity_logs where entity_type = 'tasks' and action = 'insert'), 'task creation is logged');

-- ---------------------------------------------------------------- team member not assigned
select tests.as_user('team2@test.local');
select is((select count(*)::int from public.campaigns), 0, 'unassigned team member sees no campaigns');
select is((select count(*)::int from public.journeys), 0, 'unassigned team member sees no journeys');
select is((select count(*)::int from public.tasks), 0, 'unassigned team member sees no tasks');
select is((select count(*)::int from public.activity_logs), 0, 'unassigned team member sees no activity');

-- ---------------------------------------------------------------- assigned team member
select tests.as_user('team1@test.local');
select is((select count(*)::int from public.campaigns), 1, 'assigned team member sees only their campaign');
select lives_ok($$ update public.tasks set status = 'in_progress' where title = 'Fix OTP screen' $$, 'team member can move own task status');
select throws_ok($$ update public.tasks set title = 'Renamed' where title = 'Fix OTP screen' $$, '42501', null, 'team member cannot edit other task fields');
select throws_ok($$ insert into public.campaigns (workspace_id, name) values (public.auth_workspace(), 'Nope') $$, '42501', null, 'team member cannot create campaigns');
select is((select notifications.title from public.notifications limit 1), 'Assigned to you: Fix OTP screen', 'assignee was notified');

-- ---------------------------------------------------------------- viewer
select tests.as_user('viewer@test.local');
select is((select count(*)::int from public.campaigns), 1, 'viewer sees the assigned campaign');
select throws_ok($$ insert into public.tasks (campaign_id, title) select id, 'x' from public.campaigns limit 1 $$, '42501', null, 'viewer cannot create tasks');
update public.campaigns set name = 'Hacked';
select is((select name from public.campaigns limit 1), 'RLS campaign', 'viewer update changes nothing');
delete from public.journeys;
select is((select count(*)::int from public.journeys), 1, 'viewer delete removes nothing');
select throws_ok($$ insert into public.task_comments (task_id, campaign_id, body) select id, campaign_id, 'hi' from public.tasks limit 1 $$, '42501', null, 'viewer cannot comment');

-- ---------------------------------------------------------------- worker
select tests.as_user('worker@test.local');
select is((select count(*)::int from public.campaigns), 0, 'worker cannot read campaigns');
select is((select count(*)::int from public.journeys), 0, 'worker cannot read journeys');
select is((select count(*)::int from public.tasks), 0, 'worker cannot read tasks');
select is((select count(*)::int from public.profiles where id <> auth.uid()), 0, 'worker cannot read other users');
select is((select count(*)::int from public.workspace_members where user_id <> auth.uid()), 0, 'worker cannot read the member list');
select is((select count(*)::int from public.workspace_settings), 0, 'worker cannot read settings');

-- ---------------------------------------------------------------- activity is append-only, roles admin-only
select tests.as_user('manager@test.local');
update public.activity_logs set summary = 'tampered';
select is((select count(*)::int from public.activity_logs where summary = 'tampered'), 0, 'activity log cannot be edited by users');
select throws_ok($$ select public.set_member_role(tests.uid('team1@test.local'), 'admin') $$, '42501', null, 'manager cannot change roles');

-- ---------------------------------------------------------------- import dry run
select is((public.import_campaigns('[{"name":"Imported A","client":"BigCity","journeys":"One; Two"}]'::jsonb, true)->>'create')::int, 1, 'dry run plans one create');
select is((select count(*)::int from public.campaigns where name = 'Imported A'), 0, 'dry run leaves no rows behind');

select tests.as_postgres();
select throws_ok($$ delete from public.activity_logs $$, '42501', null, 'activity log is append-only even for the table owner');
select * from finish();
rollback;
