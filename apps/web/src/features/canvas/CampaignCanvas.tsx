import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Background, Controls, Handle, Position, ReactFlow, useNodesState,
  type Edge, type Node, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./canvas.css";
import { CheckSquare, FileText, FileUp, Globe, ImagePlus, ListChecks, ScanSearch, Sparkles } from "lucide-react";
import { Button, Dialog, DialogContent, Drawer } from "@/components/ui";
import { Pill, StatusDot } from "@/components/common";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth";
import { useAction } from "@/hooks/useAction";
import { qk, useConnectorStatus } from "@/hooks/queries";
import { SUBMISSION_STATUS_LABEL, SUBMISSION_STATUS_TONE } from "@/lib/labels";
import { cn, timeAgo } from "@/lib/utils";
import type { CampaignWithRelations } from "@/services/campaigns";
import { sowService, requirementsService, type SowDocument } from "@/services/requirements";
import { designsService, type DesignSubmission } from "@/services/designs";
import { developmentService } from "@/services/development";
import { findingsService } from "@/services/findings";
import { jobsService } from "@/services/jobs";
import { tasksService } from "@/services/tasks";
import { validateFile } from "@/services/storage";
import { RunReviewButton } from "@/features/shared/RunReview";
import { AssetImage } from "@/features/shared/AssetImage";
import { RequirementsTab } from "@/features/campaigns/tabs/RequirementsTab";
import { DesignsTab, UploadDialog } from "@/features/campaigns/tabs/DesignsTab";
import { DevelopmentTab, SubmissionDialog } from "@/features/campaigns/tabs/DevelopmentTab";
import { AiReviewsTab } from "@/features/campaigns/tabs/AiReviewsTab";
import { CampaignTasksTab } from "@/features/campaigns/tabs/CampaignTasksTab";
import { ScreenFindings } from "./ScreenFindings";
import { setAssistantHint } from "./assistantHint";
import { summarise, type Summary } from "./summary";

type Panel = "requirements" | "designs" | "development" | "ai-reviews" | "tasks";
const PANEL_TITLE: Record<Panel, string> = { requirements: "Requirements", designs: "Designs", development: "Development", "ai-reviews": "Findings and reviews", tasks: "Tasks" };

type Ctx = {
  c: CampaignWithRelations; s: Summary; canEdit: boolean; canSubmit: boolean;
  openPanel: (p: Panel) => void; openScreen: (sub: DesignSubmission, i: number) => void;
  dropSow: (files: File[]) => void; dropDesigns: (files: File[]) => void; addBuild: () => void; busySow: boolean;
};
const CanvasCtx = React.createContext<Ctx | null>(null);
const useCanvas = () => { const v = React.useContext(CanvasCtx); if (!v) throw new Error("outside canvas"); return v; };

const EXTRACTION_LABEL: Record<string, string> = { uploaded: "Not analysed", queued: "Queued", processing: "Analysing", extracted: "Analysed", failed: "Failed" };

