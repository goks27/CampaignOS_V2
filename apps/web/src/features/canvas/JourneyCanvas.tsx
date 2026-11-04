import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Background, Handle, Panel, Position, ReactFlow, useNodesState, useStore, type Edge, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./canvas.css";
import { ImagePlus } from "lucide-react";
import { Button, Drawer } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { qk, useConnectorStatus } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import type { CampaignWithRelations } from "@/services/campaigns";
import { designsService, type DesignSubmission } from "@/services/designs";
import { developmentService } from "@/services/development";
import { findingsService } from "@/services/findings";
import { jobsService } from "@/services/jobs";
import { requirementsService } from "@/services/requirements";
import { tasksService } from "@/services/tasks";
import { AssetImage } from "@/features/shared/AssetImage";
import { UploadDialog } from "@/features/campaigns/tabs/DesignsTab";
import { SubmissionDialog } from "@/features/campaigns/tabs/DevelopmentTab";
import { Inspector } from "./Inspector";
import { JourneyDock } from "./JourneyDock";
import { Bookend, CanvasTools } from "./CanvasControls";
import { ScreenFindings } from "./ScreenFindings";
import { setAssistantHint } from "./assistantHint";
import { buildJourneyModel, END_ID, FRAME_MID, layoutScreens, NODE_W, START_ID, UNASSIGNED, type JourneyModel, type ScreenModel } from "./journeyModel";

type Ctx = { model: JourneyModel; selected: string | null };
const JourneyCtx = React.createContext<Ctx | null>(null);
const useJourney = () => { const v = React.useContext(JourneyCtx); if (!v) throw new Error("outside journey canvas"); return v; };

const CHIP: Record<string, string> = { red: "bg-st-red/15 text-st-red", amber: "bg-st-amber/15 text-st-amber", green: "bg-st-green/15 text-st-green", blue: "bg-st-blue/15 text-st-blue", gray: "bg-st-gray/15 text-text-2", violet: "bg-st-violet/15 text-st-violet" };

/** A design screen as a phone frame with its name and status underneath. Selected screens glow. */
function ScreenNode({ data }: NodeProps<Node<{ id: string }>>) {
  const { model, selected } = useJourney();
  const s = model.screens.find((x) => x.asset.id === data.id);
  const zoom = useStore((st) => st.transform[2]);
  if (!s) return null;
  const on = selected === s.asset.id;
  return (
    <div className="flex flex-col items-center" style={{ width: NODE_W }} data-testid={`screen-${s.index}`}>
      <Handle id="l" type="target" position={Position.Left} style={{ top: FRAME_MID }} className="!size-1.5 !border-0 !bg-line-strong" />
      <Handle id="t" type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-line-strong" />
      <div className={cn("relative h-[280px] w-[158px] overflow-hidden rounded-[22px] border-2 bg-side transition-shadow",
        on ? "border-accent shadow-[0_0_0_5px_rgb(var(--accent)/0.22),0_8px_30px_rgb(var(--accent)/0.25)]" : "border-line-strong hover:border-text-2")}>
        <AssetImage bucket={s.asset.bucket} path={s.asset.storage_path} alt={s.asset.screen_name} className="h-full w-full" imgClassName="object-cover object-top" />
        {s.open.length > 0 && <span className="absolute right-2 top-2 rounded-full bg-st-red px-1.5 text-[11px] font-semibold text-white num">{s.open.length}</span>}
      </div>
      <p className={cn("mt-2 max-w-full truncate text-center font-medium", zoom < 0.5 ? "text-base" : "text-sm")}>{s.asset.screen_name}</p>
      <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", CHIP[s.tone])}>{s.label}</span>
      {s.kind === "state" && <span className="mt-1 text-[11px] text-muted">{s.asset.screen_type}</span>}
      <Handle id="r" type="source" position={Position.Right} style={{ top: FRAME_MID }} className="!size-1.5 !border-0 !bg-line-strong" />
      <Handle id="b" type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-line-strong" />
    </div>
  );
}

