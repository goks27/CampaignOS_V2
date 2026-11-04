import { describe, expect, it } from "vitest";
import { campaignPath, LEGACY_TAB, parseCampaignPath, pushRecent, resolveSection, SECTIONS } from "./nav";

describe("resolveSection", () => {
  it("opens the canvas by default and keeps current sections as they are", () => {
    expect(resolveSection(undefined)).toEqual({ section: "canvas", redirect: false });
    for (const s of SECTIONS) expect(resolveSection(s)).toEqual({ section: s, redirect: false });
  });
  it("sends every old tab to the section that holds its content now", () => {
    expect(resolveSection("overview")).toEqual({ section: "canvas", redirect: true });
    expect(resolveSection("journeys").section).toBe("canvas");
    expect(resolveSection("approvals").section).toBe("review");
    expect(resolveSection("ai-reviews").section).toBe("review");
    expect(resolveSection("documents").section).toBe("requirements");
    expect(resolveSection("tasks").section).toBe("issues");
    // no old tab is lost and none points at a section that does not exist
    for (const to of Object.values(LEGACY_TAB)) expect(SECTIONS).toContain(to);
  });
  it("never lands on an empty page for an address it does not know", () => {
    expect(resolveSection("nonsense")).toEqual({ section: "canvas", redirect: true });
  });
});

describe("campaign addresses", () => {
  const id = "5a1b6c1e-0000-4000-8000-0000000000a1";
  it("builds and parses them", () => {
    expect(campaignPath(id)).toBe(`/campaigns/${id}`);
    expect(campaignPath(id, "testing")).toBe(`/campaigns/${id}/testing`);
    expect(parseCampaignPath(`/campaigns/${id}/review`)).toEqual({ id, section: "review" });
    expect(parseCampaignPath(`/campaigns/${id}/ai-reviews`)).toEqual({ id, section: "review" });
    expect(parseCampaignPath(`/campaigns/${id}`)).toEqual({ id, section: "canvas" });
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
