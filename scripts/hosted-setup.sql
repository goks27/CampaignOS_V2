-- ===== 20261103000100_core.sql =====
-- CampaignOS core: enums, workspace, profiles, members, settings, shared helpers.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- enums
create type public.workspace_role as enum ('admin', 'manager', 'team_member', 'viewer', 'worker');
create type public.campaign_stage as enum ('brief_planning', 'design', 'development', 'internal_qa', 'client_uat', 'live_deployment', 'completed');
create type public.campaign_status as enum ('active', 'on_hold', 'completed', 'archived');
create type public.track_status as enum ('not_started', 'in_progress', 'in_review', 'awaiting_client', 'changes_requested', 'approved');
create type public.health as enum ('on_track', 'at_risk', 'blocked');
create type public.priority as enum ('low', 'medium', 'high', 'critical');
create type public.task_status as enum ('todo', 'in_progress', 'ready_for_review', 'done', 'blocked');
create type public.campaign_role as enum ('primary_manager', 'supporting_manager', 'designer', 'developer', 'qa_owner', 'member');

-- ---------------------------------------------------------------- shared trigger: updated_at + version
create or replace function public.touch_row() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
    new.version := 1;
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- workspace
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create trigger touch before insert or update on public.workspaces for each row execute function public.touch_row();

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create trigger touch before insert or update on public.profiles for each row execute function public.touch_row();

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'viewer',
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1,
  unique (workspace_id, user_id)
);
create index on public.workspace_members (user_id);
create trigger touch before insert or update on public.workspace_members for each row execute function public.touch_row();

-- One row per workspace. Limits mirror CLAUDE.md defaults and are read by the worker.
create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  auto_triggers jsonb not null default jsonb_build_object(
    'sow_analysis', false, 'sow_vs_design', false, 'design_consistency', false,
    'design_vs_development', false, 'sow_vs_development', false, 'functional_qa', false, 'regression', false),
  limits jsonb not null default jsonb_build_object(
    'max_screens_per_review', 12, 'max_pdf_pages', 30, 'image_long_edge', 1600,
    'max_inference_seconds', 180, 'max_retries', 2, 'job_timeout_seconds', 1800),
  allowed_domains text[] not null default '{}',
  figma_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create trigger touch before insert or update on public.workspace_settings for each row execute function public.touch_row();

-- ---------------------------------------------------------------- role helpers
-- SECURITY DEFINER so policies can call them without recursive RLS.
create or replace function public.auth_role() returns public.workspace_role
language sql stable security definer set search_path = public as $$
  select role from public.workspace_members
  where user_id = auth.uid() and deactivated_at is null
  order by created_at limit 1
$$;

create or replace function public.auth_workspace() returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from public.workspace_members
  where user_id = auth.uid() and deactivated_at is null
  order by created_at limit 1
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() = 'admin', false)
$$;

create or replace function public.is_manager_or_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() in ('admin', 'manager'), false)
$$;

create or replace function public.is_human_member() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() in ('admin', 'manager', 'team_member', 'viewer'), false)
$$;

create or replace function public.is_worker() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() = 'worker', false)
$$;

-- ---------------------------------------------------------------- new users
-- Sign-up is disabled; users arrive by dashboard invite. The very first user
-- becomes Admin (and creates the workspace); everyone after starts as Viewer.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
  first_user boolean;
begin
  insert into public.profiles (id, email, full_name, created_by)
  values (new.id, coalesce(new.email, ''),
          coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
          new.id)
  on conflict (id) do nothing;

  select id into ws from public.workspaces order by created_at limit 1;
  if ws is null then
    insert into public.workspaces (name, created_by) values ('Octech', new.id) returning id into ws;
    insert into public.workspace_settings (workspace_id, created_by) values (ws, new.id);
  end if;

  select not exists (select 1 from public.workspace_members where role = 'admin') into first_user;
  insert into public.workspace_members (workspace_id, user_id, role, created_by)
  values (ws, new.id, case when first_user then 'admin'::public.workspace_role else 'viewer'::public.workspace_role end, new.id)
  on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Admin-only role management (also covers assigning the worker account).
create or replace function public.set_member_role(p_user uuid, p_role public.workspace_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an Admin can change roles' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then
    raise exception 'You cannot remove your own Admin role' using errcode = '22023';
  end if;
  update public.workspace_members set role = p_role where user_id = p_user;
end $$;

create or replace function public.set_member_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an Admin can deactivate members' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot deactivate yourself' using errcode = '22023'; end if;
  update public.workspace_members
     set deactivated_at = case when p_active then null else now() end
   where user_id = p_user;
end $$;

-- ===== 20261103000200_campaigns.sql =====
-- Clients, campaigns, members, journeys, per-campaign reference counters.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1,
  unique (workspace_id, name)
);
create trigger touch before insert or update on public.clients for each row execute function public.touch_row();

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  description text,
  stage public.campaign_stage not null default 'brief_planning',
  status public.campaign_status not null default 'active',
  priority public.priority not null default 'medium',
  health public.health not null default 'on_track',
  design_status public.track_status not null default 'not_started',
  development_status public.track_status not null default 'not_started',
  qa_status public.track_status not null default 'not_started',
  uat_status public.track_status not null default 'not_started',
  start_date date,
  target_launch_date date,
  staging_url text,
  production_url text,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.campaigns (workspace_id);
