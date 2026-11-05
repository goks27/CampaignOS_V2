import * as React from "react";
import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Fingerprint, Flag, Gift, GitBranch, Globe, KeyRound, Play, ShieldCheck, StickyNote, Ticket, TextCursorInput } from "lucide-react";
import { AssetImage } from "@/features/shared/AssetImage";
import { cn } from "@/lib/utils";
import { KIND_META, nodeSubtitle, type GraphNode, type NodeKind } from "./graph";
import { FRAME_MID, NODE_W, type JourneyModel, type ScreenModel } from "./journeyModel";
import type { DesignAsset } from "@/services/designs";

export const KIND_ICON: Record<NodeKind, React.ComponentType<{ className?: string }>> = {
  start: Play, end: Flag, screen: Play, form_submission: TextCursorInput, otp_validation: KeyRound, api_call: Globe, eligibility_check: ShieldCheck,
  decision: GitBranch, reward_allocation: Gift, voucher_distribution: Ticket, kyc_verification: Fingerprint, error_state: AlertTriangle, note: StickyNote,
};

export const CHIP: Record<string, string> = { red: "bg-st-red/15 text-st-red", amber: "bg-st-amber/15 text-st-amber", green: "bg-st-green/15 text-st-green", blue: "bg-st-blue/15 text-st-blue", gray: "bg-st-gray/15 text-text-2", violet: "bg-st-violet/15 text-st-violet" };
const BAR: Record<string, string> = { red: "bg-st-red", amber: "bg-st-amber", green: "bg-st-green", blue: "bg-st-blue", gray: "bg-st-gray", violet: "bg-st-violet" };

export type GraphCtxValue = {
  model: JourneyModel; byId: Map<string, GraphNode>; screenOf: Map<string, DesignAsset | null>; screenModel: (a: DesignAsset | null) => ScreenModel | null;
  reqCount: Map<string, number>; canWrite: boolean; /** The one selected step, for the glow. */ selected: string | null;
};
export const GraphCtx = React.createContext<GraphCtxValue | null>(null);
export const useGraph = () => { const v = React.useContext(GraphCtx); if (!v) throw new Error("outside the journey canvas"); return v; };

/** Four connection points, one per side. Visible on hover or selection; dragging from one to another step connects them. */
function Handles({ mid, show }: { mid?: number; show: boolean }) {
  const cls = cn("!z-10 !size-2.5 !rounded-full !border-2 !border-bg !bg-accent transition-opacity", show ? "opacity-100" : "opacity-0 group-hover/node:opacity-100");
  return (
    <>
      <Handle id="l" type="source" position={Position.Left} style={mid !== undefined ? { top: mid } : undefined} className={cls} />
      <Handle id="r" type="source" position={Position.Right} style={mid !== undefined ? { top: mid } : undefined} className={cls} />
      <Handle id="t" type="source" position={Position.Top} className={cls} />
      <Handle id="b" type="source" position={Position.Bottom} className={cls} />
    </>
  );
}

