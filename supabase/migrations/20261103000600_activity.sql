-- Activity log written by triggers on every change to campaign records. Users cannot write it directly.

create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  r jsonb := coalesce(n, o);
  v_campaign uuid;
  v_before jsonb := null;
  v_after jsonb := null;
  k text;
  v_label text;
  v_action text := lower(tg_op);
  ignored text[] := array['updated_at', 'version', 'created_at', 'created_by', 'input', 'object_paths', 'heartbeat_at',
                          'credentials_secret_id', 'ai_original', 'edited_at', 'decided_at', 'claimed_by', 'started_at',
                          'next_attempt_at', 'attempts', 'error_detail', 'edited_by', 'decided_by', 'completed_at'];
begin
  v_campaign := case when tg_table_name = 'campaigns' then (r->>'id')::uuid else (r->>'campaign_id')::uuid end;

  if tg_op = 'UPDATE' then
    v_before := '{}'; v_after := '{}';
    for k in select jsonb_object_keys(n) loop
      if k = any(ignored) then continue; end if;
      if (o->k) is distinct from (n->k) then
        v_before := v_before || jsonb_build_object(k, o->k);
        v_after := v_after || jsonb_build_object(k, n->k);
      end if;
    end loop;
    if v_after = '{}'::jsonb then return null; end if;
    if tg_table_name = 'review_jobs' and not (v_after ? 'status') then return null; end if;
    if v_after ? 'status' then v_action := 'status_changed'; end if;
  elsif tg_op = 'INSERT' then
    v_after := n - ignored;
  else
    v_before := o - ignored;
  end if;

  v_label := coalesce(r->>'ref', r->>'title', r->>'name', r->>'subject_label', r->>'summary', r->>'file_name',
                      r->>'version_label', r->>'screen_name', r->>'url', r->>'review_type', left(r->>'body', 80));

  -- When a campaign is deleted the FK would cascade; keep the row workspace-scoped instead.
  if tg_table_name = 'campaigns' and tg_op = 'DELETE' then v_campaign := null; end if;

  insert into public.activity_logs (workspace_id, campaign_id, entity_type, entity_id, action, summary, before, after, actor_id, created_by)
  values (
    coalesce((r->>'workspace_id')::uuid, (select workspace_id from public.campaigns where id = v_campaign)),
    case when tg_op = 'DELETE' and tg_table_name <> 'campaigns'
              and not exists (select 1 from public.campaigns where id = v_campaign) then null else v_campaign end,
    tg_table_name, (r->>'id')::uuid, v_action, v_label, v_before, v_after, auth.uid(), auth.uid());
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['campaigns', 'journeys', 'campaign_members', 'tasks', 'task_comments', 'sow_versions',
                           'requirements', 'design_submissions', 'findings', 'review_jobs', 'test_environments',
                           'development_submissions', 'qa_test_cases', 'approvals', 'client_feedback', 'deployments',
                           'milestones', 'documents']
  loop
    execute format('create trigger log_activity after insert or update or delete on public.%I
                    for each row execute function public.log_activity()', t);
  end loop;
end $$;

-- Approvals are append-only: corrections are recorded as a new decision.
create or replace function public.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% records are append-only', tg_table_name using errcode = '42501';
end $$;
create trigger approvals_append_only before update or delete on public.approvals
for each row execute function public.forbid_change();
create trigger activity_append_only before update or delete on public.activity_logs
for each row when (pg_trigger_depth() = 0) execute function public.forbid_change();
