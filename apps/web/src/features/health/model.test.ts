import { describe, expect, it } from "vitest";
import { buildHealth, latestRuns, type HealthInput } from "./model";

const NOW = () => "2026-11-10T00:00:00.000Z";
const dev = (label: string, issues = 0, tested = 3) => ({ id: label, label, family: "iPhone", engine: "Chromium (emulated)", pages_tested: tested, pages_failed: 0, login: "none", issues, top_issues: issues ? ["Page scrolls sideways"] : [] });
const siteOk = { finishedAt: "2026-11-09T10:00:00Z", status: "completed", notes: { pages_checked: 4, devices_tested: 2, devices: [dev("iPhone 15"), dev("Pixel 7")] } };
const base = (over: Partial<HealthInput> = {}): HealthInput => ({
  scenarios: [{ id: "s1", name: "Daily cap", suite: "Winners", accepted: true, enabled: true }], runs: [{ scenario_id: "s1", status: "passed", ran_at: "2026-11-09T10:00:00Z", build_label: "v1" }],
  site: siteOk, qaCases: 2, qaLatest: [{ result: "verified" }, { result: "verified" }], findings: [], acceptedRequirements: 5, draftRequirements: 0, aiOnline: true, ...over,
});
const area = (h: ReturnType<typeof buildHealth>, a: string) => h.sections.find((s) => s.area === a)!;

