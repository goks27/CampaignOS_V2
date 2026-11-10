import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, Radio } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { ErrorState, LoadingRows, PageHeader, Pill, Section } from "@/components/common";
import { CampaignGlyph } from "@/components/brand";
import { useAuth } from "@/lib/auth";
import { HEALTH_LABEL, HEALTH_TONE } from "@/lib/labels";
import { cn, formatDate } from "@/lib/utils";
import { campaignPath } from "@/lib/nav";
import { progressService, type HomeSummary } from "@/services/progress";
import { PortfolioReport } from "@/features/reports/PortfolioReport";

const METRICS: { key: keyof HomeSummary["metrics"]; label: string; tone?: "red" | "amber"; to?: string }[] = [
  { key: "active", label: "Active campaigns", to: "/projects" },
  { key: "at_risk", label: "At risk", tone: "amber" },
  { key: "blocked", label: "Blocked", tone: "red" },
  { key: "findings_awaiting", label: "Findings to review", to: "/inbox?type=findings" },
  { key: "critical_open", label: "Critical open", tone: "red" },
  { key: "overdue_tasks", label: "Overdue tasks", tone: "amber", to: "/inbox?type=tasks" },
  { key: "launching_soon", label: "Launching in 14 days" },
];
const WHY = { blocked: "Blocked", at_risk: "At risk", findings: "Findings waiting" } as const;

/** Home: how the portfolio is doing, what needs attention, what launches soon, and every campaign in one table. One request fills the top. */
export function HomePage() {
  const { me } = useAuth();
  const { hash } = useLocation();
  const home = useQuery({ queryKey: ["home"], queryFn: () => progressService.home(), staleTime: 30_000 });
  React.useEffect(() => { if (hash) document.getElementById(hash.slice(1))?.scrollIntoView(); }, [hash, home.data]);

  return (
    <div className="mx-auto w-full max-w-content space-y-1 p-4 md:p-6">
      <PageHeader title={me?.fullName ? `Hello, ${me.fullName.split(" ")[0]}` : "Home"} description="How your campaigns are doing and what needs you."
        actions={<span className="flex gap-2"><Button asChild size="sm"><Link to="/playground"><FlaskConical />Quick check</Link></Button><Button asChild size="sm"><Link to="/live-test"><Radio />Live test</Link></Button></span>} />
      {home.error ? <ErrorState error={home.error} onRetry={() => void home.refetch()} />
        : home.isLoading || !home.data ? <LoadingRows rows={4} />
        : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" data-testid="metrics">
              {METRICS.map((m) => {
                const v = home.data.metrics[m.key];
                const body = (<><p className={cn("text-2xl font-semibold num", v > 0 && m.tone === "red" && "text-st-red", v > 0 && m.tone === "amber" && "text-st-amber")}>{v}</p><p className="text-xs text-text-2">{m.label}</p></>);
                return m.to ? <Link key={m.key} to={m.to} className="rounded-box border border-line bg-surface p-3 hover:bg-hover">{body}</Link> : <Card key={m.key} className="p-3">{body}</Card>;
              })}
            </div>

            <div className="grid gap-6 pt-5 lg:grid-cols-2">
              <Section title="Needs attention">
                {!home.data.attention.length ? <p className="rounded-box border border-dashed border-line px-3 py-4 text-sm text-text-2" data-testid="attention-empty">Nothing needs attention. Campaigns that are blocked, at risk or have findings to review appear here.</p> : (
                  <ul className="divide-y divide-line rounded-box border border-line" data-testid="attention">
                    {home.data.attention.map((a) => (
                      <li key={a.campaign_id}><Link to={a.kind === "findings" ? `/inbox?type=findings&campaign=${a.campaign_id}` : campaignPath(a.campaign_id)} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-hover">
                        <CampaignGlyph id={a.campaign_id} name={a.name} size={20} /><span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
                        {a.count > 0 && <span className="text-xs text-muted">{a.count} to review</span>}
                        <Pill tone={a.kind === "blocked" ? "red" : a.kind === "at_risk" ? "amber" : "blue"}>{WHY[a.kind]}</Pill>
                      </Link></li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section id="upcoming" title="Upcoming launches">
                {!home.data.upcoming.length ? <p className="rounded-box border border-dashed border-line px-3 py-4 text-sm text-text-2" data-testid="upcoming-empty">No launch dates set. Add a target launch date to a campaign and it appears here.</p> : (
                  <ul className="divide-y divide-line rounded-box border border-line" data-testid="upcoming">
                    {home.data.upcoming.map((u) => (
                      <li key={u.campaign_id}><Link to={campaignPath(u.campaign_id, "launch")} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-hover">
                        <CampaignGlyph id={u.campaign_id} name={u.name} size={20} /><span className="min-w-0 flex-1 truncate text-sm">{u.name}</span>
                        <span className="num whitespace-nowrap text-xs text-text-2">{formatDate(u.target_launch_date, true)}</span>
                        <Pill tone={HEALTH_TONE[u.health as keyof typeof HEALTH_TONE]}>{HEALTH_LABEL[u.health as keyof typeof HEALTH_LABEL]}</Pill>
                      </Link></li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </>
        )}
      <PortfolioReport />
    </div>
  );
}
