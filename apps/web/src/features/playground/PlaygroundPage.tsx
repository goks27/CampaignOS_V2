import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "@/features/canvas/canvas.css";
import { Copy, FileText, FlaskConical, Globe, ImageIcon, Loader2, Plus, Sparkles, Trash2, UploadCloud, X } from "lucide-react";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { Pill } from "@/components/common";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth";
import { useAction } from "@/hooks/useAction";
import { qk, useCampaigns, useConnectorStatus, useSettings } from "@/hooks/queries";
import { SEVERITY_LABEL, SEVERITY_TONE, type Tone } from "@/lib/labels";
import { cn, formatBytes } from "@/lib/utils";
import { prepareImage } from "@/lib/images";
import { validateFile } from "@/services/storage";
import { requirementsService, sowService } from "@/services/requirements";
import { developmentService } from "@/services/development";
import { designsService, type NewScreen } from "@/services/designs";
import { classify, domainAllowed, domainOf, MAX_FILES, MAX_URLS, newId, playgroundService, type Finding, type Item, type Result } from "@/services/playground";

const VERDICT: Record<Result["verdict"], { label: string; tone: Tone }> = {
  yes: { label: "Heading the right way", tone: "green" }, partly: { label: "Partly there", tone: "amber" }, no: { label: "Not yet", tone: "red" }, unclear: { label: "Can’t tell from this", tone: "gray" },
};
const SEV_ORDER = ["critical", "high", "medium", "low", "informational"];

type Ctx = {
  items: Item[]; result: Result | null; running: boolean; selected: string | null; setSelected: (id: string | null) => void;
  addFiles: (f: File[]) => void; addUrl: (url: string, device: "desktop" | "mobile") => void; remove: (id: string) => void; clear: () => void;
  campaignId: string; setCampaignId: (v: string) => void; question: string; setQuestion: (v: string) => void; run: () => void; stop: () => void;
  baselineCount: number | null; saveImages: () => void; saveDoc: () => void; saving: boolean; canSubmit: boolean; copy: () => void;
};
const PlayCtx = React.createContext<Ctx | null>(null);
const usePlay = () => { const v = React.useContext(PlayCtx); if (!v) throw new Error("outside playground"); return v; };

const Shell = ({ title, icon: Icon, children, right, w = 320 }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; right?: React.ReactNode; w?: number }) => (
  <div className="rounded-box border border-line bg-surface shadow-sm" style={{ width: w }}>
    <Handle id="l" type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-line-strong" />
    <div className="flex items-center gap-2 border-b border-line px-3 py-2"><Icon className="size-4 text-muted" /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>{right}</div>
    <div className="px-3 py-2.5 text-sm">{children}</div>
    <Handle id="r" type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-line-strong" />
  </div>
);

// ---------------------------------------------------------------- nodes
function DropNode() {
  const { addFiles, addUrl, items } = usePlay();
  const input = React.useRef<HTMLInputElement>(null);
  const [url, setUrl] = React.useState("");
  const [device, setDevice] = React.useState<"desktop" | "mobile">("desktop");
  const [over, setOver] = React.useState(false);
  const submitUrl = () => { if (!url.trim()) return; addUrl(url.trim(), device); setUrl(""); };
  return (
    <Shell title="Drop anything here" icon={UploadCloud} right={<span className="text-xs text-muted num">{items.length}</span>}>
      <div className={cn("nodrag nopan flex flex-col items-center gap-2 rounded-box border border-dashed px-3 py-6 text-center", over ? "border-accent bg-accent/5" : "border-line-strong")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(Array.from(e.dataTransfer.files)); }}>
        <UploadCloud className="size-6 text-muted" />
        <p className="text-text-2">Screens, a SOW, a brief or any document.</p>
        <Button size="sm" onClick={() => input.current?.click()}><Plus />Choose files</Button>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        <p className="text-xs text-muted">PNG, JPG, WEBP, PDF, Word, Excel, PowerPoint, text</p>
      </div>
      <form className="nodrag nopan mt-3 space-y-1.5" onSubmit={(e) => { e.preventDefault(); submitUrl(); }}>
        <p className="text-xs font-medium text-text-2">Or check a web page</p>
        <div className="flex gap-1.5">
          <Input aria-label="Page URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://staging.example.com/" />
          <Select aria-label="Device" className="w-28" value={device} onChange={(e) => setDevice(e.target.value as "desktop" | "mobile")} options={[{ value: "desktop", label: "Desktop" }, { value: "mobile", label: "Mobile" }]} />
          <Button type="submit" size="icon" aria-label="Add URL" disabled={!url.trim()}><Plus /></Button>
        </div>
      </form>
      <p className="mt-2 text-xs text-muted">Nothing here is saved unless you press Save.</p>
    </Shell>
  );
}