describe("the health check never claims more than was run", () => {
  it("with nothing run it says so for every area, and the verdict is incomplete", () => {
    const h = buildHealth(base({ scenarios: [], runs: [], site: null, qaCases: 0, qaLatest: null, acceptedRequirements: 0 }), NOW);
    expect(["browser", "rules", "scenarios"].map((a) => area(h, a).status)).toEqual(["not_run", "not_run", "not_run"]);
    expect(h.verdict).toBe("incomplete");
    expect(h.notTested.length).toBeGreaterThanOrEqual(3);
  });

  it("says 'no failures' only when the browser, the rules and the scenarios all ran and passed, and still says it is no guarantee", () => {
    const h = buildHealth(base(), NOW);
    expect(h.verdict).toBe("no_failures");
    expect(h.headline).toMatch(/not a guarantee/);
  });

  it("is never 'no failures' when one independent area was not run, or only partly verified", () => {
    expect(buildHealth(base({ site: null }), NOW).verdict).toBe("incomplete");
    expect(buildHealth(base({ qaCases: 0, qaLatest: null }), NOW).verdict).toBe("incomplete");
    expect(buildHealth(base({ qaLatest: null }), NOW).verdict).toBe("incomplete");
    expect(buildHealth(base({ qaLatest: [{ result: "verified" }, { result: "needs_verification" }] }), NOW).verdict).toBe("incomplete");
    expect(buildHealth(base({ qaLatest: [{ result: "verified" }] }), NOW).verdict).toBe("incomplete"); // two scenarios exist, one has a result
    expect(buildHealth(base({ scenarios: [], runs: [] }), NOW).verdict).toBe("incomplete");
  });

  it("a failed browser scenario fails the verdict", () => {
    const h = buildHealth(base({ qaLatest: [{ result: "failed" }, { result: "verified" }] }), NOW);
    expect(h.verdict).toBe("failed");
    expect(area(h, "scenarios").lines[0]!.text).toBe("1 scenario step failed in the browser");
  });

  it("a failed rule scenario makes the verdict failed, labelled CONFIRMED", () => {
    const h = buildHealth(base({ runs: [{ scenario_id: "s1", status: "failed", ran_at: "2026-11-09T10:00:00Z", build_label: "v2" }] }), NOW);
    expect(h.verdict).toBe("failed");
    expect(area(h, "rules").lines[0]).toEqual({ text: "Daily cap failed on v2", evidence: "CONFIRMED" });
    expect(h.confirmedFailures).toBe(1);
  });

  it("devices with issues fail the browser area, labelled OBSERVED, and the emulation limit is listed as not tested", () => {
    const h = buildHealth(base({ site: { ...siteOk, notes: { ...siteOk.notes, devices: [dev("iPhone 15", 2), dev("Pixel 7")] } } }), NOW);
    const b = area(h, "browser");
    expect(b.status).toBe("failed");
    expect(b.lines[0]!.evidence).toBe("OBSERVED");
    expect(b.notTested.join(" ")).toMatch(/Real phones and Safari/);
  });

  it("a device that opened no page makes the browser area incomplete, not passed", () => {
    const h = buildHealth(base({ site: { ...siteOk, notes: { ...siteOk.notes, devices: [dev("iPhone 15"), { ...dev("iPad", 0, 0), skipped: "the login needs an OTP" }] } } }), NOW);
    expect(area(h, "browser").status).toBe("incomplete");
    expect(area(h, "browser").notTested.join(" ")).toMatch(/iPad: the login needs an OTP/);
  });

  it("an incomplete rule run and a scenario never run are listed, and neither counts as passed", () => {
    const h = buildHealth(base({
      scenarios: [{ id: "s1", name: "A", suite: "x", accepted: true, enabled: true }, { id: "s2", name: "B", suite: "x", accepted: true, enabled: true }, { id: "s3", name: "C", suite: "x", accepted: true, enabled: true }],
      runs: [{ scenario_id: "s1", status: "incomplete", ran_at: "2026-11-09T10:00:00Z", build_label: null }, { scenario_id: "s2", status: "passed", ran_at: "2026-11-09T10:00:00Z", build_label: null }],
    }), NOW);
    const r = area(h, "rules");
    expect(r.status).toBe("incomplete");
    expect(r.summary).toBe("1 passed, 0 failed, 1 incomplete, 1 never run (of 3).");
    expect(r.notTested).toEqual(expect.arrayContaining(["C has never been run", "A ran without everything verified"]));
  });

  it("uses the latest run of each scenario, and ignores drafts and disabled scenarios", () => {
    const rows = latestRuns({
      scenarios: [{ id: "s1", name: "A", suite: "x", accepted: true, enabled: true }, { id: "s2", name: "Draft", suite: "x", accepted: false, enabled: true }, { id: "s3", name: "Off", suite: "x", accepted: true, enabled: false }],
      runs: [{ scenario_id: "s1", status: "failed", ran_at: "2026-11-01T00:00:00Z", build_label: null }, { scenario_id: "s1", status: "passed", ran_at: "2026-11-05T00:00:00Z", build_label: null }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.run?.status).toBe("passed");
  });
});

describe("AI is shown apart and never counts as a confirmed failure", () => {
  it("lists AI findings as suggestions and does not change the verdict of the independent areas", () => {
    const withAi = buildHealth(base({ findings: [{ severity: "critical", status: "awaiting_review", review_type: "sow_vs_design" }] }), NOW);
    const without = buildHealth(base(), NOW);
    expect(area(withAi, "ai").lines[0]!.evidence).toBe("AI SUGGESTION");
    expect(area(withAi, "ai").independentOfAi).toBe(false);
    expect(withAi.verdict).toBe(without.verdict);
    expect(withAi.confirmedFailures).toBe(without.confirmedFailures);
  });
  it("when AI is offline the other areas are unchanged and the report says so", () => {
    const off = buildHealth(base({ aiOnline: false }), NOW);
    const on = buildHealth(base(), NOW);
    expect(area(off, "ai").summary).toMatch(/AI is offline/);
    for (const a of ["browser", "rules", "scenarios"]) expect(area(off, a).status).toBe(area(on, a).status);
    expect(off.verdict).toBe(on.verdict);
  });
  it("mentions draft requirements and a campaign with none accepted as not tested", () => {
    const h = buildHealth(base({ draftRequirements: 3, acceptedRequirements: 0 }), NOW);
    expect(area(h, "ai").notTested).toEqual(["3 draft requirements are not accepted yet", "No requirement is accepted, so nothing was checked against requirements"]);
  });
});
