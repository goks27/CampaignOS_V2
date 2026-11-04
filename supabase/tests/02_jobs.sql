begin;
select plan(29);
select tests.make_users();

-- ---------------------------------------------------------------- fixtures
select tests.as_user('manager@test.local');
insert into public.campaigns (workspace_id, name) values (public.auth_workspace(), 'Jobs campaign');
insert into public.campaigns (workspace_id, name) values (public.auth_workspace(), 'Unrelated campaign');
insert into public.journeys (campaign_id, name) select id, 'Consumer promotion' from public.campaigns where name = 'Jobs campaign';
insert into public.campaign_members (campaign_id, user_id, campaign_role)
  select id, tests.uid('team1@test.local'), 'designer' from public.campaigns where name = 'Jobs campaign';
insert into public.sow_documents (campaign_id, title) select id, 'SOW' from public.campaigns where name = 'Jobs campaign';
insert into public.sow_versions (sow_document_id, campaign_id, version_no, storage_path, file_name, size_bytes, content_hash)
  select d.id, d.campaign_id, 1, d.campaign_id || '/sow-v1.pdf', 'sow.pdf', 1000, 'hash-sow-1' from public.sow_documents d
  join public.campaigns c on c.id = d.campaign_id where c.name = 'Jobs campaign';

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;
insert into ids select 'campaign', id from public.campaigns where name = 'Jobs campaign';
insert into ids select 'other', id from public.campaigns where name = 'Unrelated campaign';
insert into ids select 'sow', v.id from public.sow_versions v join public.campaigns c on c.id = v.campaign_id where c.name = 'Jobs campaign';

-- ---------------------------------------------------------------- enqueue and duplicates
insert into ids select 'job1', public.enqueue_review((select v from ids where k = 'campaign'), 'sow_analysis',
  jsonb_build_object('sow_version_id', (select v from ids where k = 'sow')));
select isnt((select v from ids where k = 'job1'), null, 'manager can enqueue a SOW analysis');
select throws_ok($$ select public.enqueue_review((select v from ids where k = 'campaign'), 'sow_analysis',
  jsonb_build_object('sow_version_id', (select v from ids where k = 'sow'))) $$, '23505', null, 'duplicate content is rejected');
insert into ids select 'job2', public.enqueue_review((select v from ids where k = 'campaign'), 'sow_analysis',
  jsonb_build_object('sow_version_id', (select v from ids where k = 'sow')), true);
select isnt((select v from ids where k = 'job2'), null, '"Run again" bypasses the duplicate check');
select lives_ok($$ select public.cancel_review_job((select v from ids where k = 'job2')) $$, 'manager can cancel a queued job');
select is((select status::text from public.review_jobs where id = (select v from ids where k = 'job2')), 'cancelled', 'queued job is cancelled');

select tests.as_user('team1@test.local');
select throws_ok($$ select public.enqueue_review((select v from ids where k = 'campaign'), 'sow_analysis',
  jsonb_build_object('sow_version_id', (select v from ids where k = 'sow')), true) $$, '42501', null, 'team member cannot start reviews');

-- ---------------------------------------------------------------- worker claims and completes
select tests.as_user('worker@test.local');
select throws_ok($$ select public.enqueue_review((select v from ids where k = 'campaign'), 'sow_analysis', '{}'::jsonb) $$, '42501', null, 'worker cannot enqueue');
select is((public.claim_review_job('pc-1')->>'id')::uuid, (select v from ids where k = 'job1'), 'worker claims the queued job');
select is(public.claim_review_job('pc-2'), null, 'nothing left to claim (claimed jobs are not handed out twice)');
select ok(public.worker_can_read_object('sow', (select v from ids where k = 'campaign') || '/sow-v1.pdf'), 'worker can read the claimed job''s file');
select ok(not public.worker_can_read_object('sow', (select v from ids where k = 'other') || '/secret.pdf'), 'worker cannot read unrelated files');
select is((public.heartbeat_job((select v from ids where k = 'job1'))->>'cancel_requested')::boolean, false, 'heartbeat works');
select lives_ok($$ select public.worker_heartbeat('pc-1', 'qwen3-vl:8b', true, 'ready', 'gpu', true, null, '{}') $$, 'worker heartbeat recorded');

select lives_ok($$ select public.complete_review_job((select v from ids where k = 'job1'),
  '{"page_count": 2,
    "pages": [{"page_no": 1, "method": "text", "text": "Users register with mobile number"}, {"page_no": 2, "method": "ocr", "text": "OTP"}],
    "requirements": [
      {"title": "Mobile registration", "description": "Users register with a mobile number", "category": "functional",
       "priority": "high", "journey_hint": "consumer promotion", "source_pages": [1], "source_text": "Users register with mobile number", "confidence": "high"},
      {"title": "OTP verification", "description": "OTP is sent", "category": "validation", "source_pages": [1, 2], "source_text": "OTP"}]}'::jsonb,
  '{"prompt_version": "sow-v1", "model": "qwen3-vl:8b", "duration_ms": 1200}'::jsonb) $$, 'worker completes the job');