// ---------------------------------------------------------------- card shell
function CardShell({ title, icon: Icon, status, working, children, footer, onOpen, onFiles, dropHint }: {
  title: string; icon: React.ComponentType<{ className?: string }>; status?: React.ReactNode; working?: boolean;
  children: React.ReactNode; footer?: React.ReactNode; onOpen?: () => void; onFiles?: (files: File[]) => void; dropHint?: string;
}) {
  const [over, setOver] = React.useState(false);
  return (
    <div className={cn("w-[320px] rounded-box border bg-surface shadow-sm transition-colors", over ? "cos-drop-active border-accent" : "border-line")}
      onDragOver={(e) => { if (onFiles && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (!onFiles) return; e.preventDefault(); setOver(false); const f = Array.from(e.dataTransfer.files); if (f.length) onFiles(f); }}>
      <Handle id="l" type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-line-strong" />
      <Handle id="t" type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-line-strong" />
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Icon className="size-4 text-muted" />
        <button className="nodrag min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-accent" onClick={onOpen} disabled={!onOpen}>{title}</button>
        {status}
      </div>
      <div className="px-3 py-2.5 text-sm">
        {children}
        {over && dropHint && <p className="mt-2 text-xs font-medium text-accent">{dropHint}</p>}
        {working && <p className="mt-2 flex items-center gap-1.5 text-xs text-accent"><Sparkles className="size-3.5 animate-pulse" />Claude is working on this…</p>}
      </div>
      {footer && <div className="nodrag nopan flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">{footer}</div>}
      <Handle id="r" type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-line-strong" />
      <Handle id="b" type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-line-strong" />
    </div>
  );
}

// ---------------------------------------------------------------- cards
function SowNode() {
  const { c, s, canEdit, openPanel, dropSow, busySow } = useCanvas();
  const latest = s.sow.latest;
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <CardShell title="SOW" icon={FileText} working={s.sow.working} onOpen={() => openPanel("requirements")} onFiles={canEdit ? dropSow : undefined} dropHint="Drop to upload the SOW"
      status={latest && <StatusDot tone={latest.version.extraction_status === "failed" ? "red" : latest.version.extraction_status === "extracted" ? "green" : "blue"} label={EXTRACTION_LABEL[latest.version.extraction_status] ?? latest.version.extraction_status} className="text-xs" />}
      footer={canEdit && <>
        <input ref={input} type="file" className="hidden" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) dropSow(f); }} />
        <Button size="sm" loading={busySow} onClick={() => input.current?.click()}><FileUp />{latest ? "New file" : "Upload SOW"}</Button>
        {latest && !s.sow.working && <RunReviewButton size="sm" variant={latest.version.extraction_status === "extracted" ? "ghost" : "primary"} campaignId={c.id} reviewType="sow_analysis"
          source={{ sow_version_id: latest.version.id }} label={latest.version.extraction_status === "extracted" ? "Analyse again" : "Analyse"} />}
      </>}>
      {latest ? (
        <>
          <p className="truncate font-medium" title={latest.version.file_name}>{latest.version.file_name}</p>
          <p className="text-xs text-muted">v{latest.version.version_no}{latest.version.page_count ? ` · ${latest.version.page_count} pages` : ""} · {timeAgo(latest.version.created_at)}</p>
          {latest.version.extraction_status === "failed" && <p className="mt-1 text-xs text-st-red">The analysis failed. Upload the SOW again or analyse it again.</p>}
        </>
      ) : <p className="text-text-2">Drop the client’s SOW here: PDF, Word, Excel, PowerPoint, text or an image. Claude reads it and drafts the requirements.</p>}
    </CardShell>
  );
}

function RequirementsNode() {
  const { s, openPanel } = useCanvas();
  const r = s.reqs;
  return (
    <CardShell title="Requirements" icon={ListChecks} onOpen={() => openPanel("requirements")}
      status={r.draft > 0 ? <Pill tone="amber">{r.draft} to review</Pill> : r.total ? <Pill tone="green">Reviewed</Pill> : undefined}
      footer={<Button size="sm" variant={r.draft ? "primary" : "secondary"} onClick={() => openPanel("requirements")}>{r.draft ? "Review drafts" : "Open"}</Button>}>
      {r.total ? (
        <>
          <p className="text-2xl font-semibold num">{r.total}</p>
          <p className="text-xs text-text-2">{r.accepted} accepted · {r.draft} draft · {r.clarification} need clarification{r.rejected ? ` · ${r.rejected} rejected` : ""}</p>
          <p className="mt-1 text-xs text-muted">Claude’s requirements are drafts. A manager accepts them.</p>
        </>
      ) : <p className="text-text-2">Draft requirements appear here after Claude reads the SOW.</p>}
    </CardShell>
  );
}

function DesignsNode() {
  const { c, s, canEdit, canSubmit, openPanel, openScreen, dropDesigns } = useCanvas();
  const sub = s.designs.latest;
  const shown = s.designs.screens.slice(0, 6);
  return (
    <CardShell title="Designs" icon={ImagePlus} working={s.designs.working} onOpen={() => openPanel("designs")} onFiles={canSubmit ? dropDesigns : undefined} dropHint="Drop screens to submit them"
      status={sub && <StatusDot tone={SUBMISSION_STATUS_TONE[sub.status]} label={SUBMISSION_STATUS_LABEL[sub.status]} className="text-xs" />}
      footer={<>
        {canSubmit && <Button size="sm" onClick={() => openPanel("designs")}><ImagePlus />{sub ? "Manage" : "Add screens"}</Button>}
        {canEdit && sub && !s.designs.working && <>
          <RunReviewButton size="sm" variant="primary" campaignId={c.id} reviewType="sow_vs_design" source={{ design_submission_id: sub.id }} label="Check vs SOW" />
          <RunReviewButton size="sm" variant="ghost" campaignId={c.id} reviewType="design_consistency" source={{ design_submission_id: sub.id }} label="Consistency" />
        </>}
      </>}>
      {sub ? (
        <>
          <p className="truncate text-xs text-muted">{sub.title} · v{sub.version_no} · {sub.design_assets.length} screen{sub.design_assets.length === 1 ? "" : "s"}</p>
          <div className="nodrag nopan mt-2 grid grid-cols-3 gap-1.5">
            {shown.map(({ asset, findings }, i) => (
              <button key={asset.id} onClick={() => openScreen(sub, i)} title={asset.screen_name} className="relative aspect-[3/4] overflow-hidden rounded border border-line hover:border-accent">
                <AssetImage bucket={asset.bucket} path={asset.storage_path} alt={asset.screen_name} className="h-full w-full" />
                {findings > 0 && <span className="absolute right-1 top-1 rounded-full bg-st-red px-1.5 text-[10px] font-semibold text-white num">{findings}</span>}
              </button>
            ))}
          </div>
          {s.designs.screens.length > shown.length && <p className="mt-1 text-xs text-muted">+{s.designs.screens.length - shown.length} more</p>}
          <p className="mt-1.5 text-xs text-muted">Click a screen to see Claude’s findings pinned on it.</p>
        </>
      ) : <p className="text-text-2">Drop design screens here (PNG, JPG, WEBP or PDF), then press Check.</p>}
    </CardShell>
  );
}

