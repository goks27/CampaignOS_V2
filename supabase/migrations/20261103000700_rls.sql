-- Row Level Security on every table. Hiding UI is not a permission.

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Anonymous visitors get nothing.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------- workspace-level
create policy ws_read on public.workspaces for select to authenticated
  using (public.is_human_member() and id = public.auth_workspace());
create policy ws_update on public.workspaces for update to authenticated
  using (public.is_admin() and id = public.auth_workspace());

create policy settings_read on public.workspace_settings for select to authenticated
  using (public.is_human_member() and workspace_id = public.auth_workspace());
create policy settings_update on public.workspace_settings for update to authenticated
  using (public.is_admin() and workspace_id = public.auth_workspace())
  with check (public.is_admin() and workspace_id = public.auth_workspace());

create policy profiles_read on public.profiles for select to authenticated
  using (public.is_human_member() or id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy members_read on public.workspace_members for select to authenticated
  using ((public.is_human_member() and workspace_id = public.auth_workspace()) or user_id = auth.uid());
-- Role and activation changes go through set_member_role / set_member_active only.

create policy worker_status_read on public.worker_status for select to authenticated
  using (public.is_human_member());

create policy notifications_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy clients_read on public.clients for select to authenticated
  using (public.is_human_member() and workspace_id = public.auth_workspace());
create policy clients_insert on public.clients for insert to authenticated
  with check (public.is_manager_or_admin() and workspace_id = public.auth_workspace());
create policy clients_update on public.clients for update to authenticated
  using (public.is_manager_or_admin() and workspace_id = public.auth_workspace());
create policy clients_delete on public.clients for delete to authenticated
  using (public.is_admin() and workspace_id = public.auth_workspace());

-- ---------------------------------------------------------------- campaigns
-- Evaluated on the row itself (not via can_read_campaign) so INSERT ... RETURNING works.
create policy campaigns_read on public.campaigns for select to authenticated
  using ((public.is_manager_or_admin() and workspace_id = public.auth_workspace())
         or (public.auth_role() in ('team_member', 'viewer') and public.is_campaign_member(id)));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check (public.is_manager_or_admin() and workspace_id = public.auth_workspace());
create policy campaigns_update on public.campaigns for update to authenticated
  using (public.is_manager_or_admin() and workspace_id = public.auth_workspace())
  with check (public.is_manager_or_admin() and workspace_id = public.auth_workspace());
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (public.is_admin() and public.can_read_campaign(id));

-- ---------------------------------------------------------------- standard campaign-scoped tables:
-- read = can_read_campaign, write = can_manage_campaign
do $$
declare t text;
begin
  foreach t in array array['campaign_members', 'journeys', 'sow_documents', 'sow_versions', 'requirements',
                           'test_environments', 'qa_test_cases', 'client_feedback', 'deployments', 'milestones',
                           'documents', 'findings']
  loop
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (public.can_read_campaign(campaign_id))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.can_manage_campaign(campaign_id))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.can_manage_campaign(campaign_id)) with check (public.can_manage_campaign(campaign_id))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.can_manage_campaign(campaign_id))', t);
  end loop;

  -- read-only to users (written by SECURITY DEFINER functions)
  foreach t in array array['sow_pages', 'requirement_checks', 'dev_captures', 'qa_test_runs', 'qa_test_results', 'review_jobs']
  loop
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (public.can_read_campaign(campaign_id))', t);
  end loop;

  -- team members on the campaign can submit work; they may edit what they created
  foreach t in array array['design_submissions', 'design_assets', 'development_submissions']
  loop
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (public.can_read_campaign(campaign_id))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.can_contribute(campaign_id))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.can_manage_campaign(campaign_id) or (public.can_contribute(campaign_id) and created_by = auth.uid())) with check (public.can_contribute(campaign_id))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.can_manage_campaign(campaign_id) or (public.can_contribute(campaign_id) and created_by = auth.uid()))', t);
  end loop;
end $$;

create policy finding_evidence_read on public.finding_evidence for select to authenticated
  using (public.can_read_campaign(campaign_id));
create policy finding_evidence_insert on public.finding_evidence for insert to authenticated
  with check (public.can_manage_campaign(campaign_id));

create policy approvals_read on public.approvals for select to authenticated
  using (public.can_read_campaign(campaign_id));
create policy approvals_insert on public.approvals for insert to authenticated
  with check (public.can_manage_campaign(campaign_id));

-- ---------------------------------------------------------------- tasks
create policy tasks_read on public.tasks for select to authenticated
  using (public.can_read_campaign(campaign_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.can_manage_campaign(campaign_id));
-- Team members reach only their own tasks; the trigger limits them to the status field.
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_manage_campaign(campaign_id)
         or (assignee_id = auth.uid() and public.auth_role() = 'team_member' and public.can_read_campaign(campaign_id)))
  with check (public.can_read_campaign(campaign_id));
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.can_manage_campaign(campaign_id));

create policy task_comments_read on public.task_comments for select to authenticated
  using (public.can_read_campaign(campaign_id));
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (public.can_contribute(campaign_id) and coalesce(created_by, auth.uid()) = auth.uid()
              and exists (select 1 from public.tasks t where t.id = task_id and t.campaign_id = task_comments.campaign_id));
create policy task_comments_update on public.task_comments for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy task_comments_delete on public.task_comments for delete to authenticated
  using (created_by = auth.uid() or public.can_manage_campaign(campaign_id));

-- ---------------------------------------------------------------- activity (no write policies at all)
create policy activity_read on public.activity_logs for select to authenticated
  using ((campaign_id is not null and public.can_read_campaign(campaign_id))
         or (campaign_id is null and public.is_manager_or_admin() and workspace_id is not distinct from public.auth_workspace()));

-- campaign_counters: RLS on, no policies; only next_ref() touches it.
