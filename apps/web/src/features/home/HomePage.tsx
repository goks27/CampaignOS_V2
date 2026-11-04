import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, CalendarRange, FlaskConical, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { ErrorState, LoadingRows, Pill, StatusDot } from "@/components/common";
import { CampaignGlyph } from "@/components/brand";
import { useAuth } from "@/lib/auth";
import { campaignPath, readRecent } from "@/lib/nav";
import { SEVERITY_LABEL, SEVERITY_TONE, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "@/lib/labels";
import { formatDate, todayISO } from "@/lib/utils";
import { useCampaigns } from "@/hooks/queries";
import { activityService } from "@/services/activity";
import { tasksService } from "@/services/tasks";
import { ActivityFeed } from "@/features/shared/activity";
import { useAwaitingReview } from "@/features/inbox/useInbox";
import { CampaignCover, useCovers } from "./CampaignCover";
import { continueList, groupReview, myOpenTasks } from "./model";

const greeting = () => { const h = new Date().getHours(); return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

function Block({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-box border border-dashed border-line px-3 py-5 text-sm text-text-2">{children}</p>;

/** Where you start: what you were in, what waits for you, what is assigned to you. Not a report. */
export function HomePage() {
  const { me, isManager, canEdit } = useAuth();
  const campaigns = useCampaigns();
  const review = useAwaitingReview();
  const tasks = useQuery({ queryKey: ["tasks", "home"], queryFn: () => tasksService.list({ assigneeId: me?.id }), enabled: Boolean(me) });
  const activity = useQuery({ queryKey: ["activity", "home"], queryFn: () => activityService.list({ limit: 10 }) });

  const active = (campaigns.data ?? []).filter((c) => c.status === "active");
  const cont = continueList(active, readRecent(), 6);
  const covers = useCovers(cont.map((c) => c.id));
  const groups = groupReview(review.data ?? []);
  const mine = myOpenTasks(tasks.data ?? [], me?.id, todayISO());

  if (campaigns.error) return <ErrorState error={campaigns.error} onRetry={() => void campaigns.refetch()} />;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-normal tracking-tight">{greeting()}, {me?.fullName.split(" ")[0] ?? ""}</h1>
          <p className="mt-1 text-sm text-muted">Pick up where you left off.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="ghost"><Link to="/timeline"><CalendarRange />Timeline</Link></Button>
          <Button asChild size="sm" variant="ghost"><Link to="/reports"><BarChart3 />Reports</Link></Button>
          <Button asChild size="sm"><Link to="/playground"><FlaskConical />Playground</Link></Button>
        </div>
      </div>

      <Block title="Continue" action={<Link to="/projects" className="flex items-center gap-1 text-xs text-text-2 hover:text-text">All projects <ArrowRight className="size-3.5" /></Link>}>
        {campaigns.isLoading ? <LoadingRows rows={3} /> : !cont.length ? (
          <Empty>No campaigns yet. {canEdit ? <Link to="/projects?new=1" className="text-accent hover:underline">Create the first one</Link> : "A manager adds campaigns."}</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cont.map((c) => <CampaignCover key={c.id} c={c} cover={covers[c.id]} />)}</div>
        )}
      </Block>

      <div className="grid gap-8 lg:grid-cols-2">
        {isManager && (
          <Block title={`Waiting for your review${groups.length ? ` · ${(review.data ?? []).length}` : ""}`} action={<Link to="/inbox" className="flex items-center gap-1 text-xs text-text-2 hover:text-text">Inbox <ArrowRight className="size-3.5" /></Link>}>
            {review.isLoading ? <LoadingRows rows={2} /> : !groups.length ? <Empty>Nothing is waiting for review. Claude’s findings appear here as drafts for you to accept or dismiss.</Empty> : (
              <ul className="divide-y divide-line rounded-box border border-line">
                {groups.slice(0, 5).map((g) => (
                  <li key={g.campaignId}>
                    <Link to={`/reviews?campaign=${g.campaignId}`} className="block px-3 py-2.5 hover:bg-hover">
                      <div className="flex items-center gap-2"><CampaignGlyph id={g.campaignId} name={g.name} size={18} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{g.name}</span><Pill tone={SEVERITY_TONE[g.worst as keyof typeof SEVERITY_TONE]}>{g.count} to review</Pill></div>
                      <ul className="mt-1.5 space-y-0.5 pl-7">{g.items.map((f) => <li key={f.id} className="flex items-center gap-2 text-xs text-text-2"><span className="text-muted">{SEVERITY_LABEL[f.severity]}</span><span className="truncate">{f.title}</span></li>)}</ul>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}
        <Block title={`Assigned to you${mine.all.length ? ` · ${mine.all.length}` : ""}`} action={<Link to="/tasks" className="flex items-center gap-1 text-xs text-text-2 hover:text-text">All tasks <ArrowRight className="size-3.5" /></Link>}>
          {tasks.isLoading ? <LoadingRows rows={2} /> : !mine.all.length ? <Empty>No open tasks assigned to you.</Empty> : (
            <ul className="divide-y divide-line rounded-box border border-line">
              {mine.all.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <Link to={`/tasks?task=${t.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-hover">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm">{t.title}</span><span className="block truncate text-xs text-muted">{t.campaigns?.name}</span></span>
                    <StatusDot tone={TASK_STATUS_TONE[t.status]} label={TASK_STATUS_LABEL[t.status]} className="text-xs" />
                    <span className={t.due_date && t.due_date < todayISO() ? "text-xs text-st-red" : "text-xs text-muted"}>{t.due_date ? formatDate(t.due_date, true) : "No date"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Block>
        <Block title="Recent activity" action={undefined}>
          <div className="rounded-box border border-line"><ActivityFeed items={activity.data ?? []} emptyText="Nothing has happened yet." /></div>
        </Block>
        {canEdit && (
          <Block title="Start something">
            <div className="flex flex-wrap gap-2">
              <Button asChild><Link to="/projects?new=1"><Plus />New project</Link></Button>
              <Button asChild><Link to="/playground"><FlaskConical />Try something in the Playground</Link></Button>
              {me && (campaigns.data ?? []).length > 0 && <Button asChild variant="ghost"><Link to={campaignPath((cont[0] ?? campaigns.data![0]!).id)}>Open {(cont[0] ?? campaigns.data![0]!).name}</Link></Button>}
            </div>
          </Block>
        )}
      </div>
    </div>
  );
}