function BuildNode() {
  const { c, s, canEdit, openPanel, addBuild } = useCanvas();
  const b = s.build.latest;
  return (
    <CardShell title="Staging build" icon={Globe} working={s.build.working} onOpen={() => openPanel("development")}
      status={b && <StatusDot tone={SUBMISSION_STATUS_TONE[b.status]} label={SUBMISSION_STATUS_LABEL[b.status]} className="text-xs" />}
      footer={canEdit && <>
        <Button size="sm" variant={b ? "secondary" : "primary"} onClick={addBuild}><Globe />{b ? "New build" : "Add staging URL"}</Button>
        {b && !s.build.working && <>
          <RunReviewButton size="sm" variant="primary" campaignId={c.id} reviewType="site_check" source={{ development_submission_id: b.id }} label="Test now" />
          <RunReviewButton size="sm" variant="ghost" campaignId={c.id} reviewType="design_vs_development" source={{ development_submission_id: b.id }} label="Visual" />
          <RunReviewButton size="sm" variant="ghost" campaignId={c.id} reviewType="functional_qa" source={{ development_submission_id: b.id }} label="Scenarios" />
          <RunReviewButton size="sm" variant="ghost" campaignId={c.id} reviewType="sow_vs_development" source={{ development_submission_id: b.id }} label="SOW" />
        </>}
      </>}>
      {b ? (
        <>
          <p className="font-medium">{b.version_label}</p>
          <p className="truncate text-xs text-muted" title={b.staging_url}>{b.staging_url}</p>
          <p className="mt-1 text-xs text-muted">Claude opens it in a real browser on this PC and looks through the site for errors. Press Test now to run it again.</p>
        </>
      ) : <p className="text-text-2">Add the staging URL. Claude looks through the site on desktop and mobile for broken links, errors and layout problems, and can compare it with the design.</p>}
    </CardShell>
  );
}

function FindingsNode() {
  const { c, s, openPanel } = useCanvas();
  const f = s.findings;
  return (
    <CardShell title="Findings" icon={ScanSearch} onOpen={() => openPanel("ai-reviews")}
      status={f.awaitingReview > 0 ? <Pill tone="amber">{f.awaitingReview} to review</Pill> : f.total ? <Pill tone="green">Reviewed</Pill> : undefined}
      footer={<Button asChild size="sm" variant={f.awaitingReview ? "primary" : "secondary"}><Link to={`/reviews?campaign=${c.id}`}>Open inbox</Link></Button>}>
      {f.total ? (
        <>
          <p className="text-2xl font-semibold num">{f.total}</p>
          <p className="text-xs text-text-2">{f.critical} critical · {f.high} high open · {f.byStatus.dismissed ?? 0} dismissed</p>
          <p className="mt-1 text-xs text-muted">Claude suggests; a manager accepts or dismisses each one.</p>
        </>
      ) : <p className="text-text-2">Claude’s findings from the design and build checks collect here.</p>}
    </CardShell>
  );
}

function TasksNode() {
  const { s, openPanel } = useCanvas();
  const t = s.tasks;
  return (
    <CardShell title="Tasks" icon={CheckSquare} onOpen={() => openPanel("tasks")}
      status={t.overdue > 0 ? <Pill tone="red">{t.overdue} overdue</Pill> : undefined}
      footer={<Button size="sm" onClick={() => openPanel("tasks")}>Open tasks</Button>}>
      {t.total ? (
        <>
          <p className="text-2xl font-semibold num">{t.open}</p>
          <p className="text-xs text-text-2">open · {t.done} done</p>
        </>
      ) : <p className="text-text-2">Accepted findings become tasks for the team.</p>}
    </CardShell>
  );
}

