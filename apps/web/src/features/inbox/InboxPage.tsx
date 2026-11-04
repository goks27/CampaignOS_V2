import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui";
import { LoadingRows, PageHeader, Pill, StatusDot } from "@/components/common";
import { CampaignGlyph } from "@/components/brand";
import { useAuth } from "@/lib/auth";
import { SEVERITY_LABEL, SEVERITY_TONE, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "@/lib/labels";
import { cn, formatDate, timeAgo, todayISO } from "@/lib/utils";
import { tasksService } from "@/services/tasks";
import { groupReview, myOpenTasks } from "@/features/home/model";
import { useNotificationActions } from "@/app/Notifications";
import { useAwaitingReview } from "./useInbox";

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">{title}{count > 0 && <span className="rounded-full bg-hover px-1.5 text-xs text-text-2 num">{count}</span>}</h2>
      {children}
    </section>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-box border border-dashed border-line px-3 py-4 text-sm text-text-2">{children}</p>;

/** One worklist: findings waiting for you, tasks assigned to you, and what has happened since you last looked. */
export function InboxPage() {
  const { me, isManager } = useAuth();
  const review = useAwaitingReview();
  const tasks = useQuery({ queryKey: ["tasks", "home"], queryFn: () => tasksService.list({ assigneeId: me?.id }), enabled: Boolean(me) });
  const notes = useNotificationActions();
  const groups = groupReview(review.data ?? [], 4);
  const mine = myOpenTasks(tasks.data ?? [], me?.id, todayISO());

  return (
    <div className="max-w-3xl space-y-7">
      <PageHeader title="My Inbox" description="Everything that needs you, in one place." />
      {isManager && (
        <Group title="Review" count={(review.data ?? []).length}>
          {review.isLoading ? <LoadingRows rows={2} /> : !groups.length ? <Empty>Nothing is waiting for review.</Empty> : (
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.campaignId} className="rounded-box border border-line">
                  <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                    <CampaignGlyph id={g.campaignId} name={g.name} size={18} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{g.name}</span>
                    <Button asChild size="sm" variant="primary"><Link to={`/reviews?campaign=${g.campaignId}`}>Review {g.count}</Link></Button>
                  </div>
                  <ul className="divide-y divide-line">{g.items.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm"><Pill tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</Pill><span className="min-w-0 flex-1 truncate">{f.title}</span><span className="text-xs text-muted">{f.requirements ? f.requirements.ref : "Additional observation"}</span></li>
                  ))}</ul>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted">Claude’s findings are drafts. Nothing is accepted until you decide.</p>
        </Group>
      )}
      <Group title="Assigned to you" count={mine.all.length}>
        {tasks.isLoading ? <LoadingRows rows={2} /> : !mine.all.length ? <Empty>No open tasks assigned to you.</Empty> : (
          <ul className="divide-y divide-line rounded-box border border-line">{mine.all.map((t) => (
            <li key={t.id}><Link to={`/tasks?task=${t.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-hover">
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{t.title}</span><span className="block truncate text-xs text-muted">{t.campaigns?.name}</span></span>
              <StatusDot tone={TASK_STATUS_TONE[t.status]} label={TASK_STATUS_LABEL[t.status]} className="text-xs" />
              <span className={cn("text-xs", t.due_date && t.due_date < todayISO() ? "text-st-red" : "text-muted")}>{t.due_date ? formatDate(t.due_date, true) : "No date"}</span>
            </Link></li>
          ))}</ul>
        )}
      </Group>
      <Group title="Updates" count={notes.unread.length}>
        <div className="mb-2 flex justify-end">{notes.unread.length > 0 && <Button size="sm" variant="ghost" onClick={() => void notes.markAll()}>Mark all read</Button>}</div>
        {!notes.data.length ? <Empty>No updates yet. Finished reviews and assignments show up here.</Empty> : (
          <ul className="divide-y divide-line rounded-box border border-line">{notes.data.map((n) => (
            <li key={n.id}><button onClick={() => void notes.open(n)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-hover">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} /><span className="flex-1 text-sm">{n.title}</span><span className="whitespace-nowrap text-xs text-muted">{timeAgo(n.created_at)}</span>
            </button></li>
          ))}</ul>
        )}
      </Group>
    </div>
  );
}