function Pins({ source, w, h }: { source: string; w: number; h: number }) {
  const { result, selected, setSelected } = usePlay();
  void w; void h;
  return <>{(result?.findings ?? []).filter((f) => f.source === source && f.region).map((f, i) => {
    const id = `${source}:${i}`;
    const r = f.region!;
    const active = selected === id;
    return <button key={id} onClick={(e) => { e.stopPropagation(); setSelected(id); }} aria-label={`Finding: ${f.title} (approximate)`} className={cn("nodrag nopan absolute rounded-sm", active ? "border-2 border-accent bg-accent/15" : "border border-dashed border-st-red/70 bg-st-red/5 hover:bg-st-red/15")}
      style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />;
  })}</>;
}

function ImagePreview({ file, source }: { file: File; source: string }) {
  const url = React.useMemo(() => URL.createObjectURL(file), [file]);
  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <div className="relative mt-2 overflow-hidden rounded border border-line bg-side"><img src={url} alt={file.name} className="block max-h-56 w-full object-contain" draggable={false} /><Pins source={source} w={1} h={1} /></div>;
}

function ItemNode({ data }: NodeProps<Node<{ id: string }>>) {
  const { items, result, remove } = usePlay();
  const it = items.find((x) => x.id === data.id);
  if (!it) return null;
  const cap = it.kind === "url" ? result?.captures.find((c) => c.source === it.id) : null;
  const Icon = it.kind === "image" ? ImageIcon : it.kind === "url" ? Globe : FileText;
  const count = (result?.findings ?? []).filter((f) => f.source === it.id).length;
  return (
    <Shell title={it.name} icon={Icon} right={<>{result && <span className="text-xs text-muted num">{count} finding{count === 1 ? "" : "s"}</span>}<button className="nodrag nopan text-muted hover:text-text" aria-label={`Remove ${it.name}`} onClick={() => remove(it.id)}><X className="size-4" /></button></>}>
      {it.kind === "url" ? (
        <>
          <p className="truncate text-xs text-muted" title={it.url}>{it.device} · {it.url}</p>
          {cap ? <div className="relative mt-2 max-h-56 overflow-hidden rounded border border-line"><img src={cap.image} alt={`Captured ${it.url}`} className="block w-full" draggable={false} /><Pins source={it.id} w={cap.width} h={cap.height} /></div> : <p className="mt-1 text-xs text-muted">Opened in a real browser on this PC when you press Check.</p>}
          {cap && cap.height > 700 && <p className="mt-1 text-xs text-muted">Full page, scaled down. Regions are approximate.</p>}
        </>
      ) : it.kind === "image" ? <ImagePreview file={it.file} source={it.id} /> : <p className="text-xs text-muted">{it.kind === "pdf" ? (/\.pdf$/i.test(it.name) ? "PDF" : "Converted to PDF when checked") : "Text"} · {formatBytes(it.bytes)}</p>}
    </Shell>
  );
}

