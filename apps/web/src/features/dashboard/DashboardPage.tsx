import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, Clock, MessageSquareMore, FlaskConical, HelpCircle, Rocket, Sparkles, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { must } from "@/services/db";
import { dashboardService, activityService } from "@/services/activity";
import { useCampaigns, qk } from "@/hooks/queries";
import { useAuth } from "@/lib/auth";
import { useListKeys } from "@/hooks/useListKeys";
import { Button, Card } from "@/components/ui";
import { ErrorState, LoadingRows, PageHeader, Pill, Section, Skeleton } from "@/components/common";
import { SEVERITY_LABEL, SEVERITY_TONE, type Severity } from "@/lib/labels";
import { formatDate, timeAgo, todayISO } from "@/lib/utils";
import { CampaignTable } from "@/features/campaigns/CampaignTable";
import { CampaignDrawer } from "@/features/campaigns/CampaignDrawer";
import { CampaignFilters, DEFAULT_FILTER, applyCampaignFilter, type CampaignFilter } from "@/features/campaigns/CampaignFilters";
import { CampaignFormDialog } from "@/features/campaigns/CampaignForm";
import { ActivityFeed } from "@/features/shared/activity";
import type { CampaignWithRelations } from "@/services/campaigns";

const METRICS: { key: string; label: string; to?: string }[] = [
  { key: "active", label: "Active campaigns", to: "/campaigns" },
  { key: "awaiting_design_approval", label: "Awaiting design approval" },
  { key: "in_development", label: "In development" },
  { key: "pending_internal_qa", label: "Pending internal QA" },
  { key: "awaiting_client_uat", label: "Awaiting client UAT" },
  { key: "critical_open_findings", label: "Critical open findings", to: "/reviews?severity=critical" },
  { key: "overdue_tasks", label: "Overdue tasks", to: "/tasks?due=overdue" },
  { key: "upcoming_launches", label: "Launching in 14 days", to: "/timeline" },
];

type AttentionItem = { id: string; icon: React.ComponentType<{ className?: string }>; title: string; context: string; tags: React.ReactNode[]; time?: string; to: string; tone: string };

function useAttention(campaigns: CampaignWithRelations[] | undefined) {
  const findings = useQuery({
    queryKey: ["attention", "findings"],
    queryFn: async () => must(await supabase.from("findings").select("id, ref, title, severity, created_at, campaign_id, journeys(name), campaigns(name)")
      .in("status", ["new", "awaiting_review"]).in("severity", ["critical", "high"]).order("created_at", { ascending: false }).limit(20)),
  });
  const tasks = useQuery({
    queryKey: ["attention", "tasks"],
    queryFn: async () => must(await supabase.from("tasks").select("id, ref, title, due_date, campaign_id, campaigns(name), journeys(name)")
      .lt("due_date", todayISO()).neq("status", "done").order("due_date").limit(20)),
  });
  const reqs = useQuery({
    queryKey: ["attention", "reqs"],
    queryFn: async () => must(await supabase.from("requirements").select("campaign_id").eq("status", "needs_clarification")),
  });
  const deps = useQuery({
    queryKey: ["attention", "deployments"],
    queryFn: async () => must(await supabase.from("deployments").select("campaign_id, status, environment")),
  });

  return React.useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    const byId = new Map((campaigns ?? []).map((c) => [c.id, c]));
    for (const f of findings.data ?? []) {
      const c = f.campaigns as { name: string } | null;
      const j = f.journeys as { name: string } | null;
      items.push({ id: `f${f.id}`, icon: Sparkles, title: f.title, context: [c?.name, j?.name].filter(Boolean).join(" · "),
        tags: [<Pill key="s" tone={SEVERITY_TONE[f.severity as Severity]}>{SEVERITY_LABEL[f.severity as Severity]}</Pill>, <span key="r" className="font-mono text-xs text-muted">{f.ref}</span>],
        time: f.created_at, to: `/reviews?finding=${f.id}`, tone: "AI finding awaiting review" });
    }
    for (const t of tasks.data ?? []) {
      const c = t.campaigns as { name: string } | null;
      items.push({ id: `t${t.id}`, icon: Clock, title: t.title, context: c?.name ?? "", tags: [<span key="d" className="text-xs text-st-amber">Due {formatDate(t.due_date, true)}</span>],
        to: `/tasks?task=${t.id}`, tone: "Overdue task" });
    }
    for (const c of campaigns ?? []) {
      if (c.status !== "active") continue;
      if (c.design_status === "awaiting_client" || c.uat_status === "awaiting_client") {
        items.push({ id: `cf${c.id}`, icon: MessageSquareMore, title: `Waiting on client feedback`, context: c.name,
          tags: [<span key="x" className="text-xs text-muted">{c.uat_status === "awaiting_client" ? "UAT" : "Design"}</span>], to: `/campaigns/${c.id}/approvals`, tone: "Client" });
      }
      if (c.stage === "internal_qa" && c.qa_status !== "approved") {
        items.push({ id: `qa${c.id}`, icon: FlaskConical, title: "Build awaiting QA", context: c.name, tags: [], to: `/campaigns/${c.id}/development`, tone: "QA" });
      }
      if (c.stage === "live_deployment" && !(deps.data ?? []).some((d) => d.campaign_id === c.id && d.environment === "production" && (d.status === "deployed" || d.status === "verified"))) {
        items.push({ id: `dep${c.id}`, icon: Rocket, title: "Awaiting deployment approval", context: c.name, tags: [], to: `/campaigns/${c.id}/approvals`, tone: "Deploy" });
      }
    }
    const blocked = new Map<string, number>();
    (reqs.data ?? []).forEach((r) => blocked.set(r.campaign_id, (blocked.get(r.campaign_id) ?? 0) + 1));
    for (const [cid, n] of blocked) {
      const c = byId.get(cid);
      if (!c) continue;
      items.push({ id: `rq${cid}`, icon: HelpCircle, title: `${n} requirement${n > 1 ? "s" : ""} need client clarification`, context: c.name, tags: [], to: `/campaigns/${cid}/requirements`, tone: "Blocked" });
    }
    return items;
  }, [campaigns, findings.data, tasks.data, reqs.data, deps.data]);
}

