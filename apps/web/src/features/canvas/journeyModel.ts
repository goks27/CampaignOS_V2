/**
 * Pure model of one journey for the journey canvas: its screens in flow order, what is known about each screen,
 * the journey's test results and its layout. No fetching and no React here, so every rule is easy to test.
 */
import type { DesignAsset, DesignSubmission } from "@/services/designs";
import type { DevCapture, DevSubmission, TestCase, TestRun } from "@/services/development";
import type { Finding } from "@/services/findings";
import type { Requirement, RequirementCheck } from "@/services/requirements";
import type { Task } from "@/services/tasks";
import type { ReviewType, Tone } from "@/lib/labels";

/** A journey id, or "unassigned" for designs and builds that were submitted without a journey. */
export const UNASSIGNED = "unassigned";

export type JourneyRaw = {
  designs: DesignSubmission[]; findings: Finding[]; tasks: Task[]; requirements: Requirement[]; checks: RequirementCheck[];
  builds: DevSubmission[]; captures: DevCapture[]; cases: TestCase[]; runs: TestRun[]; jobs: { review_type: ReviewType; status: string }[];
};

const CLOSED = new Set(["dismissed", "fixed", "verified"]);
const ACTIVE = new Set(["queued", "processing"]);
const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, informational: 0 };
/** Error and success states hang under the screen they belong to instead of extending the main flow. */
const STATE_TYPES = new Set(["error state", "success state"]);

export type ScreenModel = {
  asset: DesignAsset;
  index: number;
  kind: "main" | "state";
  /** Index of the main screen a state belongs to; -1 for main screens. */
  parent: number;
  findings: Finding[];
  open: Finding[];
  worst: string | null;
  label: string;
  tone: Tone;
  capture: DevCapture | null;
  built: string;
  tasks: Task[];
};

export type TestSummary = {
  total: number; passed: number; failed: number; blocked: number; notRun: number;
  failing: { id: string; title: string; result: string; actual: string | null }[];
  /** Every scenario of this journey with its latest result (null = never run). */
  results: { id: string; title: string; result: string | null; actual: string | null }[];
};

export type JourneyModel = ReturnType<typeof buildJourneyModel>;

/** Does something submitted for `jid` belong on the canvas of journey `key`? */
export const belongs = (key: string, jid: string | null) => (key === UNASSIGNED ? jid === null : jid === key);

