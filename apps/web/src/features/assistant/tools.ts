/**
 * The assistant's action catalogue. This is the ONLY thing Claude can ask this app to do.
 *
 * - Reads run immediately, with the signed-in user's own session (RLS applies).
 * - Writes become Confirm cards. Nothing runs until the user clicks Confirm, and what the card shows is exactly what runs.
 * - Deliberately absent: approving or rejecting requirements, accepting or dismissing findings, approving designs or builds,
 *   changing a campaign's stage or status, launching, deleting anything, and team roles, settings or credentials.
 *   Those are decisions for a manager (CLAUDE.md: "AI never approves ..."). tools.test.ts fails if a tool is added without review.
 */
import { z } from "zod";
import { campaignsService } from "@/services/campaigns";
import { findingsService, defaultFeedback } from "@/services/findings";
import { requirementsService } from "@/services/requirements";
import { tasksService } from "@/services/tasks";
import { jobsService } from "@/services/jobs";
import { activityService, dashboardService } from "@/services/activity";
import { teamService } from "@/services/team";
import { connectorService } from "@/services/connector";
import type { ToolSpec } from "@/services/assistant";
import {
  CAMPAIGN_STATUS_LABEL, CATEGORY_LABEL, FINDING_STATUS_LABEL, PRIORITY_LABEL, SEVERITY_LABEL, TASK_STATUS_LABEL,
  type CampaignStatus, type FindingStatus, type Priority, type RequirementCategory, type Severity, type TaskStatus,
} from "@/lib/labels";

// ---------------------------------------------------------------- helpers
const keys = <T extends string>(o: Record<T, unknown>) => Object.keys(o) as [T, ...T[]];
const PRIORITY = z.enum(keys<Priority>(PRIORITY_LABEL));
const TASK_STATUS = z.enum(keys<TaskStatus>(TASK_STATUS_LABEL));
const CATEGORY = z.enum(keys<RequirementCategory>(CATEGORY_LABEL));
const SEVERITY = z.enum(keys<Severity>(SEVERITY_LABEL));
const FINDING_STATUS = z.enum(keys<FindingStatus>(FINDING_STATUS_LABEL));
const CAMPAIGN_STATUS = z.enum(keys<CampaignStatus>(CAMPAIGN_STATUS_LABEL));
const REQ_READ_STATUS = z.enum(["draft", "accepted", "rejected", "needs_clarification"]);
/** Every review the Claude connector can run (staging reviews use a headless browser on this PC). */
export const ASSISTANT_REVIEW_TYPES = ["site_check", "sow_analysis", "sow_vs_design", "design_consistency", "design_vs_development", "functional_qa", "regression", "sow_vs_development"] as const;
type SourceKey = "sow_version_id" | "design_submission_id" | "development_submission_id";
const REVIEW_SOURCE: Record<(typeof ASSISTANT_REVIEW_TYPES)[number], SourceKey> = {
  sow_analysis: "sow_version_id", sow_vs_design: "design_submission_id", design_consistency: "design_submission_id",
  site_check: "development_submission_id", design_vs_development: "development_submission_id", functional_qa: "development_submission_id", regression: "development_submission_id", sow_vs_development: "development_submission_id",
};

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const text = (max: number) => z.string().trim().min(1).max(max);

export const clip = (s: string | null | undefined, n = 300): string | null => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);
const cap = <T>(rows: T[], n: number) => ({ total: rows.length, shown: Math.min(rows.length, n), rows: rows.slice(0, n) });
export const formatIssues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ");

export type Lookup = { campaign: (id?: string | null) => string; person: (id?: string | null) => string };
export type Card = { title: string; fields: { label: string; value: string }[] };
export type Applied = { summary: string; campaignId: string | null; link?: string };

export type ReadTool = { kind: "read"; name: string; description: string; params: string; run: (raw: unknown) => Promise<unknown> };
export type WriteTool = {
  kind: "write"; name: string; description: string; params: string;
  /** Validates the arguments and describes the change. Throws a readable Error when the arguments are invalid. */
  propose: (raw: unknown, lookup: Lookup) => Card & { apply: () => Promise<Applied> };
};
export type Tool = ReadTool | WriteTool;

