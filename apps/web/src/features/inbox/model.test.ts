import { describe, expect, it } from "vitest";
import { buildItems } from "./model";

const finding = (id: string, over: Record<string, unknown> = {}) => ({ id, review_type: "sow_vs_design", ref: `F-${id}`, title: `Finding ${id}`, campaign_id: "c1", campaigns: { name: "Gold Drop" }, severity: "high", status: "awaiting_review", created_at: "2026-11-06T10:00:00Z", ...over }) as never;
const task = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Task ${id}`, campaign_id: "c2", campaigns: { name: "Other" }, assignee_id: "me", status: "todo", due_date: "2026-11-09", created_at: "2026-11-06T09:00:00Z", updated_at: "2026-11-06T11:00:00Z", ...over }) as never;
const base = { findings: [], tasks: [], meId: "me", feedback: [], clarify: [], live: [] };

describe("buildItems: everything waiting on one person, newest first", () => {
  it("combines findings, my tasks, open feedback, live runs waiting for me and questions, newest first", () => {
    const items = buildItems({
      ...base, findings: [finding("1")], tasks: [task("t1")],
      feedback: [{ id: "b1", campaign_id: "c1", summary: "Logo is too small", channel: "email", created_at: "2026-11-06T12:00:00Z", campaigns: { name: "Gold Drop" } }],
      clarify: [{ id: "q1", ref: "R-3", title: "Prize tiers", campaign_id: "c1", updated_at: "2026-11-06T08:00:00Z", campaigns: { name: "Gold Drop" } }],
      live: [{ runId: "r1", status: "asking", url: "https://s.example", deviceLabel: "All devices", campaignId: "c1", campaignName: "Gold Drop", startedAt: Date.parse("2026-11-06T13:00:00Z"), finishedAt: null, passed: 0, total: 1 }],
    });
    expect(items.map((i) => i.kind)).toEqual(["live", "feedback", "tasks", "findings", "clarify"]);
    expect(items.find((i) => i.kind === "findings")?.to).toBe("/inbox?type=findings&campaign=c1");
    expect(items.find((i) => i.kind === "tasks")?.to).toBe("/inbox?type=tasks&task=t1");
    expect(items.find((i) => i.kind === "live")?.to).toBe("/campaigns/c1/build");
    expect(items.find((i) => i.kind === "feedback")?.to).toBe("/campaigns/c1/launch");
    expect(items.find((i) => i.kind === "clarify")?.to).toBe("/campaigns/c1/requirements");
  });

  it("includes only what is waiting: findings awaiting review, my open tasks, runs that are asking", () => {
    const items = buildItems({
      ...base,
      findings: [finding("1"), finding("2", { status: "accepted" }), finding("3", { status: "dismissed" })],
      tasks: [task("t1"), task("t2", { assignee_id: "someone-else" }), task("t3", { status: "done" })],
      live: [{ runId: "r1", status: "passed", url: "u", deviceLabel: "", campaignId: "", campaignName: "", startedAt: 1, finishedAt: 2, passed: 1, total: 1 }],
    });
    expect(items.map((i) => i.key).sort()).toEqual(["f:1", "t:t1"]);
    expect(items).toHaveLength(2);
  });

  it("sends a live run with no campaign to the standalone Live test", () => {
    const [i] = buildItems({ ...base, live: [{ runId: "r1", status: "asking", url: "u", deviceLabel: "", campaignId: "", campaignName: "", startedAt: 1, finishedAt: null, passed: 0, total: 1 }] });
    expect(i?.to).toBe("/live-test");
    expect(i?.campaignId).toBeNull();
  });

  it("says how each finding was reached: an AI suggestion, or something a browser check observed", () => {
    const items = buildItems({ ...base, findings: [finding("1"), finding("2", { review_type: "site_check" }), finding("3", { review_type: "functional_qa" })] });
    expect(Object.fromEntries(items.map((i) => [i.key, i.evidence]))).toEqual({ "f:1": "AI SUGGESTION", "f:2": "OBSERVED", "f:3": "OBSERVED" });
  });

  it("is empty when nothing is waiting", () => { expect(buildItems(base)).toEqual([]); });
});
