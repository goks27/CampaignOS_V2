import { useQuery } from "@tanstack/react-query";
import { Printer, ShieldAlert } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { LoadingRows, Section, StatusDot } from "@/components/common";
import { cn, formatDateTime } from "@/lib/utils";
import { siteNotes } from "@/lib/devices";
import { useConnectorStatus } from "@/hooks/queries";
import { developmentService } from "@/services/development";
import { findingsService } from "@/services/findings";
import { jobsService } from "@/services/jobs";
import { rulesService } from "@/services/rules";
import { progressService } from "@/services/progress";
import type { CampaignWithRelations } from "@/services/campaigns";
import { buildHealth, type Evidence, type AreaStatus } from "./model";

const TONE: Record<AreaStatus, "red" | "amber" | "green" | "gray"> = { failed: "red", incomplete: "amber", passed: "green", not_run: "gray" };
const LABEL: Record<AreaStatus, string> = { failed: "Failed", incomplete: "Incomplete", passed: "Passed", not_run: "Not run" };
const EVIDENCE_STYLE: Record<Evidence, string> = { CONFIRMED: "bg-st-red/15 text-st-red", OBSERVED: "bg-st-amber/15 text-st-amber", "AI SUGGESTION": "bg-st-blue/15 text-st-blue", "NEEDS VERIFICATION": "bg-hover text-text-2" };

/**
 * The Campaign Health Check: what was tested, what failed, what could not be verified and what was not tested, in one report.
 * Browser and rule results do not depend on AI; AI findings are shown apart, as suggestions.
 */
export function HealthCheck({ campaign: c }: { campaign: CampaignWithRelations }) {
  const connector = useConnectorStatus().data;
  const scenarios = useQuery({ queryKey: ["rules", "scenarios", c.id], queryFn: () => rulesService.scenarios(c.id) });
  const runs = useQuery({ queryKey: ["rules", "runs", c.id], queryFn: () => rulesService.runs(c.id) });
  const jobs = useQuery({ queryKey: ["jobs", "health", c.id], queryFn: () => jobsService.list({ campaignId: c.id, limit: 30 }) });
  const findings = useQuery({ queryKey: ["findings", "health", c.id], queryFn: () => findingsService.list({ campaignId: c.id }) });
  const cases = useQuery({ queryKey: ["dev", c.id, "cases"], queryFn: () => developmentService.testCases(c.id) });
  const qaRuns = useQuery({ queryKey: ["dev", c.id, "runs"], queryFn: () => developmentService.runs(c.id) });
  const progress = useQuery({ queryKey: ["progress", c.id], queryFn: () => progressService.campaign(c.id), staleTime: 15_000 });
  const loading = [scenarios, runs, jobs, findings, cases, qaRuns].some((q) => q.isLoading);

  const lastSite = (jobs.data ?? []).find((j) => j.review_type === "site_check" && j.status === "completed");
  const health = buildHealth({
    scenarios: scenarios.data ?? [], runs: runs.data ?? [],
    site: lastSite ? { finishedAt: lastSite.finished_at, status: lastSite.status, notes: siteNotes(lastSite.result_summary) } : null,
    qaCases: (cases.data ?? []).filter((t) => t.enabled).length,
    qaLatest: qaRuns.data?.[0] ? qaRuns.data[0].qa_test_results.map((r) => ({ result: r.result })) : null,
    findings: findings.data ?? [],
    acceptedRequirements: progress.data?.counts.accepted ?? 0, draftRequirements: progress.data?.counts.drafts ?? 0,
    aiOnline: connector == null ? false : connector.claude.ok,
  });

  return (
    <Section id="health" title="Campaign health check" actions={<Button size="sm" className="no-print" onClick={() => window.print()}><Printer />Print</Button>}>
      {loading ? <LoadingRows rows={3} /> : (
        <div className="space-y-3" data-testid="health">
          <Card className={cn("flex items-start gap-3 p-4", health.verdict === "failed" ? "border-st-red/40" : health.verdict === "incomplete" ? "border-st-amber/40" : "border-st-green/40")} data-testid="health-verdict" data-verdict={health.verdict}>
            <ShieldAlert className={cn("mt-0.5 size-5 shrink-0", health.verdict === "failed" ? "text-st-red" : health.verdict === "incomplete" ? "text-st-amber" : "text-st-green")} aria-hidden />
            <div className="min-w-0"><p className="font-medium">{health.headline}</p><p className="text-xs text-muted">Generated {formatDateTime(health.generatedAt)}. Browser and rule results do not depend on AI.</p></div>
          </Card>
          <div className="grid gap-3 lg:grid-cols-2">
            {health.sections.map((s) => (
              <Card key={s.area} className="space-y-2 p-3" data-testid={`health-${s.area}`} data-status={s.status}>
                <div className="flex items-center gap-2"><StatusDot tone={TONE[s.status]} /><p className="flex-1 text-sm font-medium">{s.title}</p><span className="text-xs text-muted">{s.independentOfAi ? "No AI" : "AI-assisted"} · {LABEL[s.status]}</span></div>
                <p className="text-sm text-text-2">{s.summary}</p>
                {s.lines.length > 0 && <ul className="space-y-1 text-sm">{s.lines.map((l, i) => <li key={i} className="flex items-start gap-2"><span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", EVIDENCE_STYLE[l.evidence])}>{l.evidence}</span><span>{l.text}</span></li>)}</ul>}
              </Card>
            ))}
          </div>
          <Card className="p-3" data-testid="health-not-tested">
            <p className="mb-1 text-sm font-medium">What was not tested or not verified</p>
            {!health.notTested.length ? <p className="text-sm text-text-2">Nothing is outstanding.</p> : <ul className="list-disc space-y-0.5 pl-5 text-sm text-text-2">{health.notTested.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          </Card>
        </div>
      )}
    </Section>
  );
}
