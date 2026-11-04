import { describe, expect, it } from "vitest";
import { buildJourneyModel, layoutScreens, NODE_H, NODE_W, UNASSIGNED, type JourneyRaw } from "./journeyModel";

const cast = <T,>(x: unknown) => x as T;
const asset = (id: string, type = "screen", i = 0) => ({ id, screen_name: id, screen_type: type, sort_order: i, bucket: "designs", storage_path: `${id}.png` });
const sub = (id: string, journey: string | null, status: string, assets: ReturnType<typeof asset>[]) => ({ id, journey_id: journey, status, version_no: 1, title: id, design_assets: assets });
const empty: JourneyRaw = { designs: [], findings: [], tasks: [], requirements: [], checks: [], builds: [], captures: [], cases: [], runs: [], jobs: [] };
const raw = (over: Partial<Record<keyof JourneyRaw, unknown>>): JourneyRaw => ({ ...empty, ...(over as Partial<JourneyRaw>) });

describe("buildJourneyModel", () => {
  it("only shows the screens of the journey that is open, from its latest non-superseded submission", () => {
    const designs = cast<JourneyRaw["designs"]>([
      sub("new", "j1", "in_review", [asset("a", "screen", 0), asset("b", "screen", 1)]),
      sub("old", "j1", "superseded", [asset("z")]), sub("other", "j2", "approved", [asset("y")])]);
    const m = buildJourneyModel(raw({ designs }), "j1");
    expect(m.submission?.id).toBe("new");
    expect(m.screens.map((s) => s.asset.id)).toEqual(["a", "b"]);
    expect(buildJourneyModel(raw({ designs }), "j2").screens.map((s) => s.asset.id)).toEqual(["y"]);
  });

  it("treats designs without a journey as their own 'unassigned' journey", () => {
    const designs = cast<JourneyRaw["designs"]>([sub("s", null, "submitted", [asset("a")])]);
    expect(buildJourneyModel(raw({ designs }), UNASSIGNED).screens).toHaveLength(1);
    expect(buildJourneyModel(raw({ designs }), "j1").screens).toHaveLength(0);
  });

  it("states a screen's status from its open findings first, then from the design's approval", () => {
    const designs = cast<JourneyRaw["designs"]>([sub("s", "j1", "approved", [asset("a"), asset("b"), asset("c")])]);
    const findings = cast<JourneyRaw["findings"]>([
      { id: "f1", design_asset_id: "a", status: "awaiting_review", severity: "critical" }, { id: "f2", design_asset_id: "a", status: "dismissed", severity: "critical" },
      { id: "f3", design_asset_id: "b", status: "accepted", severity: "medium" }, { id: "f4", design_asset_id: "c", status: "fixed", severity: "high" }]);
    const [a, b, c] = buildJourneyModel(raw({ designs, findings }), "j1").screens;
    expect([a!.label, a!.tone]).toEqual(["1 finding", "red"]); // the dismissed one does not count
    expect([b!.label, b!.tone]).toEqual(["1 finding", "amber"]);
    expect([c!.label, c!.tone]).toEqual(["Approved", "green"]); // a fixed finding is closed
  });

  it("never claims a built version it does not have", () => {
    const designs = cast<JourneyRaw["designs"]>([sub("s", "j1", "approved", [asset("a"), asset("b")])]);
    const builds = cast<JourneyRaw["builds"]>([{ id: "b1", journey_id: null, version_label: "build 14" }]);
    const captures = cast<JourneyRaw["captures"]>([{ id: "c1", design_asset_id: "a", viewport: "desktop", diff_ratio: 0.124 }]);
    const withBuild = buildJourneyModel(raw({ designs, builds, captures }), "j1");
    expect(withBuild.screens.map((s) => s.built)).toEqual(["12% differs", "Not compared yet"]);
    expect(buildJourneyModel(raw({ designs }), "j1").screens[0]!.built).toBe("No build");
  });

  it("summarises scenario results for this journey, counting 'all journeys' scenarios too and naming what failed", () => {
    const cases = cast<JourneyRaw["cases"]>([
      { id: "t1", title: "Valid code", journey_id: "j1" }, { id: "t2", title: "Duplicate code", journey_id: null }, { id: "t3", title: "Invalid code", journey_id: "j1" },
      { id: "t4", title: "Daily limit", journey_id: "j1" }, { id: "t5", title: "Other journey", journey_id: "j2" }, { id: "t6", title: "Never run", journey_id: "j1" }]);
    const runs = cast<JourneyRaw["runs"]>([
      { qa_test_results: [{ test_case_id: "t1", result: "verified" }, { test_case_id: "t3", result: "failed", actual: "No error shown" }, { test_case_id: "t4", result: "blocked", actual: "CAPTCHA" }, { test_case_id: "t5", result: "failed" }] },
      { qa_test_results: [{ test_case_id: "t1", result: "failed" }, { test_case_id: "t2", result: "verified" }] }]); // older run: t1 already known from the newer one
    const t = buildJourneyModel(raw({ cases, runs }), "j1").tests;
    expect(t).toMatchObject({ total: 5, passed: 2, failed: 1, blocked: 1, notRun: 1 });
    expect(t.failing.map((f) => f.title)).toEqual(["Invalid code", "Daily limit"]);
    expect(t.failing[0]!.actual).toBe("No error shown");
  });

  it("links tasks to screens through their findings and shows only accepted requirements of the journey", () => {
    const designs = cast<JourneyRaw["designs"]>([sub("s", "j1", "submitted", [asset("a")])]);
    const findings = cast<JourneyRaw["findings"]>([{ id: "f1", design_asset_id: "a", status: "assigned", severity: "high", journey_id: "j1" }]);
    const tasks = cast<JourneyRaw["tasks"]>([{ id: "t1", source_finding_id: "f1", journey_id: "j1", status: "todo" }, { id: "t2", source_finding_id: null, journey_id: "j2", status: "todo" }]);
    const requirements = cast<JourneyRaw["requirements"]>([
      { id: "r1", status: "accepted", journey_id: "j1" }, { id: "r2", status: "accepted", journey_id: null }, { id: "r3", status: "draft", journey_id: "j1" }, { id: "r4", status: "accepted", journey_id: "j2" }]);
    const m = buildJourneyModel(raw({ designs, findings, tasks, requirements }), "j1");
    expect(m.screens[0]!.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(m.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(m.accepted.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("knows when Claude is working on the designs or the build", () => {
    const jobs = (review_type: string, status: string) => [{ review_type, status }] as JourneyRaw["jobs"];
    expect(buildJourneyModel(raw({ jobs: jobs("sow_vs_design", "processing") }), "j1").working).toEqual({ design: true, build: false });
    expect(buildJourneyModel(raw({ jobs: jobs("site_check", "queued") }), "j1").working).toEqual({ design: false, build: true });
    expect(buildJourneyModel(raw({ jobs: jobs("site_check", "completed") }), "j1").working).toEqual({ design: false, build: false });
  });
});

describe("layoutScreens", () => {
  const model = (types: string[]) => buildJourneyModel(raw({ designs: cast<JourneyRaw["designs"]>([sub("s", "j1", "submitted", types.map((t, i) => asset(`s${i}`, t, i)))]) }), "j1").screens;

  it("runs main screens left to right and links them in order", () => {
    const { positions, edges } = layoutScreens(model(["screen", "form", "screen"]));
    expect(positions.s0).toEqual({ x: 0, y: 0 });
    expect(positions.s1!.x).toBe(NODE_W + 90);
    expect(positions.s2!.x).toBe(2 * (NODE_W + 90));
    expect(edges.map((e) => [e.source, e.target, e.kind])).toEqual([["s0", "s1", "flow"], ["s1", "s2", "flow"]]);
  });

  it("hangs error and success states under the screen they belong to", () => {
    const { positions, edges } = layoutScreens(model(["screen", "form", "error state", "error state", "screen", "success state"]));
    expect(positions.s2).toEqual({ x: positions.s1!.x, y: NODE_H + 70 });
    expect(positions.s3).toEqual({ x: positions.s1!.x, y: 2 * (NODE_H + 70) });
    expect(positions.s4!.x).toBe(2 * (NODE_W + 90)); // the next main screen is the next column, not pushed right by the states
    expect(positions.s5!.x).toBe(positions.s4!.x);
    expect(edges.filter((e) => e.kind === "state").map((e) => [e.source, e.target])).toEqual([["s1", "s2"], ["s2", "s3"], ["s4", "s5"]]);
    expect(edges.filter((e) => e.kind === "flow")).toHaveLength(2);
  });

  it("brackets the main flow with Start and End, level with the phone frames", () => {
    const { bookends, positions } = layoutScreens(model(["screen", "form", "error state", "screen"]));
    expect(bookends!.start.x).toBeLessThan(positions.s0!.x);
    expect(bookends!.end.x).toBeGreaterThan(positions.s3!.x);
    expect(bookends!.edges.map((e) => [e.source, e.target])).toEqual([["__start", "s0"], ["s3", "__end"]]);
    expect(layoutScreens([]).bookends).toBeNull();
  });

  it("a state with nothing before it is just the first screen", () => {
    const { positions } = layoutScreens(model(["error state", "screen"]));
    expect(positions.s0).toEqual({ x: 0, y: 0 });
    expect(Object.keys(positions)).toHaveLength(2);
  });
});
