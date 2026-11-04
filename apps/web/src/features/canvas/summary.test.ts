import { describe, expect, it } from "vitest";
import { summarise, type Raw } from "./summary";

const empty: Raw = { sow: [], requirements: [], designs: [], builds: [], findings: [], tasks: [], jobs: [] };
const cast = <T,>(x: unknown) => x as T;

describe("summarise", () => {
  it("handles a brand-new campaign", () => {
    const s = summarise(empty);
    expect(s.sow.latest).toBeNull();
    expect(s.reqs.total).toBe(0);
    expect(s.designs.screens).toEqual([]);
    expect(s.build.latest).toBeNull();
    expect(s.findings.awaitingReview).toBe(0);
    expect(s.tasks.open).toBe(0);
  });

  it("picks the newest SOW version and knows when Claude is working on it", () => {
    const sow = cast<Raw["sow"]>([{ id: "d1", title: "SOW", sow_versions: [
      { id: "v1", created_at: "2026-11-01T00:00:00Z", extraction_status: "failed" },
      { id: "v2", created_at: "2026-11-03T00:00:00Z", extraction_status: "processing" }] }]);
    const s = summarise({ ...empty, sow });
    expect(s.sow.latest?.version.id).toBe("v2");
    expect(s.sow.working).toBe(true);
    expect(summarise({ ...empty, sow, jobs: [] }).sow.working).toBe(true);
  });

  it("counts requirements by status and keeps AI drafts separate from accepted ones", () => {
    const requirements = cast<Raw["requirements"]>([{ status: "draft" }, { status: "draft" }, { status: "accepted" }, { status: "needs_clarification" }, { status: "rejected" }]);
    expect(summarise({ ...empty, requirements }).reqs).toEqual({ total: 5, draft: 2, accepted: 1, clarification: 1, rejected: 1 });
  });

  it("shows the latest non-superseded design with a finding count per screen (dismissed findings excluded)", () => {
    const designs = cast<Raw["designs"]>([
      { id: "new", status: "submitted", design_assets: [{ id: "a1" }, { id: "a2" }] },
      { id: "old", status: "superseded", design_assets: [{ id: "a0" }] }]);
    const findings = cast<Raw["findings"]>([
      { design_asset_id: "a1", status: "awaiting_review", severity: "high" }, { design_asset_id: "a1", status: "accepted", severity: "low" },
      { design_asset_id: "a1", status: "dismissed", severity: "low" }, { design_asset_id: null, status: "new", severity: "critical" }]);
    const s = summarise({ ...empty, designs, findings });
    expect(s.designs.latest?.id).toBe("new");
    expect(s.designs.screens.map((x) => x.findings)).toEqual([2, 0]);
    expect(s.findings.awaitingReview).toBe(2);
    expect(s.findings.critical).toBe(1);
    expect(s.findings.high).toBe(1);
  });

  it("maps running jobs to the right card", () => {
    const jobs = (review_type: string, status: string) => [{ review_type, status }] as Raw["jobs"];
    expect(summarise({ ...empty, jobs: jobs("sow_vs_design", "processing") }).designs.working).toBe(true);
    expect(summarise({ ...empty, jobs: jobs("functional_qa", "queued") }).build.working).toBe(true);
    expect(summarise({ ...empty, jobs: jobs("functional_qa", "completed") }).build.working).toBe(false);
    expect(summarise({ ...empty, jobs: jobs("sow_vs_design", "processing") }).build.working).toBe(false);
  });

  it("counts overdue tasks only when they are not done", () => {
    const tasks = cast<Raw["tasks"]>([{ status: "todo", due_date: "2026-11-01" }, { status: "done", due_date: "2026-11-01" }, { status: "in_progress", due_date: "2026-12-01" }, { status: "todo", due_date: null }]);
    expect(summarise({ ...empty, tasks }, "2026-11-04").tasks).toEqual({ total: 4, open: 3, overdue: 1, done: 1 });
  });
});
