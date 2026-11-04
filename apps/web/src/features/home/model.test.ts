import { describe, expect, it } from "vitest";
import { continueList, groupReview, inboxCount, myOpenTasks, pickCovers } from "./model";

const cast = <T,>(x: unknown) => x as T;
type F = Parameters<typeof groupReview>[0];
type T = Parameters<typeof myOpenTasks>[0];

describe("groupReview", () => {
  const findings = cast<F>([
    { id: "1", campaign_id: "a", campaigns: { name: "Alpha" }, status: "awaiting_review", severity: "medium" },
    { id: "2", campaign_id: "a", campaigns: { name: "Alpha" }, status: "new", severity: "low" },
    { id: "3", campaign_id: "b", campaigns: { name: "Beta" }, status: "awaiting_review", severity: "critical" },
    { id: "4", campaign_id: "b", campaigns: { name: "Beta" }, status: "accepted", severity: "critical" },
    { id: "5", campaign_id: "a", campaigns: { name: "Alpha" }, status: "dismissed", severity: "high" },
  ]);
  it("counts only what still waits for a manager and puts the most severe campaign first", () => {
    const g = groupReview(findings);
    expect(g.map((x) => [x.name, x.count, x.worst])).toEqual([["Beta", 1, "critical"], ["Alpha", 2, "medium"]]);
  });
  it("lists the most severe findings of a campaign first and caps them", () => {
    const many = cast<F>(Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, campaign_id: "a", campaigns: { name: "A" }, status: "awaiting_review", severity: i === 4 ? "high" : "low" })));
    const [g] = groupReview(many, 3);
    expect(g!.items).toHaveLength(3);
    expect(g!.items[0]!.id).toBe("4");
    expect(g!.count).toBe(6);
  });
  it("is empty when nothing waits", () => {
    expect(groupReview([])).toEqual([]);
  });
});

describe("myOpenTasks", () => {
  const tasks = cast<T>([
    { id: "a", assignee_id: "me", status: "todo", due_date: "2026-11-10" }, { id: "b", assignee_id: "me", status: "in_progress", due_date: "2026-11-01" },
    { id: "c", assignee_id: "me", status: "done", due_date: "2026-10-01" }, { id: "d", assignee_id: "other", status: "todo", due_date: "2026-10-01" },
    { id: "e", assignee_id: "me", status: "todo", due_date: null }, { id: "f", assignee_id: "me", status: "blocked", due_date: "2026-11-05" },
  ]);
  it("shows only your open tasks, overdue first, then by date, undated last", () => {
    const r = myOpenTasks(tasks, "me", "2026-11-04");
    expect(r.overdue.map((t) => t.id)).toEqual(["b"]);
    expect(r.all.map((t) => t.id)).toEqual(["b", "f", "a", "e"]);
  });
});

describe("pickCovers", () => {
  it("uses the first screen of each campaign's newest design submission", () => {
    const rows = [
      { campaign_id: "a", submission_id: "old", bucket: "designs", storage_path: "old0.png", sort_order: 0, created_at: "2026-11-01T00:00:00Z" },
      { campaign_id: "a", submission_id: "new", bucket: "designs", storage_path: "new1.png", sort_order: 1, created_at: "2026-11-03T00:00:01Z" },
      { campaign_id: "a", submission_id: "new", bucket: "designs", storage_path: "new0.png", sort_order: 0, created_at: "2026-11-03T00:00:00Z" },
      { campaign_id: "b", submission_id: "s", bucket: "designs", storage_path: "b0.png", sort_order: 0, created_at: "2026-11-02T00:00:00Z" },
    ];
    expect(pickCovers(rows)).toEqual({ a: { bucket: "designs", path: "new0.png" }, b: { bucket: "designs", path: "b0.png" } });
    expect(pickCovers([])).toEqual({});
  });
});

describe("inboxCount and continueList", () => {
  it("counts review work only for managers", () => {
    expect(inboxCount(2, 5, true)).toBe(7);
    expect(inboxCount(2, 5, false)).toBe(2);
  });
  it("shows recently opened campaigns first, drops ones that no longer exist, then the most recently changed", () => {
    const all = [{ id: "a", updated_at: "2026-11-01" }, { id: "b", updated_at: "2026-11-03" }, { id: "c", updated_at: "2026-11-02" }];
    expect(continueList(all, ["c", "gone", "a"]).map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(continueList(all, [], 2).map((x) => x.id)).toEqual(["b", "c"]);
  });
});