function CheckNode() {
  const { items, running, run, stop, campaignId, setCampaignId, question, setQuestion, baselineCount, clear } = usePlay();
  const { data: campaigns } = useCampaigns();
  const connector = useConnectorStatus().data;
  return (
    <Shell title="Check" icon={Sparkles} w={340}>
      <div className="nodrag nopan space-y-2.5">
        <div>
          <p className="mb-1 text-xs font-medium text-text-2">Check against</p>
          <Select aria-label="Campaign baseline" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} placeholder="No campaign (general review)" options={(campaigns ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          {campaignId && <p className="mt-1 text-xs text-muted">{baselineCount === null ? "Loading requirements…" : baselineCount ? `Using ${baselineCount} accepted requirements as the baseline.` : "This campaign has no accepted requirements yet, so it is a general review."}</p>}
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-text-2">What should Claude look at? <span className="font-normal text-muted">(optional)</span></p>
          <Textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Are we on track? Is the OTP flow complete?" />
        </div>
        {!connector && <p className="rounded-box border border-line bg-side px-2.5 py-2 text-xs text-text-2">The Claude connector isn’t running. Run <span className="font-mono">npm run claude</span> in the project folder, then press Check.</p>}
        <div className="flex gap-2">
          {running ? <Button className="flex-1" onClick={stop}><Loader2 className="animate-spin" />Stop</Button>
            : <Button className="flex-1" variant="primary" disabled={!items.length} onClick={run}><FlaskConical />Check with Claude</Button>}
          <Button variant="ghost" size="icon" aria-label="Clear everything" title="Clear everything" disabled={!items.length || running} onClick={clear}><Trash2 /></Button>
        </div>
        {running && <p className="text-xs text-accent">Claude is reading everything you added. This can take a minute or two.</p>}
      </div>
    </Shell>
  );
}

function ResultNode() {
  const { result, selected, setSelected, items, campaignId, saveImages, saveDoc, saving, canSubmit, copy } = usePlay();
  if (!result) return null;
  const v = VERDICT[result.verdict];
  const sorted = result.findings.map((f, i) => ({ f, i })).sort((a, b) => SEV_ORDER.indexOf(a.f.severity) - SEV_ORDER.indexOf(b.f.severity));
  const idOf = (f: Finding, i: number) => `${f.source}:${result.findings.filter((x, j) => j < i && x.source === f.source && x.region).length}`;
  const hasImages = items.some((i) => i.kind === "image"), hasDoc = items.some((i) => i.kind === "pdf" || i.kind === "text");
  return (
    <Shell title="Result" icon={FlaskConical} w={420} right={<Pill tone={v.tone}>{v.label}</Pill>}>
      <p className="whitespace-pre-wrap">{result.summary}</p>
      <p className="mt-1 text-xs text-muted">These are suggestions from Claude, not decisions. Nothing was saved or approved.</p>
      <ul className="nodrag nopan nowheel mt-2 max-h-72 divide-y divide-line overflow-y-auto rounded-box border border-line">
        {!sorted.length && <li className="px-3 py-3 text-text-2">No problems found in what you added.</li>}
        {sorted.map(({ f, i }) => {
          const id = f.region ? idOf(f, i) : `${f.source}:x${i}`;
          const src = items.find((x) => x.id === f.source)?.name;
          return (
            <li key={i} onClick={() => setSelected(id)} className={cn("cursor-pointer px-3 py-2", selected === id ? "bg-active" : "hover:bg-hover")}>
              <div className="flex items-center gap-2"><Pill tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</Pill><span className="min-w-0 flex-1 truncate text-xs text-muted">{src ?? "Overall"}{f.requirement_ref ? ` · ${f.requirement_ref}` : " · additional observation"}</span></div>
              <p className="mt-0.5 font-medium">{f.title}</p>
              {f.observed && <p className="text-xs text-text-2"><span className="text-muted">Seen: </span>{f.observed}</p>}
              {f.suggested_correction && <p className="text-xs text-text-2"><span className="text-muted">Fix: </span>{f.suggested_correction}</p>}
            </li>
          );
        })}
      </ul>
      {result.checks.length > 0 && <p className="mt-2 text-xs text-text-2">{result.checks.filter((c) => c.result === "verified").length} requirement(s) look satisfied · {result.checks.filter((c) => c.result === "needs_verification").length} need verification.</p>}
      {result.blocked.length > 0 && <p className="mt-1 text-xs text-muted">{result.blocked.length} request(s) were blocked by the network rules.</p>}
      <div className="nodrag nopan mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={copy}><Copy />Copy findings</Button>
        {campaignId && canSubmit && hasImages && <Button size="sm" loading={saving} onClick={saveImages}>Save screens to campaign</Button>}
        {campaignId && canSubmit && hasDoc && <Button size="sm" loading={saving} onClick={saveDoc}>Save document as SOW</Button>}
      </div>
      {!campaignId && <p className="mt-1 text-xs text-muted">Pick a campaign above to save the screens or document to it.</p>}
    </Shell>
  );
}

const nodeTypes: NodeTypes = { drop: DropNode, item: ItemNode, check: CheckNode, result: ResultNode };

// ---------------------------------------------------------------- page
export function PlaygroundPage() {
  const toast = useToast();
  const { canEdit, me } = useAuth();
  const { data: settings } = useSettings();
  const [items, setItems] = React.useState<Item[]>([]);
  const [result, setResult] = React.useState<Result | null>(null);
  const [running, setRunning] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [campaignId, setCampaignId] = React.useState("");
  const [question, setQuestion] = React.useState("");
  const abort = React.useRef<AbortController | null>(null);
  const { data: campaigns } = useCampaigns();
  const campaign = campaigns?.find((c) => c.id === campaignId);
  const canSubmit = canEdit || Boolean(campaign && me?.role === "team_member" && campaign.campaign_members.some((m) => m.user_id === me.id));

  const reqs = useQuery({ queryKey: qk.requirements(campaignId || "none"), queryFn: () => requirementsService.list(campaignId), enabled: Boolean(campaignId) });
  const accepted = (reqs.data ?? []).filter((r) => r.status === "accepted");
  const envs = useQuery({ queryKey: [...qk.dev(campaignId || "none"), "env"], queryFn: () => developmentService.environments(campaignId), enabled: Boolean(campaignId) });

  const changed = () => setResult(null); // adding or removing something makes an older answer stale
  const addFiles = (files: File[]) => {
    const next: Item[] = [];
    for (const f of files) {
      const kind = classify(f);
      if (!kind) { toast.error(`${f.name}: this type can’t be checked. Use an image, PDF, Word, Excel, PowerPoint or text file.`); continue; }
      const problem = kind === "image" ? validateFile("designs", f) : null;
      if (problem) { toast.error(problem); continue; }
      next.push({ id: newId(), kind, name: f.name, file: f, bytes: f.size });
    }
    if (!next.length) return;
    setItems((cur) => {
      const room = MAX_FILES - cur.filter((i) => i.kind !== "url").length;
      if (next.length > room) toast.error(`At most ${MAX_FILES} files per check.`);
      return [...cur, ...next.slice(0, Math.max(0, room))];
    });
    changed();
  };
  const addUrl = (raw: string, device: "desktop" | "mobile") => {
    let u: URL;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return toast.error("That doesn’t look like a web address."); }
    if (items.filter((i) => i.kind === "url").length >= MAX_URLS) return toast.error(`At most ${MAX_URLS} web pages per check.`);
    setItems((cur) => [...cur, { id: newId(), kind: "url", name: u.hostname + (u.pathname === "/" ? "" : u.pathname), url: u.toString(), device }]);
    changed();
  };
  const remove = (id: string) => { setItems((cur) => cur.filter((i) => i.id !== id)); changed(); };
  const clear = () => { setItems([]); setResult(null); setSelected(null); };

  const allowed = React.useMemo(() => [...(settings?.allowed_domains ?? []), ...(envs.data ?? []).flatMap((e) => e.allowed_domains ?? [])], [settings, envs.data]);

  const run = async () => {
    if (running) return;
    const blocked = items.flatMap((i) => (i.kind === "url" && !domainAllowed(domainOf(i.url), allowed) ? [domainOf(i.url)] : []));
    if (blocked.length) return toast.error(`${blocked[0]} isn’t on the allowed domains list. Add it in Settings (or on the campaign’s test environment) first. Local and private addresses are never allowed.`);
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true); setResult(null); setSelected(null);
    try {
      const prepared = await playgroundService.prepare(items, (settings?.limits as { image_long_edge?: number } | undefined)?.image_long_edge ?? 1600);
      const out = await playgroundService.check({
        ...prepared, question, allowed_domains: allowed,
        baseline: campaign ? { campaign: campaign.name, requirements: accepted.map((r) => ({ ref: r.ref, title: r.title, description: r.description, category: r.category })) } : null,
      }, ac.signal);
      setResult(out);
    } catch (e) {
      if (!ac.signal.aborted) toast.error(e, "The check failed");
    } finally { setRunning(false); abort.current = null; }
  };

  const saveImages = useAction(async () => {
    const screens: NewScreen[] = [];
    for (const it of items) if (it.kind === "image") {
      const p = await prepareImage(it.file, 1600);
      screens.push({ ...p, screenName: it.name.replace(/\.(png|jpe?g|webp|gif)$/i, ""), screenType: "screen", sourceFile: it.name });
    }
    return designsService.create({ campaignId, journeyId: null, title: "From the playground", notes: "Submitted from the Playground.", screens });
  }, { invalidate: [qk.designs(campaignId || "none")], success: (r) => `Saved as design submission v${r.submission.version_no} in ${campaign?.name ?? "the campaign"}.`, error: "Could not save the screens" });
  const saveDoc = useAction(async () => {
    const doc = items.find((i) => i.kind === "pdf" || i.kind === "text");
    if (!doc || doc.kind === "url") throw new Error("No document to save.");
    return sowService.upload(campaignId, doc.file);
  }, { invalidate: [qk.sow(campaignId || "none")], success: (r) => `Saved as SOW v${r.version.version_no}${r.converted ? " (converted to PDF)" : ""} in ${campaign?.name ?? "the campaign"}.`, error: "Could not save the document" });

  const copy = () => {
    if (!result) return;
    const text = [`${VERDICT[result.verdict].label}. ${result.summary}`, "", ...result.findings.map((f, i) => `${i + 1}. [${SEVERITY_LABEL[f.severity]}] ${f.title}${f.requirement_ref ? ` (${f.requirement_ref})` : ""}\n   Seen: ${f.observed}\n   Fix: ${f.suggested_correction}`)].join("\n");
    void navigator.clipboard.writeText(text).then(() => toast.success("Findings copied"), () => toast.error("Could not copy"));
  };

  const ctx: Ctx = { items, result, running, selected, setSelected, addFiles, addUrl, remove, clear, campaignId, setCampaignId, question, setQuestion, run: () => void run(), stop: () => abort.current?.abort(),
    baselineCount: campaignId ? (reqs.isLoading ? null : accepted.length) : null, saveImages: () => saveImages.mutate(undefined), saveDoc: () => saveDoc.mutate(undefined), saving: saveImages.isPending || saveDoc.isPending, canSubmit, copy };

  // Fixed layout: drop zone, then what you added, then the check and the result.
  const nodes = React.useMemo<Node[]>(() => {
    let y = 0;
    const list: Node[] = [{ id: "drop", type: "drop", position: { x: 0, y: 0 }, data: {}, draggable: true }];
    for (const it of items) {
      const tall = it.kind === "image" || (it.kind === "url" && result?.captures.some((c) => c.source === it.id));
      list.push({ id: it.id, type: "item", position: { x: 420, y }, data: { id: it.id }, draggable: true });
      y += tall ? 330 : 130;
    }
    list.push({ id: "check", type: "check", position: { x: 840, y: 0 }, data: {}, draggable: true });
    if (result) list.push({ id: "result", type: "result", position: { x: 820, y: 360 }, data: {}, draggable: true });
    return list;
  }, [items, result]);
  const edges = React.useMemo<Edge[]>(() => [
    ...items.map((i) => ({ id: `e-${i.id}`, source: i.id, target: "check", sourceHandle: "r", targetHandle: "l", animated: running })),
    ...(items.length ? [] : [{ id: "e-drop", source: "drop", target: "check", sourceHandle: "r", targetHandle: "l" }]),
    ...(result ? [{ id: "e-result", source: "check", target: "result", sourceHandle: "r", targetHandle: "l" }] : []),
  ], [items, result, running]);
  const dark = document.documentElement.classList.contains("dark");

  return (
    <PlayCtx.Provider value={ctx}>
      <div className="mb-3">
        <h1 className="font-display text-2xl font-normal tracking-tight">Playground</h1>
        <p className="mt-1 text-sm text-text-2">Drop a SOW, designs or a staging URL and ask Claude whether you’re heading the right way. It’s a scratchpad: nothing is saved to a campaign unless you press Save.</p>
      </div>
      <div className="h-[calc(100vh-200px)] min-h-[520px] overflow-hidden rounded-box border border-line" data-testid="playground-canvas"
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); const f = Array.from(e.dataTransfer.files); if (f.length) addFiles(f); }}>
        <ReactFlow key={`${items.length}-${Boolean(result)}`} className="cos-flow" nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode={dark ? "dark" : "light"}
          fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.25} maxZoom={1.5} nodesConnectable={false} deleteKeyCode={null} proOptions={{ hideAttribution: true }}>
          <Background gap={24} size={1} color="rgb(var(--line))" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </PlayCtx.Provider>
  );
}
