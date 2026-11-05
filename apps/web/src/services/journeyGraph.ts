import { supabase, must, type Tables } from "./db";
import type { Json } from "@/types/database";
import type { DraftEdge, DraftNode, GraphEdge, GraphNode, NodeKind } from "@/features/canvas/graph";

export type NodeRequirementLink = Tables<"node_requirements">;
export type JourneyGraphData = { nodes: GraphNode[]; edges: GraphEdge[]; links: NodeRequirementLink[] };

const asNode = (r: Tables<"journey_nodes">): GraphNode => ({
  id: r.id, campaign_id: r.campaign_id, journey_id: r.journey_id, kind: r.kind as NodeKind, label: r.label, screen_key: r.screen_key,
  pos_x: Number(r.pos_x), pos_y: Number(r.pos_y), config: (r.config && typeof r.config === "object" && !Array.isArray(r.config) ? r.config : {}) as Record<string, unknown>, version: r.version,
});
const asEdge = (r: Tables<"journey_edges">): GraphEdge => ({ id: r.id, campaign_id: r.campaign_id, journey_id: r.journey_id, source_id: r.source_id, target_id: r.target_id, label: r.label, version: r.version });

const CHANGED = "Someone else changed this step. The latest version has been loaded; please make your change again.";

/** The journey graph: steps, connections and the requirements a step answers to. RLS decides who can write; the database also enforces the connection rules. */
export const journeyGraphService = {
  async list(campaignId: string): Promise<JourneyGraphData> {
    const [n, e, l] = await Promise.all([
      supabase.from("journey_nodes").select("*").eq("campaign_id", campaignId).order("created_at"),
      supabase.from("journey_edges").select("*").eq("campaign_id", campaignId).order("created_at"),
      supabase.from("node_requirements").select("*").eq("campaign_id", campaignId),
    ]);
    return { nodes: must(n).map(asNode), edges: must(e).map(asEdge), links: must(l) };
  },

  /** Builds a journey's graph from its design screens the first time it is opened. Returns false when a graph already exists. */
  async ensure(campaignId: string, journeyId: string | null, draft: { nodes: DraftNode[]; edges: DraftEdge[] }) {
    return must(await supabase.rpc("ensure_journey_graph", {
      p_campaign: campaignId, p_journey: journeyId as string,
      p_nodes: draft.nodes.map((n) => ({ key: n.key, kind: n.kind, label: n.label, screen_key: n.screen_key, x: n.x, y: n.y, config: n.config })) as unknown as Json,
      p_edges: draft.edges as unknown as Json,
    })) as boolean;
  },

  async createNode(input: { campaignId: string; journeyId: string | null; kind: NodeKind; label: string; screenKey?: string | null; x: number; y: number; config?: Record<string, unknown> }) {
    return asNode(must(await supabase.from("journey_nodes").insert({
      campaign_id: input.campaignId, journey_id: input.journeyId, kind: input.kind, label: input.label, screen_key: input.screenKey ?? null,
      pos_x: input.x, pos_y: input.y, config: (input.config ?? {}) as Json,
    }).select().single()));
  },

  /** Label and settings. Fails with a clear message if someone else changed the step meanwhile. */
  async updateNode(node: Pick<GraphNode, "id" | "version">, patch: { label?: string; config?: Record<string, unknown> }) {
    const rows = must(await supabase.from("journey_nodes").update({ ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.config ? { config: patch.config as Json } : {}) })
      .eq("id", node.id).eq("version", node.version).select());
    if (!rows.length) throw new Error(CHANGED);
    return asNode(rows[0]!);
  },

  /** Positions only. Last save wins; returns the new versions so the next edit does not clash with this one. */
  async moveNodes(moves: { id: string; x: number; y: number }[]) {
    const out = await Promise.all(moves.map(async (m) => must(await supabase.from("journey_nodes").update({ pos_x: Math.round(m.x), pos_y: Math.round(m.y) }).eq("id", m.id).select())[0]));
    return out.filter((r): r is Tables<"journey_nodes"> => Boolean(r)).map(asNode);
  },

  async deleteNodes(ids: string[]) {
    if (ids.length) must(await supabase.from("journey_nodes").delete().in("id", ids).select("id"));
  },

  async createEdge(input: { campaignId: string; journeyId: string | null; source: string; target: string; label?: string }) {
    return asEdge(must(await supabase.from("journey_edges").insert({ campaign_id: input.campaignId, journey_id: input.journeyId, source_id: input.source, target_id: input.target, label: input.label ?? "" }).select().single()));
  },
  async updateEdge(edge: Pick<GraphEdge, "id" | "version">, label: string) {
    const rows = must(await supabase.from("journey_edges").update({ label }).eq("id", edge.id).eq("version", edge.version).select());
    if (!rows.length) throw new Error(CHANGED);
    return asEdge(rows[0]!);
  },
  async deleteEdges(ids: string[]) {
    if (ids.length) must(await supabase.from("journey_edges").delete().in("id", ids).select("id"));
  },

  async linkRequirement(campaignId: string, nodeId: string, requirementId: string) {
    return must(await supabase.from("node_requirements").upsert({ campaign_id: campaignId, node_id: nodeId, requirement_id: requirementId }, { onConflict: "node_id,requirement_id", ignoreDuplicates: true }).select());
  },
  async unlinkRequirement(nodeId: string, requirementId: string) {
    must(await supabase.from("node_requirements").delete().eq("node_id", nodeId).eq("requirement_id", requirementId).select());
  },
};
