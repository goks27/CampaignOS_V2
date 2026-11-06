-- Saved Live test sessions: what a person chose to keep from an interactive preview.
-- Run this ONCE in the Supabase SQL editor (paste the whole file). Nothing existing is changed or deleted.
--
-- The preview itself lives in memory on the PC that runs the connector and is gone when it closes. "Save session" copies the
-- record of it here: the URL, the build, the device, when it ran, the problems found (message, page, time, category, severity,
-- whether a person marked it reviewed) and counts. Screenshots are NOT stored (free-tier storage): they stay on the PC until
-- the connector restarts. Who can do what follows the campaign: everyone who can read it can see saved sessions, managers and
-- team members on it can save and delete them.

create table public.live_test_sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  build_label text check (build_label is null or length(build_label) <= 200),
  url text not null check (length(url) between 1 and 2000),
  device text not null check (length(device) between 1 and 40),
  session_ref text check (session_ref is null or length(session_ref) <= 80),
  started_at timestamptz not null,
  ended_at timestamptz not null default now(),
  events jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array' and pg_column_size(events) <= 400000),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  notes text check (notes is null or length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  version int not null default 1
);
create index on public.live_test_sessions (campaign_id, created_at desc);
create trigger touch before insert or update on public.live_test_sessions for each row execute function public.touch_row();

alter table public.live_test_sessions enable row level security;
create policy live_test_sessions_read on public.live_test_sessions for select to authenticated using (public.can_read_campaign(campaign_id));
create policy live_test_sessions_insert on public.live_test_sessions for insert to authenticated with check (public.can_contribute(campaign_id));
create policy live_test_sessions_update on public.live_test_sessions for update to authenticated using (public.can_contribute(campaign_id)) with check (public.can_contribute(campaign_id));
create policy live_test_sessions_delete on public.live_test_sessions for delete to authenticated using (public.can_contribute(campaign_id));
revoke all on public.live_test_sessions from anon;