const nodeTypes: NodeTypes = { sow: SowNode, requirements: RequirementsNode, designs: DesignsNode, build: BuildNode, findings: FindingsNode, tasks: TasksNode };

const HOME: Record<string, { x: number; y: number }> = {
  sow: { x: 0, y: 0 }, requirements: { x: 390, y: 0 }, designs: { x: 780, y: 0 }, build: { x: 1170, y: 0 }, findings: { x: 975, y: 520 }, tasks: { x: 1365, y: 520 },
};
const posKey = (id: string) => `campaignos-canvas-${id}`;
function readPositions(id: string): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem(posKey(id)) ?? "{}") as Record<string, { x: number; y: number }>; } catch { return {}; }
}
function writePositions(id: string, p: Record<string, { x: number; y: number }>) {
  try { localStorage.setItem(posKey(id), JSON.stringify(p)); } catch { /* layout is only a convenience */ }
}
const isDark = () => document.documentElement.classList.contains("dark");
function useDark() {
  const [dark, setDark] = React.useState(isDark);
  React.useEffect(() => {
    const o = new MutationObserver(() => setDark(isDark()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);
  return dark;
}

// ---------------------------------------------------------------- the canvas
export function PipelineCanvas({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit, me } = useAuth();
  const canSubmit = canEdit || (me?.role === "team_member" && c.campaign_members.some((m) => m.user_id === me.id));
  const toast = useToast();
  const connector = useConnectorStatus().data;
  const dark = useDark();

  const sow = useQuery({ queryKey: qk.sow(c.id), queryFn: () => sowService.list(c.id), refetchInterval: 15_000 });
  const reqs = useQuery({ queryKey: qk.requirements(c.id), queryFn: () => requirementsService.list(c.id) });
  const designs = useQuery({ queryKey: qk.designs(c.id), queryFn: () => designsService.list(c.id) });
  const builds = useQuery({ queryKey: [...qk.dev(c.id), "subs"], queryFn: () => developmentService.submissions(c.id) });
  const findings = useQuery({ queryKey: ["findings", "canvas", c.id], queryFn: () => findingsService.list({ campaignId: c.id }), refetchInterval: 20_000 });
  const tasks = useQuery({ queryKey: ["tasks", "canvas", c.id], queryFn: () => tasksService.list({ campaignId: c.id }) });
  const jobs = useQuery({ queryKey: ["jobs", "canvas", c.id], queryFn: () => jobsService.list({ campaignId: c.id, limit: 30 }), refetchInterval: 8_000 });

  const s = React.useMemo(() => summarise({
    sow: sow.data ?? [], requirements: reqs.data ?? [], designs: designs.data ?? [], builds: builds.data ?? [],
    findings: findings.data ?? [], tasks: tasks.data ?? [], jobs: (jobs.data ?? []).map((j) => ({ review_type: j.review_type, status: j.status })),
  }), [sow.data, reqs.data, designs.data, builds.data, findings.data, tasks.data, jobs.data]);

  const [panel, setPanel] = React.useState<Panel | null>(null);
  const [screen, setScreen] = React.useState<{ sub: DesignSubmission; index: number } | null>(null);
  const [designFiles, setDesignFiles] = React.useState<File[] | null>(null);
  const [addingBuild, setAddingBuild] = React.useState(false);
  const [pendingSow, setPendingSow] = React.useState<File | null>(null);

  const upload = useAction(({ file, docId }: { file: File; docId?: string }) => sowService.upload(c.id, file, docId), {
    invalidate: [qk.sow(c.id)], error: "Upload failed",
    success: (r) => `SOW v${r.version.version_no} uploaded${r.converted ? " and converted to PDF" : ""}${r.autoQueued ? ". Claude is analysing it" : ". Press Analyse to start"}.`,
    onSuccess: () => setPendingSow(null),
  });
  const dropSow = (files: File[]) => {
    const f = files[0]!;
    const problem = validateFile("sow", f);
    if (problem) return toast.error(problem);
    if (s.sow.docs.length) setPendingSow(f); else upload.mutate({ file: f });
  };
  const dropDesigns = (files: File[]) => setDesignFiles(files);

  const ctx: Ctx = { c, s, canEdit, canSubmit, openPanel: setPanel, openScreen: (sub, index) => setScreen({ sub, index }), dropSow, dropDesigns, addBuild: () => setAddingBuild(true), busySow: upload.isPending };

  const initial = React.useMemo<Node[]>(() => {
    const saved = readPositions(c.id);
    return Object.keys(HOME).map((id) => ({ id, type: id, position: saved[id] ?? HOME[id]!, data: {}, draggable: true }));
  }, [c.id]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initial);
  React.useEffect(() => setNodes(initial), [initial, setNodes]);

  const edges = React.useMemo<Edge[]>(() => [
    { id: "e1", source: "sow", target: "requirements", sourceHandle: "r", targetHandle: "l", animated: s.sow.working },
    { id: "e2", source: "requirements", target: "designs", sourceHandle: "r", targetHandle: "l" },
    { id: "e3", source: "designs", target: "build", sourceHandle: "r", targetHandle: "l" },
    { id: "e4", source: "designs", target: "findings", sourceHandle: "b", targetHandle: "t", animated: s.designs.working },
    { id: "e5", source: "build", target: "findings", sourceHandle: "b", targetHandle: "t", animated: s.build.working },
    { id: "e6", source: "findings", target: "tasks", sourceHandle: "r", targetHandle: "l" },
  ], [s.sow.working, s.designs.working, s.build.working]);

  React.useEffect(() => () => setAssistantHint(null), []);
  const waiting = (s.sow.working || s.designs.working || s.build.working) && !connector;

  return (
    <CanvasCtx.Provider value={ctx}>
      {waiting && (
        <p className="mb-2 rounded-box border border-line bg-side px-3 py-2 text-sm text-text-2">
          Claude can’t start yet: the connector isn’t running on this PC. Run <span className="font-mono text-xs">npm run claude</span> in the project folder and the checks begin by themselves.
        </p>
      )}
      <div className="h-[calc(100vh-215px)] min-h-[520px] overflow-hidden rounded-box border border-line" data-testid="campaign-canvas">
        <ReactFlow className="cos-flow" nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={dark ? "dark" : "light"}
          fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }} minZoom={0.25} maxZoom={1.5} nodesConnectable={false} elementsSelectable
          proOptions={{ hideAttribution: true }} deleteKeyCode={null}
          onNodeClick={(_, n) => setAssistantHint({ campaignId: c.id, node: n.id, label: nodeLabel(n.id) })}
          onPaneClick={() => setAssistantHint(null)}
          onNodeDragStop={(_, __, all) => writePositions(c.id, Object.fromEntries(all.map((n) => [n.id, n.position])))}>
          <Background gap={24} size={1} color="rgb(var(--line))" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <Drawer open={Boolean(panel)} onOpenChange={(o) => !o && setPanel(null)} width={920} title={panel ? PANEL_TITLE[panel] : ""} subtitle={c.name}>
        {panel === "requirements" && <RequirementsTab campaign={c} />}
        {panel === "designs" && <DesignsTab campaign={c} />}
        {panel === "development" && <DevelopmentTab campaign={c} />}
        {panel === "ai-reviews" && <AiReviewsTab campaign={c} />}
        {panel === "tasks" && <CampaignTasksTab campaign={c} />}
      </Drawer>
      {screen && <ScreenFindings campaignId={c.id} sub={screen.sub} index={screen.index} onIndex={(i) => setScreen({ ...screen, index: i })} onClose={() => setScreen(null)} />}
      {designFiles && <UploadDialog campaign={c} initialFiles={designFiles} onClose={() => setDesignFiles(null)} />}
      {addingBuild && <SubmissionDialog campaign={c} onClose={() => setAddingBuild(false)} />}
      {pendingSow && <SowChoice file={pendingSow} docs={s.sow.docs} busy={upload.isPending} onPick={(docId) => upload.mutate({ file: pendingSow, docId })} onCancel={() => setPendingSow(null)} />}
    </CanvasCtx.Provider>
  );
}

const nodeLabel = (id: string) => ({ sow: "SOW", requirements: "Requirements", designs: "Designs", build: "Staging build", findings: "Findings", tasks: "Tasks" }[id] ?? id);

/** Dropping onto a campaign that already has a SOW: new version of it, or a separate document? */
function SowChoice({ file, docs, busy, onPick, onCancel }: { file: File; docs: SowDocument[]; busy: boolean; onPick: (docId?: string) => void; onCancel: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent title="Where does this file go?" description={file.name} footer={<Button onClick={onCancel} disabled={busy}>Cancel</Button>}>
        <div className="space-y-2">
          {docs.map((d) => <Button key={d.id} className="w-full justify-start" loading={busy} onClick={() => onPick(d.id)}><FileUp />New version of “{d.title}”</Button>)}
          <Button className="w-full justify-start" variant="primary" loading={busy} onClick={() => onPick(undefined)}><FileUp />A separate SOW document</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
