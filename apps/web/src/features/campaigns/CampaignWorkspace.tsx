import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Check, ListTodo, X } from "lucide-react";
import { useCampaign } from "@/hooks/queries";
import { ErrorState, LoadingRows, Section } from "@/components/common";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { campaignPath, resolveStep, STEPS, STEP_LABEL, type Panel, type Step } from "@/lib/nav";
import type { CampaignWithRelations } from "@/services/campaigns";
import { progressService, type Progress } from "@/services/progress";
import { CampaignCanvas } from "@/features/canvas/CanvasHome";
import { JobsTable } from "@/features/shared/JobsTable";
import { RulesLab } from "@/features/rules/RulesLab";
import { HealthCheck } from "@/features/health/HealthCheck";
import { RequirementsTab } from "./tabs/RequirementsTab";
import { DesignsTab } from "./tabs/DesignsTab";
import { DevelopmentTab } from "./tabs/DevelopmentTab";
import { ApprovalsTab } from "./tabs/ApprovalsTab";
import { DocumentsTab } from "./tabs/DocumentsTab";
import { CampaignTasksTab } from "./tabs/CampaignTasksTab";
import { ActivityTab } from "./tabs/ActivityTab";
import { nextAction, STATE_LABEL } from "./progress";

/** The five steps of a campaign, each marked done, in progress or not started, with how many items are waiting in it. */
export function StepBar({ id, current, progress, side, onSide }: { id: string; current: Step; progress: Progress | null | undefined; side: Panel | null; onSide: (p: Panel | null) => void }) {
  const { search } = useLocation();
  const byId = new Map((progress?.steps ?? []).map((s) => [s.id, s]));
  return (
    <div className="flex shrink-0 items-stretch border-b border-line bg-bg">
      <nav aria-label="Campaign steps" className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-3 sm:px-4">
        {STEPS.map((s, i) => {
          const st = byId.get(s);
          const on = s === current;
          return (
            <Link key={s} to={{ pathname: campaignPath(id, s), search: s === "brief" ? search.replace(/[?&]side=[^&]*/, "") : "" }} aria-current={on ? "step" : undefined} data-state={st?.state ?? "not_started"} title={st ? STATE_LABEL[st.state] : undefined}
              className={cn("relative flex h-11 shrink-0 items-center gap-2 px-3 text-sm text-text-2 hover:text-text", on && "font-medium text-text")}>
              <span className={cn("flex size-[18px] items-center justify-center rounded-full border text-[11px] num", st?.state === "done" ? "border-st-green bg-st-green text-white" : on || st?.state === "current" ? "border-accent text-accent" : "border-line-strong text-muted")} aria-hidden>
                {st?.state === "done" ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              {STEP_LABEL[s]}
              {st && st.open > 0 && <span className="rounded-full bg-st-amber/15 px-1.5 text-[11px] font-medium text-st-amber num" aria-label={`${st.open} open`}>{st.open}</span>}
              {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
            </Link>
          );
        })}
      </nav>
      <div className="flex shrink-0 items-center gap-1 border-l border-line px-2" role="group" aria-label="Side panel">
        <Button size="sm" variant={side === "tasks" ? "primary" : "ghost"} onClick={() => onSide(side === "tasks" ? null : "tasks")} aria-pressed={side === "tasks"}><ListTodo /><span className="hidden sm:inline">Tasks</span></Button>
        <Button size="sm" variant={side === "activity" ? "primary" : "ghost"} onClick={() => onSide(side === "activity" ? null : "activity")} aria-pressed={side === "activity"}><Activity /><span className="hidden sm:inline">Activity</span></Button>
      </div>
    </div>
  );
}

/** Top of every campaign: the one thing to do next, with one button. It is worked out from the data, never typed in. */
export function NextStepCard({ id, progress, loading }: { id: string; progress: Progress | null | undefined; loading: boolean }) {
  if (loading) return <div className="h-11 shrink-0 border-b border-line bg-side" aria-hidden />;
  const a = nextAction(id, progress?.next ?? null);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-side px-4 py-2" data-testid="next-step">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">Next</span>
      {a ? (
        <>
          <span className="min-w-0 flex-1 text-sm font-medium" data-testid="next-label">{a.label}</span>
          <Button asChild size="sm" variant="primary"><Link to={a.to}>{a.label.split(" ")[0]}<ArrowRight /></Link></Button>
        </>
      ) : <span className="min-w-0 flex-1 text-sm text-text-2" data-testid="next-label">Nothing is waiting. Everything on this campaign is up to date.</span>}
    </div>
  );
}

function Body({ c, step }: { c: CampaignWithRelations; step: Step }) {
  switch (step) {
    case "requirements": return <><RequirementsTab campaign={c} /><Section title="Documents"><DocumentsTab campaign={c} /></Section></>;
    case "design": return <DesignsTab campaign={c} />;
    case "build": return <><DevelopmentTab campaign={c} part="all" /><RulesLab campaign={c} /><Section title="Review jobs"><JobsTable campaignId={c.id} /></Section></>;
    case "launch": return <><HealthCheck campaign={c} /><ApprovalsTab campaign={c} /></>;
    default: return null;
  }
}

export function CampaignWorkspace() {
  const { id, tab } = useParams();
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  const { data: c, isLoading, error, refetch } = useCampaign(id);
  const { step, panel, redirect } = resolveStep(tab);
  const progress = useQuery({ queryKey: ["progress", id], queryFn: () => progressService.campaign(id!), enabled: Boolean(id), staleTime: 15_000 });
  const sideParam = params.get("side");
  const side: Panel | null = sideParam === "tasks" || sideParam === "activity" ? sideParam : null;
  const setSide = (p: Panel | null) => setParams((cur) => { const n = new URLSearchParams(cur); if (p) n.set("side", p); else n.delete("side"); return n; }, { replace: true });

  // Old addresses (…/overview, …/ai-reviews, …/tasks) keep working: they land on the step, or the side panel, that holds that content now.
  if (redirect && id) {
    const sp = new URLSearchParams(search);
    if (panel) sp.set("side", panel);
    const q = sp.toString();
    return <Navigate to={{ pathname: campaignPath(id, step), search: q ? `?${q}` : "" }} replace />;
  }
  if (!id) return null;

  return (
    <>
      <StepBar id={id} current={step} progress={progress.data} side={side} onSide={setSide} />
      <NextStepCard id={id} progress={progress.data} loading={progress.isLoading} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error ? <div className="p-6"><ErrorState error={error} onRetry={() => void refetch()} /></div>
            : isLoading || !c ? <div className="p-6"><LoadingRows rows={8} /></div>
            : step === "brief" ? <div className="flex min-h-0 flex-1 flex-col"><CampaignCanvas campaign={c} /></div>
            : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-content px-4 py-5 sm:px-6"><div key={step} className="page-enter"><Body c={c} step={step} /></div></div>
              </div>
            )}
        </div>
        {side && c && (
          <aside aria-label={side === "tasks" ? "Tasks" : "Activity"} className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-line bg-bg lg:block" data-testid="side-panel">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <p className="text-sm font-medium">{side === "tasks" ? "Tasks" : "Activity"}</p>
              <button onClick={() => setSide(null)} aria-label="Close the side panel" className="rounded-ctl p-1 text-muted hover:bg-hover hover:text-text"><X className="size-4" /></button>
            </div>
            <div className="p-3">{side === "tasks" ? <CampaignTasksTab campaign={c} /> : <ActivityTab campaign={c} />}</div>
          </aside>
        )}
      </div>
    </>
  );
}