export function buildJourneyModel(raw: JourneyRaw, key: string) {
  const submission = raw.designs.filter((d) => belongs(key, d.journey_id)).find((d) => d.status !== "superseded")
    ?? raw.designs.find((d) => belongs(key, d.journey_id)) ?? null;
  // A build submitted for "all journeys" applies to every journey.
  const build = raw.builds.find((b) => b.journey_id === null || belongs(key, b.journey_id)) ?? null;
  const assets = submission?.design_assets ?? [];
  const assetIds = new Set(assets.map((a) => a.id));
  const journeyFindings = raw.findings.filter((f) => (f.design_asset_id && assetIds.has(f.design_asset_id)) || (!f.design_asset_id && belongs(key, f.journey_id)));

  let lastMain = -1;
  const screens: ScreenModel[] = assets.map((asset, index) => {
    const kind = STATE_TYPES.has(String(asset.screen_type).toLowerCase()) && lastMain >= 0 ? "state" : "main";
    if (kind === "main") lastMain = index;
    const findings = raw.findings.filter((f) => f.design_asset_id === asset.id);
    const open = findings.filter((f) => !CLOSED.has(f.status));
    const worst = open.reduce<string | null>((w, f) => (w === null || (SEV_RANK[f.severity] ?? 0) > (SEV_RANK[w] ?? 0) ? f.severity : w), null);
    const capture = raw.captures.find((c) => c.design_asset_id === asset.id && c.viewport === "desktop") ?? raw.captures.find((c) => c.design_asset_id === asset.id) ?? null;
    const findingIds = new Set(findings.map((f) => f.id));
    let label: string, tone: Tone;
    if (open.length) {
      label = `${open.length} finding${open.length === 1 ? "" : "s"}`;
      tone = worst === "critical" || worst === "high" ? "red" : worst === "medium" ? "amber" : "blue";
    } else if (submission?.status === "approved") { label = "Approved"; tone = "green"; }
    else if (submission?.status === "changes_requested") { label = "Changes requested"; tone = "amber"; }
    else { label = "In review"; tone = "blue"; }
    const built = capture
      ? (capture.diff_ratio !== null && capture.diff_ratio !== undefined ? `${Math.round(Number(capture.diff_ratio) * 100)}% differs` : "Captured")
      : build ? "Not compared yet" : "No build";
    return { asset, index, kind, parent: kind === "state" ? lastMain : -1, findings, open, worst, label, tone, capture, built,
      tasks: raw.tasks.filter((t) => t.source_finding_id && findingIds.has(t.source_finding_id)) };
  });

  // Scenario results for THIS journey: a scenario for all journeys counts everywhere.
  const cases = raw.cases.filter((c) => c.journey_id === null || belongs(key, c.journey_id));
  const latest = new Map<string, { result: string; actual: string | null }>();
  for (const run of raw.runs) for (const r of run.qa_test_results ?? []) if (r.test_case_id && !latest.has(r.test_case_id)) latest.set(r.test_case_id, { result: r.result, actual: r.actual });
  const tests: TestSummary = { total: cases.length, passed: 0, failed: 0, blocked: 0, notRun: 0, failing: [], results: [] };
  for (const c of cases) {
    const r = latest.get(c.id);
    tests.results.push({ id: c.id, title: c.title, result: r?.result ?? null, actual: r?.actual ?? null });
    if (!r) tests.notRun++;
    else if (r.result === "verified") tests.passed++;
    else if (r.result === "failed") { tests.failed++; tests.failing.push({ id: c.id, title: c.title, result: r.result, actual: r.actual }); }
    else if (r.result === "blocked") { tests.blocked++; tests.failing.push({ id: c.id, title: c.title, result: r.result, actual: r.actual }); }
    else tests.notRun++;
  }

  const accepted = raw.requirements.filter((r) => r.status === "accepted" && (r.journey_id === null || belongs(key, r.journey_id)));
  const checkOf = new Map<string, RequirementCheck>();
  for (const c of raw.checks) if (!checkOf.has(c.requirement_id)) checkOf.set(c.requirement_id, c); // checks arrive newest first

  const tasks = raw.tasks.filter((t) => belongs(key, t.journey_id) || (t.source_finding_id && journeyFindings.some((f) => f.id === t.source_finding_id)));
  const working = {
    design: raw.jobs.some((j) => ["sow_vs_design", "design_consistency"].includes(j.review_type) && ACTIVE.has(j.status)),
    build: raw.jobs.some((j) => ["site_check", "design_vs_development", "functional_qa", "regression", "sow_vs_development"].includes(j.review_type) && ACTIVE.has(j.status)),
  };

  return {
    key, submission, build, screens, findings: journeyFindings, tests, cases, accepted, checkOf, tasks, working,
    summary: {
      screens: screens.length, awaitingReview: journeyFindings.filter((f) => f.status === "new" || f.status === "awaiting_review").length,
      openFindings: journeyFindings.filter((f) => !CLOSED.has(f.status)).length, openTasks: tasks.filter((t) => t.status !== "done").length, acceptedRequirements: accepted.length,
    },
  };
}

// ---------------------------------------------------------------- layout
export const NODE_W = 240;
export const NODE_H = 360;
const GAP_X = 90;
const GAP_Y = 70;

export type LayoutEdge = { id: string; source: string; target: string; kind: "flow" | "state" };

/** Main screens run left to right in flow order. States (error, success) sit below the screen they belong to. */
export function layoutScreens(screens: ScreenModel[]) {
  const positions: Record<string, { x: number; y: number }> = {};
  const edges: LayoutEdge[] = [];
  const column = new Map<number, number>(); // index of main screen -> its column
  const below = new Map<number, number>(); // index of main screen -> how many states are already under it
  let col = 0;
  let prevMain: ScreenModel | null = null;
  for (const s of screens) {
    if (s.kind === "main" || s.parent < 0) {
      column.set(s.index, col);
      positions[s.asset.id] = { x: col * (NODE_W + GAP_X), y: 0 };
      if (prevMain) edges.push({ id: `flow-${prevMain.asset.id}-${s.asset.id}`, source: prevMain.asset.id, target: s.asset.id, kind: "flow" });
      prevMain = s;
      col++;
    } else {
      const k = (below.get(s.parent) ?? 0) + 1;
      below.set(s.parent, k);
      const parent = screens[s.parent]!;
      positions[s.asset.id] = { x: (column.get(s.parent) ?? 0) * (NODE_W + GAP_X), y: k * (NODE_H + GAP_Y) };
      edges.push({ id: `state-${parent.asset.id}-${s.asset.id}`, source: k === 1 ? parent.asset.id : screens.find((x) => positions[x.asset.id]?.x === positions[s.asset.id]!.x && positions[x.asset.id]!.y === (k - 1) * (NODE_H + GAP_Y))?.asset.id ?? parent.asset.id, target: s.asset.id, kind: "state" });
    }
  }
  return { positions, edges };
}