create index on public.campaigns (stage);
create index on public.campaigns (status);
create index on public.campaigns (target_launch_date);
create index on public.campaigns (client_id);
create trigger touch before insert or update on public.campaigns for each row execute function public.touch_row();

create table public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  campaign_role public.campaign_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1,
  unique (campaign_id, user_id, campaign_role)
);
create unique index campaign_one_primary_manager on public.campaign_members (campaign_id) where campaign_role = 'primary_manager';
create index on public.campaign_members (user_id);
create trigger touch before insert or update on public.campaign_members for each row execute function public.touch_row();

create table public.journeys (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  sort_order int not null default 0,
  stage public.campaign_stage not null default 'brief_planning',
  design_status public.track_status not null default 'not_started',
  development_status public.track_status not null default 'not_started',
  qa_status public.track_status not null default 'not_started',
  uat_status public.track_status not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.journeys (campaign_id);
create trigger touch before insert or update on public.journeys for each row execute function public.touch_row();

create table public.campaign_counters (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  kind text not null,
  n int not null default 0,
  primary key (campaign_id, kind)
);

-- Human-readable IDs such as REQ-014 or F-203, unique per campaign.
create or replace function public.next_ref(p_campaign uuid, p_kind text, p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into public.campaign_counters (campaign_id, kind, n) values (p_campaign, p_kind, 1)
  on conflict (campaign_id, kind) do update set n = public.campaign_counters.n + 1
  returning n into v;
  return p_prefix || '-' || lpad(v::text, 3, '0');
end $$;
revoke all on function public.next_ref(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- campaign access helpers
create or replace function public.is_campaign_member(p_campaign uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campaign_members where campaign_id = p_campaign and user_id = auth.uid())
$$;

-- Admin and Manager: every campaign in the workspace. Team member and Viewer: assigned ones.
-- The worker never reads campaigns directly.
create or replace function public.can_read_campaign(p_campaign uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.auth_role() in ('admin', 'manager') then
      exists (select 1 from public.campaigns c where c.id = p_campaign and c.workspace_id = public.auth_workspace())
    when public.auth_role() in ('team_member', 'viewer') then public.is_campaign_member(p_campaign)
    else false
  end
$$;

create or replace function public.can_manage_campaign(p_campaign uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager_or_admin() and public.can_read_campaign(p_campaign)
$$;

-- Managers, plus team members assigned to the campaign (uploads, comments, own tasks).
create or replace function public.can_contribute(p_campaign uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_campaign(p_campaign)
      or (public.auth_role() = 'team_member' and public.is_campaign_member(p_campaign))
$$;

-- ===== 20261103000300_tasks_activity.sql =====
-- Tasks, comments, activity log (append-only), notifications.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  journey_id uuid references public.journeys(id) on delete set null,
  ref text,
  title text not null check (length(trim(title)) > 0),
  description text,
  assignee_id uuid references public.profiles(id) on delete set null,
  status public.task_status not null default 'todo',
  priority public.priority not null default 'medium',
  due_date date,
  -- Traceability for tasks created from findings / client feedback (later phases add FKs).
  source_finding_id uuid,
  source_requirement_id uuid,
  source_submission_id uuid,
  source_feedback_id uuid,
  evidence jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.tasks (campaign_id);
create index on public.tasks (assignee_id);
create index on public.tasks (status);
create index on public.tasks (due_date);
create trigger touch before insert or update on public.tasks for each row execute function public.touch_row();

create or replace function public.tasks_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.ref is null then
    new.ref := public.next_ref(new.campaign_id, 'task', 'T');
  end if;
  if tg_op = 'UPDATE' then
    -- Team members may only move the status of their own tasks.
    if not public.is_manager_or_admin() then
      if old.assignee_id is distinct from auth.uid() then
        raise exception 'You can only update tasks assigned to you' using errcode = '42501';
      end if;
      if (new.title, new.description, new.assignee_id, new.priority, new.due_date, new.campaign_id, new.journey_id,
          new.source_finding_id, new.source_requirement_id, new.ref)
         is distinct from
         (old.title, old.description, old.assignee_id, old.priority, old.due_date, old.campaign_id, old.journey_id,
          old.source_finding_id, old.source_requirement_id, old.ref) then
        raise exception 'Team members can only change the status of their tasks' using errcode = '42501';
      end if;
    end if;
    if new.status = 'done' and old.status <> 'done' then new.completed_at := now(); end if;
    if new.status <> 'done' then new.completed_at := null; end if;
  end if;
  return new;
end $$;
create trigger tasks_before_write before insert or update on public.tasks
for each row execute function public.tasks_before_write();

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.task_comments (task_id);
create trigger touch before insert or update on public.task_comments for each row execute function public.touch_row();

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  summary text,
  before jsonb,
  after jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.activity_logs (campaign_id, created_at desc);
create index on public.activity_logs (created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  kind text not null,
  title text not null,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.notifications (user_id, read_at);
create trigger touch before insert or update on public.notifications for each row execute function public.touch_row();

-- Notify the assignee when a task is assigned or reassigned.
create or replace function public.notify_task_assignee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.assignee_id is distinct from auth.uid() then
    insert into public.notifications (user_id, campaign_id, kind, title, entity_type, entity_id)
    values (new.assignee_id, new.campaign_id, 'task_assigned', 'Assigned to you: ' || new.title, 'task', new.id);
  end if;
  return new;
end $$;
create trigger notify_task_assignee after insert or update of assignee_id on public.tasks
for each row execute function public.notify_task_assignee();

-- ===== 20261103000400_domain.sql =====
-- SOW, requirements, design submissions, findings, development, QA, delivery records.

create type public.review_type as enum (
  'sow_analysis', 'sow_vs_design', 'design_consistency',
  'design_vs_development', 'sow_vs_development', 'functional_qa', 'regression');
create type public.requirement_category as enum (
  'user_journey', 'screen', 'ui', 'functional', 'validation', 'business_rule', 'reward_logic',
  'api_integration', 'legal', 'performance', 'security', 'analytics', 'deployment');
create type public.requirement_status as enum ('draft', 'accepted', 'rejected', 'needs_clarification');
create type public.confidence as enum ('high', 'medium', 'low', 'needs_manual_verification');
create type public.severity as enum ('critical', 'high', 'medium', 'low', 'informational');
create type public.finding_status as enum (
  'new', 'awaiting_review', 'accepted', 'dismissed', 'assigned', 'in_progress',
  'ready_for_retest', 'fixed', 'verified', 'reopened');
-- CLAUDE.md verification states. `check_method` records HOW (PRD Â§8: visual / functional / backend).
create type public.verification_state as enum ('verified', 'failed', 'needs_verification', 'not_tested', 'blocked');
create type public.check_method as enum ('visually_observed', 'functionally_tested', 'backend_verified', 'manual');
create type public.submission_status as enum ('submitted', 'in_review', 'changes_requested', 'approved', 'superseded');
create type public.approval_decision as enum ('approved', 'changes_requested', 'rejected');
create type public.feedback_status as enum ('open', 'converted', 'closed');
create type public.deployment_status as enum ('planned', 'deployed', 'verified', 'rolled_back');

-- ================================================================ SOW
create table public.sow_documents (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.sow_documents (campaign_id);
create trigger touch before insert or update on public.sow_documents for each row execute function public.touch_row();

create table public.sow_versions (
  id uuid primary key default gen_random_uuid(),
  sow_document_id uuid not null references public.sow_documents(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  version_no int not null,
  storage_path text not null,
  file_name text not null,
  size_bytes bigint not null check (size_bytes > 0),
  content_hash text not null,
  page_count int,
  extraction_status text not null default 'uploaded'
    check (extraction_status in ('uploaded', 'queued', 'processing', 'extracted', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1,
  unique (sow_document_id, version_no)
);
create index on public.sow_versions (campaign_id);
create trigger touch before insert or update on public.sow_versions for each row execute function public.touch_row();

create table public.sow_pages (
  id uuid primary key default gen_random_uuid(),
  sow_version_id uuid not null references public.sow_versions(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  page_no int not null,
  method text not null check (method in ('text', 'ocr', 'skipped')),
  text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1,
  unique (sow_version_id, page_no)
);
create trigger touch before insert or update on public.sow_pages for each row execute function public.touch_row();

-- ================================================================ requirements
create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  journey_id uuid references public.journeys(id) on delete set null,
  journey_hint text,
  ref text not null,
  title text not null,
  description text not null default '',
  category public.requirement_category not null default 'functional',
  priority public.priority not null default 'medium',
  acceptance_criteria text,
  source_version_id uuid references public.sow_versions(id) on delete set null,
  source_pages int[] not null default '{}',
  source_text text,
  status public.requirement_status not null default 'draft',
  confidence public.confidence,
  origin text not null default 'ai' check (origin in ('ai', 'manual')),
  ai_original jsonb,
  review_job_id uuid,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1,
  unique (campaign_id, ref)
);
create index on public.requirements (campaign_id, status);
create index on public.requirements (journey_id);
create trigger touch before insert or update on public.requirements for each row execute function public.touch_row();

create or replace function public.requirements_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and (new.ref is null or new.ref = '') then
    new.ref := public.next_ref(new.campaign_id, 'requirement', 'REQ');
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end $$;
create trigger requirements_before_write before insert or update on public.requirements
for each row execute function public.requirements_before_write();

-- ================================================================ design
create table public.design_submissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  journey_id uuid references public.journeys(id) on delete set null,
  title text not null,
  version_no int not null default 1,
  source text not null default 'upload' check (source in ('upload', 'figma')),
  figma_url text,
  status public.submission_status not null default 'submitted',
  notes text,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.design_submissions (campaign_id);
create trigger touch before insert or update on public.design_submissions for each row execute function public.touch_row();

create table public.design_assets (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.design_submissions(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  screen_name text not null,
  screen_type text not null default 'screen',
  bucket text not null default 'designs' check (bucket in ('designs', 'captures')),  -- captures = exported from Figma by the worker
  storage_path text not null,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  width int not null check (width > 0),
  height int not null check (height > 0),
  original_width int not null check (original_width > 0),
  original_height int not null check (original_height > 0),
  content_hash text not null,
  source_file text,
  page_number int,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.design_assets (submission_id);
create index on public.design_assets (content_hash);
create trigger touch before insert or update on public.design_assets for each row execute function public.touch_row();

-- ================================================================ development
create table public.test_environments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  base_url text not null check (base_url ~* '^https?://'),
  allowed_domains text[] not null default '{}',
  access_notes text,
  credentials_secret_id uuid,   -- vault.secrets id; never readable by users
  has_credentials boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.test_environments (campaign_id);
create trigger touch before insert or update on public.test_environments for each row execute function public.touch_row();

create table public.development_submissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  journey_id uuid references public.journeys(id) on delete set null,
  environment_id uuid references public.test_environments(id) on delete set null,
  design_submission_id uuid references public.design_submissions(id) on delete set null,
  version_label text not null,
  staging_url text not null check (staging_url ~* '^https?://'),
  developer_id uuid references public.profiles(id),
  devices text[] not null default '{desktop,mobile}',
  browsers text[] not null default '{chromium}',
  page_paths text[] not null default '{/}',
  notes text,
  status public.submission_status not null default 'submitted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.development_submissions (campaign_id);
create trigger touch before insert or update on public.development_submissions for each row execute function public.touch_row();

create table public.dev_captures (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  development_submission_id uuid not null references public.development_submissions(id) on delete cascade,
  review_job_id uuid,
  url text not null,
  viewport text not null,
  storage_path text,
  width int,
  height int,
  design_asset_id uuid references public.design_assets(id) on delete set null,
  diff_ratio numeric,
  diff_regions jsonb not null default '[]',
  console_messages jsonb not null default '[]',
  failed_requests jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.dev_captures (development_submission_id);
create trigger touch before insert or update on public.dev_captures for each row execute function public.touch_row();

create table public.qa_test_cases (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  journey_id uuid references public.journeys(id) on delete set null,
  requirement_id uuid references public.requirements(id) on delete set null,
  title text not null,
  -- Ordered steps: {"action": "goto|fill|click|select|check|expect_text|expect_url|expect_visible|wait", "target": "...", "value": "..."}
  steps jsonb not null default '[]',
  expected text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.qa_test_cases (campaign_id);
create trigger touch before insert or update on public.qa_test_cases for each row execute function public.touch_row();

create table public.qa_test_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  development_submission_id uuid references public.development_submissions(id) on delete cascade,
  review_job_id uuid,
  summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create trigger touch before insert or update on public.qa_test_runs for each row execute function public.touch_row();

create table public.qa_test_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qa_test_runs(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  test_case_id uuid references public.qa_test_cases(id) on delete set null,
  result public.verification_state not null,
  actual text,
  error text,
  duration_ms int,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.qa_test_results (run_id);
create trigger touch before insert or update on public.qa_test_results for each row execute function public.touch_row();

-- ================================================================ findings
create table public.findings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  journey_id uuid references public.journeys(id) on delete set null,
  review_job_id uuid,
  review_type public.review_type not null,
  ref text not null,
  title text not null,
  severity public.severity not null default 'medium',
  description text not null default '',
  expected text,
  observed text,
  suggested_correction text,
  confidence public.confidence not null default 'medium',
  evidence_note text,
  requirement_id uuid references public.requirements(id) on delete set null,
  additional_observation boolean not null default false,
  design_submission_id uuid references public.design_submissions(id) on delete set null,
  design_asset_id uuid references public.design_assets(id) on delete set null,
  development_submission_id uuid references public.development_submissions(id) on delete set null,
  dev_capture_id uuid references public.dev_captures(id) on delete set null,
  affected_page text,
  test_scenario text,
  reproducibility text,
  status public.finding_status not null default 'awaiting_review',
  owner_id uuid references public.profiles(id),
  feedback jsonb,
  ai_original jsonb,
  edited_by uuid references public.profiles(id),
  edited_at timestamptz,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1,
  unique (campaign_id, ref),
  constraint finding_linked check (requirement_id is not null or additional_observation)
);
create index on public.findings (campaign_id, status);
create index on public.findings (severity);
create index on public.findings (owner_id);
create index on public.findings (design_asset_id);
create trigger touch before insert or update on public.findings for each row execute function public.touch_row();

create table public.finding_evidence (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  design_asset_id uuid references public.design_assets(id) on delete set null,
  dev_capture_id uuid references public.dev_captures(id) on delete set null,
  kind text not null default 'region' check (kind in ('region', 'console', 'network', 'note')),
  -- Normalised 0-1 relative to the original image: {"x":..,"y":..,"w":..,"h":..}
  region jsonb,
  approximate boolean not null default true,
  data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1,
  constraint region_normalised check (
    region is null or (
      (region->>'x')::numeric between 0 and 1 and (region->>'y')::numeric between 0 and 1 and
      (region->>'w')::numeric between 0 and 1 and (region->>'h')::numeric between 0 and 1))
);
create index on public.finding_evidence (finding_id);
create trigger touch before insert or update on public.finding_evidence for each row execute function public.touch_row();

-- Requirements the AI could not judge, plus SOW compliance results per requirement.
create table public.requirement_checks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  review_job_id uuid,
  review_type public.review_type not null,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  result public.verification_state not null,
  method public.check_method,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.requirement_checks (campaign_id, requirement_id);
create trigger touch before insert or update on public.requirement_checks for each row execute function public.touch_row();

create or replace function public.findings_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and (new.ref is null or new.ref = '') then
    new.ref := public.next_ref(new.campaign_id, 'finding', 'F');
  end if;
  if tg_op = 'UPDATE' then
    -- The original AI output is immutable once written.
    new.ai_original := old.ai_original;
    if (new.title, new.description, new.expected, new.observed, new.suggested_correction, new.severity, new.feedback)
       is distinct from
       (old.title, old.description, old.expected, old.observed, old.suggested_correction, old.severity, old.feedback) then
      new.edited_by := auth.uid();
      new.edited_at := now();
    end if;
    if new.status is distinct from old.status then
      new.decided_by := auth.uid();
      new.decided_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger findings_before_write before insert or update on public.findings
for each row execute function public.findings_before_write();

-- Task progress moves the linked finding (never to "verified": that needs a review or a manager).
create or replace function public.sync_finding_from_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source_finding_id is null or new.status is not distinct from old.status then return new; end if;
  update public.findings f set status = case new.status
      when 'in_progress' then 'in_progress'::public.finding_status
      when 'ready_for_review' then 'ready_for_retest'::public.finding_status
      when 'done' then 'fixed'::public.finding_status
      else f.status end
  where f.id = new.source_finding_id and f.status not in ('verified', 'dismissed');
  return new;
end $$;
create trigger sync_finding_from_task after update of status on public.tasks
for each row execute function public.sync_finding_from_task();

alter table public.tasks
  add constraint tasks_source_finding_fk foreign key (source_finding_id) references public.findings(id) on delete set null,
  add constraint tasks_source_requirement_fk foreign key (source_requirement_id) references public.requirements(id) on delete set null;

-- ================================================================ delivery
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  journey_id uuid references public.journeys(id) on delete set null,
  subject_type text not null check (subject_type in ('design_submission', 'development_submission', 'stage', 'deployment', 'requirements_baseline')),
  subject_id uuid,
  subject_label text not null,
  approver text not null check (approver in ('internal', 'client')),
  client_contact text,
  decision public.approval_decision not null,
  note text,
  decided_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.approvals (campaign_id, created_at desc);
create trigger touch before insert on public.approvals for each row execute function public.touch_row();

create table public.client_feedback (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  journey_id uuid references public.journeys(id) on delete set null,
  channel text not null default 'email' check (channel in ('email', 'call', 'meeting', 'chat', 'other')),
  client_contact text,
  received_on date not null default current_date,
  summary text not null,
  details text,
  status public.feedback_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.client_feedback (campaign_id);
create trigger touch before insert or update on public.client_feedback for each row execute function public.touch_row();
alter table public.tasks add constraint tasks_source_feedback_fk foreign key (source_feedback_id) references public.client_feedback(id) on delete set null;

create table public.deployments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  environment text not null default 'production' check (environment in ('staging', 'production')),
  url text not null check (url ~* '^https?://'),
  version_label text,
  status public.deployment_status not null default 'planned',
  planned_for date,
  deployed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.deployments (campaign_id);
create trigger touch before insert or update on public.deployments for each row execute function public.touch_row();

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  journey_id uuid references public.journeys(id) on delete set null,
  title text not null,
  stage public.campaign_stage,
  due_date date not null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.milestones (campaign_id, due_date);
create trigger touch before insert or update on public.milestones for each row execute function public.touch_row();

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  kind text not null default 'other' check (kind in ('brief', 'legal', 'creative', 'technical', 'client', 'other')),
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.documents (campaign_id);
create trigger touch before insert or update on public.documents for each row execute function public.touch_row();

-- ===== 20261103000500_jobs.sql =====
-- Review job queue, worker status, and the SECURITY DEFINER functions the worker uses.

create type public.job_status as enum ('queued', 'processing', 'completed', 'failed', 'cancelled');

create table public.review_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  review_type public.review_type not null,
  source jsonb not null,
  source_hash text not null,
  input jsonb not null default '{}',
  object_paths text[] not null default '{}',   -- "bucket/path" the worker may read while it holds the job
  status public.job_status not null default 'queued',
  attempts int not null default 0,
  max_attempts int not null default 3,
  next_attempt_at timestamptz not null default now(),
  cancel_requested boolean not null default false,
  run_again boolean not null default false,
  triggered_by text not null default 'manual' check (triggered_by in ('manual', 'automatic')),
  claimed_by uuid,
  worker_name text,
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  error text,
  error_detail jsonb,
  prompt_version text,
  model text,
  context_size int,
  duration_ms int,
  tokens_in int,
  tokens_out int,
  result_summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.review_jobs (status, next_attempt_at, created_at);
create index on public.review_jobs (campaign_id, created_at desc);
create index on public.review_jobs (campaign_id, review_type, source_hash);
create trigger touch before insert or update on public.review_jobs for each row execute function public.touch_row();

create table public.worker_status (
  id uuid primary key default gen_random_uuid(),
  worker_name text not null unique,
  worker_user_id uuid not null,
  last_seen_at timestamptz not null default now(),
  model text,
  model_ready boolean not null default false,
  model_message text,
  accelerator text not null default 'unknown' check (accelerator in ('gpu', 'cpu', 'unknown')),
  busy boolean not null default false,
  current_job_id uuid,
  info jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create trigger touch before insert or update on public.worker_status for each row execute function public.touch_row();

-- ---------------------------------------------------------------- helpers
create or replace function public.workspace_limits(p_campaign uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(s.limits, '{}'::jsonb)
  from public.campaigns c left join public.workspace_settings s on s.workspace_id = c.workspace_id
  where c.id = p_campaign
$$;

create or replace function public.accepted_requirements_json(p_campaign uuid, p_journey uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'ref', r.ref, 'title', r.title, 'description', r.description,
      'category', r.category, 'acceptance_criteria', r.acceptance_criteria,
      'source_text', r.source_text, 'journey_id', r.journey_id, 'version', r.version)
    order by r.ref), '[]'::jsonb)
  from public.requirements r
  where r.campaign_id = p_campaign and r.status = 'accepted'
    and (p_journey is null or r.journey_id = p_journey or r.journey_id is null)
$$;

-- Internal: builds the job input, checks limits and duplicates, inserts the job.
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

  -- dev captures are written under <campaign>/<job>/ â€” now that we have the id, pin the prefix
  if p_type not in ('sow_analysis', 'sow_vs_design', 'design_consistency') or (v_input->>'source') = 'figma' then
    update public.review_jobs set input = input || jsonb_build_object('capture_prefix', p_campaign::text || '/' || v_id::text || '/')
    where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public._enqueue_review(uuid, public.review_type, jsonb, boolean, text, uuid) from public, anon, authenticated;

create or replace function public.enqueue_review(
  p_campaign uuid, p_type public.review_type, p_source jsonb, p_run_again boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_campaign(p_campaign) then
    raise exception 'Only a Manager or Admin can start a review' using errcode = '42501';
  end if;
  return public._enqueue_review(p_campaign, p_type, p_source, p_run_again, 'manual', auth.uid());
end $$;

create or replace function public.cancel_review_job(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j public.review_jobs;
begin
  select * into j from public.review_jobs where id = p_job;
  if j.id is null or not public.can_manage_campaign(j.campaign_id) then
    raise exception 'Only a Manager or Admin can cancel this job' using errcode = '42501';
  end if;
  if j.status = 'queued' then
    update public.review_jobs set status = 'cancelled', finished_at = now(), error = 'Cancelled before it started' where id = p_job;
  elsif j.status = 'processing' then
    update public.review_jobs set cancel_requested = true where id = p_job;
  end if;
end $$;

-- ---------------------------------------------------------------- worker functions
create or replace function public._require_worker() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_worker() then raise exception 'Worker role required' using errcode = '42501'; end if;
end $$;

create or replace function public._worker_job(p_job uuid) returns public.review_jobs
language plpgsql security definer set search_path = public as $$
declare j public.review_jobs;
begin
  perform public._require_worker();
  select * into j from public.review_jobs where id = p_job for update;
  if j.id is null or j.claimed_by is distinct from auth.uid() or j.status <> 'processing' then
    raise exception 'This job is not held by this worker' using errcode = '42501';
  end if;
  return j;
end $$;
revoke all on function public._worker_job(uuid) from public, anon, authenticated;

create or replace function public.worker_heartbeat(
  p_worker_name text, p_model text, p_model_ready boolean, p_model_message text,
  p_accelerator text, p_busy boolean, p_current_job uuid default null, p_info jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_worker();
  insert into public.worker_status (worker_name, worker_user_id, last_seen_at, model, model_ready, model_message,
                                    accelerator, busy, current_job_id, info, created_by)
  values (p_worker_name, auth.uid(), now(), p_model, p_model_ready, p_model_message,
          coalesce(p_accelerator, 'unknown'), p_busy, p_current_job, coalesce(p_info, '{}'), auth.uid())
  on conflict (worker_name) do update set
    worker_user_id = excluded.worker_user_id, last_seen_at = now(), model = excluded.model,
    model_ready = excluded.model_ready, model_message = excluded.model_message, accelerator = excluded.accelerator,
    busy = excluded.busy, current_job_id = excluded.current_job_id, info = excluded.info;
end $$;

create or replace function public.claim_review_job(p_worker_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  j public.review_jobs;
  v_timeout int;
begin
  perform public._require_worker();

  -- Requeue (or fail) jobs whose worker stopped sending heartbeats past the job timeout.
  for j in
    select rj.* from public.review_jobs rj
    where rj.status = 'processing'
      and rj.heartbeat_at < now() - make_interval(secs => coalesce((public.workspace_limits(rj.campaign_id)->>'job_timeout_seconds')::int, 1800))
    for update skip locked
  loop
    if j.attempts >= j.max_attempts then
      update public.review_jobs set status = 'failed', finished_at = now(),
        error = 'Job timed out: no heartbeat from the worker within the job timeout.' where id = j.id;
    else
      update public.review_jobs set status = 'queued', claimed_by = null, worker_name = null,
        next_attempt_at = now(), error = 'Previous attempt timed out; retrying.' where id = j.id;
    end if;
  end loop;

  select * into j from public.review_jobs
  where status = 'queued' and next_attempt_at <= now() and not cancel_requested
  order by created_at
  for update skip locked
  limit 1;
  if j.id is null then return null; end if;

  update public.review_jobs set status = 'processing', claimed_by = auth.uid(), worker_name = p_worker_name,
    attempts = attempts + 1, started_at = now(), heartbeat_at = now(), error = null
  where id = j.id returning * into j;

  if j.review_type = 'sow_analysis' then
    update public.sow_versions set extraction_status = 'processing' where id = (j.input->>'sow_version_id')::uuid;
  end if;

  v_timeout := coalesce((public.workspace_limits(j.campaign_id)->>'job_timeout_seconds')::int, 1800);
  return jsonb_build_object('id', j.id, 'campaign_id', j.campaign_id, 'review_type', j.review_type,
                            'input', j.input, 'attempts', j.attempts, 'max_attempts', j.max_attempts,
                            'timeout_seconds', v_timeout);
end $$;

create or replace function public.heartbeat_job(p_job uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.review_jobs;
begin
  j := public._worker_job(p_job);
  update public.review_jobs set heartbeat_at = now() where id = p_job;
  return jsonb_build_object('cancel_requested', j.cancel_requested);
end $$;

create or replace function public._notify_job(j public.review_jobs, p_title text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if j.created_by is not null then
    insert into public.notifications (user_id, campaign_id, kind, title, entity_type, entity_id)
    values (j.created_by, j.campaign_id, 'review_' || j.status::text, p_title, 'review_job', j.id);
  end if;
end $$;
revoke all on function public._notify_job(public.review_jobs, text) from public, anon, authenticated;

create or replace function public.fail_review_job(p_job uuid, p_error text, p_detail jsonb default null, p_retryable boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j public.review_jobs;
  v_status public.job_status;
begin
  j := public._worker_job(p_job);
  if j.cancel_requested then
    v_status := 'cancelled';
  elsif p_retryable and j.attempts < j.max_attempts then
    v_status := 'queued';
  else
    v_status := 'failed';
  end if;

  update public.review_jobs set
    status = v_status, error = left(p_error, 2000), error_detail = p_detail,
    claimed_by = case when v_status = 'queued' then null else claimed_by end,
    next_attempt_at = case when v_status = 'queued' then now() + make_interval(secs => 30 * power(2, j.attempts - 1)) else next_attempt_at end,
    finished_at = case when v_status = 'queued' then null else now() end
  where id = p_job returning * into j;

  if v_status = 'failed' then
    if j.review_type = 'sow_analysis' then
      update public.sow_versions set extraction_status = 'failed' where id = (j.input->>'sow_version_id')::uuid;
    end if;
    perform public._notify_job(j, 'Review failed: ' || left(p_error, 120));
  elsif v_status = 'cancelled' and j.review_type = 'sow_analysis' then
    update public.sow_versions set extraction_status = 'uploaded' where id = (j.input->>'sow_version_id')::uuid;
  end if;
  return jsonb_build_object('status', v_status, 'next_attempt_at', j.next_attempt_at);
end $$;

-- Writes validated results. The worker cannot touch result tables any other way.
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
  if j.review_type in ('design_vs_development', 'sow_vs_development', 'functional_qa', 'regression') then
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

-- Staging credentials: stored in Vault, released only to the worker holding a job for that environment.
create or replace function public.set_environment_credentials(p_environment uuid, p_username text, p_password text, p_extra text default null)
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  e public.test_environments;
  v_secret text := jsonb_build_object('username', p_username, 'password', p_password, 'extra', p_extra)::text;
  v_id uuid;
begin
  select * into e from public.test_environments where id = p_environment;
  if e.id is null or not public.can_manage_campaign(e.campaign_id) then
    raise exception 'Only a Manager or Admin can set credentials' using errcode = '42501';
  end if;
  if e.credentials_secret_id is null then
    v_id := vault.create_secret(v_secret, 'env-' || e.id::text, 'CampaignOS staging credentials');
    update public.test_environments set credentials_secret_id = v_id, has_credentials = true where id = e.id;
  else
    perform vault.update_secret(e.credentials_secret_id, v_secret);
    update public.test_environments set has_credentials = true where id = e.id;
  end if;
end $$;

create or replace function public.clear_environment_credentials(p_environment uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
declare e public.test_environments;
begin
  select * into e from public.test_environments where id = p_environment;
  if e.id is null or not public.can_manage_campaign(e.campaign_id) then
    raise exception 'Only a Manager or Admin can clear credentials' using errcode = '42501';
  end if;
  if e.credentials_secret_id is not null then
    delete from vault.secrets where id = e.credentials_secret_id;
  end if;
  update public.test_environments set credentials_secret_id = null, has_credentials = false where id = e.id;
end $$;

create or replace function public.worker_get_credentials(p_job uuid) returns jsonb
language plpgsql security definer set search_path = public, vault as $$
declare
  j public.review_jobs;
  v_secret text;
begin
  j := public._worker_job(p_job);
  select s.decrypted_secret into v_secret
  from public.test_environments e join vault.decrypted_secrets s on s.id = e.credentials_secret_id
  where e.id = nullif(j.input->'environment'->>'id', '')::uuid;
  return case when v_secret is null then null else v_secret::jsonb end;
end $$;

-- Storage access for the worker: only objects listed on a job it currently holds.
create or replace function public.worker_can_read_object(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_worker() and exists (
    select 1 from public.review_jobs
    where status = 'processing' and claimed_by = auth.uid() and (p_bucket || '/' || p_name) = any(object_paths))
$$;

create or replace function public.worker_can_write_capture(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_worker() and exists (
    select 1 from public.review_jobs
    where status = 'processing' and claimed_by = auth.uid()
      and input ? 'capture_prefix' and left(p_name, length(input->>'capture_prefix')) = input->>'capture_prefix'
      and position('/' || id::text || '/' in '/' || p_name) > 0)
$$;
-- Captures from earlier jobs can be read back for regression comparison.
create or replace function public.worker_can_read_capture(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.worker_can_write_capture(p_name)
$$;

-- ---------------------------------------------------------------- automatic triggers (Phase 5)
create or replace function public._auto_enabled(p_campaign uuid, p_type public.review_type) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((s.auto_triggers->>p_type::text)::boolean, false)
  from public.campaigns c join public.workspace_settings s on s.workspace_id = c.workspace_id
  where c.id = p_campaign
$$;

-- Queue the automatic reviews that apply; skip silently when a precondition is missing.
create or replace function public._auto_enqueue(p_campaign uuid, p_types public.review_type[], p_source jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare t public.review_type; n int := 0;
begin
  foreach t in array p_types loop
    if public._auto_enabled(p_campaign, t) then
      begin
        perform public._enqueue_review(p_campaign, t, p_source, false, 'automatic', auth.uid());
        n := n + 1;
      exception when others then
        null; -- duplicates or missing prerequisites: the manager can still run it by hand
      end;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public._auto_enqueue(uuid, public.review_type[], jsonb) from public, anon, authenticated;

create or replace function public.finalize_sow_version(p_version uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v public.sow_versions;
begin
  select * into v from public.sow_versions where id = p_version;
  if v.id is null or not public.can_manage_campaign(v.campaign_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return public._auto_enqueue(v.campaign_id, array['sow_analysis']::public.review_type[], jsonb_build_object('sow_version_id', v.id));
end $$;

create or replace function public.finalize_design_submission(p_submission uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s public.design_submissions;
begin
  select * into s from public.design_submissions where id = p_submission;
  if s.id is null or not public.can_contribute(s.campaign_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.design_submissions set finalized_at = now() where id = s.id;
  return public._auto_enqueue(s.campaign_id, array['sow_vs_design', 'design_consistency']::public.review_type[],
                              jsonb_build_object('design_submission_id', s.id));
end $$;

create or replace function public.finalize_development_submission(p_submission uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s public.development_submissions;
begin
  select * into s from public.development_submissions where id = p_submission;
  if s.id is null or not public.can_contribute(s.campaign_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return public._auto_enqueue(s.campaign_id,
    array['design_vs_development', 'sow_vs_development', 'functional_qa', 'regression']::public.review_type[],
    jsonb_build_object('development_submission_id', s.id));
end $$;

-- ===== 20261103000600_activity.sql =====
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

-- ===== 20261103000700_rls.sql =====
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

-- ===== 20261103000800_storage.sql =====
-- Private buckets. Object names always start with "<campaign_id>/".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('sow', 'sow', false, 26214400, array['application/pdf']),
  ('designs', 'designs', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('captures', 'captures', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('documents', 'documents', false, 26214400, array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_campaign(p_name text) returns uuid
language plpgsql immutable as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end $$;

-- Users
create policy "campaign files: read" on storage.objects for select to authenticated
  using (bucket_id in ('sow', 'designs', 'captures', 'documents')
         and public.can_read_campaign(public.storage_campaign(name)));

create policy "sow: managers upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sow' and public.can_manage_campaign(public.storage_campaign(name)));
create policy "documents: managers upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.can_manage_campaign(public.storage_campaign(name)));
create policy "designs: contributors upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'designs' and public.can_contribute(public.storage_campaign(name)));

create policy "campaign files: managers delete" on storage.objects for delete to authenticated
  using (bucket_id in ('designs', 'documents') and public.can_manage_campaign(public.storage_campaign(name)));

-- Worker: only objects referenced by a job it holds, and captures under that job's folder.
create policy "worker: read job objects" on storage.objects for select to authenticated
  using (public.worker_can_read_object(bucket_id, name)
         or (bucket_id = 'captures' and public.worker_can_read_capture(name)));
create policy "worker: write captures" on storage.objects for insert to authenticated
  with check (bucket_id = 'captures' and public.worker_can_write_capture(name));

-- ===== 20261103000900_rpc.sql =====
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

