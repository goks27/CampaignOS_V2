/** Pure helpers for the Inbox: turn everything waiting on a person into one list. No fetching here, so the rules are easy to test. */
import type { Finding } from "@/services/findings";
import type { Task } from "@/services/tasks";
import type { LiveTestRunSummary } from "@/services/connector";
import { AI_REVIEW_TYPES, type Evidence } from "@/features/health/model";

export type InboxKind = "all" | "findings" | "tasks" | "feedback" | "live" | "clarify";
export const KIND_LABEL: Record<InboxKind, string> = { all: "All", findings: "Findings", tasks: "Tasks", feedback: "Client feedback", live: "Live test", clarify: "Questions" };

export type InboxItem = {
  key: string; kind: Exclude<InboxKind, "all">; title: string; campaignId: string | null; campaignName: string | null; at: string; to: string;
  severity?: Finding["severity"]; detail?: string;
  /** How a finding was reached: a model's suggestion, or something a browser check observed. Never presented as confirmed by AI. */
  evidence?: Evidence;
};

type Feedback = { id: string; campaign_id: string; summary: string; channel: string; created_at: string; campaigns: { name: string } | null };
type Clarify = { id: string; ref: string; title: string; campaign_id: string; updated_at: string; campaigns: { name: string } | null };

/**
 * Everything waiting on this person, newest first:
 * findings waiting for review (managers), tasks assigned to them, open client feedback (managers), Live test runs waiting for their input,
 * and requirements that need clarifying (managers). The caller leaves out what a role may not see.
 */
export function buildItems(i: { findings: Finding[]; tasks: Task[]; meId: string | undefined; feedback: Feedback[]; clarify: Clarify[]; live: LiveTestRunSummary[] }): InboxItem[] {
  const items: InboxItem[] = [];
  for (const f of i.findings) {
    if (f.status !== "new" && f.status !== "awaiting_review") continue;
    items.push({ key: `f:${f.id}`, kind: "findings", title: `${f.ref} ${f.title}`.trim(), campaignId: f.campaign_id, campaignName: f.campaigns?.name ?? null, at: f.created_at, severity: f.severity, evidence: AI_REVIEW_TYPES.has(f.review_type) ? "AI SUGGESTION" : "OBSERVED", to: `/inbox?type=findings&campaign=${f.campaign_id}` });
  }
  for (const t of i.tasks) {
    if (t.assignee_id !== i.meId || t.status === "done") continue;
    items.push({ key: `t:${t.id}`, kind: "tasks", title: t.title, campaignId: t.campaign_id, campaignName: t.campaigns?.name ?? null, at: t.updated_at ?? t.created_at, detail: t.due_date ? `due ${t.due_date}` : undefined, to: `/inbox?type=tasks&task=${t.id}` });
  }
  for (const f of i.feedback) {
    items.push({ key: `b:${f.id}`, kind: "feedback", title: f.summary, campaignId: f.campaign_id, campaignName: f.campaigns?.name ?? null, at: f.created_at, detail: f.channel, to: `/campaigns/${f.campaign_id}/launch` });
  }
  for (const r of i.live) {
    if (r.status !== "asking") continue; // a run that is waiting for someone to type something
    items.push({ key: `l:${r.runId}`, kind: "live", title: "A live test is waiting for your answer", campaignId: r.campaignId || null, campaignName: r.campaignName || null, at: new Date(r.startedAt).toISOString(), detail: r.url, to: r.campaignId ? `/campaigns/${r.campaignId}/build` : "/live-test" });
  }
  for (const q of i.clarify) {
    items.push({ key: `q:${q.id}`, kind: "clarify", title: `${q.ref} ${q.title}`.trim(), campaignId: q.campaign_id, campaignName: q.campaigns?.name ?? null, at: q.updated_at, detail: "needs clarification", to: `/campaigns/${q.campaign_id}/requirements` });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}