export function DashboardPage() {
  const { me, canEdit } = useAuth();
  const navigate = useNavigate();
  const summary = useQuery({ queryKey: qk.summary, queryFn: dashboardService.summary });
  const campaigns = useCampaigns();
  const activity = useQuery({ queryKey: qk.activity("recent"), queryFn: () => activityService.list({ limit: 15 }) });
  const [filter, setFilter] = React.useState<CampaignFilter>(DEFAULT_FILTER);
  const [peek, setPeek] = React.useState<CampaignWithRelations | null>(null);
  const [creating, setCreating] = React.useState(false);
  const list = React.useMemo(() => applyCampaignFilter(campaigns.data ?? [], filter), [campaigns.data, filter]);
  const { index } = useListKeys(list, setPeek);
  const attention = useAttention(campaigns.data);
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader title={`${greeting}, ${me?.fullName.split(" ")[0] ?? ""}`} description="What’s active, what needs you, and what’s blocking delivery."
        actions={canEdit && <Button variant="primary" onClick={() => setCreating(true)}><Plus />New campaign</Button>} />

      <Card className="mb-6 grid grid-cols-2 divide-line sm:grid-cols-4 lg:grid-cols-8 [&>*]:border-line [&>*:not(:last-child)]:border-r max-lg:[&>*]:border-b">
        {METRICS.map((m) => {
          const v = summary.data?.[m.key];
          const body = (
            <>
              <p className="text-xs text-muted">{m.label}</p>
              {summary.isLoading ? <Skeleton className="mt-1 h-6 w-8" /> : <p className="mt-0.5 text-xl font-semibold num">{v ?? "—"}</p>}
            </>
          );
          return m.to ? <Link key={m.key} to={m.to} className="px-3.5 py-3 hover:bg-hover">{body}</Link> : <div key={m.key} className="px-3.5 py-3">{body}</div>;
        })}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <Section title="Campaigns">
            <CampaignFilters campaigns={campaigns.data ?? []} value={filter} onChange={setFilter} />
            {campaigns.error ? <ErrorState error={campaigns.error} onRetry={() => void campaigns.refetch()} />
              : campaigns.isLoading ? <LoadingRows /> : (
                <CampaignTable campaigns={list} onOpen={setPeek} selectedIndex={index}
                  emptyAction={canEdit && <Button variant="primary" onClick={() => setCreating(true)}><Plus />New campaign</Button>} />
              )}
          </Section>
        </div>
        <div className="min-w-0">
          <Section title={`Needs attention · ${attention.length}`}>
            <Card>
              {attention.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted">Nothing needs you right now. High-severity findings, overdue tasks and blockers will appear here.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {attention.slice(0, 12).map((a) => (
                    <li key={a.id}>
                      <button onClick={() => navigate(a.to)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-hover">
                        <a.icon className="mt-0.5 size-4 shrink-0 text-muted" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{a.title}</p>
                          <p className="truncate text-xs text-muted">{a.context}</p>
                          {a.tags.length > 0 && <div className="mt-1 flex items-center gap-1.5">{a.tags}</div>}
                        </div>
                        {a.time && <span className="whitespace-nowrap text-xs text-muted">{timeAgo(a.time)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Section>
          <Section title="Recent activity">
            <Card>{activity.isLoading ? <LoadingRows rows={4} /> : <ActivityFeed items={activity.data ?? []} />}</Card>
          </Section>
          {(campaigns.data?.length ?? 0) === 0 && !campaigns.isLoading && (
            <Card className="p-3 text-sm text-text-2">
              <AlertOctagon className="mb-1 size-4 text-muted" />
              No campaigns yet. {canEdit ? "Create one, or import your existing list from Notion." : "Ask a Manager to add you to a campaign."}
            </Card>
          )}
        </div>
      </div>
      <CampaignDrawer campaign={peek} onOpenChange={(o) => !o && setPeek(null)} />
      {canEdit && <CampaignFormDialog open={creating} onOpenChange={setCreating} />}
    </>
  );
}
