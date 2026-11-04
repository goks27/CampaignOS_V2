import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/requirements", () => ({ requirementsService: { get: vi.fn(), update: vi.fn(), create: vi.fn(), list: vi.fn(), checks: vi.fn() } }));
vi.mock("@/services/findings", () => ({
  findingsService: { get: vi.fn(), assign: vi.fn(), list: vi.fn() },
  defaultFeedback: vi.fn(() => ({ issue: "Issue", location: "", observation: "", expected: "", action_required: "", priority: "high" })),
}));
vi.mock("@/services/tasks", () => ({ tasksService: { create: vi.fn(), update: vi.fn(), get: vi.fn(), addComment: vi.fn(), list: vi.fn() } }));
vi.mock("@/services/campaigns", () => ({ campaignsService: { list: vi.fn(), get: vi.fn(), update: vi.fn() } }));
vi.mock("@/services/jobs", () => ({ jobsService: { enqueue: vi.fn(), list: vi.fn() } }));
vi.mock("@/services/activity", () => ({ activityService: { list: vi.fn() }, dashboardService: { summary: vi.fn() } }));
vi.mock("@/services/team", () => ({ teamService: { members: vi.fn() } }));
vi.mock("@/services/connector", () => ({ connectorService: { wake: vi.fn(async () => true) } }));

import { requirementsService } from "@/services/requirements";
import { findingsService } from "@/services/findings";
import { tasksService } from "@/services/tasks";
import { campaignsService } from "@/services/campaigns";
import { jobsService } from "@/services/jobs";
import { TOOLS, TOOL_BY_NAME, TOOL_SPECS, clip, type Lookup, type WriteTool } from "./tools";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const lookup: Lookup = { campaign: (id) => `Campaign ${id?.slice(0, 4)}`, person: (id) => `Person ${id?.slice(0, 4)}` };
const w = (name: string) => TOOL_BY_NAME.get(name) as WriteTool;

beforeEach(() => vi.clearAllMocks());

describe("the catalogue", () => {
  it("is exactly the reviewed list: adding a tool must be a deliberate change", () => {
    expect(TOOLS.map((t) => `${t.kind}:${t.name}`).sort()).toEqual([
      "read:dashboard_summary", "read:get_campaign", "read:list_activity", "read:list_campaigns", "read:list_findings", "read:list_people",
      "read:list_requirement_checks", "read:list_requirements", "read:list_reviews", "read:list_tasks",
      "write:add_task_comment", "write:assign_finding", "write:create_requirement", "write:create_task", "write:start_review",
      "write:update_campaign", "write:update_requirement", "write:update_task",
    ]);
  });

  it("has no tool that approves, rejects, accepts, dismisses, deletes, launches or touches roles, settings or credentials", () => {
    const banned = /approve|reject|accept|dismiss|delete|remove|launch|deploy|role|setting|credential|password|status_change|set_status/i;
    expect(TOOLS.filter((t) => banned.test(t.name))).toEqual([]);
  });

  it("describes every tool for the model", () => {
    expect(TOOL_SPECS).toHaveLength(TOOLS.length);
    expect(TOOL_SPECS.every((s) => s.description.length > 10 && s.params.length > 1)).toBe(true);
  });
});

describe("write tools validate before they ever show a Confirm card", () => {
  it("rejects bad ids, missing fields and made-up values", () => {
    expect(() => w("create_task").propose({ campaign_id: "nope", title: "x" }, lookup)).toThrow(/campaign_id/);
    expect(() => w("create_task").propose({ campaign_id: ID, title: "" }, lookup)).toThrow(/title/);
    expect(() => w("create_task").propose({ campaign_id: ID, title: "x", priority: "urgent" }, lookup)).toThrow(/priority/);
    expect(() => w("update_task").propose({ task_id: ID }, lookup)).toThrow(/at least one field/);
    expect(() => w("start_review").propose({ campaign_id: ID, review_type: "regression" }, lookup)).toThrow(/review_type/);
    expect(() => w("start_review").propose({ campaign_id: ID, review_type: "sow_vs_design" }, lookup)).toThrow(/design_submission_id/);
  });

  it("shows exactly what will run, with names instead of ids", () => {
    const p = w("create_task").propose({ campaign_id: ID, title: "Fix OTP", assignee_id: ID2, priority: "high", due_date: "2026-11-10" }, lookup);
    expect(p.title).toBe("Create task");
    expect(p.fields).toEqual(expect.arrayContaining([{ label: "Assignee", value: "Person 2222" }, { label: "Priority", value: "High" }, { label: "Due", value: "2026-11-10" }]));
  });

  it("create_task passes the confirmed arguments to the service and nothing else", async () => {
    vi.mocked(tasksService.create).mockResolvedValue({ id: ID2, ref: "T-001", title: "Fix OTP" } as never);
    const r = await w("create_task").propose({ campaign_id: ID, title: "Fix OTP", sneaky: "x" }, lookup).apply();
    expect(tasksService.create).toHaveBeenCalledWith(expect.not.objectContaining({ sneaky: expect.anything() }));
    expect(r.summary).toContain("T-001");
  });
});

