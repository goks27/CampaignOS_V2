import { describe, expect, it } from "vitest";
import { ADDABLE_KINDS, KIND_META, NODE_KINDS, canDelete, canDuplicate, deriveDefaultGraph, findSpace, nodeSubtitle, pickHandles, resolveScreens, screenKey, validateConnection, type GraphNode } from "./graph";
import { buildJourneyModel, END_ID, START_ID, type JourneyRaw } from "./journeyModel";

const cast = <T,>(x: unknown) => x as T;
const asset = (id: string, name: string, type = "screen", i = 0) => ({ id, screen_name: name, screen_type: type, sort_order: i, bucket: "designs", storage_path: `${id}.png` });
const empty: JourneyRaw = { designs: [], findings: [], tasks: [], requirements: [], checks: [], builds: [], captures: [], cases: [], runs: [], jobs: [] };
const screensOf = (list: ReturnType<typeof asset>[]) => buildJourneyModel({ ...empty, designs: cast<JourneyRaw["designs"]>([{ id: "s", journey_id: "j1", status: "submitted", version_no: 1, title: "t", design_assets: list }]) }, "j1").screens;
const node = (id: string, kind: GraphNode["kind"], over: Partial<GraphNode> = {}): GraphNode => ({ id, campaign_id: "c", journey_id: "j1", kind, label: id, screen_key: null, pos_x: 0, pos_y: 0, config: {}, version: 1, ...over });

describe("kinds", () => {
  it("describes every kind, and only offers sensible ones to add", () => {
    for (const k of NODE_KINDS) expect(KIND_META[k].label.length).toBeGreaterThan(1);
    expect(ADDABLE_KINDS).not.toContain("start");
    expect(ADDABLE_KINDS).not.toContain("screen");
    expect(ADDABLE_KINDS).toEqual(expect.arrayContaining(["api_call", "decision", "reward_allocation", "voucher_distribution", "kyc_verification", "otp_validation", "eligibility_check", "error_state"]));
  });
  it("shows the first setting of a step under its name, else what the kind is for", () => {
    expect(nodeSubtitle(node("a", "api_call", { config: { endpoint: "POST /codes/validate" } }))).toBe("POST /codes/validate");
    expect(nodeSubtitle(node("a", "decision"))).toBe(KIND_META.decision.hint);
    expect(nodeSubtitle(node("a", "reward_allocation", { config: { reward: "  ", limit: "10 a day" } }))).toBe("10 a day");
  });
});

describe("screenKey", () => {
  it("ignores case, spacing and punctuation", () => {
    expect(screenKey("  OTP  Verification! ")).toBe("otp verification");
    expect(screenKey("otp-verification")).toBe(screenKey("OTP Verification"));
  });
});

describe("deriveDefaultGraph", () => {
  it("builds Start, the screens in order, End and the connections, and invents nothing else", () => {
    const g = deriveDefaultGraph(screensOf([asset("a", "Landing"), asset("b", "Registration", "form", 1), asset("c", "Error", "error state", 2), asset("d", "Reward", "screen", 3)]));
    expect(g.nodes.map((n) => n.kind)).toEqual(["start", "screen", "screen", "screen", "screen", "end"]);
    expect(g.nodes.filter((n) => n.kind === "screen").map((n) => n.screen_key)).toEqual(["landing", "registration", "error", "reward"]);
    const pairs = g.edges.map((e) => `${e.from}>${e.to}`);
    expect(pairs).toContain(`${START_ID}>a`);
    expect(pairs).toContain("a>b");
    expect(pairs).toContain("b>c"); // the error state hangs off the screen before it
    expect(pairs).toContain("b>d"); // and the main flow carries on past it
    expect(pairs).toContain(`d>${END_ID}`);
    expect(g.edges.find((e) => e.to === "c")!.label).toBe("error state");
  });
  it("is empty when there are no screens", () => {
    expect(deriveDefaultGraph([])).toEqual({ nodes: [], edges: [] });
  });
});

