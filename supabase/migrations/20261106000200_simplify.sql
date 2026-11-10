-- Phase 6, Simplify: fewer places to go, one next thing to do.
-- Run this ONCE in the Supabase SQL editor (paste the whole file) after 20261106000100_live_test_sessions.sql.
-- Nothing is deleted. It changes one default, adds four functions, and lets existing workspaces that never touched
-- the automation switches get the new default.
--
--   1. Reviews start automatically after an upload (on by default; an Admin can switch each off in Settings).
--   2. enqueue_reviews(): three actions (Check SOW, Review designs, Test build), each queues every check that applies
--      and says why it skipped the others. The seven review types and their worker handlers are unchanged.
--   3. campaign_progress(): the five steps of a campaign, their counts, and the one next action, in one call.
--   4. home_summary() and portfolio_report(): one call each, instead of one request per campaign.
-- The three read functions are SECURITY INVOKER, so row-level security decides what each person sees.

-- ---------------------------------------------------------------- 1. automatic reviews by default
alter table public.workspace_settings alter column auto_triggers set default jsonb_build_object(
  'site_check', true, 'sow_analysis', true, 'sow_vs_design', true, 'design_consistency', true,
  'design_vs_development', true, 'sow_vs_development', true, 'functional_qa', true, 'regression', false);

-- Only workspaces still on the old default (nothing on except the Site check) are switched; anyone who chose their own settings keeps them.
update public.workspace_settings s
   set auto_triggers = s.auto_triggers || jsonb_build_object(
     'sow_analysis', true, 'sow_vs_design', true, 'design_consistency', true,
     'design_vs_development', true, 'sow_vs_development', true, 'functional_qa', true)
 where not exists (
   select 1 from jsonb_each(s.auto_triggers) e
    where e.key <> 'site_check' and e.value = 'true'::jsonb);

