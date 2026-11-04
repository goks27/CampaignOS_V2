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