function BookendNode({ data }: NodeProps<Node<{ kind: "start" | "end" }>>) {
  return (
    <div>
      <Handle id="l" type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-line-strong" />
      <Bookend kind={data.kind} />
      <Handle id="r" type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-line-strong" />
    </div>
  );
}
const nodeTypes: NodeTypes = { screen: ScreenNode, bookend: BookendNode };

const posKey = (campaign: string, key: string) => `campaignos-journey-${campaign}-${key}`;
function readPos(campaign: string, key: string): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem(posKey(campaign, key)) ?? "{}") as Record<string, { x: number; y: number }>; } catch { return {}; }
}
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

/** The journey's own canvas: its screens in flow order, the inspector on the right and the dock underneath. */
export function JourneyCanvas({ campaign: c, journeyKey, journeyName, selector }: { campaign: CampaignWithRelations; journeyKey: string; journeyName: string; selector: React.ReactNode }) {
  const { canEdit, me } = useAuth();
  const canSubmit = canEdit || (me?.role === "team_member" && c.campaign_members.some((m) => m.user_id === me.id));
  const connector = useConnectorStatus().data;
  const wide = useWide();
  const rootRef = React.useRef<HTMLDivElement>(null);

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

  const [selected, setSelected] = React.useState<string | null>(null);
  const [viewer, setViewer] = React.useState<{ sub: DesignSubmission; index: number } | null>(null);
  const [uploadFiles, setUploadFiles] = React.useState<File[] | null>(null);
  const [addingBuild, setAddingBuild] = React.useState(false);
  const [over, setOver] = React.useState(false);
  React.useEffect(() => { setSelected(null); }, [journeyKey]);
  React.useEffect(() => () => setAssistantHint(null), []);

  const layout = React.useMemo(() => layoutScreens(model.screens), [model.screens]);
  const initial = React.useMemo<Node[]>(() => {
    const saved = readPos(c.id, journeyKey);
    const screens: Node[] = model.screens.map((s) => ({ id: s.asset.id, type: "screen", position: saved[s.asset.id] ?? layout.positions[s.asset.id] ?? { x: 0, y: 0 }, data: { id: s.asset.id } }));
    const ends: Node[] = layout.bookends ? [
      { id: START_ID, type: "bookend", position: layout.bookends.start, data: { kind: "start" }, draggable: false, selectable: false },
      { id: END_ID, type: "bookend", position: layout.bookends.end, data: { kind: "end" }, draggable: false, selectable: false },
    ] : [];
    return [...ends, ...screens];
  }, [model.screens, layout, c.id, journeyKey]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initial);
  React.useEffect(() => setNodes(initial), [initial, setNodes]);
  const edges = React.useMemo<Edge[]>(() => [...layout.edges, ...(layout.bookends?.edges ?? [])].map((e) => ({
    id: e.id, source: e.source, target: e.target, sourceHandle: e.kind === "flow" ? "r" : "b", targetHandle: e.kind === "flow" ? "l" : "t",
    animated: model.working.design, type: "smoothstep", style: e.kind === "state" ? { strokeDasharray: "5 4" } : undefined,
  })), [layout, model.working.design]);

  // The first view shows the main flow at a readable size; error and success states sit below it and are one pan away.
  const mainFlow = React.useMemo(() => [START_ID, END_ID, ...model.screens.filter((s) => s.kind === "main" || s.parent < 0).map((s) => s.asset.id)].map((id) => ({ id })), [model.screens]);
  const picked: ScreenModel | null = model.screens.find((s) => s.asset.id === selected) ?? null;
  const select = (id: string | null) => {
    setSelected(id);
    const s = model.screens.find((x) => x.asset.id === id);
    setAssistantHint(s ? { campaignId: c.id, node: `${journeyName} / ${s.asset.screen_name}`, label: `Screen "${s.asset.screen_name}" in journey "${journeyName}"` } : null);
  };
  const waiting = (model.working.design || model.working.build) && !connector;
  const journeyId = journeyKey === UNASSIGNED ? "" : journeyKey;

  return (
    <JourneyCtx.Provider value={{ model, selected }}>
      {waiting && <p className="mx-3 mt-2 rounded-box border border-line bg-side px-3 py-2 text-sm text-text-2">Claude can’t start yet: the connector isn’t running on this PC. Run <span className="font-mono text-xs">npm run claude</span> in the project folder and the checks begin by themselves.</p>}
      <div ref={rootRef} className="flex min-h-0 flex-1 flex-col bg-bg" data-testid="journey-canvas">
        <div className="flex min-h-0 flex-1"
          onDragOver={(e) => { if (canSubmit && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { setOver(false); if (!canSubmit) return; e.preventDefault(); const f = Array.from(e.dataTransfer.files); if (f.length) setUploadFiles(f); }}>
          <div className={cn("relative min-w-0 flex-1", over && "cos-drop-active")}>
            {!model.screens.length ? (
              <>
                <div className="absolute left-3 top-3 z-10">{selector}</div>
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <ImagePlus className="size-8 text-muted" />
                  <p className="text-sm font-medium">No screens in “{journeyName}” yet</p>
                  <p className="max-w-sm text-sm text-text-2">Drop the design screens here (PNG, JPG, WEBP or PDF). They appear in flow order, and Claude’s findings are pinned on them.</p>
                  {canSubmit && <Button variant="primary" onClick={() => setUploadFiles([])}><ImagePlus />Submit designs</Button>}
                </div>
              </>
            ) : (
              <ReactFlow key={`${journeyKey}-${model.screens.length}`} className="cos-flow" nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={isDark() ? "dark" : "light"}
                fitView fitViewOptions={{ padding: 0.18, minZoom: 0.4, maxZoom: 1, nodes: mainFlow }} minZoom={0.15} maxZoom={1.6} nodesConnectable={false} deleteKeyCode={null} proOptions={{ hideAttribution: true }}
                onNodeClick={(_, n) => { if (n.type === "screen") select(n.id); }} onPaneClick={() => select(null)}
                onNodeDragStop={(_, __, all) => { try { localStorage.setItem(posKey(c.id, journeyKey), JSON.stringify(Object.fromEntries(all.filter((n) => n.type === "screen").map((n) => [n.id, n.position])))); } catch { /* layout is only a convenience */ } }}>
                <Background gap={22} size={1.2} color="rgb(var(--line))" />
                <Panel position="top-left">{selector}</Panel>
                <Panel position="top-right"><CanvasTools rootRef={rootRef} /></Panel>
              </ReactFlow>
            )}
          </div>
          {wide && <aside className="w-[400px] shrink-0 border-l border-line bg-bg" aria-label="Inspector">
            <Inspector campaign={c} model={model} journeyName={journeyName} screen={picked} onClose={() => select(null)}
              onOpenViewer={(i) => model.submission && setViewer({ sub: model.submission, index: i })} onSubmitDesigns={() => setUploadFiles([])} onAddBuild={() => setAddingBuild(true)} />
          </aside>}
        </div>
        <JourneyDock campaign={c} model={model} onSelectScreen={(id) => select(id)} />
      </div>
      {!wide && picked && (
        <Drawer open onOpenChange={(o) => !o && select(null)} width={440} title={picked.asset.screen_name} subtitle={journeyName}>
          <Inspector campaign={c} model={model} journeyName={journeyName} screen={picked} onClose={() => select(null)}
            onOpenViewer={(i) => model.submission && setViewer({ sub: model.submission, index: i })} onSubmitDesigns={() => setUploadFiles([])} onAddBuild={() => setAddingBuild(true)} />
        </Drawer>
      )}
      {viewer && <ScreenFindings campaignId={c.id} sub={viewer.sub} index={viewer.index} onIndex={(i) => setViewer({ ...viewer, index: i })} onClose={() => setViewer(null)} />}
      {uploadFiles && <UploadDialog campaign={c} defaultJourney={journeyId} initialFiles={uploadFiles.length ? uploadFiles : undefined} onClose={() => setUploadFiles(null)} />}
      {addingBuild && <SubmissionDialog campaign={c} defaultJourney={journeyId} onClose={() => setAddingBuild(false)} />}
    </JourneyCtx.Provider>
  );
}
