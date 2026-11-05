/**
 * The journey graph, as pure rules: what kinds of step exist, how the first graph is built from the design screens,
 * which connections are allowed, and which design screen a node shows. No fetching and no React, so it is easy to test.
 * The database enforces the same connection rules (see supabase/migrations/20261105000100_journey_graph.sql).
 */
import type { Tone } from "@/lib/labels";
import type { DesignAsset } from "@/services/designs";
import { END_ID, START_ID, layoutScreens, type ScreenModel } from "./journeyModel";

export const NODE_KINDS = ["start", "end", "screen", "form_submission", "otp_validation", "api_call", "eligibility_check", "decision",
  "reward_allocation", "voucher_distribution", "kyc_verification", "error_state", "note"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** Steps a person can add. Start is created with the journey and screens come from the designs. */
export const ADDABLE_KINDS: NodeKind[] = ["form_submission", "otp_validation", "api_call", "eligibility_check", "decision", "reward_allocation",
  "voucher_distribution", "kyc_verification", "error_state", "end", "note"];

export type ConfigField = { key: string; label: string; placeholder: string; multiline?: boolean };
export type KindMeta = { label: string; hint: string; tone: Tone; fields: ConfigField[] };

export const KIND_META: Record<NodeKind, KindMeta> = {
  start: { label: "Start", hint: "Where the journey begins", tone: "blue", fields: [] },
  end: { label: "End", hint: "Where the journey finishes", tone: "blue", fields: [] },
  screen: { label: "Screen", hint: "A design screen the user sees", tone: "gray", fields: [] },
  form_submission: { label: "Form submission", hint: "The user submits details", tone: "violet", fields: [
    { key: "fields", label: "Fields", placeholder: "Name, mobile number, consent checkbox" }, { key: "validation", label: "Validation", placeholder: "10 digit mobile number, name required", multiline: true }] },
  otp_validation: { label: "OTP validation", hint: "A one-time code is checked", tone: "violet", fields: [
    { key: "channel", label: "Sent by", placeholder: "SMS" }, { key: "rule", label: "Rule", placeholder: "6 digits, expires in 5 minutes, 3 attempts" }] },
  api_call: { label: "API request", hint: "Calls a backend or an external service", tone: "blue", fields: [
    { key: "endpoint", label: "Endpoint", placeholder: "POST /codes/validate" }, { key: "success", label: "Success looks like", placeholder: "200 and { valid: true }", multiline: true }, { key: "failure", label: "Failure looks like", placeholder: "409 when the code was already used", multiline: true }] },
  eligibility_check: { label: "Eligibility check", hint: "Decides whether the user may take part", tone: "amber", fields: [
    { key: "rule", label: "Rule", placeholder: "Resident of AP or Telangana, 18 or over", multiline: true }] },
  decision: { label: "Decision", hint: "A branch: the journey goes one of several ways", tone: "amber", fields: [
    { key: "condition", label: "Question", placeholder: "Is the code valid?" }] },
  reward_allocation: { label: "Reward allocation", hint: "Decides and records the reward", tone: "green", fields: [
    { key: "reward", label: "Reward", placeholder: "Rs 100 voucher" }, { key: "limit", label: "Limits", placeholder: "10 winners per day, 1 per user", multiline: true }] },
  voucher_distribution: { label: "Voucher distribution", hint: "A voucher is delivered to the user", tone: "green", fields: [
    { key: "provider", label: "Provider", placeholder: "Amazon Pay" }, { key: "delivery", label: "Delivery", placeholder: "Code on screen and by SMS" }] },
  kyc_verification: { label: "KYC verification", hint: "The user's identity is verified", tone: "violet", fields: [
    { key: "provider", label: "Provider", placeholder: "Digio" }, { key: "documents", label: "Documents", placeholder: "PAN, Aadhaar last 4 digits" }] },
  error_state: { label: "Error or fallback", hint: "What the user sees when something fails", tone: "red", fields: [
    { key: "message", label: "Message", placeholder: "That code is not valid", multiline: true }, { key: "recovery", label: "Recovery", placeholder: "Try again, or contact support" }] },
  note: { label: "Note", hint: "An annotation for the team", tone: "gray", fields: [{ key: "text", label: "Note", placeholder: "Anything the team should know", multiline: true }] },
};

export type GraphNode = {
  id: string; campaign_id: string; journey_id: string | null; kind: NodeKind; label: string; screen_key: string | null;
  pos_x: number; pos_y: number; config: Record<string, unknown>; version: number;
};
export type GraphEdge = { id: string; campaign_id: string; journey_id: string | null; source_id: string; target_id: string; label: string; version: number };

/** Screens match nodes by name, ignoring case, spacing and punctuation, so a renamed file does not orphan a node. */
export const screenKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** One line under a node's name: the first thing its settings say. */
export function nodeSubtitle(n: GraphNode): string {
  const first = KIND_META[n.kind].fields.map((f) => String(n.config?.[f.key] ?? "").trim()).find(Boolean);
  return first ?? KIND_META[n.kind].hint;
}

// ---------------------------------------------------------------- the first graph, built from the design screens
export type DraftNode = { key: string; kind: NodeKind; label: string; screen_key: string | null; x: number; y: number; config: Record<string, unknown> };
export type DraftEdge = { from: string; to: string; label: string };

/** Start, the screens in flow order, End, with states hanging below the screen they belong to. Nothing is invented. */
export function deriveDefaultGraph(screens: ScreenModel[]): { nodes: DraftNode[]; edges: DraftEdge[] } {
  if (!screens.length) return { nodes: [], edges: [] };
  const layout = layoutScreens(screens);
  const nodes: DraftNode[] = screens.map((s) => ({ key: s.asset.id, kind: "screen", label: s.asset.screen_name, screen_key: screenKey(s.asset.screen_name), x: layout.positions[s.asset.id]?.x ?? 0, y: layout.positions[s.asset.id]?.y ?? 0, config: {} }));
  const edges: DraftEdge[] = layout.edges.map((e) => ({ from: e.source, to: e.target, label: e.kind === "state" ? String(screens.find((s) => s.asset.id === e.target)?.asset.screen_type ?? "") : "" }));
  if (layout.bookends) {
    nodes.unshift({ key: START_ID, kind: "start", label: "Start", screen_key: null, x: layout.bookends.start.x, y: layout.bookends.start.y, config: {} });
    nodes.push({ key: END_ID, kind: "end", label: "End", screen_key: null, x: layout.bookends.end.x, y: layout.bookends.end.y, config: {} });
    edges.unshift({ from: START_ID, to: layout.bookends.edges[0]!.target, label: "" });
    edges.push({ from: layout.bookends.edges[1]!.source, to: END_ID, label: "" });
  }
  return { nodes, edges };
}

// ---------------------------------------------------------------- connection rules (the database enforces the same ones)
export function validateConnection(nodes: Pick<GraphNode, "id" | "kind" | "journey_id" | "campaign_id">[], edges: Pick<GraphEdge, "source_id" | "target_id">[], sourceId: string, targetId: string): string | null {
  const s = nodes.find((n) => n.id === sourceId), t = nodes.find((n) => n.id === targetId);
  if (!s || !t) return "Both ends of a connection must exist.";
  if (s.id === t.id) return "A step cannot connect to itself.";
  if (s.campaign_id !== t.campaign_id || s.journey_id !== t.journey_id) return "A connection must join two steps of the same journey.";
  if (t.kind === "start") return "Nothing can lead into Start.";
  if (s.kind === "end") return "End has no outgoing connections.";
  if (s.kind === "note" || t.kind === "note") return "Notes are not part of the flow.";
  if (edges.some((e) => e.source_id === sourceId && e.target_id === targetId)) return "Those two steps are already connected.";
  return null;
}

// ---------------------------------------------------------------- which design a node shows
/** Screen nodes show the newest design with the same name. Designs with no node yet wait in the tray. */
export function resolveScreens(nodes: GraphNode[], assets: DesignAsset[]) {
  const byKey = new Map(assets.map((a) => [screenKey(a.screen_name), a]));
  const placed = new Set<string>();
  const forNode = new Map<string, DesignAsset | null>();
  for (const n of nodes) {
    if (n.kind !== "screen") continue;
    const a = n.screen_key ? byKey.get(n.screen_key) ?? null : null;
    forNode.set(n.id, a);
    if (n.screen_key) placed.add(n.screen_key);
  }
  return { forNode, unplaced: assets.filter((a) => !placed.has(screenKey(a.screen_name))) };
}

// ---------------------------------------------------------------- placing and copying
/** Rough size of each kind on the canvas, so new steps can be placed clear of what is already there. */
export const nodeSize = (kind: NodeKind) => (kind === "screen" ? { w: 240, h: 360 } : kind === "start" || kind === "end" ? { w: 70, h: 40 } : kind === "note" ? { w: 190, h: 90 } : { w: 210, h: 100 });

/** The nearest spot to `at` where a new step overlaps nothing. Looks inside `within` (the part of the canvas you can see) first; failing that, further down, then further right. */
export function findSpace(nodes: Pick<GraphNode, "kind" | "pos_x" | "pos_y">[], at: { x: number; y: number }, kind: NodeKind, within?: { x: number; y: number; w: number; h: number }, gap = 24) {
  const me = nodeSize(kind);
  const clash = (x: number, y: number) => nodes.some((n) => { const s = nodeSize(n.kind); return x < n.pos_x + s.w + gap && x + me.w + gap > n.pos_x && y < n.pos_y + s.h + gap && y + me.h + gap > n.pos_y; });
  const x0 = Math.round(at.x), y0 = Math.round(at.y);
  if (within) {
    const step = 30, cand: { x: number; y: number; d: number }[] = [];
    for (let x = within.x; x + me.w <= within.x + within.w; x += step) for (let y = within.y; y + me.h <= within.y + within.h; y += step) cand.push({ x: Math.round(x), y: Math.round(y), d: Math.hypot(x - x0, y - y0) });
    cand.sort((a, b) => a.d - b.d);
    const hit = cand.find((c) => !clash(c.x, c.y));
    if (hit) return { x: hit.x, y: hit.y };
  }
  for (let col = 0; col < 12; col++) for (let row = 0; row < 40; row++) {
    const x = x0 + col * (me.w + gap), y = y0 + row * 36;
    if (!clash(x, y)) return { x, y };
  }
  return { x: x0, y: y0 };
}

/** Start and screens cannot be copied: there is one Start, and a screen appears once per journey. */
export const canDuplicate = (kind: NodeKind) => kind !== "start" && kind !== "screen";
export const canDelete = (kind: NodeKind) => kind !== "start";

/** Where a connection leaves and enters, so the arrow follows the layout wherever the nodes are dragged. */
export function pickHandles(a: { x: number; y: number }, b: { x: number; y: number }): { sourceHandle: "l" | "r" | "t" | "b"; targetHandle: "l" | "r" | "t" | "b" } {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy) * 0.6) return dx >= 0 ? { sourceHandle: "r", targetHandle: "l" } : { sourceHandle: "l", targetHandle: "r" };
  return dy >= 0 ? { sourceHandle: "b", targetHandle: "t" } : { sourceHandle: "t", targetHandle: "b" };
}
