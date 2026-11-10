import { supabase, must } from "./db";

export type StepState = "not_started" | "current" | "done";
export type NextKey = "upload_sow" | "verify_requirements" | "submit_designs" | "review_findings" | "submit_build" | "record_approval" | "plan_deployment";
export type Progress = {
  steps: { id: "brief" | "requirements" | "design" | "build" | "launch"; state: StepState; open: number }[];
  next: { key: NextKey; step: "requirements" | "design" | "build" | "launch" | "inbox"; count: number } | null;
  counts: Record<string, number>;
};
export type HomeSummary = {
  metrics: { active: number; at_risk: number; blocked: number; findings_awaiting: number; critical_open: number; overdue_tasks: number; launching_soon: number };
  attention: { campaign_id: string; name: string; kind: "blocked" | "at_risk" | "findings"; count: number }[];
  upcoming: { campaign_id: string; name: string; target_launch_date: string; health: string }[];
};
export type PortfolioRow = {
  id: string; name: string; client: string | null; stage: string; status: string; health: string; priority: string; design_status: string; development_status: string; qa_status: string; uat_status: string;
  start_date: string | null; target_launch_date: string | null; requirements_accepted: number; requirements_total: number; findings_open: number; critical_open: number; tasks_open: number;
};
export type ReviewAction = "check_sow" | "review_designs" | "test_build";
export type ReviewOutcome = { type: string; status: "queued" | "skipped"; job_id?: string; reason?: string };

/** One call each, so a screen is one request instead of one per campaign. They are SECURITY INVOKER: row-level security decides what is counted. */
export const progressService = {
  async campaign(id: string): Promise<Progress | null> {
    return must(await supabase.rpc("campaign_progress", { p_campaign: id })) as unknown as Progress | null;
  },
  async home(): Promise<HomeSummary> {
    return must(await supabase.rpc("home_summary")) as unknown as HomeSummary;
  },
  async portfolio(): Promise<PortfolioRow[]> {
    return must(await supabase.rpc("portfolio_report")) as unknown as PortfolioRow[];
  },
  /** Starts every check an action covers and says why it skipped the others. */
  async review(campaignId: string, action: ReviewAction, source: Record<string, string>, runAgain = false): Promise<ReviewOutcome[]> {
    return must(await supabase.rpc("enqueue_reviews", { p_campaign: campaignId, p_action: action, p_source: source, p_run_again: runAgain })) as unknown as ReviewOutcome[];
  },
};
