-- Shared test fixtures: run first. Creates test users once per database.
-- Each test file wraps itself in begin/rollback, so these helpers live in a schema.
create schema if not exists tests;

create or replace function tests.uid(p_email text) returns uuid language sql stable security definer as $$
  select id from auth.users where email = p_email
$$;

create or replace function tests.as_user(p_email text) returns void language plpgsql as $$
declare uid uuid;
begin
  uid := tests.uid(p_email);
  if uid is null then raise exception 'unknown test user %', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function tests.as_postgres() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;


-- Users: first insert becomes Admin automatically.
create or replace function tests.make_users() returns void language plpgsql as $$
begin
  if exists (select 1 from auth.users where email = 'admin@test.local') then return; end if;
  insert into auth.users (email) values ('admin@test.local');
  insert into auth.users (email) values ('manager@test.local'), ('team1@test.local'), ('team2@test.local'),
                                        ('viewer@test.local'), ('worker@test.local');
  update public.workspace_members set role = 'manager' where user_id = tests.uid('manager@test.local');
  update public.workspace_members set role = 'team_member' where user_id in (tests.uid('team1@test.local'), tests.uid('team2@test.local'));
  update public.workspace_members set role = 'worker' where user_id = tests.uid('worker@test.local');
end $$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

begin;
select plan(1);
select lives_ok($$ select tests.make_users() $$, 'test users created');
select * from finish();
commit;
