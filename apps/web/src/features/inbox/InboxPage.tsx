import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ListTodo, MessageSquareText, Radio, ScanSearch, HelpCircle } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { LoadingRows, PageHeader, Pill } from "@/components/common";
import { CampaignGlyph } from "@/components/brand";
import { useAuth } from "@/lib/auth";
import { SEVERITY_LABEL, SEVERITY_TONE } from "@/lib/labels";
import { cn, timeAgo } from "@/lib/utils";
import { tasksService } from "@/services/tasks";
import { deliveryService } from "@/services/delivery";
import { requirementsService } from "@/services/requirements";
import { liveTestService } from "@/services/connector";
import { useNotificationActions } from "@/app/Notifications";
import { ReviewsPage } from "@/features/reviews/ReviewsPage";
import { TasksPage } from "@/features/tasks/TasksPage";
import { useAwaitingReview } from "./useInbox";
import { buildItems, KIND_LABEL, type InboxKind } from "./model";

const ICON: Record<Exclude<InboxKind, "all">, React.ComponentType<{ className?: string }>> = { findings: ScanSearch, tasks: ListTodo, feedback: MessageSquareText, live: Radio, clarify: HelpCircle };
const KINDS: InboxKind[] = ["all", "findings", "tasks", "feedback", "live", "clarify"];

/**
 * One Inbox: everything waiting on you, newest first, filterable by campaign and type. Findings open in the three-column review
 * (J/K, A, D, E, Enter); tasks keep their list and board. A campaign's own tasks and activity are in its side panel.
 */
export function InboxPage() {
  const { me, isManager } = useAuth();
  const [params, setParams] = useSearchParams();
  const kind = (KINDS as string[]).includes(params.get("type") ?? "") ? (params.get("type") as InboxKind) : "all";
  const campaign = params.get("campaign") ?? "";
  const set = (patch: Record<string, string | null>) => setParams((cur) => { const n = new URLSearchParams(cur); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); } return n; }, { replace: true });

  const review = useAwaitingReview();
  const tasks = useQuery({ queryKey: ["tasks", "home"], queryFn: () => tasksService.list({ assigneeId: me?.id }), enabled: Boolean(me) });
  const feedback = useQuery({ queryKey: ["feedback", "open"], queryFn: () => deliveryService.openFeedback(), enabled: isManager });
  const clarify = useQuery({ queryKey: ["requirements", "clarify"], queryFn: () => requirementsService.needingClarification(), enabled: isManager });
  const live = useQuery({ queryKey: ["livetest", "runs"], queryFn: () => liveTestService.runs(), retry: false, refetchInterval: 5000 });
  const notes = useNotificationActions();

  const all = React.useMemo(() => buildItems({ findings: isManager ? review.data ?? [] : [], tasks: tasks.data ?? [], meId: me?.id, feedback: feedback.data ?? [], clarify: clarify.data ?? [], live: live.data ?? [] }), [isManager, review.data, tasks.data, me?.id, feedback.data, clarify.data, live.data]);
  const campaigns = React.useMemo(() => [...new Map(all.filter((i) => i.campaignId).map((i) => [i.campaignId!, i.campaignName ?? ""])).entries()].map(([value, label]) => ({ value, label })), [all]);
  const shown = all.filter((i) => (kind === "all" || i.kind === kind) && (!campaign || i.campaignId === campaign));
  const count = (k: InboxKind) => all.filter((i) => (k === "all" || i.kind === k) && (!campaign || i.campaignId === campaign)).length;
  const loading = review.isLoading || tasks.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader title="Inbox" description="Everything waiting on you, newest first." />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by type">
        {KINDS.filter((k) => isManager || !["findings", "feedback", "clarify"].includes(k)).map((k) => (
          <button key={k} onClick={() => set({ type: k === "all" ? null : k })} aria-pressed={k === kind} data-testid={`type-${k}`}
            className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm", k === kind ? "border-accent bg-accent/10 font-medium text-accent" : "border-line text-text-2 hover:bg-hover")}>
            {k !== "all" && (() => { const I = ICON[k]; return <I className="size-3.5" />; })()}{KIND_LABEL[k]}
            {count(k) > 0 && <span className="num text-xs">{count(k)}</span>}
          </button>
        ))}
        {campaigns.length > 1 && <Select aria-label="Campaign" className="ml-auto w-52" value={campaign} onChange={(e) => set({ campaign: e.target.value || null })} placeholder="All campaigns" options={campaigns} />}
      </div>

      {kind === "findings" ? <ReviewsPage embedded />
        : kind === "tasks" ? <TasksPage embedded />
        : (
          <div className="max-w-3xl space-y-6">
            {loading ? <LoadingRows rows={3} /> : !shown.length ? (
              <p className="rounded-box border border-dashed border-line px-3 py-6 text-sm text-text-2" data-testid="inbox-empty">
                {kind === "all" ? "Nothing is waiting on you. New findings, assigned tasks and client feedback appear here." : `No ${KIND_LABEL[kind].toLowerCase()} are waiting on you.`}
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-box border border-line" data-testid="inbox-list">
                {shown.map((i) => {
                  const I = ICON[i.kind];
                  return (
                    <li key={i.key}>
                      <Link to={i.to} className="flex items-center gap-3 px-3 py-2.5 hover:bg-hover" data-kind={i.kind}>
                        <I className="size-4 shrink-0 text-muted" aria-label={KIND_LABEL[i.kind]} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{i.title}</span>
                          <span className="flex items-center gap-1.5 truncate text-xs text-muted">{i.campaignId && <CampaignGlyph id={i.campaignId} name={i.campaignName ?? ""} size={14} />}{i.campaignName}{i.detail ? ` · ${i.detail}` : ""}</span>
                        </span>
                        {i.evidence && <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", i.evidence === "AI SUGGESTION" ? "bg-st-blue/15 text-st-blue" : "bg-st-amber/15 text-st-amber")} data-testid="evidence">{i.evidence}</span>}
                        {i.severity && <Pill tone={SEVERITY_TONE[i.severity]}>{SEVERITY_LABEL[i.severity]}</Pill>}
                        <span className="shrink-0 whitespace-nowrap text-xs text-muted">{timeAgo(i.at)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {kind === "all" && (
              <section>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">Updates{notes.unread.length > 0 && <span className="rounded-full bg-hover px-1.5 text-xs text-text-2 num">{notes.unread.length}</span>}</h2>
                <div className="mb-2 flex justify-end">{notes.unread.length > 0 && <Button size="sm" variant="ghost" onClick={() => void notes.markAll()}>Mark all read</Button>}</div>
                {!notes.data.length ? <p className="rounded-box border border-dashed border-line px-3 py-4 text-sm text-text-2">No updates yet. Finished reviews and assignments show up here.</p> : (
                  <ul className="divide-y divide-line rounded-box border border-line">{notes.data.map((n) => (
                    <li key={n.id}><button onClick={() => void notes.open(n)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-hover">
                      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} /><span className="flex-1 text-sm">{n.title}</span><span className="whitespace-nowrap text-xs text-muted">{timeAgo(n.created_at)}</span>
                    </button></li>
                  ))}</ul>
                )}
              </section>
            )}
            {!isManager && kind === "all" && <p className="flex items-center gap-1.5 text-xs text-muted"><AlertCircle className="size-3.5" />Findings, client feedback and requirement questions are for Managers and Admins.</p>}
          </div>
        )}
    </div>
  );
}
