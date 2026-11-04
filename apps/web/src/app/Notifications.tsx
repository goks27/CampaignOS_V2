import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { qk, useNotifications } from "@/hooks/queries";
import { notificationsService } from "@/services/activity";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";

type Note = NonNullable<ReturnType<typeof useNotifications>["data"]>[number];

/** Marks a notification read and goes to what it is about. Shared by the bell and the Inbox. */
export function useNotificationActions() {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const unread = (data ?? []).filter((n) => !n.read_at);
  const markAll = async () => {
    await notificationsService.markRead(unread.map((n) => n.id));
    void qc.invalidateQueries({ queryKey: qk.notifications });
  };
  const open = async (n: Note) => {
    if (!n.read_at) {
      await notificationsService.markRead([n.id]);
      void qc.invalidateQueries({ queryKey: qk.notifications });
    }
    if (n.entity_type === "task") navigate(`/tasks?task=${n.entity_id}`);
    else if (n.entity_type === "review_job") navigate(n.kind.includes("sow") || n.title.startsWith("SOW") ? `/campaigns/${n.campaign_id}/requirements` : `/campaigns/${n.campaign_id}/review`);
    else if (n.campaign_id) navigate(`/campaigns/${n.campaign_id}`);
  };
  return { data: data ?? [], unread, markAll, open };
}

export function NotificationsButton() {
  const { data, unread, markAll, open } = useNotificationActions();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ""}`} className="relative">
          <Bell />
          {unread.length > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-accent" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="section-title">Notifications</span>
          {unread.length > 0 && <Button variant="link" size="sm" onClick={markAll}>Mark all read</Button>}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {data.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No notifications yet. Task assignments and finished reviews show up here.</p>}
          {data.map((n) => (
            <button key={n.id} onClick={() => void open(n)} className="flex w-full items-start gap-2 border-b border-line px-3 py-2 text-left last:border-0 hover:bg-hover">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
              <span className="flex-1 text-sm">{n.title}</span>
              <span className="text-xs text-muted whitespace-nowrap">{timeAgo(n.created_at)}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