function read<S extends z.ZodTypeAny>(d: { name: string; description: string; params: string; schema: S; run: (a: z.infer<S>) => Promise<unknown> }): ReadTool {
  return {
    kind: "read", name: d.name, description: d.description, params: d.params,
    run: async (raw) => {
      const p = d.schema.safeParse(raw ?? {});
      if (!p.success) throw new Error(`Invalid arguments: ${formatIssues(p.error)}`);
      return d.run(p.data);
    },
  };
}

function write<S extends z.ZodTypeAny>(d: {
  name: string; description: string; params: string; schema: S;
  describe: (a: z.infer<S>, l: Lookup) => Card; apply: (a: z.infer<S>) => Promise<Applied>;
}): WriteTool {
  return {
    kind: "write", name: d.name, description: d.description, params: d.params,
    propose: (raw, lookup) => {
      const p = d.schema.safeParse(raw ?? {});
      if (!p.success) throw new Error(`Invalid arguments: ${formatIssues(p.error)}`);
      return { ...d.describe(p.data, lookup), apply: () => d.apply(p.data) };
    },
  };
}

const field = (label: string, value: unknown) => ({ label, value: value === null || value === undefined || value === "" ? "—" : String(value) });
const present = (fields: [string, unknown][]) => fields.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([l, v]) => field(l, v));

