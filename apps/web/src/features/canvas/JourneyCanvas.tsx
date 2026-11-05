import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Background, ConnectionMode, MarkerType, MiniMap, Panel, ReactFlow, ReactFlowProvider, useNodesInitialized, useNodesState, useReactFlow, type Connection, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./canvas.css";
import { ImagePlus, Layers } from "lucide-react";
import { Button, Drawer } from "@/components/ui";
import { ConfirmDialog } from "@/components/common";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth";
import { qk, useConnectorStatus } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import type { CampaignWithRelations } from "@/services/campaigns";
import { designsService, type DesignSubmission } from "@/services/designs";
import { developmentService } from "@/services/development";
import { findingsService } from "@/services/findings";
import { jobsService } from "@/services/jobs";
import { journeyGraphService } from "@/services/journeyGraph";
import { requirementsService } from "@/services/requirements";
import { tasksService } from "@/services/tasks";
import { UploadDialog } from "@/features/campaigns/tabs/DesignsTab";
import { SubmissionDialog } from "@/features/campaigns/tabs/DevelopmentTab";
import { AddMenu } from "./AddMenu";
import { Inspector } from "./Inspector";
import { JourneyDock } from "./JourneyDock";
import { CanvasTools } from "./CanvasControls";
import { EdgePanel, FindingPanel, NodePanel, RequirementPanel, type Focus } from "./ObjectPanels";
import { ScreenFindings } from "./ScreenFindings";
import { GraphCtx, nodeTypes, rfType, type GraphCtxValue } from "./nodes";
import { setAssistantHint } from "./assistantHint";
import { KIND_META, canDelete, canDuplicate, findSpace, nodeSize, pickHandles, resolveScreens, screenKey, validateConnection, type GraphEdge, type GraphNode, type NodeKind } from "./graph";
import { buildJourneyModel, NODE_W, UNASSIGNED } from "./journeyModel";
import { useJourneyGraph } from "./useJourneyGraph";

const MINIMAP_KEY = "journ-minimap";
const readMinimap = () => { try { return localStorage.getItem(MINIMAP_KEY) !== "0"; } catch { return true; } };
const isDark = () => document.documentElement.classList.contains("dark");

function useWide() {
  const q = "(min-width: 1024px)";
  const [wide, setWide] = React.useState(() => window.matchMedia?.(q).matches ?? true);
  React.useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

const toRfNodes = (nodes: GraphNode[], selected: Set<string>, draggable: boolean): Node[] => nodes.map((n) => ({
  id: n.id, type: rfType(n.kind), position: { x: n.pos_x, y: n.pos_y }, data: { id: n.id }, selected: selected.has(n.id), deletable: canDelete(n.kind), draggable,
}));

type Props = { campaign: CampaignWithRelations; journeyKey: string; journeyName: string; selector: React.ReactNode };

/** The journey's own canvas: a graph of screens and logic steps you can edit, the inspector that follows what you select, and the dock underneath. */
export function JourneyCanvas(props: Props) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}

