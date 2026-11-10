import { describe, expect, it } from "vitest";
import { campaignPath, parseCampaignPath, pushRecent, resolveStep, STEPS } from "./nav";

describe("resolveStep", () => {
  it("opens the brief by default and keeps the five steps as they are", () => {
    expect(resolveStep(undefined)).toEqual({ step: "brief", redirect: false });
    expect(STEPS).toEqual(["brief", "requirements", "design", "build", "launch"]);
    for (const s of STEPS) expect(resolveStep(s)).toEqual({ step: s, redirect: false });
  });

  it("sends every old section and tab to the step that holds its content now", () => {
    const to = (tab: string) => resolveStep(tab);
    expect(to("canvas")).toEqual({ step: "brief", redirect: true });
    expect(to("overview").step).toBe("brief");
    expect(to("journeys").step).toBe("brief");
    expect(to("documents").step).toBe("requirements");
    expect(to("designs").step).toBe("design");
    expect(to("development").step).toBe("build");
    expect(to("testing").step).toBe("build");
    expect(to("live").step).toBe("build");
    expect(to("ai-reviews").step).toBe("build");
    expect(to("approvals").step).toBe("launch");
    expect(to("review").step).toBe("launch");
    for (const t of ["canvas", "overview", "journeys", "documents", "designs", "development", "testing", "live", "ai-reviews", "approvals", "review"]) expect(to(t).redirect).toBe(true);
  });

  it("turns the old Tasks and Activity tabs into the side panel, on the brief", () => {
    expect(resolveStep("tasks")).toEqual({ step: "brief", panel: "tasks", redirect: true });
    expect(resolveStep("issues")).toEqual({ step: "brief", panel: "tasks", redirect: true });
    expect(resolveStep("activity")).toEqual({ step: "brief", panel: "activity", redirect: true });
  });

  it("never lands on an empty page for an address it does not know", () => {
    expect(resolveStep("nonsense")).toEqual({ step: "brief", redirect: true });
  });
});

describe("campaign addresses", () => {
  const id = "5a1b6c1e-0000-4000-8000-0000000000a1";
  it("builds and parses them", () => {
    expect(campaignPath(id)).toBe(`/campaigns/${id}`);
    expect(campaignPath(id, "build")).toBe(`/campaigns/${id}/build`);
    expect(parseCampaignPath(`/campaigns/${id}/launch`)).toEqual({ id, step: "launch" });
    expect(parseCampaignPath(`/campaigns/${id}/ai-reviews`)).toEqual({ id, step: "build" });
    expect(parseCampaignPath(`/campaigns/${id}`)).toEqual({ id, step: "brief" });
    expect(parseCampaignPath("/projects")).toBeNull();
    expect(parseCampaignPath("/campaigns")).toBeNull();
  });
});

describe("pushRecent", () => {
  it("puts the newest first, never repeats, and keeps a short list", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent([], "x")).toEqual(["x"]);
    expect(pushRecent(Array.from({ length: 8 }, (_, i) => `c${i}`), "new")).toHaveLength(8);
    expect(pushRecent(Array.from({ length: 8 }, (_, i) => `c${i}`), "new")[0]).toBe("new");
  });
});
