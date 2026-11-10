import type { NextKey, Progress } from "@/services/progress";
import { campaignPath, type Step } from "@/lib/nav";

/** The one next thing to do, in words, with where the button goes. Computed from data by campaign_progress(). */
export function nextAction(id: string, n: Progress["next"]): { label: string; to: string; step: Step | "inbox" } | null {
  if (!n) return null;
  const plural = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
  const text: Record<NextKey, string> = {
    upload_sow: "Upload the SOW",
    verify_requirements: `Verify ${plural(n.count, "draft requirement", "draft requirements")}`,
    submit_designs: "Submit designs",
    review_findings: `Review ${plural(n.count, "finding", "findings")}`,
    submit_build: "Submit a staging build",
    record_approval: n.count > 0 ? `Record client approval (${plural(n.count, "open feedback item", "open feedback items")})` : "Record client approval",
    plan_deployment: "Plan the production deployment",
  };
  const to = n.step === "inbox" ? `/inbox?type=findings&campaign=${id}` : campaignPath(id, n.step);
  return { label: text[n.key], to, step: n.step };
}

export const STATE_LABEL = { not_started: "Not started", current: "In progress", done: "Done" } as const;