// ---------------------------------------------------------------- reads (run immediately)
const reads: ReadTool[] = [
  read({
    name: "list_campaigns", description: "List campaigns the user can see, with stage, status, health, track statuses, launch date, journeys and team.",
    params: "{status?: active|on_hold|completed|archived, query?: string}",
    schema: z.object({ status: CAMPAIGN_STATUS.optional(), query: z.string().max(100).optional() }),
    run: async (a) => {
      const all = await campaignsService.list();
      const rows = all.filter((c) => (!a.status || c.status === a.status) && (!a.query || c.name.toLowerCase().includes(a.query.toLowerCase()) || (c.clients?.name ?? "").toLowerCase().includes(a.query.toLowerCase())));
      return cap(rows.map((c) => ({
        id: c.id, name: c.name, client: c.clients?.name ?? null, stage: c.stage, status: c.status, health: c.health, priority: c.priority,
        design_status: c.design_status, development_status: c.development_status, qa_status: c.qa_status, uat_status: c.uat_status,
        target_launch_date: c.target_launch_date, is_demo: c.is_demo,
        journeys: c.journeys.map((j) => ({ id: j.id, name: j.name })),
        team: c.campaign_members.map((m) => ({ user_id: m.user_id, name: m.profiles?.full_name ?? m.profiles?.email ?? null, role: m.campaign_role })),
      })), 60);
    },
  }),
  read({
    name: "get_campaign", description: "Full details of one campaign (description, notes, URLs, dates).", params: "{campaign_id: uuid}",
    schema: z.object({ campaign_id: uuid }),
    run: async (a) => {
      const c = await campaignsService.get(a.campaign_id);
      return { id: c.id, name: c.name, client: c.clients?.name ?? null, description: clip(c.description, 1500), notes: clip(c.notes, 1500), stage: c.stage, status: c.status, health: c.health, priority: c.priority,
        design_status: c.design_status, development_status: c.development_status, qa_status: c.qa_status, uat_status: c.uat_status,
        start_date: c.start_date, target_launch_date: c.target_launch_date, staging_url: c.staging_url, production_url: c.production_url, is_demo: c.is_demo,
        journeys: c.journeys.map((j) => ({ id: j.id, name: j.name })) };
    },
  }),
  read({
    name: "list_requirements", description: "Requirements of a campaign. AI-extracted ones are drafts until a manager accepts them.", params: "{campaign_id: uuid, status?: draft|accepted|rejected|needs_clarification}",
    schema: z.object({ campaign_id: uuid, status: REQ_READ_STATUS.optional() }),
    run: async (a) => {
      const rows = (await requirementsService.list(a.campaign_id)).filter((r) => !a.status || r.status === a.status);
      return cap(rows.map((r) => ({ id: r.id, ref: r.ref, title: r.title, category: r.category, priority: r.priority, status: r.status, confidence: r.confidence, origin: r.origin,
        journey_hint: r.journey_hint, source_pages: r.source_pages, description: clip(r.description, 300), acceptance_criteria: clip(r.acceptance_criteria, 200) })), 150);
    },
  }),
  read({
    name: "list_requirement_checks", description: "Latest verification results per requirement (verified, failed, needs_verification, not_tested, blocked).", params: "{campaign_id: uuid}",
    schema: z.object({ campaign_id: uuid }),
    run: async (a) => cap((await requirementsService.checks(a.campaign_id)).map((c) => ({ requirement_id: c.requirement_id, result: c.result, method: c.method, review_type: c.review_type, note: clip(c.note, 200), at: c.created_at })), 200),
  }),
  read({
    name: "list_findings", description: "QA findings. Many are AI-written drafts awaiting a manager's review. Optionally filter.", params: "{campaign_id?: uuid, status?: new|awaiting_review|accepted|dismissed|assigned|in_progress|ready_for_retest|fixed|verified|reopened, severity?: critical|high|medium|low|informational, limit?: 1-100}",
    schema: z.object({ campaign_id: uuid.optional(), status: FINDING_STATUS.optional(), severity: SEVERITY.optional(), limit: z.number().int().min(1).max(100).optional() }),
    run: async (a) => {
      const rows = (await findingsService.list({ campaignId: a.campaign_id, statuses: a.status ? [a.status] : undefined })).filter((f) => !a.severity || f.severity === a.severity);
      return cap(rows.map((f) => ({ id: f.id, ref: f.ref, campaign: f.campaigns?.name ?? null, campaign_id: f.campaign_id, title: f.title, severity: f.severity, status: f.status, confidence: f.confidence,
        requirement: f.requirements ? `${f.requirements.ref} ${f.requirements.title}` : "Additional observation (no requirement)", review_type: f.review_type,
        description: clip(f.description, 300), expected: clip(f.expected, 200), observed: clip(f.observed, 200), suggested_correction: clip(f.suggested_correction, 200),
        screen: f.design_assets?.screen_name ?? null, owner_id: f.owner_id, created_at: f.created_at })), a.limit ?? 60);
    },
  }),
  read({
    name: "list_tasks", description: "Tasks, optionally by campaign, assignee, status, or only overdue ones.", params: "{campaign_id?: uuid, assignee_id?: uuid, status?: todo|in_progress|ready_for_review|done|blocked, overdue_only?: boolean}",
    schema: z.object({ campaign_id: uuid.optional(), assignee_id: uuid.optional(), status: TASK_STATUS.optional(), overdue_only: z.boolean().optional() }),
    run: async (a) => {
      const today = new Date().toISOString().slice(0, 10);
      const rows = (await tasksService.list({ campaignId: a.campaign_id, assigneeId: a.assignee_id }))
        .filter((t) => (!a.status || t.status === a.status) && (!a.overdue_only || (t.due_date && t.due_date < today && t.status !== "done")));
      return cap(rows.map((t) => ({ id: t.id, ref: t.ref, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, campaign: t.campaigns?.name ?? null, campaign_id: t.campaign_id,
        assignee: t.assignee?.full_name ?? null, assignee_id: t.assignee_id, from_finding: Boolean(t.source_finding_id), description: clip(t.description, 200) })), 150);
    },
  }),
  read({
    name: "list_reviews", description: "AI review jobs (SOW analysis, SOW vs design, consistency, ...) with status, errors and result counts.", params: "{campaign_id?: uuid, limit?: 1-50}",
    schema: z.object({ campaign_id: uuid.optional(), limit: z.number().int().min(1).max(50).optional() }),
    run: async (a) => cap((await jobsService.list({ campaignId: a.campaign_id, limit: a.limit ?? 20 })).map((j) => ({ id: j.id, type: j.review_type, status: j.status, campaign: j.campaigns?.name ?? null,
      error: clip(j.error, 200), result: j.result_summary, model: j.model, created_at: j.created_at, finished_at: j.finished_at })), 50),
  }),
  read({
    name: "list_activity", description: "Recent change log entries.", params: "{campaign_id?: uuid, limit?: 1-50}",
    schema: z.object({ campaign_id: uuid.optional(), limit: z.number().int().min(1).max(50).optional() }),
    run: async (a) => cap((await activityService.list({ campaignId: a.campaign_id, limit: a.limit ?? 25 })).map((x) => ({ at: x.created_at, campaign: x.campaigns?.name ?? null, entity: x.entity_type, action: x.action, summary: clip(x.summary, 120), actor_id: x.actor_id })), 50),
  }),
  read({
    name: "list_people", description: "Team members with their ids (needed to assign tasks).", params: "{}", schema: z.object({}),
    run: async () => cap((await teamService.members()).filter((m) => m.role !== "worker" && !m.deactivated_at && m.profiles).map((m) => ({ id: m.user_id, name: m.profiles!.full_name || m.profiles!.email, role: m.role })), 100),
  }),
  read({
    name: "dashboard_summary", description: "Headline numbers: active campaigns, findings awaiting review, critical findings, overdue tasks, upcoming launches.", params: "{}", schema: z.object({}),
    run: async () => dashboardService.summary(),
  }),
];