/** A design screen as a phone frame, with its name, status, version and where development and QA are. */
export function ScreenNode({ data }: NodeProps<Node<{ id: string }>>) {
  const g = useGraph();
  const node = g.byId.get(data.id);
  const zoom = useStore((st) => st.transform[2]);
  if (!node) return null;
  const asset = g.screenOf.get(node.id) ?? null;
  const s = g.screenModel(asset);
  const on = g.selected === node.id;
  const version = g.model.submission?.version_no;
  const t = g.model.tests;
  return (
    <div className="group/node flex flex-col items-center" style={{ width: NODE_W }} data-testid="screen-node" data-name={node.label}>
      <Handles mid={FRAME_MID} show={on && g.canWrite} />
      <div className={cn("relative h-[280px] w-[158px] overflow-hidden rounded-[22px] border-2 bg-side transition-shadow",
        on ? "border-accent shadow-[0_0_0_5px_rgb(var(--accent)/0.22),0_8px_30px_rgb(var(--accent)/0.25)]" : "border-line-strong hover:border-text-2")}>
        {asset ? <AssetImage bucket={asset.bucket} path={asset.storage_path} alt={asset.screen_name} className="h-full w-full" imgClassName="object-cover object-top" />
          : <div className="flex h-full flex-col items-center justify-center gap-1 border-dashed px-3 text-center text-xs text-muted"><span className="font-medium text-text-2">No design</span>in the latest version</div>}
        {s && s.open.length > 0 && <span className="absolute right-2 top-2 rounded-full bg-st-red px-1.5 text-[11px] font-semibold text-white num">{s.open.length}</span>}
      </div>
      <p className={cn("mt-2 max-w-full truncate text-center font-medium", zoom < 0.5 ? "text-base" : "text-sm")}>{node.label}</p>
      {s && <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", CHIP[s.tone])}>{s.label}</span>}
      {s?.kind === "state" && <span className="mt-1 text-[11px] text-muted">{s.asset.screen_type}</span>}
      {asset && (
        <p className="mt-1 max-w-full truncate text-center text-[11px] text-muted" title="Design version · built page · scenarios passed">
          {version ? `v${version} · ` : ""}{s?.built ?? "No build"}{t.total ? ` · ${t.passed}/${t.total} tests` : ""}
        </p>
      )}
    </div>
  );
}

/** A step that is not a design screen: an API call, an OTP check, a decision. It documents the journey; it is not tested until a scenario covers it. */
export function LogicNode({ data }: NodeProps<Node<{ id: string }>>) {
  const g = useGraph();
  const node = g.byId.get(data.id);
  if (!node) return null;
  const meta = KIND_META[node.kind], Icon = KIND_ICON[node.kind];
  const on = g.selected === node.id;
  const linked = g.reqCount.get(node.id) ?? 0;
  return (
    <div className={cn("group/node relative w-[210px] overflow-hidden rounded-box border-2 bg-surface px-3 py-2.5 transition-shadow", on ? "border-accent shadow-[0_0_0_5px_rgb(var(--accent)/0.22),0_8px_30px_rgb(var(--accent)/0.25)]" : "border-line-strong hover:border-text-2")} data-testid="logic-node" data-kind={node.kind}>
      <span className={cn("absolute inset-y-0 left-0 w-1", BAR[meta.tone])} aria-hidden />
      <Handles show={on && g.canWrite} />
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted"><Icon className="size-3.5" />{meta.label}</p>
      <p className="mt-0.5 truncate text-sm font-medium">{node.label || meta.label}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-text-2">{nodeSubtitle(node)}</p>
      {linked > 0 && <span className="mt-1.5 inline-flex rounded-full bg-hover px-1.5 py-0.5 text-[11px] text-text-2 num">{linked} requirement{linked === 1 ? "" : "s"}</span>}
    </div>
  );
}

export function EndpointNode({ data }: NodeProps<Node<{ id: string }>>) {
  const g = useGraph();
  const node = g.byId.get(data.id);
  if (!node) return null;
  const on = g.selected === node.id;
  return (
    <div className="group/node relative" data-testid={`${node.kind}-node`}>
      <Handles show={on && g.canWrite} />
      <div className={cn("flex h-9 items-center rounded-full border border-accent/60 bg-accent/10 px-4 text-sm font-medium text-accent", on && "shadow-[0_0_0_4px_rgb(var(--accent)/0.22)]")}>{node.kind === "start" ? "Start" : "End"}</div>
    </div>
  );
}

export function NoteNode({ data }: NodeProps<Node<{ id: string }>>) {
  const g = useGraph();
  const node = g.byId.get(data.id);
  if (!node) return null;
  const on = g.selected === node.id;
  return (
    <div className={cn("w-[190px] rounded-box border-2 border-dashed bg-side px-3 py-2", on ? "border-accent" : "border-line-strong")} data-testid="note-node">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted"><StickyNote className="size-3.5" />Note</p>
      <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-2">{String(node.config.text ?? "") || node.label || "Empty note"}</p>
    </div>
  );
}

export const nodeTypes = { screen: ScreenNode, logic: LogicNode, endpoint: EndpointNode, note: NoteNode };
export const rfType = (k: NodeKind) => (k === "screen" ? "screen" : k === "start" || k === "end" ? "endpoint" : k === "note" ? "note" : "logic");
