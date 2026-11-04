import type { Database } from "@/types/database";

type E = Database["public"]["Enums"];
export type Role = E["workspace_role"];
export type Stage = E["campaign_stage"];
export type CampaignStatus = E["campaign_status"];
export type TrackStatus = E["track_status"];
export type Health = E["health"];
export type Priority = E["priority"];
export type TaskStatus = E["task_status"];
export type CampaignRole = E["campaign_role"];
export type ReviewType = E["review_type"];
export type RequirementCategory = E["requirement_category"];
export type RequirementStatus = E["requirement_status"];
export type Confidence = E["confidence"];
export type Severity = E["severity"];
export type FindingStatus = E["finding_status"];
export type VerificationState = E["verification_state"];
export type CheckMethod = E["check_method"];
export type SubmissionStatus = E["submission_status"];
export type JobStatus = E["job_status"];
export type ApprovalDecision = E["approval_decision"];
export type FeedbackStatus = E["feedback_status"];
export type DeploymentStatus = E["deployment_status"];

/** Status colour names from DESIGN.md. */
export type Tone = "green" | "blue" | "violet" | "amber" | "red" | "gray";

export const TONE_HEX: Record<Tone, string> = {
  green: "#2E9A5B",
  blue: "#3A6FE0",
  violet: "#7C5AD6",
  amber: "#C98A12",
  red: "#D2463C",
  gray: "#9A9CA5",
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  team_member: "Team member",
  viewer: "Viewer",
  worker: "AI worker (service account)",
};

/** Seven stages, always in PRD order. */
export const STAGES: Stage[] = ["brief_planning", "design", "development", "internal_qa", "client_uat", "live_deployment", "completed"];
export const STAGE_LABEL: Record<Stage, string> = {
  brief_planning: "Brief & Planning",
  design: "Design",
  development: "Development",
  internal_qa: "Internal QA",
  client_uat: "Client UAT",
  live_deployment: "Live Deployment",
  completed: "Completed",
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  archived: "Archived",
};
export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, Tone> = { active: "blue", on_hold: "amber", completed: "green", archived: "gray" };

export const TRACK_LABEL: Record<TrackStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  in_review: "In review",
  awaiting_client: "Awaiting client",
  changes_requested: "Changes requested",
  approved: "Approved",
};
export const TRACK_TONE: Record<TrackStatus, Tone> = {
  not_started: "gray",
  in_progress: "blue",
  in_review: "violet",
  awaiting_client: "violet",
  changes_requested: "amber",
  approved: "green",
};

export const HEALTH_LABEL: Record<Health, string> = { on_track: "On track", at_risk: "At risk", blocked: "Blocked" };
export const HEALTH_TONE: Record<Health, Tone> = { on_track: "green", at_risk: "amber", blocked: "red" };

export const PRIORITY_LABEL: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
export const PRIORITY_TONE: Record<Priority, Tone> = { low: "gray", medium: "blue", high: "amber", critical: "red" };

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "ready_for_review", "done", "blocked"];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  done: "Done",
  blocked: "Blocked",
};
export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = {
  todo: "gray",
  in_progress: "blue",
  ready_for_review: "violet",
  done: "green",
  blocked: "red",
};

export const CAMPAIGN_ROLE_LABEL: Record<CampaignRole, string> = {
  primary_manager: "Primary manager",
  supporting_manager: "Supporting manager",
  designer: "Designer",
  developer: "Developer",
  qa_owner: "QA owner",
  member: "Member",
};

export const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
  sow_analysis: "SOW analysis",
  sow_vs_design: "SOW vs Design",
  design_consistency: "Design consistency",
  design_vs_development: "Design vs Development",
  sow_vs_development: "SOW vs Development",
  functional_qa: "Functional QA",
  regression: "Regression review",
};
export const DESIGN_REVIEW_TYPES: ReviewType[] = ["sow_vs_design", "design_consistency"];
export const DEV_REVIEW_TYPES: ReviewType[] = ["design_vs_development", "sow_vs_development", "functional_qa", "regression"];

