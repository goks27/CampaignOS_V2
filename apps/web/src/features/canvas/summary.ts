/** Pure summary of a campaign's data for the canvas cards. No fetching here, so it is easy to test. */
import type { SowDocument } from "@/services/requirements";
import type { Requirement } from "@/services/requirements";
import type { DesignSubmission, DesignAsset } from "@/services/designs";
import type { DevSubmission } from "@/services/development";
import type { Finding } from "@/services/findings";
import type { Task } from "@/services/tasks";
import type { ReviewType } from "@/lib/labels";

export type JobLite = { review_type: ReviewType; status: string };
export type Raw = {
  sow: SowDocument[]; requirements: Requirement[]; designs: DesignSubmission[]; builds: DevSubmission[];
  findings: Finding[]; tasks: Task[]; jobs: JobLite[];
};

const ACTIVE = new Set(["queued", "processing"]);
const OPEN_FINDING = new Set(["new", "awaiting_review", "accepted", "assigned", "in_progress", "ready_for_retest", "reopened"]);

export type Summary = ReturnType<typeof summarise>;

export function summarise(raw: Raw, today = new Date().toISOString().slice(0, 10)) {
  const active = (types: ReviewType[]) => raw.jobs.some((j) => types.includes(j.review_type) && ACTIVE.has(j.status));

  const versions = raw.sow.flatMap((d) => d.sow_versions.map((v) => ({ doc: d, version: v })))
    .sort((a, b) => b.version.created_at.localeCompare(a.version.created_at));
  const latestSow = versions[0] ?? null;
  const sowWorking = Boolean(latestSow && ACTIVE.has(latestSow.version.extraction_status)) || active(["sow_analysis"]);

  const reqs = {
    total: raw.requirements.length,
    draft: raw.requirements.filter((r) => r.status === "draft").length,
    accepted: raw.requirements.filter((r) => r.status === "accepted").length,
    clarification: raw.requirements.filter((r) => r.status === "needs_clarification").length,
    rejected: raw.requirements.filter((r) => r.status === "rejected").length,
  };

  const latestDesign = raw.designs.find((d) => d.status !== "superseded") ?? raw.designs[0] ?? null;
  const countByAsset = new Map<string, number>();
  for (const f of raw.findings) {
    if (f.design_asset_id && f.status !== "dismissed") countByAsset.set(f.design_asset_id, (countByAsset.get(f.design_asset_id) ?? 0) + 1);
  }
  const screens: { asset: DesignAsset; findings: number }[] = (latestDesign?.design_assets ?? []).map((asset) => ({ asset, findings: countByAsset.get(asset.id) ?? 0 }));

  const latestBuild = raw.builds[0] ?? null;

  const byStatus: Record<string, number> = {};
  for (const f of raw.findings) byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
  const open = raw.findings.filter((f) => OPEN_FINDING.has(f.status));
  const findings = {
    total: raw.findings.length,
    awaitingReview: (byStatus.new ?? 0) + (byStatus.awaiting_review ?? 0),
    critical: open.filter((f) => f.severity === "critical").length,
    high: open.filter((f) => f.severity === "high").length,
    byStatus,
  };

  const tasks = {
    total: raw.tasks.length,
    open: raw.tasks.filter((t) => t.status !== "done").length,
    overdue: raw.tasks.filter((t) => t.status !== "done" && t.due_date && t.due_date < today).length,
    done: raw.tasks.filter((t) => t.status === "done").length,
  };

  return {
    sow: { latest: latestSow, docs: raw.sow, working: sowWorking },
    reqs,
    designs: { latest: latestDesign, screens, working: active(["sow_vs_design", "design_consistency"]) },
    build: { latest: latestBuild, working: active(["design_vs_development", "functional_qa", "regression", "sow_vs_development"]) },
    findings,
    tasks,
  };
}
