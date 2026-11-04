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