// ---------------------------------------------------------------- writes (Confirm cards)
const taskFields = { title: text(300), description: z.string().max(4000).optional(), assignee_id: uuid.optional(), priority: PRIORITY.optional(), due_date: date.optional(), journey_id: uuid.optional() };

const writes: WriteTool[] = [
  write({
    name: "create_task", description: "Create a task in a campaign.", params: "{campaign_id: uuid, title: string, description?: string, assignee_id?: uuid, priority?: low|medium|high|critical, due_date?: YYYY-MM-DD, journey_id?: uuid}",
    schema: z.object({ campaign_id: uuid, ...taskFields }),
    describe: (a, l) => ({ title: "Create task", fields: present([["Campaign", l.campaign(a.campaign_id)], ["Title", a.title], ["Description", clip(a.description, 400)], ["Assignee", a.assignee_id && l.person(a.assignee_id)], ["Priority", a.priority && PRIORITY_LABEL[a.priority]], ["Due", a.due_date]]) }),
    apply: async (a) => {
      const t = await tasksService.create({ campaign_id: a.campaign_id, title: a.title, description: a.description ?? null, assignee_id: a.assignee_id ?? null, priority: a.priority ?? "medium", due_date: a.due_date ?? null, journey_id: a.journey_id ?? null });
      return { summary: `Created task ${t.ref ?? ""} ${t.title}`.trim(), campaignId: a.campaign_id, link: `/tasks?task=${t.id}` };
    },
  }),
  write({
    name: "update_task", description: "Change a task's title, description, assignee, priority, due date or status.", params: "{task_id: uuid, title?, description?, assignee_id?: uuid, priority?, due_date?: YYYY-MM-DD, status?: todo|in_progress|ready_for_review|done|blocked}",
    schema: z.object({ task_id: uuid, title: taskFields.title.optional(), description: taskFields.description, assignee_id: uuid.optional(), priority: PRIORITY.optional(), due_date: date.optional(), status: TASK_STATUS.optional() })
      .refine((a) => Object.keys(a).some((k) => k !== "task_id"), "give at least one field to change"),
    describe: (a, l) => ({ title: `Update task`, fields: present([["Task", a.task_id.slice(0, 8)], ["Title", a.title], ["Description", clip(a.description, 400)], ["Assignee", a.assignee_id && l.person(a.assignee_id)], ["Priority", a.priority && PRIORITY_LABEL[a.priority]], ["Due", a.due_date], ["Status", a.status && TASK_STATUS_LABEL[a.status]]]) }),
    apply: async (a) => {
      const { task_id, ...patch } = a;
      const t = await tasksService.update(task_id, patch);
      return { summary: `Updated task ${t.ref ?? ""} ${t.title}`.trim(), campaignId: t.campaign_id, link: `/tasks?task=${t.id}` };
    },
  }),
  write({
    name: "add_task_comment", description: "Add a comment to a task.", params: "{task_id: uuid, body: string}",
    schema: z.object({ task_id: uuid, body: text(2000) }),
    describe: (a) => ({ title: "Comment on task", fields: present([["Task", a.task_id.slice(0, 8)], ["Comment", a.body]]) }),
    apply: async (a) => {
      const t = await tasksService.get(a.task_id);
      await tasksService.addComment(a.task_id, t.campaign_id, a.body);
      return { summary: `Commented on task ${t.ref ?? ""} ${t.title}`.trim(), campaignId: t.campaign_id, link: `/tasks?task=${t.id}` };
    },
  }),
  write({
    name: "create_requirement", description: "Add a requirement as a DRAFT. A manager still has to accept it.", params: "{campaign_id: uuid, title: string, description: string, category: user_journey|screen|ui|functional|validation|business_rule|reward_logic|api_integration|legal|performance|security|analytics|deployment, priority?: low|medium|high|critical, acceptance_criteria?: string, journey_id?: uuid}",
    schema: z.object({ campaign_id: uuid, title: text(300), description: z.string().max(4000), category: CATEGORY, priority: PRIORITY.optional(), acceptance_criteria: z.string().max(4000).optional(), journey_id: uuid.optional() }),
    describe: (a, l) => ({ title: "Add draft requirement", fields: present([["Campaign", l.campaign(a.campaign_id)], ["Title", a.title], ["Description", clip(a.description, 400)], ["Category", CATEGORY_LABEL[a.category]], ["Priority", a.priority && PRIORITY_LABEL[a.priority]], ["Acceptance criteria", clip(a.acceptance_criteria, 300)], ["Status", "Draft (a manager must accept it)"]]) }),
    apply: async (a) => {
      const r = await requirementsService.create({ campaign_id: a.campaign_id, title: a.title, description: a.description, category: a.category, priority: a.priority ?? "medium", acceptance_criteria: a.acceptance_criteria ?? null, journey_id: a.journey_id ?? null, ref: "" });
      return { summary: `Added draft requirement ${r.ref} ${r.title}`, campaignId: a.campaign_id, link: `/campaigns/${a.campaign_id}/requirements` };
    },
  }),
  write({
    name: "update_requirement", description: "Edit the wording of a DRAFT or needs-clarification requirement. Accepted or rejected requirements cannot be edited by the assistant. Status is never changed.", params: "{requirement_id: uuid, title?, description?, category?, priority?, acceptance_criteria?}",
    schema: z.object({ requirement_id: uuid, title: text(300).optional(), description: z.string().max(4000).optional(), category: CATEGORY.optional(), priority: PRIORITY.optional(), acceptance_criteria: z.string().max(4000).optional() })
      .refine((a) => Object.keys(a).some((k) => k !== "requirement_id"), "give at least one field to change"),
    describe: (a) => ({ title: "Edit draft requirement", fields: present([["Requirement", a.requirement_id.slice(0, 8)], ["Title", a.title], ["Description", clip(a.description, 400)], ["Category", a.category && CATEGORY_LABEL[a.category]], ["Priority", a.priority && PRIORITY_LABEL[a.priority]], ["Acceptance criteria", clip(a.acceptance_criteria, 300)], ["Note", "The original AI wording is kept alongside your edit"]]) }),
    apply: async (a) => {
      const current = await requirementsService.get(a.requirement_id);
      if (current.status !== "draft" && current.status !== "needs_clarification") {
        throw new Error(`${current.ref} is ${current.status}. Only a manager can change an accepted or rejected requirement, in the dashboard.`);
      }
      const { requirement_id, ...patch } = a;
      const r = await requirementsService.update(requirement_id, patch);
      return { summary: `Edited requirement ${r.ref} ${r.title}`, campaignId: r.campaign_id, link: `/campaigns/${r.campaign_id}/requirements` };
    },
  }),
  write({
    name: "update_campaign", description: "Edit descriptive campaign fields only. Stage, status, health and approvals cannot be changed by the assistant.", params: "{campaign_id: uuid, name?, description?, notes?, priority?, start_date?: YYYY-MM-DD, target_launch_date?: YYYY-MM-DD, staging_url?, production_url?}",
    schema: z.object({ campaign_id: uuid, name: text(200).optional(), description: z.string().max(4000).optional(), notes: z.string().max(4000).optional(), priority: PRIORITY.optional(),
      start_date: date.optional(), target_launch_date: date.optional(), staging_url: z.string().url().max(500).optional(), production_url: z.string().url().max(500).optional() })
      .refine((a) => Object.keys(a).some((k) => k !== "campaign_id"), "give at least one field to change"),
    describe: (a, l) => ({ title: "Edit campaign", fields: present([["Campaign", l.campaign(a.campaign_id)], ["Name", a.name], ["Description", clip(a.description, 400)], ["Notes", clip(a.notes, 400)], ["Priority", a.priority && PRIORITY_LABEL[a.priority]], ["Start", a.start_date], ["Target launch", a.target_launch_date], ["Staging URL", a.staging_url], ["Production URL", a.production_url]]) }),
    apply: async (a) => {
      const { campaign_id, ...patch } = a;
      const c = await campaignsService.update(campaign_id, patch);
      return { summary: `Edited campaign ${c.name}`, campaignId: c.id, link: `/campaigns/${c.id}` };
    },
  }),
  write({
    name: "start_review", description: "Start an AI review. sow_analysis needs sow_version_id; sow_vs_design and design_consistency need design_submission_id; site_check (looks through a staging site for errors; needs nothing else), design_vs_development, functional_qa, regression and sow_vs_development test a staging build in a browser and need development_submission_id. Results are drafts for a manager.", params: "{campaign_id: uuid, review_type: site_check|sow_analysis|sow_vs_design|design_consistency|design_vs_development|functional_qa|regression|sow_vs_development, sow_version_id?: uuid, design_submission_id?: uuid, development_submission_id?: uuid}",
    schema: z.object({ campaign_id: uuid, review_type: z.enum(ASSISTANT_REVIEW_TYPES), sow_version_id: uuid.optional(), design_submission_id: uuid.optional(), development_submission_id: uuid.optional() })
      .refine((a) => Boolean(a[REVIEW_SOURCE[a.review_type]]), (a) => ({ message: `${a.review_type} needs ${REVIEW_SOURCE[a.review_type]}`, path: [REVIEW_SOURCE[a.review_type]] })),
    describe: (a, l) => ({ title: "Start AI review", fields: present([["Campaign", l.campaign(a.campaign_id)], ["Review", a.review_type.replace(/_/g, " ")], ["Note", "Findings arrive as drafts for a manager"]]) }),
    apply: async (a) => {
      const key = REVIEW_SOURCE[a.review_type];
      await jobsService.enqueue(a.campaign_id, a.review_type, { [key]: String(a[key]) }, false);
      const started = await connectorService.wake();
      return { summary: `Started ${a.review_type.replace(/_/g, " ")}${started ? "" : " (queued: the Claude connector is not running)"}`, campaignId: a.campaign_id, link: `/campaigns/${a.campaign_id}/ai-reviews` };
    },
  }),
  write({
    name: "assign_finding", description: "Create a task from a finding a manager has ALREADY ACCEPTED, and assign it. Findings that are still awaiting review cannot be assigned.", params: "{finding_id: uuid, owner_id: uuid, due_date?: YYYY-MM-DD, priority?: low|medium|high|critical}",
    schema: z.object({ finding_id: uuid, owner_id: uuid, due_date: date.optional(), priority: PRIORITY.optional() }),
    describe: (a, l) => ({ title: "Assign accepted finding", fields: present([["Finding", a.finding_id.slice(0, 8)], ["Assign to", l.person(a.owner_id)], ["Due", a.due_date], ["Priority", a.priority && PRIORITY_LABEL[a.priority]], ["Note", "Creates a linked task. Only works for findings a manager accepted"]]) }),
    apply: async (a) => {
      const f = await findingsService.get(a.finding_id);
      if (f.status !== "accepted") throw new Error(`${f.ref} is ${FINDING_STATUS_LABEL[f.status]}. A manager must accept a finding before it can be assigned.`);
      const fb = defaultFeedback(f);
      const t = await findingsService.assign(f, { ownerId: a.owner_id, dueDate: a.due_date ?? null, priority: a.priority ?? fb.priority, feedback: { ...fb, priority: a.priority ?? fb.priority } });
      return { summary: `Assigned ${f.ref} as task ${t.ref ?? ""}`.trim(), campaignId: f.campaign_id, link: `/tasks?task=${t.id}` };
    },
  }),
];

export const TOOLS: Tool[] = [...reads, ...writes];
export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const TOOL_SPECS: ToolSpec[] = TOOLS.map((t) => ({ name: t.name, kind: t.kind, description: t.description, params: t.params }));
