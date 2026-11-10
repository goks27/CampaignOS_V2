-- Rules lab: reusable business-rule scenarios and the record of every run.
-- Run this ONCE in the Supabase SQL editor (paste the whole file) after 20261106000200_simplify.sql. Nothing existing is changed or deleted.
--
-- A scenario is a test fixture: the rules of a campaign (eligibility, caps, codes, rewards), the data it is run on, and the outcome to
-- check. A run is the result of checking it, kept with the build it was run against. Nothing here is decided by AI: the checks are
-- deterministic (see apps/web/src/features/rules/engine.ts). A scenario that AI suggested starts as a draft and only counts once a
-- manager accepts it.
--
-- Who can do what follows the campaign: everyone who can read it sees scenarios and runs; managers and team members on it can add,
-- edit, run and delete them. Fixtures must not contain real participants' personal data: use made-up or masked ids.

create table public.rule_scenarios (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  suite text not null default 'General' check (length(suite) between 1 and 80),
  name text not null check (length(trim(name)) between 1 and 200),
  scenario jsonb not null check (jsonb_typeof(scenario) = 'object' and pg_column_size(scenario) <= 1500000),
  source text not null default 'manual' check (source in ('manual', 'ai_suggested', 'imported')),
  -- AI suggestions are drafts until a manager accepts them. Manual scenarios are accepted from the start.
  accepted boolean not null default true,
  linked_requirement_id uuid references public.requirements(id) on delete set null,
  enabled boolean not null default true,
  accepted_by uuid,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1,
  -- an AI suggestion becomes official only when a named manager accepted it
  check (source <> 'ai_suggested' or accepted = false or accepted_by is not null)
);
create index on public.rule_scenarios (campaign_id, suite);
create trigger touch before insert or update on public.rule_scenarios for each row execute function public.touch_row();

create table public.rule_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  scenario_id uuid references public.rule_scenarios(id) on delete set null,
  scenario_name text not null,
  scenario_version int,
  build_label text check (build_label is null or length(build_label) <= 200),
  environment text not null default 'fixture' check (environment in ('fixture', 'staging')),
  status text not null check (status in ('passed', 'failed', 'incomplete')),
  counts jsonb not null default '{}'::jsonb,
  result jsonb not null check (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 1500000),
  ran_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.rule_runs (campaign_id, ran_at desc);
create index on public.rule_runs (scenario_id, ran_at desc);
create trigger touch before insert or update on public.rule_runs for each row execute function public.touch_row();

-- Only a Manager or Admin can accept an AI-suggested scenario into the official suite; the accepter is recorded.
create or replace function public._rule_scenario_accept() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'ai_suggested' and new.accepted and (tg_op = 'INSERT' or not old.accepted) then
    if not public.can_manage_campaign(new.campaign_id) then raise exception 'Only a Manager or Admin can accept a suggested scenario' using errcode = '42501'; end if;
    new.accepted_by := auth.uid(); new.accepted_at := now();
  end if;
  return new;
end $$;
create trigger accept_gate before insert or update on public.rule_scenarios for each row execute function public._rule_scenario_accept();

alter table public.rule_scenarios enable row level security;
create policy rule_scenarios_read on public.rule_scenarios for select to authenticated using (public.can_read_campaign(campaign_id));
create policy rule_scenarios_insert on public.rule_scenarios for insert to authenticated with check (public.can_contribute(campaign_id));
create policy rule_scenarios_update on public.rule_scenarios for update to authenticated using (public.can_contribute(campaign_id)) with check (public.can_contribute(campaign_id));
create policy rule_scenarios_delete on public.rule_scenarios for delete to authenticated using (public.can_contribute(campaign_id));
revoke all on public.rule_scenarios from anon;

alter table public.rule_runs enable row level security;
create policy rule_runs_read on public.rule_runs for select to authenticated using (public.can_read_campaign(campaign_id));
create policy rule_runs_insert on public.rule_runs for insert to authenticated with check (public.can_contribute(campaign_id));
create policy rule_runs_delete on public.rule_runs for delete to authenticated using (public.can_contribute(campaign_id));
revoke all on public.rule_runs from anon;
