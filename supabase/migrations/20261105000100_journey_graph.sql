-- Journey graph: the canvas of a journey, stored. Nodes (screens and logic), the connections between them, and which
-- requirements a node answers to.
--
-- Run this ONCE in the Supabase SQL editor (paste the whole file). Nothing existing is changed or deleted.
-- Screens are stored by NAME (screen_key), not by file, so a node follows its screen through new design versions.
-- Who can edit: managers and team members on the campaign (can_contribute). Everyone who can read the campaign can read the graph.

create table public.journey_nodes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  journey_id uuid references public.journeys(id) on delete cascade, -- null = designs submitted without a journey ("Unassigned")
  kind text not null check (kind in ('start', 'end', 'screen', 'form_submission', 'otp_validation', 'api_call', 'eligibility_check',
                                     'decision', 'reward_allocation', 'voucher_distribution', 'kyc_verification', 'error_state', 'note')),
  label text not null default '' check (length(label) <= 200),
  screen_key text check (screen_key is null or length(screen_key) <= 200),
  pos_x numeric not null default 0,
  pos_y numeric not null default 0,
  config jsonb not null default '{}' check (pg_column_size(config) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.journey_nodes (campaign_id, journey_id);
-- One Start per journey, and a screen appears once per journey.
create unique index journey_nodes_one_start on public.journey_nodes (campaign_id, coalesce(journey_id, '00000000-0000-0000-0000-000000000000'::uuid)) where kind = 'start';
create unique index journey_nodes_one_screen on public.journey_nodes (campaign_id, coalesce(journey_id, '00000000-0000-0000-0000-000000000000'::uuid), screen_key) where kind = 'screen' and screen_key is not null;
create trigger touch before insert or update on public.journey_nodes for each row execute function public.touch_row();

create table public.journey_edges (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  journey_id uuid references public.journeys(id) on delete cascade,
  source_id uuid not null references public.journey_nodes(id) on delete cascade,
  target_id uuid not null references public.journey_nodes(id) on delete cascade,
  label text not null default '' check (length(label) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1,
  check (source_id <> target_id),
  unique (source_id, target_id)
);
create index on public.journey_edges (campaign_id, journey_id);
create trigger touch before insert or update on public.journey_edges for each row execute function public.touch_row();

-- A connection joins two nodes of the SAME journey. Nothing leads into Start, nothing leaves End, and notes are not part of the flow.
create or replace function public.check_journey_edge() returns trigger language plpgsql as $$
declare s public.journey_nodes; t public.journey_nodes;
begin
  select * into s from public.journey_nodes where id = new.source_id;
  select * into t from public.journey_nodes where id = new.target_id;
  if s.id is null or t.id is null then raise exception 'Both ends of a connection must exist' using errcode = '23503'; end if;
  if s.campaign_id <> new.campaign_id or t.campaign_id <> new.campaign_id or s.journey_id is distinct from t.journey_id or s.journey_id is distinct from new.journey_id then
    raise exception 'A connection must join two steps of the same journey' using errcode = '23514';
  end if;
  if t.kind = 'start' then raise exception 'Nothing can lead into Start' using errcode = '23514'; end if;
  if s.kind = 'end' then raise exception 'End has no outgoing connections' using errcode = '23514'; end if;
  if s.kind = 'note' or t.kind = 'note' then raise exception 'Notes are not part of the flow' using errcode = '23514'; end if;
  return new;
end $$;
create trigger check_edge before insert or update on public.journey_edges for each row execute function public.check_journey_edge();

create table public.node_requirements (
  node_id uuid not null references public.journey_nodes(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (node_id, requirement_id)
);
create index on public.node_requirements (campaign_id);
create or replace function public.check_node_requirement() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.journey_nodes n where n.id = new.node_id and n.campaign_id = new.campaign_id)
     or not exists (select 1 from public.requirements r where r.id = new.requirement_id and r.campaign_id = new.campaign_id) then
    raise exception 'The step and the requirement must belong to the same campaign' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger check_link before insert on public.node_requirements for each row execute function public.check_node_requirement();

-- Row Level Security. Hiding UI is not a permission.
alter table public.journey_nodes enable row level security;
alter table public.journey_edges enable row level security;
alter table public.node_requirements enable row level security;
do $$
declare t text;
begin
  foreach t in array array['journey_nodes', 'journey_edges', 'node_requirements']
  loop
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (public.can_read_campaign(campaign_id))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.can_contribute(campaign_id))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.can_contribute(campaign_id))', t);
  end loop;
  foreach t in array array['journey_nodes', 'journey_edges']
  loop
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.can_contribute(campaign_id)) with check (public.can_contribute(campaign_id))', t);
  end loop;
end $$;
revoke all on public.journey_nodes, public.journey_edges, public.node_requirements from anon;

-- Steps and connections that a person adds or removes go in the activity log. Moving a node does not (it would flood the log),
-- and neither does the automatic first build of a graph (ensure_journey_graph sets journ.bulk for its own transaction).
create trigger log_activity after insert or delete on public.journey_nodes for each row when (coalesce(current_setting('journ.bulk', true), '') <> '1') execute function public.log_activity();
create trigger log_activity after insert or delete on public.journey_edges for each row when (coalesce(current_setting('journ.bulk', true), '') <> '1') execute function public.log_activity();

-- Builds a journey's graph in one go, the first time it is opened: Journ derives it from the design screens and sends it here.
-- Does nothing (returns false) if the journey already has a graph, even when two people open it at the same moment.
-- SECURITY INVOKER: the caller's own permissions apply.
create or replace function public.ensure_journey_graph(p_campaign uuid, p_journey uuid, p_nodes jsonb, p_edges jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
declare n jsonb; e jsonb; ids jsonb := '{}'; new_id uuid;
begin
  if not public.can_contribute(p_campaign) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_journey is not null and not exists (select 1 from public.journeys where id = p_journey and campaign_id = p_campaign) then
    raise exception 'That journey does not belong to this campaign' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_campaign::text || coalesce(p_journey::text, '-'), 0));
  if exists (select 1 from public.journey_nodes where campaign_id = p_campaign and journey_id is not distinct from p_journey) then return false; end if;
  if jsonb_array_length(p_nodes) > 200 or jsonb_array_length(p_edges) > 400 then raise exception 'That journey is too large to build automatically' using errcode = '22023'; end if;
  perform set_config('journ.bulk', '1', true); -- this build is not a person's edit, so it stays out of the activity feed
  for n in select * from jsonb_array_elements(p_nodes) loop
    insert into public.journey_nodes (campaign_id, journey_id, kind, label, screen_key, pos_x, pos_y, config)
    values (p_campaign, p_journey, n->>'kind', coalesce(n->>'label', ''), nullif(n->>'screen_key', ''),
            coalesce((n->>'x')::numeric, 0), coalesce((n->>'y')::numeric, 0), coalesce(n->'config', '{}'))
    returning id into new_id;
    ids := ids || jsonb_build_object(n->>'key', new_id);
  end loop;
  for e in select * from jsonb_array_elements(p_edges) loop
    insert into public.journey_edges (campaign_id, journey_id, source_id, target_id, label)
    values (p_campaign, p_journey, (ids->>(e->>'from'))::uuid, (ids->>(e->>'to'))::uuid, coalesce(e->>'label', ''));
  end loop;
  perform set_config('journ.bulk', '', true);
  return true;
end $$;
revoke all on function public.ensure_journey_graph(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.ensure_journey_graph(uuid, uuid, jsonb, jsonb) to authenticated;
