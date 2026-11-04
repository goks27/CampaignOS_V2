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
