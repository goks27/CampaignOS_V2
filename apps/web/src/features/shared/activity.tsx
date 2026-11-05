import { Link } from "react-router-dom";
import type { Activity } from "@/services/activity";
import { Avatar, EmptyState } from "@/components/common";
import { timeAgo } from "@/lib/utils";
import { useProfiles } from "@/hooks/queries";
import {
  STAGE_LABEL, TASK_STATUS_LABEL, FINDING_STATUS_LABEL, REQ_STATUS_LABEL, JOB_STATUS_LABEL, TRACK_LABEL, SUBMISSION_STATUS_LABEL,
  REVIEW_TYPE_LABEL, type Stage, type TaskStatus, type FindingStatus, type RequirementStatus, type JobStatus, type TrackStatus,
  type SubmissionStatus, type ReviewType,
} from "@/lib/labels";

const ENTITY: Record<string, string> = {
  campaigns: "campaign", journeys: "journey", campaign_members: "team assignment", tasks: "task", task_comments: "comment",
  sow_versions: "SOW version", requirements: "requirement", design_submissions: "design submission", findings: "finding",
  review_jobs: "AI review", test_environments: "test environment", development_submissions: "development submission",
  qa_test_cases: "test scenario", approvals: "approval", client_feedback: "client feedback", deployments: "deployment",
  milestones: "milestone", documents: "document", journey_nodes: "journey step", journey_edges: "journey connection", brand_assets: "brand asset",
};

function statusLabel(table: string, v: string) {
  const maps: Record<string, Record<string, string>> = {
    tasks: TASK_STATUS_LABEL as Record<TaskStatus, string>, findings: FINDING_STATUS_LABEL as Record<FindingStatus, string>,
    requirements: REQ_STATUS_LABEL as Record<RequirementStatus, string>, review_jobs: JOB_STATUS_LABEL as Record<JobStatus, string>,
    design_submissions: SUBMISSION_STATUS_LABEL as Record<SubmissionStatus, string>,
    development_submissions: SUBMISSION_STATUS_LABEL as Record<SubmissionStatus, string>,
  };
  return maps[table]?.[v] ?? v.replace(/_/g, " ");
}

const FIELD: Record<string, string> = {
  stage: "stage", status: "status", health: "health", assignee_id: "assignee", due_date: "due date", priority: "priority",
  design_status: "design status", development_status: "development status", qa_status: "QA status", uat_status: "UAT status",
  target_launch_date: "launch date", title: "title", name: "name", description: "description", feedback: "feedback",
  owner_id: "owner", severity: "severity", staging_url: "staging URL", production_url: "production URL", journey_id: "journey",
};

export function describeActivity(a: Activity, name: (id?: string | null) => string): string {
  const what = ENTITY[a.entity_type] ?? a.entity_type;
  const label = a.summary ? ` ${a.entity_type === "review_jobs" ? REVIEW_TYPE_LABEL[a.summary as ReviewType] ?? a.summary : a.summary}` : "";
  const after = (a.after ?? {}) as Record<string, unknown>;
  const before = (a.before ?? {}) as Record<string, unknown>;
  if (a.action === "insert") {
    if (a.entity_type === "campaign_members") return `added ${name(after.user_id as string)} to the team`;
    if (a.entity_type === "review_jobs") return `started${label}`;
    if (a.entity_type === "approvals") return `recorded ${String(after.decision).replace("_", " ")} for${label}`;
    return `created ${what}${label}`;
  }
  if (a.action === "delete") return `removed ${what}${label}`;
  if (a.action === "status_changed") {
    const v = String(after.status);
    return `moved ${what}${label} to ${statusLabel(a.entity_type, v)}`;
  }
  const keys = Object.keys(after);
  if (keys.includes("stage")) return `moved ${what}${label} to ${STAGE_LABEL[after.stage as Stage]}`;
  if (keys.includes("assignee_id")) return `assigned ${what}${label} to ${name(after.assignee_id as string)}`;
  const track = keys.find((k) => k.endsWith("_status") && after[k]);
  if (track) return `set ${FIELD[track] ?? track} on${label} to ${TRACK_LABEL[after[track] as TrackStatus] ?? after[track]}`;
  const fields = keys.map((k) => FIELD[k] ?? k.replace(/_/g, " ")).slice(0, 3).join(", ");
  void before;
  return `updated ${fields} on ${what}${label}`;
}

export function ActivityFeed({ items, showCampaign = true, emptyText }: { items: Activity[]; showCampaign?: boolean; emptyText?: string }) {
  const { name } = useProfiles();
  if (!items.length) return <EmptyState title="No activity yet" body={emptyText ?? "Changes to campaigns, tasks and reviews are recorded here automatically."} />;
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => (
        <li key={a.id} className="flex items-start gap-2.5 px-3 py-2.5">
          <Avatar name={a.actor_id ? name(a.actor_id) : "System"} size={20} />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{a.actor_id ? name(a.actor_id) : "System"}</span>{" "}
            <span className="text-text-2">{describeActivity(a, name)}</span>
            {showCampaign && a.campaign_id && a.campaigns && (
              <Link to={`/campaigns/${a.campaign_id}`} className="ml-1 text-muted hover:text-text">· {a.campaigns.name}</Link>
            )}
          </div>
          <span className="whitespace-nowrap text-xs text-muted num">{timeAgo(a.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}
