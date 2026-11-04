import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Background, Controls, Handle, Position, ReactFlow, useNodesState, useStore, type Edge, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./canvas.css";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui";
import { StatusDot } from "@/components/common";
import { useAuth } from "@/lib/auth";
import { qk, useConnectorStatus } from "@/hooks/queries";
import { SUBMISSION_STATUS_LABEL } from "@/lib/labels";
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
import { ScreenFindings } from "./ScreenFindings";
import { setAssistantHint } from "./assistantHint";
import { buildJourneyModel, layoutScreens, NODE_W, UNASSIGNED, type JourneyModel, type ScreenModel } from "./journeyModel";

type Ctx = { model: JourneyModel; selected: string | null };
const JourneyCtx = React.createContext<Ctx | null>(null);
const useJourney = () => { const v = React.useContext(JourneyCtx); if (!v) throw new Error("outside journey canvas"); return v; };

const TONE_BG: Record<string, string> = { red: "bg-st-red", amber: "bg-st-amber", green: "bg-st-green", blue: "bg-st-blue", gray: "bg-st-gray", violet: "bg-st-violet" };

/** One design screen. Zoomed out it is a compact tile; zoomed in it shows the status strip. */
function ScreenNode({ data }: NodeProps<Node<{ id: string }>>) {
  const { model, selected } = useJourney();
  const zoom = useStore((s) => s.transform[2]);
  const s = model.screens.find((x) => x.asset.id === data.id);
  if (!s) return null;
  const compact = zoom < 0.3; // only when really zoomed out; at the normal fit the status strip is still readable
  const on = selected === s.asset.id;
  return (
    <div className={cn("rounded-box border bg-surface shadow-sm transition-shadow", on ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-line-strong")} style={{ width: NODE_W }} data-testid={`screen-${s.index}`}>
      <Handle id="l" type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-line-strong" />
      <Handle id="t" type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-line-strong" />
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <span className={cn("size-2 shrink-0 rounded-full", TONE_BG[s.tone])} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{String(s.index + 1).padStart(2, "0")} · {s.asset.screen_name}</span>
        {s.kind === "state" && <span className="rounded bg-hover px-1 text-[10px] text-muted">{s.asset.screen_type}</span>}
      </div>
      <div className="relative">
        <AssetImage bucket={s.asset.bucket} path={s.asset.storage_path} alt={s.asset.screen_name} className={cn("w-full", compact ? "h-[250px]" : "h-[210px]")} />
        {s.open.length > 0 && <span className="absolute right-1.5 top-1.5 rounded-full bg-st-red px-1.5 text-[11px] font-semibold text-white num">{s.open.length}</span>}
      </div>
      {compact ? (
        <p className="px-2.5 py-2 text-sm font-medium">{s.label}</p>
      ) : (
        <div className="space-y-0.5 px-2.5 py-2 text-xs">
          <StatusDot tone={s.tone} label={s.label} className="text-sm font-medium" />
          <p className="text-muted">Design {model.submission ? `v${model.submission.version_no} · ${SUBMISSION_STATUS_LABEL[model.submission.status]}` : "—"}</p>
          <p className="text-muted">Built: {s.built}</p>
          {model.tests.failed > 0 && <p className="text-st-red">Tests: {model.tests.failed} failed in this journey</p>}
        </div>
      )}
      <Handle id="r" type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-line-strong" />
      <Handle id="b" type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-line-strong" />
    </div>
  );
}
const nodeTypes: NodeTypes = { screen: ScreenNode };

const posKey = (campaign: string, key: string) => `campaignos-journey-${campaign}-${key}`;
function readPos(campaign: string, key: string): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem(posKey(campaign, key)) ?? "{}") as Record<string, { x: number; y: number }>; } catch { return {}; }
}
const isDark = () => document.documentElement.classList.contains("dark");

