-- Read models and bulk operations used by the web app. Invoker functions respect RLS.

create or replace function public.dashboard_summary() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'active', (select count(*) from public.campaigns where status = 'active'),
    'awaiting_design_approval', (select count(*) from public.campaigns
        where status = 'active' and stage = 'design' and design_status in ('in_review', 'awaiting_client')),
    'in_development', (select count(*) from public.campaigns where status = 'active' and stage = 'development'),
    'pending_internal_qa', (select count(*) from public.campaigns
        where status = 'active' and stage = 'internal_qa' and qa_status <> 'approved'),
    'awaiting_client_uat', (select count(*) from public.campaigns
        where status = 'active' and stage = 'client_uat' and uat_status <> 'approved'),
    'critical_open_findings', (select count(*) from public.findings
        where severity = 'critical' and status not in ('dismissed', 'fixed', 'verified')),
    'findings_awaiting_review', (select count(*) from public.findings where status in ('new', 'awaiting_review')),
    'overdue_tasks', (select count(*) from public.tasks where due_date < current_date and status <> 'done'),
    'upcoming_launches', (select count(*) from public.campaigns
        where status = 'active' and target_launch_date between current_date and current_date + 14)
  )
$$;

-- Notion CSV import. Rows arrive already mapped to CampaignOS fields; values are validated here.
-- With p_dry_run the whole import is rolled back and only the plan is returned.
create or replace function public.import_campaigns(p_rows jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  ws uuid := public.auth_workspace();
  x jsonb;
  i int := 0;
  results jsonb := '[]';
  v_client uuid;
  v_campaign uuid;
  v_action text;
  v_journey text;
  n_create int := 0;
  n_update int := 0;
  n_error int := 0;
begin
  if not public.is_manager_or_admin() then
    raise exception 'Only a Manager or Admin can import campaigns' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Expected an array of rows' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'Import at most 500 rows at a time' using errcode = '22023'; end if;

  begin
    for x in select * from jsonb_array_elements(p_rows) loop
      i := i + 1;
      begin
        if coalesce(trim(x->>'name'), '') = '' then raise exception 'Campaign name is empty'; end if;

        v_client := null;
        if coalesce(trim(x->>'client'), '') <> '' then
          select id into v_client from public.clients where workspace_id = ws and lower(name) = lower(trim(x->>'client'));
          if v_client is null then
            insert into public.clients (workspace_id, name) values (ws, trim(x->>'client')) returning id into v_client;
          end if;
        end if;

        select id into v_campaign from public.campaigns
        where workspace_id = ws and lower(name) = lower(trim(x->>'name')) and client_id is not distinct from v_client;

        if v_campaign is null then
          insert into public.campaigns (workspace_id, client_id, name, description, stage, status, priority,
            start_date, target_launch_date, staging_url, production_url, notes)
          values (ws, v_client, trim(x->>'name'), nullif(x->>'description', ''),
            coalesce(nullif(x->>'stage', '')::public.campaign_stage, 'brief_planning'),
            coalesce(nullif(x->>'status', '')::public.campaign_status, 'active'),
            coalesce(nullif(x->>'priority', '')::public.priority, 'medium'),
            nullif(x->>'start_date', '')::date, nullif(x->>'target_launch_date', '')::date,
            nullif(x->>'staging_url', ''), nullif(x->>'production_url', ''), nullif(x->>'notes', ''))
          returning id into v_campaign;
          insert into public.campaign_members (campaign_id, user_id, campaign_role)
          values (v_campaign, auth.uid(), 'primary_manager') on conflict do nothing;
          v_action := 'create'; n_create := n_create + 1;
        else
          update public.campaigns set
            description = coalesce(nullif(x->>'description', ''), description),
            stage = coalesce(nullif(x->>'stage', '')::public.campaign_stage, stage),
            status = coalesce(nullif(x->>'status', '')::public.campaign_status, status),
            priority = coalesce(nullif(x->>'priority', '')::public.priority, priority),
            start_date = coalesce(nullif(x->>'start_date', '')::date, start_date),
            target_launch_date = coalesce(nullif(x->>'target_launch_date', '')::date, target_launch_date),
            staging_url = coalesce(nullif(x->>'staging_url', ''), staging_url),
            production_url = coalesce(nullif(x->>'production_url', ''), production_url),
            notes = coalesce(nullif(x->>'notes', ''), notes)
          where id = v_campaign;
          v_action := 'update'; n_update := n_update + 1;
        end if;

        for v_journey in select trim(j) from unnest(string_to_array(coalesce(x->>'journeys', ''), ';')) j where trim(j) <> '' loop
          if not exists (select 1 from public.journeys where campaign_id = v_campaign and lower(name) = lower(v_journey)) then
            insert into public.journeys (campaign_id, name, sort_order)
            values (v_campaign, v_journey, (select coalesce(max(sort_order), -1) + 1 from public.journeys where campaign_id = v_campaign));
          end if;
        end loop;

        results := results || jsonb_build_object('row', i, 'name', x->>'name', 'action', v_action);
      exception when others then
        n_error := n_error + 1;
        results := results || jsonb_build_object('row', i, 'name', x->>'name', 'action', 'error', 'message', sqlerrm);
      end;
    end loop;

    if p_dry_run then raise exception using errcode = 'P0001', message = 'DRY_RUN_ROLLBACK'; end if;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'DRY_RUN_ROLLBACK' then raise; end if;
  end;

  return jsonb_build_object('dry_run', p_dry_run, 'create', n_create, 'update', n_update, 'error', n_error, 'rows', results);
end $$;

create or replace function public.storage_usage() returns jsonb
language plpgsql stable security definer set search_path = public, storage as $$
begin
  if not public.is_manager_or_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'buckets', coalesce((select jsonb_object_agg(bucket_id, bytes) from (
        select bucket_id, sum(coalesce((metadata->>'size')::bigint, 0)) bytes from storage.objects group by bucket_id) b), '{}'),
    'database_bytes', pg_database_size(current_database()));
end $$;

create or replace function public.campaign_report(p_campaign uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'requirements', (select coalesce(jsonb_object_agg(status, n), '{}') from
        (select status, count(*) n from public.requirements where campaign_id = p_campaign group by status) s),
    'findings_by_severity', (select coalesce(jsonb_object_agg(severity, n), '{}') from
        (select severity, count(*) n from public.findings where campaign_id = p_campaign and status not in ('dismissed') group by severity) s),
    'findings_by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from
        (select status, count(*) n from public.findings where campaign_id = p_campaign group by status) s),
    'tasks', (select coalesce(jsonb_object_agg(status, n), '{}') from
        (select status, count(*) n from public.tasks where campaign_id = p_campaign group by status) s),
    'overdue_tasks', (select count(*) from public.tasks where campaign_id = p_campaign and due_date < current_date and status <> 'done'),
    'compliance', (select coalesce(jsonb_object_agg(result, n), '{}') from (
        select result, count(*) n from (
          select distinct on (requirement_id) requirement_id, result from public.requirement_checks
          where campaign_id = p_campaign order by requirement_id, created_at desc) latest group by result) s),
    'accepted_requirements', (select count(*) from public.requirements where campaign_id = p_campaign and status = 'accepted'),
    'reviews', (select coalesce(jsonb_object_agg(status, n), '{}') from
        (select status, count(*) n from public.review_jobs where campaign_id = p_campaign group by status) s)
  )
$$;

-- Realtime: AI status indicator, job progress, notifications.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.worker_status, public.review_jobs, public.notifications;
  end if;
end $$;