function Canvas({ campaign: c, journeyKey, journeyName, selector }: Props) {
  const { canEdit, me } = useAuth();
  const toast = useToast();
  const canSubmit = canEdit || (me?.role === "team_member" && c.campaign_members.some((m) => m.user_id === me.id));
  const connector = useConnectorStatus().data;
  const wide = useWide();
  const rf = useReactFlow();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const areaRef = React.useRef<HTMLDivElement>(null);

  const designs = useQuery({ queryKey: qk.designs(c.id), queryFn: () => designsService.list(c.id) });
  const findings = useQuery({ queryKey: ["findings", "canvas", c.id], queryFn: () => findingsService.list({ campaignId: c.id }), refetchInterval: 20_000 });
  const tasks = useQuery({ queryKey: ["tasks", "canvas", c.id], queryFn: () => tasksService.list({ campaignId: c.id }) });
  const reqs = useQuery({ queryKey: qk.requirements(c.id), queryFn: () => requirementsService.list(c.id) });
  const checks = useQuery({ queryKey: qk.checks(c.id), queryFn: () => requirementsService.checks(c.id) });
  const builds = useQuery({ queryKey: [...qk.dev(c.id), "subs"], queryFn: () => developmentService.submissions(c.id) });
  const cases = useQuery({ queryKey: [...qk.dev(c.id), "cases"], queryFn: () => developmentService.testCases(c.id) });
  const runs = useQuery({ queryKey: [...qk.dev(c.id), "runs"], queryFn: () => developmentService.runs(c.id) });
  const jobs = useQuery({ queryKey: ["jobs", "canvas", c.id], queryFn: () => jobsService.list({ campaignId: c.id, limit: 30 }), refetchInterval: 8_000 });

  const base = React.useMemo(() => ({
    designs: designs.data ?? [], findings: findings.data ?? [], tasks: tasks.data ?? [], requirements: reqs.data ?? [], checks: checks.data ?? [], builds: builds.data ?? [], captures: [],
    cases: cases.data ?? [], runs: runs.data ?? [], jobs: (jobs.data ?? []).map((j) => ({ review_type: j.review_type, status: j.status })),
  }), [designs.data, findings.data, tasks.data, reqs.data, checks.data, builds.data, cases.data, runs.data, jobs.data]);
  const first = React.useMemo(() => buildJourneyModel(base, journeyKey), [base, journeyKey]);
  const buildId = first.build?.id;
  const captures = useQuery({ queryKey: ["captures", buildId], queryFn: () => developmentService.captures(buildId!), enabled: Boolean(buildId) });
  const model = React.useMemo(() => buildJourneyModel({ ...base, captures: captures.data ?? [] }, journeyKey), [base, captures.data, journeyKey]);

  const graph = useJourneyGraph(c.id, journeyKey, model.screens, canSubmit);
  const editable = canSubmit && !graph.isVirtual;
  const allRequirements = React.useMemo(() => reqs.data ?? [], [reqs.data]);

  // ------------------------------------------------------------ what each node shows
  const resolved = React.useMemo(() => resolveScreens(graph.nodes, model.submission?.design_assets ?? []), [graph.nodes, model.submission]);
  const byId = React.useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const reqCount = React.useMemo(() => { const m = new Map<string, number>(); for (const l of graph.links) m.set(l.node_id, (m.get(l.node_id) ?? 0) + 1); return m; }, [graph.links]);
  const screenModel = React.useCallback((a: { id: string } | null) => (a ? model.screens.find((s) => s.asset.id === a.id) ?? null : null), [model.screens]);

  // ------------------------------------------------------------ selection and the inspector
  const [focus, setFocus] = React.useState<Focus | null>(null);
  const [sel, setSel] = React.useState<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] });
  const [viewer, setViewer] = React.useState<{ sub: DesignSubmission; index: number } | null>(null);
  const [uploadFiles, setUploadFiles] = React.useState<File[] | null>(null);
  const [addingBuild, setAddingBuild] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [minimap, setMinimap] = React.useState(readMinimap);
  const [pendingDelete, setPendingDelete] = React.useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const pendingSelect = React.useRef<string[] | null>(null);
  const lastSel = React.useRef("");

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(toRfNodes(graph.nodes, new Set(), editable));
  React.useEffect(() => {
    setNodes((prev) => {
      const want = pendingSelect.current; pendingSelect.current = null;
      const keep = new Set(want ?? prev.filter((n) => n.selected).map((n) => n.id));
      return toRfNodes(graph.nodes, keep, editable);
    });
  }, [graph.nodes, editable, setNodes]);
  const selectNodes = React.useCallback((ids: string[]) => setNodes((prev) => prev.map((n) => ({ ...n, selected: ids.includes(n.id) }))), [setNodes]);
  const clearSelection = React.useCallback(() => { selectNodes([]); setFocus(null); }, [selectNodes]);

  const onSelectionChange = React.useCallback(({ nodes: ns, edges: es }: { nodes: Node[]; edges: Edge[] }) => {
    const k = `${ns.map((n) => n.id).join(",")}|${es.map((e) => e.id).join(",")}`;
    if (k === lastSel.current) return;
    lastSel.current = k;
    setSel({ nodes: ns.map((n) => n.id), edges: es.map((e) => e.id) });
    if (ns.length === 1) setFocus({ t: "node", id: ns[0]!.id });
    else if (ns.length === 0 && es.length === 1) setFocus({ t: "edge", id: es[0]!.id });
    else setFocus(null);
  }, []);

  const edges = React.useMemo<Edge[]>(() => graph.edges.flatMap((e) => {
    const s = byId.get(e.source_id), t = byId.get(e.target_id);
    if (!s || !t) return [];
    const toState = t.kind === "screen" && screenModel(resolved.forNode.get(t.id) ?? null)?.kind === "state";
    return [{
      id: e.id, source: e.source_id, target: e.target_id, ...pickHandles({ x: s.pos_x, y: s.pos_y }, { x: t.pos_x, y: t.pos_y }), type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }, label: e.label || undefined, animated: model.working.design && graph.isVirtual,
      selected: focus?.t === "edge" && focus.id === e.id, style: toState ? { strokeDasharray: "5 4" } : undefined,
    }];
  }), [graph.edges, byId, resolved.forNode, screenModel, focus, model.working.design, graph.isVirtual]);

  const single = sel.nodes.length === 1 ? sel.nodes[0]! : null;
  const ctx = React.useMemo<GraphCtxValue>(() => ({ model, byId, screenOf: resolved.forNode, screenModel, reqCount, canWrite: editable, selected: focus?.t === "node" ? focus.id : single }), [model, byId, resolved.forNode, screenModel, reqCount, editable, focus, single]);

  // ------------------------------------------------------------ writes
  const patchNodes = (fn: (n: GraphNode) => GraphNode) => graph.patch((d) => ({ ...d, nodes: d.nodes.map(fn) }));
  /** The part of the canvas you can see, in canvas coordinates, and its middle. */
  const visible = () => {
    const r = areaRef.current?.getBoundingClientRect();
    const a = rf.screenToFlowPosition({ x: (r?.left ?? 0) + 16, y: (r?.top ?? 0) + 70 }), z = rf.screenToFlowPosition({ x: (r?.right ?? 600) - 16, y: (r?.bottom ?? 400) - 16 });
    return { rect: { x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y }, mid: { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 } };
  };
  /** Pans, never zooms, so a step that landed outside the view is brought into it. */
  const reveal = (x: number, y: number, kind: NodeKind) => {
    const { rect } = visible(), s = nodeSize(kind);
    if (x >= rect.x && y >= rect.y && x + s.w <= rect.x + rect.w && y + s.h <= rect.y + rect.h) return;
    void rf.setCenter(x + s.w / 2, y + s.h / 2, { zoom: rf.getZoom(), duration: 300 });
  };

  const addStep = async (kind: NodeKind) => {
    if (!editable) return;
    const v = visible(), size = nodeSize(kind);
    const spot = findSpace(graph.nodes, { x: v.mid.x - size.w / 2, y: v.mid.y - size.h / 2 }, kind, v.rect);
    const created = await graph.run(() => journeyGraphService.createNode({ campaignId: c.id, journeyId: graph.journeyId, kind, label: KIND_META[kind].label, x: spot.x, y: spot.y }), "Could not add the step");
    if (!created) return;
    pendingSelect.current = [created.id];
    graph.patch((d) => ({ ...d, nodes: [...d.nodes, created] }));
    setFocus({ t: "node", id: created.id });
    reveal(spot.x, spot.y, kind);
  };

  const addScreens = async (list: typeof resolved.unplaced) => {
    if (!editable || !list.length) return;
    const topRow = graph.nodes.filter((n) => n.pos_y < 80);
    let x = (topRow.length ? Math.max(...topRow.map((n) => n.pos_x)) : -NODE_W) + NODE_W + 90;
    const made: GraphNode[] = [];
    for (const a of list) {
      const n = await graph.run(() => journeyGraphService.createNode({ campaignId: c.id, journeyId: graph.journeyId, kind: "screen", label: a.screen_name, screenKey: screenKey(a.screen_name), x, y: 0 }), "Could not add the screen");
      if (!n) break;
      made.push(n); x += NODE_W + 90;
    }
    if (made.length) graph.patch((d) => ({ ...d, nodes: [...d.nodes, ...made] }));
  };

  const onConnect = async (cn: Connection) => {
    if (!editable) return;
    const err = validateConnection(graph.nodes, graph.edges, cn.source, cn.target);
    if (err) { toast.error(new Error(err)); return; }
    const e = await graph.run(() => journeyGraphService.createEdge({ campaignId: c.id, journeyId: graph.journeyId, source: cn.source, target: cn.target }), "Could not connect the steps");
    if (!e) return;
    graph.patch((d) => ({ ...d, edges: [...d.edges, e] }));
    selectNodes([]); lastSel.current = ""; setFocus({ t: "edge", id: e.id });
  };

  const onDragStop = (moved: Node[]) => {
    if (!editable) return;
    const moves = moved.map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) }));
    patchNodes((n) => { const m = moves.find((x) => x.id === n.id); return m ? { ...n, pos_x: m.x, pos_y: m.y } : n; });
    void graph.run(async () => {
      const rows = await journeyGraphService.moveNodes(moves);
      patchNodes((n) => { const r = rows.find((x) => x.id === n.id); return r ? { ...n, version: r.version } : n; });
    }, "Could not save the move");
  };

  const saveNode = async (node: GraphNode, patch: { label: string; config: Record<string, unknown> }) => {
    const row = await graph.run(() => journeyGraphService.updateNode(node, patch), "Could not save");
    if (row) patchNodes((n) => (n.id === row.id ? row : n));
  };
  const saveEdge = async (edge: GraphEdge, label: string) => {
    const row = await graph.run(() => journeyGraphService.updateEdge(edge, label), "Could not save");
    if (row) graph.patch((d) => ({ ...d, edges: d.edges.map((e) => (e.id === row.id ? row : e)) }));
  };
  const link = async (nodeId: string, requirementId: string) => {
    const ok = await graph.run(() => journeyGraphService.linkRequirement(c.id, nodeId, requirementId), "Could not link");
    if (ok) graph.patch((d) => ({ ...d, links: [...d.links.filter((l) => !(l.node_id === nodeId && l.requirement_id === requirementId)), { node_id: nodeId, requirement_id: requirementId, campaign_id: c.id, created_at: new Date().toISOString(), created_by: me?.id ?? null }] }));
  };
  const unlink = async (nodeId: string, requirementId: string) => {
    const ok = await graph.run(() => journeyGraphService.unlinkRequirement(nodeId, requirementId).then(() => true), "Could not unlink");
    if (ok) graph.patch((d) => ({ ...d, links: d.links.filter((l) => !(l.node_id === nodeId && l.requirement_id === requirementId)) }));
  };

  /** Deleting always asks first. Start cannot be deleted. Connections go with the steps they join. */
  const askDelete = (nodeIds: string[], edgeIds: string[]) => {
    if (!editable) return;
    const ns = nodeIds.map((id) => byId.get(id)).filter((n): n is GraphNode => Boolean(n));
    const doomed = ns.filter((n) => canDelete(n.kind));
    const es = graph.edges.filter((e) => edgeIds.includes(e.id));
    if (ns.length && !doomed.length && !es.length) { toast.error(new Error("Start cannot be deleted: every journey has one.")); return; }
    if (!doomed.length && !es.length) return;
    setPendingDelete({ nodes: doomed, edges: es });
  };
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const ids = new Set(pendingDelete.nodes.map((n) => n.id));
    const ok = await graph.run(async () => {
      await journeyGraphService.deleteEdges(pendingDelete.edges.filter((e) => !ids.has(e.source_id) && !ids.has(e.target_id)).map((e) => e.id));
      await journeyGraphService.deleteNodes([...ids]);
      return true;
    }, "Could not delete");
    setDeleting(false); setPendingDelete(null);
    if (!ok) return;
    const gone = new Set(pendingDelete.edges.map((e) => e.id));
    graph.patch((d) => ({ ...d, nodes: d.nodes.filter((n) => !ids.has(n.id)), edges: d.edges.filter((e) => !gone.has(e.id) && !ids.has(e.source_id) && !ids.has(e.target_id)), links: d.links.filter((l) => !ids.has(l.node_id)) }));
    lastSel.current = ""; setSel({ nodes: [], edges: [] }); setFocus(null);
  };

  const duplicate = async () => {
    if (!editable) return;
    const src = sel.nodes.map((id) => byId.get(id)).filter((n): n is GraphNode => Boolean(n && canDuplicate(n.kind)));
    const made: GraphNode[] = [];
    for (const n of src) {
      const spot = findSpace([...graph.nodes, ...made], { x: n.pos_x + 40, y: n.pos_y + 40 }, n.kind, visible().rect);
      const copy = await graph.run(() => journeyGraphService.createNode({ campaignId: c.id, journeyId: graph.journeyId, kind: n.kind, label: n.label ? `${n.label} copy` : "", x: spot.x, y: spot.y, config: n.config }), "Could not copy the step");
      if (!copy) break;
      made.push(copy);
    }
    if (!made.length) { if (sel.nodes.length) toast.error(new Error("Start and screens cannot be copied.")); return; }
    pendingSelect.current = made.map((n) => n.id);
    graph.patch((d) => ({ ...d, nodes: [...d.nodes, ...made] }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Delete" || e.key === "Backspace") { if (sel.nodes.length || sel.edges.length) { e.preventDefault(); askDelete(sel.nodes, sel.edges); } }
    else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); void duplicate(); }
    else if (mod || e.altKey) return;
    else if (e.key === "Escape") clearSelection();
    else if (e.key.toLowerCase() === "f") void rf.fitView({ padding: 0.15, maxZoom: 1, duration: 250 });
    else if (e.key === "+" || e.key === "=") void rf.zoomIn({ duration: 150 });
    else if (e.key === "-") void rf.zoomOut({ duration: 150 });
    else if (e.key.toLowerCase() === "m") toggleMinimap();
  };
  const toggleMinimap = () => setMinimap((m) => { try { localStorage.setItem(MINIMAP_KEY, m ? "0" : "1"); } catch { /* a convenience only */ } return !m; });

  // ------------------------------------------------------------ what the assistant is told you are looking at
  React.useEffect(() => () => setAssistantHint(null), []);
  const nodeName = (n?: GraphNode) => (n ? n.label || KIND_META[n.kind].label : "");
  React.useEffect(() => {
    if (!focus) { setAssistantHint(null); return; }
    if (focus.t === "node") { const n = byId.get(focus.id); setAssistantHint(n ? { campaignId: c.id, node: `${journeyName} / ${nodeName(n)}`, label: `${n.kind === "screen" ? "Screen" : KIND_META[n.kind].label} "${nodeName(n)}" in journey "${journeyName}"` } : null); }
    else if (focus.t === "edge") { const e = graph.edges.find((x) => x.id === focus.id); setAssistantHint(e ? { campaignId: c.id, node: `${journeyName} / connection`, label: `The connection from "${nodeName(byId.get(e.source_id))}" to "${nodeName(byId.get(e.target_id))}" in journey "${journeyName}"` } : null); }
    else if (focus.t === "req") { const r = allRequirements.find((x) => x.id === focus.id); setAssistantHint(r ? { campaignId: c.id, node: `${journeyName} / ${r.ref}`, label: `Requirement ${r.ref} "${r.title}"` } : null); }
    else { const f = (findings.data ?? []).find((x) => x.id === focus.id); setAssistantHint(f ? { campaignId: c.id, node: `${journeyName} / finding`, label: `Finding "${f.title}"` } : null); }
  }, [focus, byId, graph.edges, allRequirements, findings.data, c.id, journeyName]);

  // ------------------------------------------------------------ the inspector
  const waiting = (model.working.design || model.working.build) && !connector;
  const journeyId = journeyKey === UNASSIGNED ? "" : journeyKey;
  const ro = canSubmit ? "Saving this journey's layout…" : "You can view this journey. Managers and team members can edit it.";
  const backTo = single ? { label: `Back to ${nodeName(byId.get(single)) || "step"}`, go: () => setFocus({ t: "node", id: single }) } : { label: "Back to the journey", go: () => setFocus(null) };
  const linkedOf = (nodeId: string) => graph.links.filter((l) => l.node_id === nodeId).map((l) => allRequirements.find((r) => r.id === l.requirement_id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const pickableFor = (nodeId: string) => { const have = new Set(graph.links.filter((l) => l.node_id === nodeId).map((l) => l.requirement_id)); return allRequirements.filter((r) => r.status !== "rejected" && !have.has(r.id)); };

  const openViewer = (i: number) => model.submission && setViewer({ sub: model.submission, index: i });
  const inspector = (() => {
    const common = { campaign: c, model, journeyName, onClose: clearSelection, onOpenViewer: openViewer, onSubmitDesigns: () => setUploadFiles([]), onAddBuild: () => setAddingBuild(true), onFocus: setFocus };
    if (focus?.t === "node") {
      const n = byId.get(focus.id);
      if (n) {
        const asset = resolved.forNode.get(n.id) ?? null, sm = screenModel(asset);
        if (n.kind === "screen" && sm) return <Inspector {...common} screen={sm} linked={linkedOf(n.id)} pickable={pickableFor(n.id)} canLink={editable} onLink={(r) => void link(n.id, r)} onUnlink={(r) => void unlink(n.id, r)} />;
        return <NodePanel node={n} nodes={graph.nodes} edges={graph.edges} requirements={allRequirements} linked={linkedOf(n.id)} canWrite={editable} readOnlyReason={ro}
          onSave={(p) => saveNode(n, p)} onDelete={() => askDelete([n.id], [])} onSelect={setFocus} onLink={(r) => void link(n.id, r)} onUnlink={(r) => void unlink(n.id, r)} onClose={clearSelection} />;
      }
    }
    if (focus?.t === "edge") { const e = graph.edges.find((x) => x.id === focus.id); if (e) return <EdgePanel edge={e} nodes={graph.nodes} canWrite={editable} onSave={(l) => saveEdge(e, l)} onDelete={() => askDelete([], [e.id])} onSelect={setFocus} onClose={clearSelection} />; }
    if (focus?.t === "finding") { const f = (findings.data ?? []).find((x) => x.id === focus.id); if (f) return <FindingPanel campaignId={c.id} finding={f} backLabel={backTo.label} onBack={backTo.go} onSelect={setFocus} onClose={clearSelection} />; }
    if (focus?.t === "req") {
      const r = allRequirements.find((x) => x.id === focus.id);
      if (r) return <RequirementPanel campaignId={c.id} requirement={r} check={model.checkOf.get(r.id) ?? null} steps={graph.links.filter((l) => l.requirement_id === r.id).map((l) => byId.get(l.node_id)).filter((n): n is GraphNode => Boolean(n))} backLabel={backTo.label} onBack={backTo.go} onSelect={(f) => { setFocus(f); if (f.t === "node") { selectNodes([f.id]); } }} onClose={clearSelection} />;
    }
    return <Inspector {...common} screen={null} />;
  })();

  const drawerTitle = focus?.t === "node" ? nodeName(byId.get(focus.id)) : focus?.t === "edge" ? "Connection" : focus?.t === "finding" ? "Finding" : "Requirement";
  const topRow = React.useMemo(() => { const y = Math.min(...graph.nodes.map((n) => n.pos_y)); return graph.nodes.filter((n) => n.kind === "start" || n.kind === "end" || n.pos_y <= y + 60).map((n) => ({ id: n.id })); }, [graph.nodes]);
  const empty = !graph.nodes.length;

  // The first view shows the main flow at a readable size. Done once the nodes are measured, so it is right whatever the window size.
  const measured = useNodesInitialized();
  const fitted = React.useRef(false);
  React.useEffect(() => {
    if (!measured || fitted.current || empty) return;
    fitted.current = true;
    const narrow = (areaRef.current?.clientWidth ?? 1000) < 700;
    void rf.fitView({ padding: 0.18, minZoom: narrow ? 0.12 : 0.4, maxZoom: 1, nodes: topRow });
  }, [measured, empty, topRow, rf]);

  return (
    <GraphCtx.Provider value={ctx}>
      {waiting && <p className="mx-3 mt-2 rounded-box border border-line bg-side px-3 py-2 text-sm text-text-2">Claude can’t start yet: the connector isn’t running on this PC. Run <span className="font-mono text-xs">npm run claude</span> in the project folder and the checks begin by themselves.</p>}
      <div ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col bg-bg outline-none" data-testid="journey-canvas">
        <div className="flex min-h-0 flex-1"
          onDragOver={(e) => { if (canSubmit && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { setOver(false); if (!canSubmit) return; e.preventDefault(); const f = Array.from(e.dataTransfer.files); if (f.length) setUploadFiles(f); }}>
          <div ref={areaRef} className={cn("relative min-w-0 flex-1", over && "cos-drop-active")}>
            {empty && !graph.loading ? (
              <>
                <div className="absolute left-3 top-3 z-10">{selector}</div>
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <ImagePlus className="size-8 text-muted" />
                  <p className="text-sm font-medium">No screens in “{journeyName}” yet</p>
                  <p className="max-w-sm text-sm text-text-2">Drop the design screens here (PNG, JPG, WEBP or PDF). They appear in flow order, and Claude’s findings are pinned on them.</p>
                  {canSubmit && <Button variant="primary" onClick={() => setUploadFiles([])}><ImagePlus />Submit designs</Button>}
                </div>
              </>
            ) : !empty && (
              <ReactFlow key={journeyKey} className="cos-flow" nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={isDark() ? "dark" : "light"}
                minZoom={0.15} maxZoom={1.6} proOptions={{ hideAttribution: true }}
                deleteKeyCode={null} connectionMode={ConnectionMode.Loose} connectionRadius={36} snapToGrid snapGrid={[12, 12]}
                nodesDraggable={editable} nodesConnectable={editable} edgesReconnectable={false} elevateEdgesOnSelect
                isValidConnection={(cn) => validateConnection(graph.nodes, graph.edges, cn.source, cn.target) === null}
                onConnect={(cn) => void onConnect(cn)} onSelectionChange={onSelectionChange}
                onNodeClick={(ev, n) => { if (!ev.shiftKey && !ev.metaKey && !ev.ctrlKey) setFocus({ t: "node", id: n.id }); }}
                onEdgeClick={(ev, e) => { if (!ev.shiftKey && !ev.metaKey && !ev.ctrlKey) setFocus({ t: "edge", id: e.id }); }}
                onPaneClick={() => { setFocus(null); rootRef.current?.focus(); }}
                onNodeDragStop={(_, __, moved) => onDragStop(moved)}>
                <Background gap={22} size={1.2} color="rgb(var(--line))" />
                <Panel position="top-left"><div className="flex flex-wrap items-center gap-1.5">{selector}{editable && <AddMenu onAdd={(k) => void addStep(k)} />}{!canSubmit && <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted">View only</span>}</div></Panel>
                <Panel position="top-right" className="!hidden md:!block"><CanvasTools rootRef={rootRef} minimap={{ on: minimap, toggle: toggleMinimap }} /></Panel>
                <Panel position="bottom-right" className="md:!hidden"><CanvasTools rootRef={rootRef} /></Panel>
                {minimap && <MiniMap pannable zoomable ariaLabel="Overview of the journey" className="!hidden md:!block" maskColor="rgb(var(--bg) / 0.7)" />}
                {editable && resolved.unplaced.length > 0 && (
                  <Panel position="bottom-left">
                    <div className="w-[260px] rounded-box border border-line-strong bg-surface p-2.5 shadow-sm" data-testid="new-screens">
                      <p className="flex items-center gap-1.5 text-sm font-medium"><Layers className="size-4 text-muted" />New screens ({resolved.unplaced.length})</p>
                      <p className="mt-0.5 text-xs text-muted">In the latest designs but not on the canvas yet. Connect them to the flow once they are in.</p>
                      <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto">{resolved.unplaced.map((a) => (
                        <li key={a.id} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{a.screen_name}</span><button className="shrink-0 text-xs text-accent hover:underline" onClick={() => void addScreens([a])}>Add</button></li>
                      ))}</ul>
                      {resolved.unplaced.length > 1 && <Button size="sm" className="mt-1.5" onClick={() => void addScreens(resolved.unplaced)}>Add all</Button>}
                    </div>
                  </Panel>
                )}
              </ReactFlow>
            )}
          </div>
          {wide && <aside className="w-[400px] shrink-0 border-l border-line bg-bg" aria-label="Inspector">{inspector}</aside>}
        </div>
        <JourneyDock campaign={c} model={model} onSelectScreen={(assetId) => {
          const n = graph.nodes.find((x) => resolved.forNode.get(x.id)?.id === assetId);
          if (n) { selectNodes([n.id]); setFocus({ t: "node", id: n.id }); }
        }} />
      </div>
      {!wide && focus && (
        <Drawer open onOpenChange={(o) => !o && clearSelection()} width={440} title={drawerTitle} subtitle={journeyName}>{inspector}</Drawer>
      )}
      <ConfirmDialog open={Boolean(pendingDelete)} onOpenChange={(o) => !o && setPendingDelete(null)} danger loading={deleting} confirmLabel="Delete"
        title={pendingDelete ? (pendingDelete.nodes.length ? `Delete ${pendingDelete.nodes.length === 1 ? `“${nodeName(pendingDelete.nodes[0])}”` : `${pendingDelete.nodes.length} steps`}?` : `Delete ${pendingDelete.edges.length === 1 ? "this connection" : `${pendingDelete.edges.length} connections`}?`) : ""}
        onConfirm={() => void confirmDelete()}
        body={pendingDelete && (
          <div className="space-y-2">
            {pendingDelete.nodes.length > 0 && <p>This removes {pendingDelete.nodes.length === 1 ? "the step" : "the steps"} and every connection to {pendingDelete.nodes.length === 1 ? "it" : "them"} from the canvas. Findings and requirements are not deleted.</p>}
            {pendingDelete.nodes.some((n) => n.kind === "screen") && <p>A screen's design stays in Designs; it goes back to the “New screens” list.</p>}
            {pendingDelete.nodes.length === 0 && <p>The two steps stay where they are.</p>}
          </div>
        )} />
      {viewer && <ScreenFindings campaignId={c.id} sub={viewer.sub} index={viewer.index} onIndex={(i) => setViewer({ ...viewer, index: i })} onClose={() => setViewer(null)} />}
      {uploadFiles && <UploadDialog campaign={c} defaultJourney={journeyId} initialFiles={uploadFiles.length ? uploadFiles : undefined} onClose={() => setUploadFiles(null)} />}
      {addingBuild && <SubmissionDialog campaign={c} defaultJourney={journeyId} onClose={() => setAddingBuild(false)} />}
    </GraphCtx.Provider>
  );
}
