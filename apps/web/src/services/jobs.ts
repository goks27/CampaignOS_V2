import { supabase, must, type Tables } from "./db";
import type { ReviewType } from "@/lib/labels";

export type ReviewJob = Tables<"review_jobs">;
export type WorkerStatus = Tables<"worker_status">;

const OFFLINE_AFTER_MS = 2 * 60 * 1000;

export type WorkerState = { state: "not_set_up" | "offline" | "online" | "busy"; worker?: WorkerStatus; queued: number };

export function deriveWorkerState(workers: WorkerStatus[], queued: number): WorkerState {
  if (!workers.length) return { state: "not_set_up", queued };
  const latest = [...workers].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))[0]!;
  const fresh = Date.now() - new Date(latest.last_seen_at).getTime() < OFFLINE_AFTER_MS;
  if (!fresh) return { state: "offline", worker: latest, queued };
  return { state: latest.busy ? "busy" : "online", worker: latest, queued };
}

export const jobsService = {
  async enqueue(campaignId: string, type: ReviewType, source: Record<string, string>, runAgain = false) {
    return must(await supabase.rpc("enqueue_review", { p_campaign: campaignId, p_type: type, p_source: source, p_run_again: runAgain })) as string;
  },
  async cancel(jobId: string) {
    must(await supabase.rpc("cancel_review_job", { p_job: jobId }));
  },
  async list(opts: { campaignId?: string; limit?: number } = {}) {
    let q = supabase.from("review_jobs")
      .select("id, campaign_id, review_type, status, source, attempts, max_attempts, error, created_at, started_at, finished_at, duration_ms, model, prompt_version, result_summary, triggered_by, cancel_requested, created_by, campaigns(name)")
      .order("created_at", { ascending: false }).limit(opts.limit ?? 50);
    if (opts.campaignId) q = q.eq("campaign_id", opts.campaignId);
    return must(await q) as unknown as (Pick<ReviewJob, "id" | "campaign_id" | "review_type" | "status" | "source" | "attempts" | "max_attempts" | "error" | "created_at" | "started_at" | "finished_at" | "duration_ms" | "model" | "prompt_version" | "result_summary" | "triggered_by" | "cancel_requested" | "created_by"> & { campaigns: { name: string } | null })[];
  },
  async workerState(): Promise<WorkerState> {
    const [workers, queued] = await Promise.all([
      supabase.from("worker_status").select("*"),
      supabase.from("review_jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    ]);
    return deriveWorkerState(must(workers), queued.count ?? 0);
  },
};
