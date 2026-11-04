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
-- CLAUDE.md verification states. `check_method` records HOW (PRD §8: visual / functional / backend).
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
