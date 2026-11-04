import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useNotifications } from "@/hooks/queries";
import { findingsService } from "@/services/findings";
import { inboxCount } from "@/features/home/model";

/** Findings waiting for a manager, across every campaign they can see. Shared by Home, Inbox and the rail badge. */
export function useAwaitingReview() {
  const { isManager, session } = useAuth();
  return useQuery({
    queryKey: ["findings", "inbox"], queryFn: () => findingsService.list({ statuses: ["new", "awaiting_review"] }),
    enabled: Boolean(session) && isManager, refetchInterval: 60_000,
  });
}

/** The number on the Inbox item: unread updates, plus findings waiting for you if you are a manager. */
export function useInboxCount() {
  const { isManager } = useAuth();
  const notes = useNotifications();
  const review = useAwaitingReview();
  const unread = (notes.data ?? []).filter((n) => !n.read_at).length;
  return inboxCount(unread, review.data?.length ?? 0, isManager);
}
