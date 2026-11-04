/** Pure helpers for Home, Projects and Inbox. No fetching here, so the rules are easy to test. */
import type { Finding } from "@/services/findings";
import type { Task } from "@/services/tasks";

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, informational: 0 };
const sevRank = (s: string) => SEV_RANK[s] ?? 0;

export type ReviewGroup = { campaignId: string; name: string; count: number; worst: string; items: Finding[] };

/** Findings waiting for a manager, grouped by campaign: the most severe campaign first, then the biggest. */
export function groupReview(findings: Finding[], itemsPerGroup = 3): ReviewGroup[] {
  const by = new Map<string, ReviewGroup>();
  for (const f of findings) {
    if (f.status !== "new" && f.status !== "awaiting_review") continue;
    const g = by.get(f.campaign_id) ?? { campaignId: f.campaign_id, name: f.campaigns?.name ?? "Campaign", count: 0, worst: "informational", items: [] };
    g.count++;
    if (sevRank(f.severity) > sevRank(g.worst)) g.worst = f.severity;
    g.items.push(f);
    by.set(f.campaign_id, g);
  }
  return [...by.values()]
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => sevRank(b.severity) - sevRank(a.severity)).slice(0, itemsPerGroup) }))
    .sort((a, b) => sevRank(b.worst) - sevRank(a.worst) || b.count - a.count);
}

/** Your open tasks: overdue first, then by due date, tasks without a date last. */
export function myOpenTasks(tasks: Task[], meId: string | undefined, today: string) {
  const mine = tasks.filter((t) => t.assignee_id === meId && t.status !== "done");
  const byDue = (a: Task, b: Task) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31");
  const overdue = mine.filter((t) => t.due_date && t.due_date < today).sort(byDue);
  const rest = mine.filter((t) => !(t.due_date && t.due_date < today)).sort(byDue);
  return { overdue, rest, all: [...overdue, ...rest] };
}

export type CoverRow = { campaign_id: string; submission_id: string; bucket: string; storage_path: string; sort_order: number; created_at: string };

/** One cover per campaign: the first screen of its newest design submission. */
export function pickCovers(rows: CoverRow[]): Record<string, { bucket: string; path: string }> {
  const newest = new Map<string, string>(); // campaign -> newest submission id
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const r of sorted) if (!newest.has(r.campaign_id)) newest.set(r.campaign_id, r.submission_id);
  const out: Record<string, { bucket: string; path: string; order: number }> = {};
  for (const r of rows) {
    if (newest.get(r.campaign_id) !== r.submission_id) continue;
    const cur = out[r.campaign_id];
    if (!cur || r.sort_order < cur.order) out[r.campaign_id] = { bucket: r.bucket, path: r.storage_path, order: r.sort_order };
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { bucket: v.bucket, path: v.path }]));
}

/** What the Inbox badge counts: unread updates, plus findings waiting for you if you are a manager. */
export const inboxCount = (unread: number, awaitingReview: number, isManager: boolean) => unread + (isManager ? awaitingReview : 0);

/** Recently opened campaigns first, then the rest by most recent change. Only campaigns that still exist. */
export function continueList<T extends { id: string; updated_at: string }>(all: T[], recentIds: string[], limit = 6): T[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  const recent = recentIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const rest = all.filter((c) => !recentIds.includes(c.id)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return [...recent, ...rest].slice(0, limit);
}