export const CATEGORY_LABEL: Record<RequirementCategory, string> = {
  user_journey: "User journey",
  screen: "Screen",
  ui: "UI",
  functional: "Functional",
  validation: "Validation",
  business_rule: "Business rule",
  reward_logic: "Reward logic",
  api_integration: "API / integration",
  legal: "Legal",
  performance: "Performance",
  security: "Security",
  analytics: "Analytics",
  deployment: "Deployment",
};

export const REQ_STATUS_LABEL: Record<RequirementStatus, string> = {
  draft: "Draft",
  accepted: "Accepted",
  rejected: "Rejected",
  needs_clarification: "Needs client clarification",
};
export const REQ_STATUS_TONE: Record<RequirementStatus, Tone> = { draft: "gray", accepted: "green", rejected: "red", needs_clarification: "amber" };

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  needs_manual_verification: "Needs manual verification",
};

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "informational"];
export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  informational: "Informational",
};
export const SEVERITY_TONE: Record<Severity, Tone> = { critical: "red", high: "amber", medium: "blue", low: "gray", informational: "gray" };

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  new: "New",
  awaiting_review: "Awaiting manager review",
  accepted: "Accepted",
  dismissed: "Dismissed",
  assigned: "Assigned",
  in_progress: "In progress",
  ready_for_retest: "Ready for retest",
  fixed: "Fixed",
  verified: "Verified",
  reopened: "Reopened",
};
export const FINDING_STATUS_TONE: Record<FindingStatus, Tone> = {
  new: "gray",
  awaiting_review: "violet",
  accepted: "blue",
  dismissed: "gray",
  assigned: "blue",
  in_progress: "blue",
  ready_for_retest: "violet",
  fixed: "green",
  verified: "green",
  reopened: "amber",
};
export const OPEN_FINDING_STATUSES: FindingStatus[] = ["new", "awaiting_review", "accepted", "assigned", "in_progress", "ready_for_retest", "reopened"];

export const VERIFICATION_LABEL: Record<VerificationState, string> = {
  verified: "Verified",
  failed: "Failed",
  needs_verification: "Needs verification",
  not_tested: "Not tested",
  blocked: "Blocked",
};
export const VERIFICATION_TONE: Record<VerificationState, Tone> = {
  verified: "green",
  failed: "red",
  needs_verification: "amber",
  not_tested: "gray",
  blocked: "red",
};
export const METHOD_LABEL: Record<CheckMethod, string> = {
  visually_observed: "Visually observed",
  functionally_tested: "Functionally tested",
  backend_verified: "Backend verified",
  manual: "Manual check",
};

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  submitted: "Submitted",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  superseded: "Superseded",
};
export const SUBMISSION_STATUS_TONE: Record<SubmissionStatus, Tone> = {
  submitted: "gray",
  in_review: "violet",
  changes_requested: "amber",
  approved: "green",
  superseded: "gray",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
export const JOB_STATUS_TONE: Record<JobStatus, Tone> = { queued: "gray", processing: "blue", completed: "green", failed: "red", cancelled: "gray" };

export const DECISION_LABEL: Record<ApprovalDecision, string> = { approved: "Approved", changes_requested: "Changes requested", rejected: "Rejected" };
export const DECISION_TONE: Record<ApprovalDecision, Tone> = { approved: "green", changes_requested: "amber", rejected: "red" };

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = { open: "Open", converted: "Converted to task", closed: "Closed" };
export const DEPLOYMENT_STATUS_LABEL: Record<DeploymentStatus, string> = {
  planned: "Planned",
  deployed: "Deployed",
  verified: "Verified",
  rolled_back: "Rolled back",
};
export const DEPLOYMENT_STATUS_TONE: Record<DeploymentStatus, Tone> = { planned: "gray", deployed: "blue", verified: "green", rolled_back: "red" };

export function options<T extends string>(labels: Record<T, string>) {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}