describe("decisions stay with managers", () => {
  it("update_requirement never forwards a status and refuses accepted or rejected requirements", async () => {
    vi.mocked(requirementsService.get).mockResolvedValue({ id: ID, ref: "REQ-001", status: "accepted" } as never);
    await expect(w("update_requirement").propose({ requirement_id: ID, title: "New", status: "accepted" }, lookup).apply()).rejects.toThrow(/accepted.*manager/i);
    expect(requirementsService.update).not.toHaveBeenCalled();

    vi.mocked(requirementsService.get).mockResolvedValue({ id: ID, ref: "REQ-002", status: "draft" } as never);
    vi.mocked(requirementsService.update).mockResolvedValue({ id: ID, ref: "REQ-002", title: "New", campaign_id: ID2 } as never);
    await w("update_requirement").propose({ requirement_id: ID, title: "New", status: "accepted" }, lookup).apply();
    expect(requirementsService.update).toHaveBeenCalledWith(ID, { title: "New" }); // status was dropped
  });

  it("create_requirement always makes a draft", async () => {
    vi.mocked(requirementsService.create).mockResolvedValue({ ref: "REQ-009", title: "t" } as never);
    const p = w("create_requirement").propose({ campaign_id: ID, title: "t", description: "d", category: "functional", status: "accepted" }, lookup);
    expect(p.fields.find((f) => f.label === "Status")?.value).toMatch(/Draft/);
    await p.apply();
    expect(vi.mocked(requirementsService.create).mock.calls[0]![0]).not.toHaveProperty("status");
  });

  it("assign_finding only works on findings a manager already accepted", async () => {
    vi.mocked(findingsService.get).mockResolvedValue({ id: ID, ref: "F-001", status: "awaiting_review", campaign_id: ID2 } as never);
    await expect(w("assign_finding").propose({ finding_id: ID, owner_id: ID2 }, lookup).apply()).rejects.toThrow(/manager must accept/i);
    expect(findingsService.assign).not.toHaveBeenCalled();

    vi.mocked(findingsService.get).mockResolvedValue({ id: ID, ref: "F-001", status: "accepted", campaign_id: ID2 } as never);
    vi.mocked(findingsService.assign).mockResolvedValue({ id: ID2, ref: "T-002" } as never);
    await w("assign_finding").propose({ finding_id: ID, owner_id: ID2 }, lookup).apply();
    expect(findingsService.assign).toHaveBeenCalledOnce();
  });

  it("update_campaign cannot change stage, status, health or approvals", async () => {
    vi.mocked(campaignsService.update).mockResolvedValue({ id: ID, name: "Good Year" } as never);
    await w("update_campaign").propose({ campaign_id: ID, notes: "n", stage: "live_deployment", status: "completed", health: "on_track", design_status: "approved" }, lookup).apply();
    expect(campaignsService.update).toHaveBeenCalledWith(ID, { notes: "n" });
  });

  it("start_review enqueues the matching source and never forces a re-run", async () => {
    vi.mocked(jobsService.enqueue).mockResolvedValue("job" as never);
    await w("start_review").propose({ campaign_id: ID, review_type: "sow_vs_design", design_submission_id: ID2 }, lookup).apply();
    expect(jobsService.enqueue).toHaveBeenCalledWith(ID, "sow_vs_design", { design_submission_id: ID2 }, false);
  });
});

describe("reads", () => {
  it("validate their arguments and cap what they return", async () => {
    await expect((TOOL_BY_NAME.get("list_findings") as { run: (a: unknown) => Promise<unknown> }).run({ limit: 5000 })).rejects.toThrow(/Invalid arguments/);
    vi.mocked(campaignsService.list).mockResolvedValue(Array.from({ length: 90 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, clients: null, journeys: [], campaign_members: [], status: "active" })) as never);
    const out = (await (TOOL_BY_NAME.get("list_campaigns") as { run: (a: unknown) => Promise<{ total: number; shown: number }> }).run({}));
    expect(out.total).toBe(90);
    expect(out.shown).toBe(60);
  });

  it("clip shortens long text", () => {
    expect(clip("x".repeat(500), 10)).toBe("xxxxxxxxxx…");
    expect(clip(null)).toBeNull();
  });
});