/** The journey's own canvas: its screens in flow order, with the inspector on the right. */
export function JourneyCanvas({ campaign: c, journeyKey, journeyName }: { campaign: CampaignWithRelations; journeyKey: string; journeyName: string }) {
  const { canEdit, me } = useAuth();
  const canSubmit = canEdit || (me?.role === "team_member" && c.campaign_members.some((m) => m.user_id === me.id));
  const connector = useConnectorStatus().data;

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
    return model.screens.map((s) => ({ id: s.asset.id, type: "screen", position: saved[s.asset.id] ?? layout.positions[s.asset.id] ?? { x: 0, y: 0 }, data: { id: s.asset.id } }));
  }, [model.screens, layout, c.id, journeyKey]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initial);
  React.useEffect(() => setNodes(initial), [initial, setNodes]);
  const edges = React.useMemo<Edge[]>(() => layout.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, sourceHandle: e.kind === "flow" ? "r" : "b", targetHandle: e.kind === "flow" ? "l" : "t",
    animated: model.working.design, type: "smoothstep", style: e.kind === "state" ? { strokeDasharray: "5 4" } : undefined,
  })), [layout.edges, model.working.design]);

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
      {waiting && <p className="mb-2 rounded-box border border-line bg-side px-3 py-2 text-sm text-text-2">Claude can’t start yet: the connector isn’t running on this PC. Run <span className="font-mono text-xs">npm run claude</span> in the project folder and the checks begin by themselves.</p>}
      <div className="flex h-[calc(100vh-250px)] min-h-[520px] overflow-hidden rounded-box border border-line" data-testid="journey-canvas"
        onDragOver={(e) => { if (canSubmit && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { setOver(false); if (!canSubmit) return; e.preventDefault(); const f = Array.from(e.dataTransfer.files); if (f.length) setUploadFiles(f); }}>
        <div className={cn("relative min-w-0 flex-1", over && "cos-drop-active")}>
          {!model.screens.length ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <ImagePlus className="size-8 text-muted" />
              <p className="text-sm font-medium">No screens in “{journeyName}” yet</p>
              <p className="max-w-sm text-sm text-text-2">Drop the design screens here (PNG, JPG, WEBP or PDF). They appear in flow order, and Claude’s findings are pinned on them.</p>
              {canSubmit && <Button variant="primary" onClick={() => setUploadFiles([])}><ImagePlus />Submit designs</Button>}
            </div>
          ) : (
            <ReactFlow key={`${journeyKey}-${model.screens.length}`} className="cos-flow" nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={isDark() ? "dark" : "light"}
              fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.15} maxZoom={1.6} nodesConnectable={false} deleteKeyCode={null} proOptions={{ hideAttribution: true }}
              onNodeClick={(_, n) => select(n.id)} onPaneClick={() => select(null)}
              onNodeDragStop={(_, __, all) => { try { localStorage.setItem(posKey(c.id, journeyKey), JSON.stringify(Object.fromEntries(all.map((n) => [n.id, n.position])))); } catch { /* layout is only a convenience */ } }}>
              <Background gap={24} size={1} color="rgb(var(--line))" />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
        <aside className="hidden w-[400px] shrink-0 border-l border-line bg-bg lg:block" aria-label="Inspector">
          <Inspector campaign={c} model={model} journeyName={journeyName} screen={picked} onClose={() => select(null)}
            onOpenViewer={(i) => model.submission && setViewer({ sub: model.submission, index: i })} onSubmitDesigns={() => setUploadFiles([])} onAddBuild={() => setAddingBuild(true)} />
        </aside>
      </div>
      {viewer && <ScreenFindings campaignId={c.id} sub={viewer.sub} index={viewer.index} onIndex={(i) => setViewer({ ...viewer, index: i })} onClose={() => setViewer(null)} />}
      {uploadFiles && <UploadDialog campaign={c} defaultJourney={journeyId} initialFiles={uploadFiles.length ? uploadFiles : undefined} onClose={() => setUploadFiles(null)} />}
      {addingBuild && <SubmissionDialog campaign={c} defaultJourney={journeyId} onClose={() => setAddingBuild(false)} />}
    </JourneyCtx.Provider>
  );
}
