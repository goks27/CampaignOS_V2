-- Site check: share a staging URL and Claude looks through the site for errors. No design, requirements or scenarios needed.
--
-- Run this ONCE in the Supabase SQL editor (paste the whole file). It:
--   1. adds the review type 'site_check',
--   2. lets a site check open the submitted site's own host (the worker still refuses private and internal addresses),
--   3. lets complete_review_job save site-check results (captures + findings, same as the other staging reviews),
--   4. starts a site check automatically when a build is submitted, and turns that automatic trigger on for existing workspaces
--      (it can be switched off in Settings > Automatic analysis).
-- If the editor complains that the new enum value cannot be used in the same transaction, run the first statement alone, then the rest.

alter type public.review_type add value if not exists 'site_check';

create or replace function public._enqueue_review(
  p_campaign uuid, p_type public.review_type, p_source jsonb, p_run_again boolean, p_trigger text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  lim jsonb := public.workspace_limits(p_campaign);
  v_input jsonb;
  v_paths text[] := '{}';
  v_hash text;
  v_id uuid;
  v_sow public.sow_versions;
  v_sub public.design_submissions;
  v_dev public.development_submissions;
  v_env public.test_environments;
  v_assets jsonb;
  v_reqs jsonb;
  v_cases jsonb;
  v_count int;
  v_journeys jsonb;
  v_domains text[];
  v_host text;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by sort_order), '[]')
    into v_journeys from public.journeys where campaign_id = p_campaign;

  if p_type = 'sow_analysis' then
    select * into v_sow from public.sow_versions where id = (p_source->>'sow_version_id')::uuid and campaign_id = p_campaign;
    if v_sow.id is null then raise exception 'SOW version not found for this campaign' using errcode = 'P0002'; end if;
    v_hash := md5('sow_analysis:' || v_sow.content_hash);
    v_paths := array['sow/' || v_sow.storage_path];
    v_input := jsonb_build_object(
      'sow_version_id', v_sow.id, 'file_name', v_sow.file_name, 'bucket', 'sow', 'path', v_sow.storage_path,
      'content_hash', v_sow.content_hash, 'journeys', v_journeys, 'limits', lim);
    update public.sow_versions set extraction_status = 'queued' where id = v_sow.id;

  elsif p_type in ('sow_vs_design', 'design_consistency') then
    select * into v_sub from public.design_submissions where id = (p_source->>'design_submission_id')::uuid and campaign_id = p_campaign;
    if v_sub.id is null then raise exception 'Design submission not found for this campaign' using errcode = 'P0002'; end if;
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'screen_name', a.screen_name, 'screen_type', a.screen_type, 'bucket', a.bucket, 'path', a.storage_path,
        'width', a.width, 'height', a.height, 'original_width', a.original_width, 'original_height', a.original_height,
        'content_hash', a.content_hash) order by a.sort_order, a.created_at), '[]'),
        coalesce(array_agg(a.bucket || '/' || a.storage_path), '{}')
      into v_count, v_assets, v_paths
      from public.design_assets a where a.submission_id = v_sub.id;
    if v_sub.source = 'figma' then
      if not coalesce((select s.figma_enabled from public.campaigns c join public.workspace_settings s on s.workspace_id = c.workspace_id
                       where c.id = p_campaign), false) then
        raise exception 'The Figma adapter is turned off. Turn it on in Settings, or upload PDF/image exports instead.' using errcode = '22023';
      end if;
    elsif v_count = 0 then
      raise exception 'This submission has no screens yet' using errcode = '22023';
    end if;
    if v_count > coalesce((lim->>'max_screens_per_review')::int, 12) then
      raise exception 'Limit reached: % screens selected, the maximum per review is %. Split the submission or raise the limit in Settings.',
        v_count, coalesce((lim->>'max_screens_per_review')::int, 12) using errcode = '22023';
    end if;
    v_reqs := public.accepted_requirements_json(p_campaign, v_sub.journey_id);
    if p_type = 'sow_vs_design' and jsonb_array_length(v_reqs) = 0 then
      raise exception 'No accepted requirements for this journey. Accept requirements before running SOW vs Design.' using errcode = '22023';
    end if;
    v_hash := md5(p_type::text || ':' || (select string_agg(x->>'content_hash', ',' order by x->>'content_hash') from jsonb_array_elements(v_assets) x)
                  || ':' || coalesce((select string_agg((x->>'id') || '@' || (x->>'version'), ',' order by x->>'id') from jsonb_array_elements(v_reqs) x), ''));
    if v_sub.source = 'figma' and v_count = 0 then
      v_hash := md5(p_type::text || ':figma:' || v_sub.id || ':' || v_sub.version || ':' ||
                    coalesce((select string_agg((x->>'id') || '@' || (x->>'version'), ',' order by x->>'id') from jsonb_array_elements(v_reqs) x), ''));
    end if;
    v_input := jsonb_build_object(
      'design_submission_id', v_sub.id, 'journey_id', v_sub.journey_id,
      'source', v_sub.source, 'figma_url', v_sub.figma_url,
      'capture_prefix', case when v_sub.source = 'figma' then p_campaign::text || '/' else null end,
      'journey', (select name from public.journeys where id = v_sub.journey_id),
      'assets', v_assets, 'requirements', v_reqs, 'limits', lim);

  else
    select * into v_dev from public.development_submissions where id = (p_source->>'development_submission_id')::uuid and campaign_id = p_campaign;
    if v_dev.id is null then raise exception 'Development submission not found for this campaign' using errcode = 'P0002'; end if;
    select * into v_env from public.test_environments where id = v_dev.environment_id;
    select coalesce(s.allowed_domains, '{}') into v_domains
      from public.campaigns c join public.workspace_settings s on s.workspace_id = c.workspace_id where c.id = p_campaign;
    v_domains := v_domains || coalesce(v_env.allowed_domains, '{}');
    -- A site check opens the submitted site itself, so that site's own host is allowed without a separate setup step.
    -- This only widens the allow-list; the worker still refuses private, loopback and internal addresses whatever the list says.
    if p_type = 'site_check' then
      v_host := lower(substring(v_dev.staging_url from '^https?://([^/:?#]+)'));
      if v_host is not null then
        v_domains := v_domains || array[v_host, case when v_host like 'www.%' then substr(v_host, 5) else 'www.' || v_host end];
      end if;
    end if;
    if coalesce(array_length(v_domains, 1), 0) = 0 then
      raise exception 'No allowed domains configured. Add the staging domain to the test environment or Settings before testing.' using errcode = '22023';
    end if;
    v_reqs := public.accepted_requirements_json(p_campaign, v_dev.journey_id);
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'screen_name', a.screen_name, 'bucket', a.bucket, 'path', a.storage_path,
        'width', a.width, 'height', a.height, 'original_width', a.original_width, 'original_height', a.original_height,
        'content_hash', a.content_hash) order by a.sort_order), '[]'),
        coalesce(array_agg(a.bucket || '/' || a.storage_path), '{}')
      into v_assets, v_paths
      from public.design_assets a where a.submission_id = v_dev.design_submission_id;
    if p_type = 'design_vs_development' and jsonb_array_length(v_assets) = 0 then
      raise exception 'Link an approved design submission to compare against.' using errcode = '22023';
    end if;
    if p_type = 'sow_vs_development' and jsonb_array_length(v_reqs) = 0 then
      raise exception 'No accepted requirements for this journey.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'steps', t.steps, 'expected', t.expected,
        'requirement_id', t.requirement_id, 'version', t.version) order by t.created_at), '[]')
      into v_cases from public.qa_test_cases t
      where t.campaign_id = p_campaign and t.enabled and (v_dev.journey_id is null or t.journey_id is null or t.journey_id = v_dev.journey_id);
    if p_type in ('functional_qa', 'regression') and jsonb_array_length(v_cases) = 0 then
      raise exception 'No enabled test scenarios for this journey. Add scenarios on the Development tab.' using errcode = '22023';
    end if;
    v_hash := md5(p_type::text || ':' || v_dev.id || ':' || v_dev.version || ':' ||
                  coalesce((select string_agg((x->>'id') || '@' || (x->>'version'), ',' order by x->>'id') from jsonb_array_elements(v_cases) x), '') || ':' ||
                  coalesce((select string_agg((x->>'id') || '@' || (x->>'version'), ',' order by x->>'id') from jsonb_array_elements(v_reqs) x), ''));
    v_input := jsonb_build_object(
      'development_submission_id', v_dev.id, 'journey_id', v_dev.journey_id,
      'journey', (select name from public.journeys where id = v_dev.journey_id),
      'staging_url', v_dev.staging_url, 'page_paths', to_jsonb(v_dev.page_paths), 'devices', to_jsonb(v_dev.devices),
      'version_label', v_dev.version_label,
      'environment', case when v_env.id is null then null else jsonb_build_object(
        'id', v_env.id, 'base_url', v_env.base_url, 'has_credentials', v_env.has_credentials, 'access_notes', v_env.access_notes) end,
      'allowed_domains', to_jsonb(v_domains),
      'design_assets', v_assets, 'requirements', v_reqs, 'test_cases', v_cases,
      'capture_prefix', p_campaign::text || '/', 'limits', lim);
  end if;

  if not p_run_again and exists (
    select 1 from public.review_jobs
    where campaign_id = p_campaign and review_type = p_type and source_hash = v_hash
      and status in ('queued', 'processing', 'completed')) then
    raise exception 'DUPLICATE_REVIEW: this content was already reviewed. Choose "Run again" to repeat it.' using errcode = '23505';
  end if;

  insert into public.review_jobs (campaign_id, review_type, source, source_hash, input, object_paths,
                                  run_again, triggered_by, created_by, max_attempts)
  values (p_campaign, p_type, p_source, v_hash, v_input, v_paths, p_run_again, p_trigger, p_actor,
          coalesce((lim->>'max_retries')::int, 2) + 1)
  returning id into v_id;

  -- dev captures are written under <campaign>/<job>/ — now that we have the id, pin the prefix
  if p_type not in ('sow_analysis', 'sow_vs_design', 'design_consistency') or (v_input->>'source') = 'figma' then
    update public.review_jobs set input = input || jsonb_build_object('capture_prefix', p_campaign::text || '/' || v_id::text || '/')
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.complete_review_job(p_job uuid, p_result jsonb, p_meta jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j public.review_jobs;
  x jsonb;
  v_req_ids uuid[];
  v_asset_ids uuid[];
  v_req uuid;
  v_asset uuid;
  v_capture uuid;
  v_finding uuid;
  v_run uuid;
  v_case_ids uuid[];
  v_capture_map jsonb := '{}';
  n_req int := 0;
  n_find int := 0;
  n_check int := 0;
  n_test int := 0;
  v_prefix text;
begin
  j := public._worker_job(p_job);
  if j.cancel_requested then
    update public.review_jobs set status = 'cancelled', finished_at = now() where id = p_job;
    return jsonb_build_object('status', 'cancelled');
  end if;

  select coalesce(array_agg((r->>'id')::uuid), '{}') into v_req_ids from jsonb_array_elements(coalesce(j.input->'requirements', '[]')) r;
  select coalesce(array_agg((a->>'id')::uuid), '{}') into v_asset_ids
    from jsonb_array_elements(coalesce(j.input->'assets', j.input->'design_assets', '[]')) a;

  -- ---------------- SOW analysis
  if j.review_type = 'sow_analysis' then
    for x in select * from jsonb_array_elements(coalesce(p_result->'pages', '[]')) loop
      insert into public.sow_pages (sow_version_id, campaign_id, page_no, method, text)
      values ((j.input->>'sow_version_id')::uuid, j.campaign_id, (x->>'page_no')::int, x->>'method', coalesce(x->>'text', ''))
      on conflict (sow_version_id, page_no) do update set method = excluded.method, text = excluded.text;
    end loop;
    for x in select * from jsonb_array_elements(coalesce(p_result->'requirements', '[]')) loop
      insert into public.requirements (campaign_id, journey_id, journey_hint, ref, title, description, category, priority,
        acceptance_criteria, source_version_id, source_pages, source_text, status, confidence, origin, ai_original, review_job_id)
      values (j.campaign_id,
        (select id from public.journeys where campaign_id = j.campaign_id and lower(name) = lower(x->>'journey_hint') limit 1),
        x->>'journey_hint', '', left(x->>'title', 300), coalesce(x->>'description', ''),
        coalesce((x->>'category')::public.requirement_category, 'functional'),
        coalesce((x->>'priority')::public.priority, 'medium'),
        x->>'acceptance_criteria', (j.input->>'sow_version_id')::uuid,
        coalesce((select array_agg(p::int) from jsonb_array_elements_text(x->'source_pages') p), '{}'),
        x->>'source_text', 'draft', coalesce((x->>'confidence')::public.confidence, 'medium'), 'ai', x, j.id);
      n_req := n_req + 1;
    end loop;
    update public.sow_versions set extraction_status = 'extracted',
      page_count = coalesce((p_result->>'page_count')::int, page_count)
    where id = (j.input->>'sow_version_id')::uuid;
  end if;

  -- ---------------- development: captures + scenario results first, so findings can reference them
  if j.review_type in ('site_check', 'design_vs_development', 'sow_vs_development', 'functional_qa', 'regression') then
    v_prefix := j.input->>'capture_prefix';
    for x in select * from jsonb_array_elements(coalesce(p_result->'captures', '[]')) loop
      if x->>'storage_path' is not null and left(x->>'storage_path', length(v_prefix)) <> v_prefix then
        raise exception 'Capture path outside this job''s folder' using errcode = '42501';
      end if;
      v_asset := nullif(x->>'design_asset_id', '')::uuid;
      if v_asset is not null and not (v_asset = any(v_asset_ids)) then v_asset := null; end if;
      insert into public.dev_captures (campaign_id, development_submission_id, review_job_id, url, viewport, storage_path,
        width, height, design_asset_id, diff_ratio, diff_regions, console_messages, failed_requests)
      values (j.campaign_id, (j.input->>'development_submission_id')::uuid, j.id, x->>'url', x->>'viewport', x->>'storage_path',
        (x->>'width')::int, (x->>'height')::int, v_asset, (x->>'diff_ratio')::numeric,
        coalesce(x->'diff_regions', '[]'), coalesce(x->'console_messages', '[]'), coalesce(x->'failed_requests', '[]'))
      returning id into v_capture;
      if x ? 'key' then v_capture_map := v_capture_map || jsonb_build_object(x->>'key', v_capture); end if;
    end loop;

    if jsonb_array_length(coalesce(p_result->'test_results', '[]')) > 0 then
      select coalesce(array_agg((t->>'id')::uuid), '{}') into v_case_ids from jsonb_array_elements(coalesce(j.input->'test_cases', '[]')) t;
      insert into public.qa_test_runs (campaign_id, development_submission_id, review_job_id, summary)
      values (j.campaign_id, (j.input->>'development_submission_id')::uuid, j.id, coalesce(p_result->'test_summary', '{}'))
      returning id into v_run;
      for x in select * from jsonb_array_elements(p_result->'test_results') loop
        if not ((x->>'test_case_id')::uuid = any(v_case_ids)) then continue; end if;
        insert into public.qa_test_results (run_id, campaign_id, test_case_id, result, actual, error, duration_ms, evidence)
        values (v_run, j.campaign_id, (x->>'test_case_id')::uuid, (x->>'result')::public.verification_state,
                x->>'actual', x->>'error', (x->>'duration_ms')::int, coalesce(x->'evidence', '{}'));
        n_test := n_test + 1;
      end loop;
    end if;
  end if;

  -- ---------------- Figma frames exported by the worker become screens of the submission
  if j.review_type in ('sow_vs_design', 'design_consistency') and (j.input->>'source') = 'figma' then
    v_prefix := j.input->>'capture_prefix';
    for x in select * from jsonb_array_elements(coalesce(p_result->'figma_assets', '[]')) loop
      if left(x->>'storage_path', length(v_prefix)) <> v_prefix then
        raise exception 'Figma export path outside this job''s folder' using errcode = '42501';
      end if;
      insert into public.design_assets (submission_id, campaign_id, screen_name, screen_type, bucket, storage_path, mime_type,
        width, height, original_width, original_height, content_hash, source_file, sort_order)
      values ((j.input->>'design_submission_id')::uuid, j.campaign_id, x->>'screen_name', 'figma_frame', 'captures',
        x->>'storage_path', 'image/png', (x->>'width')::int, (x->>'height')::int,
        (x->>'original_width')::int, (x->>'original_height')::int, x->>'content_hash', x->>'node_id',
        coalesce((x->>'sort_order')::int, 0))
      returning id into v_asset;
      v_asset_ids := v_asset_ids || v_asset;
      if x ? 'key' then v_capture_map := v_capture_map || jsonb_build_object('asset:' || (x->>'key'), v_asset); end if;
    end loop;
  end if;

  -- ---------------- findings (design and development)
  if j.review_type <> 'sow_analysis' then
    for x in select * from jsonb_array_elements(coalesce(p_result->'findings', '[]')) loop
      v_req := nullif(x->>'requirement_id', '')::uuid;
      if v_req is not null and not (v_req = any(v_req_ids)) then v_req := null; end if;  -- only accepted, in-scope requirements
      v_asset := coalesce(nullif(x->>'design_asset_id', '')::uuid, nullif(v_capture_map->>('asset:' || (x->>'design_asset_key')), '')::uuid);
      if v_asset is not null and not (v_asset = any(v_asset_ids)) then v_asset := null; end if;
      v_capture := nullif(v_capture_map->>(x->>'capture_key'), '')::uuid;

      insert into public.findings (campaign_id, journey_id, review_job_id, review_type, ref, title, severity, description,
        expected, observed, suggested_correction, confidence, evidence_note, requirement_id, additional_observation,
        design_submission_id, design_asset_id, development_submission_id, dev_capture_id,
        affected_page, test_scenario, reproducibility, status, ai_original)
      values (j.campaign_id, nullif(j.input->>'journey_id', '')::uuid, j.id, j.review_type, '',
        left(x->>'title', 300), coalesce((x->>'severity')::public.severity, 'medium'), coalesce(x->>'description', ''),
        x->>'expected', x->>'observed', x->>'suggested_correction',
        coalesce((x->>'confidence')::public.confidence, 'medium'), x->>'evidence_note',
        v_req, v_req is null,
        nullif(j.input->>'design_submission_id', '')::uuid, v_asset,
        nullif(j.input->>'development_submission_id', '')::uuid, v_capture,
        x->>'affected_page', x->>'test_scenario', x->>'reproducibility', 'awaiting_review', x)
      returning id into v_finding;

      if x->'region' is not null and jsonb_typeof(x->'region') = 'object' then
        insert into public.finding_evidence (finding_id, campaign_id, design_asset_id, dev_capture_id, kind, region, approximate)
        values (v_finding, j.campaign_id, v_asset, v_capture, 'region', x->'region', true);
      end if;
      if jsonb_array_length(coalesce(x->'console', '[]')) > 0 then
        insert into public.finding_evidence (finding_id, campaign_id, dev_capture_id, kind, data, approximate)
        values (v_finding, j.campaign_id, v_capture, 'console', x->'console', false);
      end if;
      if jsonb_array_length(coalesce(x->'network', '[]')) > 0 then
        insert into public.finding_evidence (finding_id, campaign_id, dev_capture_id, kind, data, approximate)
        values (v_finding, j.campaign_id, v_capture, 'network', x->'network', false);
      end if;
      n_find := n_find + 1;
    end loop;

    for x in select * from jsonb_array_elements(coalesce(p_result->'checks', '[]')) loop
      v_req := nullif(x->>'requirement_id', '')::uuid;
      if v_req is null or not (v_req = any(v_req_ids)) then continue; end if;
      insert into public.requirement_checks (campaign_id, review_job_id, review_type, requirement_id, result, method, note)
      values (j.campaign_id, j.id, j.review_type, v_req, (x->>'result')::public.verification_state,
              nullif(x->>'method', '')::public.check_method, x->>'note');
      n_check := n_check + 1;
    end loop;

    if j.review_type in ('sow_vs_design', 'design_consistency') then
      update public.design_submissions set status = 'in_review'
      where id = (j.input->>'design_submission_id')::uuid and status = 'submitted';
    else
      update public.development_submissions set status = 'in_review'
      where id = (j.input->>'development_submission_id')::uuid and status = 'submitted';
    end if;
  end if;

  update public.review_jobs set status = 'completed', finished_at = now(),
    prompt_version = p_meta->>'prompt_version', model = p_meta->>'model',
    context_size = (p_meta->>'context_size')::int, duration_ms = (p_meta->>'duration_ms')::int,
    tokens_in = (p_meta->>'tokens_in')::int, tokens_out = (p_meta->>'tokens_out')::int,
    result_summary = jsonb_build_object('requirements', n_req, 'findings', n_find, 'checks', n_check, 'tests', n_test,
                                        'notes', p_result->'notes')
  where id = p_job returning * into j;

  perform public._notify_job(j, case
    when j.review_type = 'sow_analysis' then 'SOW analysis finished: ' || n_req || ' draft requirements to verify'
    else 'Review finished: ' || n_find || ' findings awaiting your review' end);

  return j.result_summary;
end $$;

create or replace function public.finalize_development_submission(p_submission uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s public.development_submissions;
begin
  select * into s from public.development_submissions where id = p_submission;
  if s.id is null or not public.can_contribute(s.campaign_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return public._auto_enqueue(s.campaign_id,
    array['site_check', 'design_vs_development', 'sow_vs_development', 'functional_qa', 'regression']::public.review_type[],
    jsonb_build_object('development_submission_id', s.id));
end $$;

update public.workspace_settings
   set auto_triggers = auto_triggers || jsonb_build_object('site_check', true)
 where not (auto_triggers ? 'site_check');

alter table public.workspace_settings alter column auto_triggers set default jsonb_build_object(
  'site_check', true, 'sow_analysis', false, 'sow_vs_design', false, 'design_consistency', false,
  'design_vs_development', false, 'sow_vs_development', false, 'functional_qa', false, 'regression', false);