describe("validateConnection", () => {
  const nodes = [node("start", "start"), node("s1", "screen"), node("api", "api_call"), node("dec", "decision"), node("end", "end"), node("note", "note"), node("other", "screen", { journey_id: "j2" })];
  it("allows an ordinary connection and nothing it should not", () => {
    expect(validateConnection(nodes, [], "s1", "api")).toBeNull();
    expect(validateConnection(nodes, [], "api", "dec")).toBeNull();
    expect(validateConnection(nodes, [], "s1", "s1")).toMatch(/itself/);
    expect(validateConnection(nodes, [], "s1", "start")).toMatch(/Nothing can lead into Start/);
    expect(validateConnection(nodes, [], "end", "s1")).toMatch(/End has no outgoing/);
    expect(validateConnection(nodes, [], "note", "s1")).toMatch(/Notes/);
    expect(validateConnection(nodes, [], "s1", "other")).toMatch(/same journey/);
    expect(validateConnection(nodes, [], "s1", "nope")).toMatch(/must exist/);
  });
  it("refuses a duplicate but allows the reverse direction (a loop back is a real journey)", () => {
    const edges = [{ source_id: "s1", target_id: "api" }];
    expect(validateConnection(nodes, edges, "s1", "api")).toMatch(/already connected/);
    expect(validateConnection(nodes, edges, "api", "s1")).toBeNull();
  });
});

describe("resolveScreens", () => {
  it("follows a screen to its newest design by name and leaves new designs in the tray", () => {
    const assets = cast<Parameters<typeof resolveScreens>[1]>([asset("a2", "Registration"), asset("n", "New promo screen")]);
    const nodes = [node("n1", "screen", { screen_key: "registration" }), node("n2", "screen", { screen_key: "thank you" }), node("n3", "api_call")];
    const r = resolveScreens(nodes, assets);
    expect(r.forNode.get("n1")?.id).toBe("a2");
    expect(r.forNode.get("n2")).toBeNull(); // "No design in the latest version"
    expect(r.forNode.has("n3")).toBe(false);
    expect(r.unplaced.map((a) => a.id)).toEqual(["n"]);
  });
});

describe("placing and copying", () => {
  it("puts a new step where it overlaps nothing, moving down and then right", () => {
    const row = [{ kind: "screen" as const, pos_x: 0, pos_y: 0 }, { kind: "screen" as const, pos_x: 330, pos_y: 0 }];
    expect(findSpace([], { x: 100, y: 100 }, "api_call")).toEqual({ x: 100, y: 100 });
    const p = findSpace(row, { x: 100, y: 100 }, "api_call");
    expect(p.x).toBe(100); // straight down, clear of the screen above it
    expect(p.y).toBeGreaterThanOrEqual(360 + 24);
    expect(findSpace(row, { x: 640, y: 100 }, "api_call")).toEqual({ x: 640, y: 100 }); // free space is used as asked
    const boxed = [{ kind: "screen" as const, pos_x: 0, pos_y: 0 }, { kind: "screen" as const, pos_x: 0, pos_y: 384 }, { kind: "screen" as const, pos_x: 0, pos_y: 768 }];
    expect(findSpace(boxed, { x: 40, y: 40 }, "note").y).toBeGreaterThanOrEqual(0);
    // given the visible area, it stays inside it when there is room there
    const seen = { x: 0, y: 0, w: 1000, h: 700 };
    const q = findSpace(row, { x: 100, y: 100 }, "api_call", seen);
    expect(q.x).toBeGreaterThanOrEqual(0); expect(q.x + 210).toBeLessThanOrEqual(1000); expect(q.y + 100).toBeLessThanOrEqual(700);
    expect(q.y >= 360 + 24 || q.x >= 570 + 24).toBe(true); // and clear of the screens
  });
  it("never copies Start or a screen, and never deletes Start", () => {
    expect(canDuplicate("start")).toBe(false);
    expect(canDuplicate("screen")).toBe(false);
    expect(canDuplicate("api_call")).toBe(true);
    expect(canDelete("start")).toBe(false);
    expect(canDelete("screen")).toBe(true);
  });
  it("draws the arrow out of the side that faces the target", () => {
    expect(pickHandles({ x: 0, y: 0 }, { x: 300, y: 20 })).toEqual({ sourceHandle: "r", targetHandle: "l" });
    expect(pickHandles({ x: 300, y: 0 }, { x: 0, y: 10 })).toEqual({ sourceHandle: "l", targetHandle: "r" });
    expect(pickHandles({ x: 0, y: 0 }, { x: 20, y: 400 })).toEqual({ sourceHandle: "b", targetHandle: "t" });
    expect(pickHandles({ x: 0, y: 400 }, { x: 10, y: 0 })).toEqual({ sourceHandle: "t", targetHandle: "b" });
  });
});
