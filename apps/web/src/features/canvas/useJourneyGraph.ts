import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { journeyGraphService, type JourneyGraphData } from "@/services/journeyGraph";
import { deriveDefaultGraph, type GraphEdge, type GraphNode } from "./graph";
import { UNASSIGNED, type ScreenModel } from "./journeyModel";

const key = (campaignId: string) => ["journey-graph", campaignId] as const;

/**
 * One journey's graph. If it has not been stored yet, the graph Journ derives from the design screens is shown at once
 * (read-only) and, for people who can edit, stored in one go. Nobody sees a flash of nothing and nothing is invented.
 */
export function useJourneyGraph(campaignId: string, journeyKey: string, screens: ScreenModel[], canWrite: boolean) {
  const qc = useQueryClient();
  const toast = useToast();
  const journeyId = journeyKey === UNASSIGNED ? null : journeyKey;
  const q = useQuery({ queryKey: key(campaignId), queryFn: () => journeyGraphService.list(campaignId), refetchInterval: 20_000 });

  const stored = React.useMemo(() => ({
    nodes: (q.data?.nodes ?? []).filter((n) => n.journey_id === journeyId),
    edges: (q.data?.edges ?? []).filter((e) => e.journey_id === journeyId),
  }), [q.data, journeyId]);
  const links = React.useMemo(() => q.data?.links ?? [], [q.data]);

  // The derived graph, with the same ids the screens have, until the stored one exists.
  const derived = React.useMemo(() => {
    const d = deriveDefaultGraph(screens);
    const nodes: GraphNode[] = d.nodes.map((n) => ({ id: n.key, campaign_id: campaignId, journey_id: journeyId, kind: n.kind, label: n.label, screen_key: n.screen_key, pos_x: n.x, pos_y: n.y, config: n.config, version: 0 }));
    const edges: GraphEdge[] = d.edges.map((e) => ({ id: `v-${e.from}-${e.to}`, campaign_id: campaignId, journey_id: journeyId, source_id: e.from, target_id: e.to, label: e.label, version: 0 }));
    return { nodes, edges, draft: d };
  }, [screens, campaignId, journeyId]);

  const isVirtual = stored.nodes.length === 0;
  const nodes = isVirtual ? derived.nodes : stored.nodes;
  const edges = isVirtual ? derived.edges : stored.edges;

  const ensuring = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!canWrite || !q.isSuccess || !isVirtual || !derived.draft.nodes.length) return;
    const tag = `${campaignId}/${journeyKey}`;
    if (ensuring.current === tag) return;
    ensuring.current = tag;
    journeyGraphService.ensure(campaignId, journeyId, derived.draft)
      .then(() => qc.invalidateQueries({ queryKey: key(campaignId) }))
      .catch((e) => { ensuring.current = null; toast.error(e, "Could not save the journey layout"); });
  }, [canWrite, q.isSuccess, isVirtual, derived.draft, campaignId, journeyKey, journeyId, qc, toast]);

  const patch = React.useCallback((fn: (d: JourneyGraphData) => JourneyGraphData) => {
    qc.setQueryData<JourneyGraphData>(key(campaignId), (d) => (d ? fn(d) : d));
  }, [qc, campaignId]);
  const refresh = React.useCallback(() => qc.invalidateQueries({ queryKey: key(campaignId) }), [qc, campaignId]);

  /** Runs a write; shows the error and reloads the stored graph if it fails, so the screen never lies about what was saved. */
  const run = React.useCallback(async <T,>(fn: () => Promise<T>, errorTitle: string): Promise<T | null> => {
    try { return await fn(); } catch (e) { toast.error(e, errorTitle); void refresh(); return null; }
  }, [toast, refresh]);

  return { loading: q.isLoading, isVirtual, nodes, edges, links, journeyId, patch, refresh, run };
}