select tests.as_user('manager@test.local');
select is((select count(*)::int from public.requirements where status = 'draft' and campaign_id = (select v from ids where k = 'campaign')), 2, 'requirements arrive as drafts');
select is((select journey_id from public.requirements where title = 'Mobile registration'),
          (select id from public.journeys where name = 'Consumer promotion'), 'journey hint is matched case-insensitively');
select is((select source_pages from public.requirements where title = 'OTP verification'), array[1, 2], 'page references kept');
select is((select extraction_status from public.sow_versions where id = (select v from ids where k = 'sow')), 'extracted', 'SOW version marked extracted');
select is((select prompt_version from public.review_jobs where id = (select v from ids where k = 'job1')), 'sow-v1', 'prompt version stored on the job');

-- ---------------------------------------------------------------- design review
update public.requirements set status = 'accepted' where title = 'Mobile registration';
insert into public.design_submissions (campaign_id, journey_id, title)
  select c.id, j.id, 'Registration v1' from public.campaigns c join public.journeys j on j.campaign_id = c.id where c.name = 'Jobs campaign';
insert into public.design_assets (submission_id, campaign_id, screen_name, storage_path, mime_type, width, height, original_width, original_height, content_hash)
  select s.id, s.campaign_id, 'Register', s.campaign_id || '/d/reg.png', 'image/png', 800, 1600, 1080, 2160, 'hash-reg' from public.design_submissions s where s.title = 'Registration v1';
insert into ids select 'job3', public.enqueue_review((select v from ids where k = 'campaign'), 'sow_vs_design',
  jsonb_build_object('design_submission_id', (select id from public.design_submissions where title = 'Registration v1')));
insert into ids select 'req_mobile', id from public.requirements where title = 'Mobile registration';
insert into ids select 'req_otp', id from public.requirements where title = 'OTP verification';
insert into ids select 'asset', id from public.design_assets where content_hash = 'hash-reg';

select tests.as_user('worker@test.local');
select is((public.claim_review_job('pc-1')->>'review_type'), 'sow_vs_design', 'worker claims the design review');
select lives_ok(format($$ select public.complete_review_job(%L,
  jsonb_build_object('findings', jsonb_build_array(
     jsonb_build_object('title', 'OTP resend missing', 'severity', 'high', 'requirement_id', %L, 'design_asset_id', %L,
                        'region', jsonb_build_object('x', 0.1, 'y', 0.5, 'w', 0.3, 'h', 0.1)),
     jsonb_build_object('title', 'Unlinked claim', 'severity', 'low', 'requirement_id', %L)),
   'checks', jsonb_build_array(jsonb_build_object('requirement_id', %L, 'result', 'needs_verification', 'note', 'No consent text visible'))),
  '{}'::jsonb) $$,
  (select v from ids where k = 'job3'), (select v from ids where k = 'req_mobile'), (select v from ids where k = 'asset'),
  (select v from ids where k = 'req_otp'), (select v from ids where k = 'req_mobile')), 'design results written');

select tests.as_user('manager@test.local');
select is((select requirement_id from public.findings where title = 'OTP resend missing'),
          (select id from public.requirements where title = 'Mobile registration'), 'finding links to the accepted requirement');
select ok((select additional_observation and requirement_id is null from public.findings where title = 'Unlinked claim'),
          'a link to a non-accepted requirement becomes an Additional observation');
select is((select (region->>'x')::numeric from public.finding_evidence where kind = 'region' and campaign_id = (select v from ids where k = 'campaign')), 0.1, 'normalised region stored');
select is((select result::text from public.requirement_checks where campaign_id = (select v from ids where k = 'campaign')), 'needs_verification', 'unverifiable requirement recorded, not turned into a finding');

update public.findings set title = 'Add OTP resend action', ai_original = '{}'::jsonb where title = 'OTP resend missing';
select is((select ai_original->>'title' from public.findings where ref = 'F-001' and campaign_id = (select v from ids where k = 'campaign')), 'OTP resend missing', 'original AI output is preserved after an edit');
select isnt((select edited_by from public.findings where ref = 'F-001' and campaign_id = (select v from ids where k = 'campaign')), null, 'editor is recorded');

-- ---------------------------------------------------------------- failure, retry, credentials
insert into ids select 'job4', public.enqueue_review((select v from ids where k = 'campaign'), 'design_consistency',
  jsonb_build_object('design_submission_id', (select id from public.design_submissions where title = 'Registration v1')));
select tests.as_user('worker@test.local');
select public.claim_review_job('pc-1');
select is((public.fail_review_job((select v from ids where k = 'job4'), 'model timeout', null, true)->>'status'), 'queued', 'retryable failure is requeued with backoff');

select tests.as_user('manager@test.local');
select throws_ok($$ select * from vault.decrypted_secrets $$, '42501', null, 'users cannot read the vault');

select tests.as_postgres();
select * from finish();
rollback;
