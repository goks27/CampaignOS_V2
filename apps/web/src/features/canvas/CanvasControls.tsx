import * as React from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { Check, ChevronDown, Map as MapIcon, Maximize, Minus, Plus, Route, Scan, Workflow } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";

export type JourneyTab = { value: string; label: string };

/** "Journey: Participate & Win ▾": switches between the campaign's journeys, or to the whole-campaign pipeline. */
export function JourneySelect({ tabs, current, onPick, onManage }: { tabs: JourneyTab[]; current: string; onPick: (v: string) => void; onManage: () => void }) {
  const now = tabs.find((t) => t.value === current);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-9 items-center gap-2 rounded-box border border-line-strong bg-surface px-3 text-sm shadow-sm hover:border-text-2" aria-label="Choose a journey">
          <Workflow className="size-4 text-muted" />
          <span className="hidden text-muted md:inline">Journey:</span>
          <span className="max-w-[110px] truncate font-medium md:max-w-[220px]">{now?.label ?? "Choose"}</span>
          <ChevronDown className="size-4 text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[260px]">
        {tabs.map((t) => (
          <DropdownMenuItem key={t.value} onSelect={() => onPick(t.value)}>
            <span className="flex-1 truncate">{t.label}</span>{t.value === current && <Check className="size-4 text-accent" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onManage}><Route />Manage journeys</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Zoom, fit and full screen for a canvas. Must be rendered inside <ReactFlow>. */
export function CanvasTools({ rootRef, minimap }: { rootRef: React.RefObject<HTMLElement | null>; minimap?: { on: boolean; toggle: () => void } }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const [full, setFull] = React.useState(false);
  React.useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => { /* the browser may refuse; the canvas still works */ });
  };
  const btn = "flex size-8 items-center justify-center rounded-ctl text-text-2 hover:bg-hover hover:text-text";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center rounded-box border border-line-strong bg-surface p-0.5 shadow-sm">
        <button className={btn} onClick={() => void fitView({ padding: 0.15, maxZoom: 1, duration: 250 })} aria-label="Fit the journey to the window" title="Fit to window"><Scan className="size-4" /></button>
      </div>
      <div className="flex items-center rounded-box border border-line-strong bg-surface p-0.5 shadow-sm">
        <button className={btn} onClick={() => void zoomOut({ duration: 150 })} aria-label="Zoom out"><Minus className="size-4" /></button>
        <span className="w-12 text-center text-xs text-text-2 num" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button className={btn} onClick={() => void zoomIn({ duration: 150 })} aria-label="Zoom in"><Plus className="size-4" /></button>
      </div>
      {minimap && (
        <div className="flex items-center rounded-box border border-line-strong bg-surface p-0.5 shadow-sm">
          <button className={cn(btn, minimap.on && "bg-active text-text")} onClick={minimap.toggle} aria-label={minimap.on ? "Hide the minimap" : "Show the minimap"} aria-pressed={minimap.on} title="Minimap (M)"><MapIcon className="size-4" /></button>
        </div>
      )}
      <div className="flex items-center rounded-box border border-line-strong bg-surface p-0.5 shadow-sm">
        <button className={cn(btn, full && "bg-active text-text")} onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"} aria-pressed={full} title="Full screen"><Maximize className="size-4" /></button>
      </div>
    </div>
  );
}

/** Start and End: the first and last step of a journey. */
export function Bookend({ kind }: { kind: "start" | "end" }) {
  return (
    <div className="flex h-9 items-center rounded-full border border-accent/60 bg-accent/10 px-4 text-sm font-medium text-accent">{kind === "start" ? "Start" : "End"}</div>
  );
}
