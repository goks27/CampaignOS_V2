-- Phase 6 (Simplify): the new SQL functions and who may use them.
-- NOT run in the session that wrote it (no local Supabase there). The same checks run without Docker as `npm run db:test`
-- (supabase/tests/simplify.pglite.test.mjs), which passed. Run this file with `supabase test db` or scripts/db-test-local.sh.
begin;
select plan(12);
select tests.make_users();

select tests.as_user('manager@test.local');
insert into public.campaigns (workspace_id, name) values (public.auth_workspace(), 'Simplify campaign');
insert into public.journeys (campaign_id, name) select id, 'Consumer' from public.campaigns where name = 'Simplify campaign';
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;
insert into ids select 'c', id from public.campaigns where name = 'Simplify campaign';

-- defaults: reviews start automatically
select tests.as_postgres();
select is((select (auto_triggers->>'sow_analysis')::boolean from public.workspace_settings limit 1), true, 'SOW analysis is automatic by default');
select is((select (auto_triggers->>'functional_qa')::boolean from public.workspace_settings limit 1), true, 'scenario tests are automatic by default');
select is((select (auto_triggers->>'regression')::boolean from public.workspace_settings limit 1), false, 'regression stays manual');

-- campaign_progress
select tests.as_user('manager@test.local');
select is(((select public.campaign_progress((select v from ids where k = 'c')))->'next'->>'key'), 'upload_sow', 'a new campaign says to upload the SOW');
select is(jsonb_array_length((select public.campaign_progress((select v from ids where k = 'c')))->'steps'), 5, 'there are five steps');
select tests.as_user('team2@test.local');
select is((select public.campaign_progress((select v from ids where k = 'c'))), null::jsonb, 'a team member who is not on the campaign sees nothing');

-- enqueue_reviews
select tests.as_user('manager@test.local');
select throws_ok($$ select public.enqueue_reviews((select v from ids where k = 'c'), 'nonsense', '{}'::jsonb) $$, '22023', null, 'an unknown action is refused');
select is(((select public.enqueue_reviews((select v from ids where k = 'c'), 'review_designs', '{}'::jsonb))->0->>'status'), 'skipped', 'with nothing accepted the design check is skipped, with a reason');
select tests.as_user('team1@test.local');
select throws_ok($$ select public.enqueue_reviews((select v from ids where k = 'c'), 'check_sow', '{}'::jsonb) $$, '42501', null, 'a team member cannot start reviews');
select tests.as_user('viewer@test.local');
select throws_ok($$ select public.enqueue_reviews((select v from ids where k = 'c'), 'check_sow', '{}'::jsonb) $$, '42501', null, 'a viewer cannot start reviews');

-- home_summary, portfolio_report
select tests.as_user('manager@test.local');
select is(((select public.home_summary())->'metrics'->>'active')::int >= 1, true, 'the manager sees the campaign in Home');
select tests.as_user('team2@test.local');
select is(jsonb_array_length(coalesce((select public.portfolio_report()), '[]'::jsonb)) , 0, 'a team member not on any campaign sees an empty portfolio');

select * from finish();
rollback;