-- ---------------------------------------------------------------- 2. three actions instead of seven buttons
-- p_action: 'check_sow' | 'review_designs' | 'test_build'
-- p_source: the id of what was just submitted: {"sow_version_id"} | {"design_submission_id"} | {"development_submission_id"}
-- Returns one row per check: {type, status: 'queued' | 'skipped', job_id?, reason?}. Duplicate protection and "run again" work as before.
create or replace function public.enqueue_reviews(p_campaign uuid, p_action text, p_source jsonb default '{}'::jsonb, p_run_again boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_types public.review_type[];
  t public.review_type;
  v_out jsonb := '[]'::jsonb;
  v_id uuid;
  v_reason text;
  v_accepted int;
  v_screens int;
  v_cases int;
  v_design uuid;
begin
  if not public.can_manage_campaign(p_campaign) then
    raise exception 'Only a Manager or Admin can start a review' using errcode = '42501';
  end if;
  v_types := case p_action
    when 'check_sow' then array['sow_analysis']::public.review_type[]
    when 'review_designs' then array['sow_vs_design', 'design_consistency']::public.review_type[]
    when 'test_build' then array['site_check', 'design_vs_development', 'functional_qa', 'sow_vs_development']::public.review_type[]
    else null end;
  if v_types is null then raise exception 'Unknown review action: %', p_action using errcode = '22023'; end if;

  select count(*) into v_accepted from public.requirements where campaign_id = p_campaign and status = 'accepted';

  foreach t in array v_types loop
    v_reason := null;
    if t in ('sow_vs_design', 'sow_vs_development') and v_accepted = 0 then
      v_reason := 'Accept some requirements first.';
    elsif t = 'design_consistency' then
      select count(*) into v_screens from public.design_assets a
       where a.submission_id = nullif(p_source->>'design_submission_id', '')::uuid;
      if v_screens < 2 then v_reason := 'Needs two or more screens to compare.'; end if;
    elsif t = 'functional_qa' then
      select count(*) into v_cases from public.qa_test_cases where campaign_id = p_campaign and enabled;
      if v_cases = 0 then v_reason := 'No test scenarios yet.'; end if;
    elsif t = 'design_vs_development' then
      select d.design_submission_id into v_design from public.development_submissions d
       where d.id = nullif(p_source->>'development_submission_id', '')::uuid and d.campaign_id = p_campaign;
      if v_design is null then v_reason := 'No design is linked to this build.'; end if;
    end if;

    if v_reason is null then
      begin
        v_id := public._enqueue_review(p_campaign, t, p_source, p_run_again, 'manual', auth.uid());
        v_out := v_out || jsonb_build_object('type', t, 'status', 'queued', 'job_id', v_id);
      exception when others then
        v_reason := sqlerrm; -- a duplicate of an earlier run, or a prerequisite only the queue itself knows about
      end;
    end if;
    if v_reason is not null then
      v_out := v_out || jsonb_build_object('type', t, 'status', 'skipped', 'reason', v_reason);
    end if;
  end loop;
  return v_out;
end $$;
revoke all on function public.enqueue_reviews(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.enqueue_reviews(uuid, text, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------- 3. one call for a campaign's steps and its next action
-- steps: brief, requirements, design, build, launch. state: not_started | current | done. open: items waiting in that step.
-- next: the one thing to do now. {key, step, count, link}; key is stable so the app can word it; null when nothing is waiting.
create or replace function public.campaign_progress(p_campaign uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_journeys int; v_sow int; v_drafts int; v_accepted int; v_designs int; v_builds int;
  v_f_req int; v_f_design int; v_f_build int; v_approved int; v_deploys int; v_verified int; v_feedback int;
  s_brief text; s_req text; s_design text; s_build text; s_launch text;
  v_next jsonb;
begin
  if not exists (select 1 from public.campaigns where id = p_campaign) then return null; end if; -- not found, or not visible to this person
  select count(*) into v_journeys from public.journeys where campaign_id = p_campaign;
  select count(*) into v_sow from public.sow_versions where campaign_id = p_campaign;
  select count(*) filter (where status in ('draft', 'needs_clarification')), count(*) filter (where status = 'accepted')
    into v_drafts, v_accepted from public.requirements where campaign_id = p_campaign;
  select count(*) into v_designs from public.design_submissions where campaign_id = p_campaign;
  select count(*) into v_builds from public.development_submissions where campaign_id = p_campaign;
  select count(*) filter (where review_type = 'sow_analysis'),
         count(*) filter (where review_type in ('sow_vs_design', 'design_consistency')),
         count(*) filter (where review_type in ('design_vs_development', 'functional_qa', 'sow_vs_development', 'regression', 'site_check'))
    into v_f_req, v_f_design, v_f_build
    from public.findings where campaign_id = p_campaign and status in ('new', 'awaiting_review');
  select count(*) into v_approved from public.approvals where campaign_id = p_campaign and decision = 'approved' and approver = 'client';
  select count(*), count(*) filter (where status in ('deployed', 'verified')) into v_deploys, v_verified from public.deployments where campaign_id = p_campaign and environment = 'production';
  select count(*) into v_feedback from public.client_feedback where campaign_id = p_campaign and status = 'open';

  s_brief := case when v_journeys > 0 then 'done' else 'current' end;
  s_req := case when v_sow = 0 then 'not_started' when v_drafts = 0 and v_accepted > 0 and v_f_req = 0 then 'done' else 'current' end;
  s_design := case when v_designs = 0 then 'not_started' when v_f_design = 0 then 'done' else 'current' end;
  s_build := case when v_builds = 0 then 'not_started' when v_f_build = 0 then 'done' else 'current' end;
  s_launch := case when v_verified > 0 then 'done' when v_approved > 0 or v_deploys > 0 then 'current' else 'not_started' end;

  v_next := case
    when v_sow = 0 then jsonb_build_object('key', 'upload_sow', 'step', 'requirements', 'count', 0)
    when v_drafts > 0 then jsonb_build_object('key', 'verify_requirements', 'step', 'requirements', 'count', v_drafts)
    when v_designs = 0 then jsonb_build_object('key', 'submit_designs', 'step', 'design', 'count', 0)
    when v_f_req + v_f_design + v_f_build > 0 then jsonb_build_object('key', 'review_findings', 'step', 'inbox', 'count', v_f_req + v_f_design + v_f_build)
    when v_builds = 0 then jsonb_build_object('key', 'submit_build', 'step', 'build', 'count', 0)
    when v_approved = 0 then jsonb_build_object('key', 'record_approval', 'step', 'launch', 'count', v_feedback)
    when v_deploys = 0 then jsonb_build_object('key', 'plan_deployment', 'step', 'launch', 'count', 0)
    else null end;

  return jsonb_build_object(
    'steps', jsonb_build_array(
      jsonb_build_object('id', 'brief', 'state', s_brief, 'open', 0),
      jsonb_build_object('id', 'requirements', 'state', s_req, 'open', v_drafts + v_f_req),
      jsonb_build_object('id', 'design', 'state', s_design, 'open', v_f_design),
      jsonb_build_object('id', 'build', 'state', s_build, 'open', v_f_build),
      jsonb_build_object('id', 'launch', 'state', s_launch, 'open', v_feedback)),
    'next', v_next,
    'counts', jsonb_build_object('journeys', v_journeys, 'sow_versions', v_sow, 'drafts', v_drafts, 'accepted', v_accepted, 'designs', v_designs, 'builds', v_builds,
                                 'findings_awaiting', v_f_req + v_f_design + v_f_build, 'client_approvals', v_approved, 'deployments', v_deploys, 'open_feedback', v_feedback));
end $$;
grant execute on function public.campaign_progress(uuid) to authenticated;

-- ---------------------------------------------------------------- 4. Home and the portfolio report, one call each
create or replace function public.home_summary() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'metrics', jsonb_build_object(
      'active', (select count(*) from public.campaigns where status = 'active'),
      'at_risk', (select count(*) from public.campaigns where status = 'active' and health = 'at_risk'),
      'blocked', (select count(*) from public.campaigns where status = 'active' and health = 'blocked'),
      'findings_awaiting', (select count(*) from public.findings where status in ('new', 'awaiting_review')),
      'critical_open', (select count(*) from public.findings where severity = 'critical' and status not in ('dismissed', 'fixed', 'verified')),
      'overdue_tasks', (select count(*) from public.tasks where due_date < current_date and status <> 'done'),
      'launching_soon', (select count(*) from public.campaigns where status = 'active' and target_launch_date between current_date and current_date + 14)),
    'attention', coalesce((
      select jsonb_agg(x order by x->>'rank', x->>'name') from (
        select jsonb_build_object('campaign_id', c.id, 'name', c.name,
                 'kind', case when c.health = 'blocked' then 'blocked' when c.health = 'at_risk' then 'at_risk' else 'findings' end,
                 'count', (select count(*) from public.findings f where f.campaign_id = c.id and f.status in ('new', 'awaiting_review')),
                 'rank', case when c.health = 'blocked' then '1' when c.health = 'at_risk' then '2' else '3' end) as x
          from public.campaigns c
         where c.status = 'active'
           and (c.health <> 'on_track' or exists (select 1 from public.findings f where f.campaign_id = c.id and f.status in ('new', 'awaiting_review')))
         limit 8) q), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object('campaign_id', c.id, 'name', c.name, 'target_launch_date', c.target_launch_date, 'health', c.health) order by c.target_launch_date)
        from (select * from public.campaigns where status = 'active' and target_launch_date >= current_date order by target_launch_date limit 8) c), '[]'::jsonb))
$$;
grant execute on function public.home_summary() to authenticated;

create or replace function public.portfolio_report() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'client', cl.name, 'stage', c.stage, 'status', c.status, 'health', c.health, 'priority', c.priority,
    'design_status', c.design_status, 'development_status', c.development_status, 'qa_status', c.qa_status, 'uat_status', c.uat_status,
    'start_date', c.start_date, 'target_launch_date', c.target_launch_date,
    'requirements_accepted', (select count(*) from public.requirements r where r.campaign_id = c.id and r.status = 'accepted'),
    'requirements_total', (select count(*) from public.requirements r where r.campaign_id = c.id),
    'findings_open', (select count(*) from public.findings f where f.campaign_id = c.id and f.status not in ('dismissed', 'fixed', 'verified')),
    'critical_open', (select count(*) from public.findings f where f.campaign_id = c.id and f.severity = 'critical' and f.status not in ('dismissed', 'fixed', 'verified')),
    'tasks_open', (select count(*) from public.tasks t where t.campaign_id = c.id and t.status <> 'done')
  ) order by c.created_at desc), '[]'::jsonb)
  from public.campaigns c left join public.clients cl on cl.id = c.client_id
$$;
grant execute on function public.portfolio_report() to authenticated;
