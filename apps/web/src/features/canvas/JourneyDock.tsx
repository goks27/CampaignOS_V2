import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, ChevronDown, FlaskConical, ScanSearch } from "lucide-react";
import { Pill, StatusDot } from "@/components/common";
import { useAuth } from "@/lib/auth";
import { SEVERITY_LABEL, SEVERITY_TONE, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "@/lib/labels";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { useProfiles } from "@/hooks/queries";
import { activityService } from "@/services/activity";
import type { CampaignWithRelations } from "@/services/campaigns";
import { RunReviewButton } from "@/features/shared/RunReview";
import { AssetImage } from "@/features/shared/AssetImage";
import { describeActivity } from "@/features/shared/activity";
import type { JourneyModel } from "./journeyModel";

type Tab = "review" | "issues" | "tests" | "activity";
const DOCK_KEY = "campaignos-dock-open";
const readOpen = () => { try { return localStorage.getItem(DOCK_KEY) !== "0"; } catch { return true; } };

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("flex w-[300px] shrink-0 gap-3 rounded-box border border-line bg-surface p-3", className)}>{children}</div>
);

/** The strip under the canvas: what the journey needs right now. Review findings, issues, test runs, activity. */
export function JourneyDock({ campaign: c, model, onSelectScreen }: { campaign: CampaignWithRelations; model: JourneyModel; onSelectScreen: (assetId: string) => void }) {
  const { canEdit } = useAuth();
  const { name } = useProfiles();
  const [tab, setTab] = React.useState<Tab>("review");
  const [open, setOpen] = React.useState(readOpen);
  const activity = useQuery({ queryKey: ["activity", "dock", c.id], queryFn: () => activityService.list({ campaignId: c.id, limit: 12 }), enabled: open && tab === "activity" });
  const toggle = (next?: Tab) => {
    if (next && next !== tab) { setTab(next); if (!open) setOpen(true); return; }
    setOpen((o) => { try { localStorage.setItem(DOCK_KEY, o ? "0" : "1"); } catch { /* a convenience only */ } return !o; });
  };

  const openFindings = model.findings.filter((f) => !["dismissed", "fixed", "verified"].includes(f.status));
  const screenOf = (assetId: string | null) => model.screens.find((s) => s.asset.id === assetId);
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; n: number }[] = [
    { id: "review", label: "AI Review", icon: ScanSearch, n: openFindings.length }, { id: "issues", label: "Issues", icon: AlertCircle, n: model.summary.openTasks },
    { id: "tests", label: "Test Runs", icon: FlaskConical, n: model.tests.total }, { id: "activity", label: "Activity", icon: Activity, n: 0 },
  ];

  return (
    <section aria-label="Journey details" className="shrink-0 border-t border-line bg-bg">
      <div className="flex items-center gap-1 overflow-x-auto px-3">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => toggle(t.id)} aria-pressed={open && tab === t.id}
            className={cn("relative flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm text-text-2 hover:text-text", open && tab === t.id && "font-medium text-text")}>
            <t.icon className="size-4 text-muted" />{t.label}
            {t.n > 0 && <span className="rounded-full bg-hover px-1.5 text-xs text-text-2 num">{t.n}</span>}
            {open && tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
        <button onClick={() => toggle()} aria-label={open ? "Hide the details" : "Show the details"} className="ml-auto rounded-ctl p-1 text-muted hover:bg-hover hover:text-text"><ChevronDown className={cn("size-4 transition-transform", !open && "rotate-180")} /></button>
      </div>
      {open && (
        <div className="flex min-h-[132px] gap-3 overflow-x-auto px-3 pb-3 pt-1" data-testid="dock-body">
          {tab === "review" && <>
            {openFindings.slice(0, 10).map((f) => {
              const s = screenOf(f.design_asset_id);
              return (
                <Card key={f.id}>
                  <button disabled={!s} onClick={() => s && onSelectScreen(s.asset.id)} className="h-[86px] w-[56px] shrink-0 overflow-hidden rounded-ctl border border-line-strong bg-side" aria-label={s ? `Select ${s.asset.screen_name}` : undefined}>
                    {s ? <AssetImage bucket={s.asset.bucket} path={s.asset.storage_path} alt={s.asset.screen_name} className="h-full w-full" imgClassName="object-cover object-top" /> : null}
                  </button>
                  <div className="min-w-0 space-y-1"><p className="text-xs text-muted">{s?.asset.screen_name ?? "Whole journey"}</p><Pill tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</Pill><p className="line-clamp-3 text-sm">{f.title}</p></div>
                </Card>
              );
            })}
            {!openFindings.length && <Card className="w-[360px]"><p className="text-sm text-text-2">No open findings in this journey. Run an AI review to check the designs against the accepted requirements.</p></Card>}
            <Card className="w-[320px] flex-col justify-between">
              <div><p className="text-sm font-medium">Run a new AI review</p><p className="mt-1 text-xs text-muted">Compare the designs and the accepted requirements. Findings arrive as drafts for a manager.</p></div>
              {canEdit && model.submission && !model.working.design
                ? <RunReviewButton size="sm" variant="primary" campaignId={c.id} reviewType="sow_vs_design" source={{ design_submission_id: model.submission.id }} label="Run review" />
                : <p className="text-xs text-muted">{model.working.design ? "Claude is working on it." : "Submit designs for this journey first."}</p>}
            </Card>
          </>}
          {tab === "issues" && <>
            {model.tasks.slice(0, 12).map((t) => (
              <Card key={t.id} className="flex-col">
                <Link to={`/tasks?task=${t.id}`} className="line-clamp-2 text-sm font-medium hover:text-accent">{t.ref ? <span className="mr-1 font-mono text-xs text-muted">{t.ref}</span> : null}{t.title}</Link>
                <p className="mt-auto flex items-center gap-2 text-xs text-muted"><StatusDot tone={TASK_STATUS_TONE[t.status]} label={TASK_STATUS_LABEL[t.status]} className="text-xs" />{t.assignee?.full_name ?? "Unassigned"}{t.due_date ? ` · due ${formatDate(t.due_date, true)}` : ""}</p>
              </Card>
            ))}
            {!model.tasks.length && <Card className="w-[360px]"><p className="text-sm text-text-2">No tasks for this journey yet. Accepted findings become tasks.</p></Card>}
          </>}
          {tab === "tests" && <>
            {model.tests.results.map((r) => (
              <Card key={r.id} className="flex-col">
                <StatusDot tone={r.result === "verified" ? "green" : r.result === "failed" ? "red" : r.result === "blocked" ? "amber" : "gray"} label={r.result === "verified" ? "Passed" : r.result === "failed" ? "Failed" : r.result === "blocked" ? "Blocked" : "Not run"} className="text-xs" />
                <p className="text-sm font-medium">{r.title}</p>
                {r.actual && r.result !== "verified" && <p className="line-clamp-2 text-xs text-muted">{r.actual}</p>}
              </Card>
            ))}
            {!model.tests.total && <Card className="w-[360px]"><p className="text-sm text-text-2">No test scenarios for this journey yet. Add them in Testing.</p></Card>}
            {canEdit && model.build && model.tests.total > 0 && !model.working.build && (
              <Card className="w-[260px] flex-col justify-between"><p className="text-sm font-medium">Run the scenarios again</p><RunReviewButton size="sm" variant="primary" campaignId={c.id} reviewType="functional_qa" source={{ development_submission_id: model.build.id }} label="Run scenarios" /></Card>
            )}
          </>}
          {tab === "activity" && (
            (activity.data ?? []).length ? (activity.data ?? []).map((a) => (
              <Card key={a.id} className="flex-col"><p className="line-clamp-3 text-sm">{describeActivity(a, name)}</p><p className="mt-auto text-xs text-muted">{name(a.actor_id)} · {timeAgo(a.created_at)}</p></Card>
            )) : <Card className="w-[360px]"><p className="text-sm text-text-2">{activity.isLoading ? "Loading…" : "Nothing has happened in this campaign yet."}</p></Card>
          )}
        </div>
      )}
    </section>
  );
}
