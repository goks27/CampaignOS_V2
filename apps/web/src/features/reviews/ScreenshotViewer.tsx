import * as React from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, ImageOff } from "lucide-react";
import { Button } from "@/components/ui";
import { useSignedUrl } from "@/features/shared/AssetImage";
import { cn } from "@/lib/utils";

export type Region = { x: number; y: number; w: number; h: number };
export type Overlay = { id: string; region: Region; active: boolean; label?: string };

/** Screenshot with normalised (0–1) evidence regions drawn on top. Regions are approximate. */
export function ScreenshotViewer({ bucket, path, title, overlays, onPrev, onNext, position, onSelectOverlay }: {
  bucket: string | null; path: string | null; title: string; overlays: Overlay[];
  onPrev?: () => void; onNext?: () => void; position?: string; onSelectOverlay?: (id: string) => void;
}) {
  const { data: url, isError } = useSignedUrl(bucket, path);
  const [zoom, setZoom] = React.useState<"fit" | number>("fit");
  const activeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { setZoom("fit"); }, [path]);
  React.useEffect(() => { activeRef.current?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }); }, [overlays, zoom]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        {position && <span className="text-xs text-muted num">{position}</span>}
        <Button variant="ghost" size="icon" aria-label="Previous screen" disabled={!onPrev} onClick={onPrev}><ChevronLeft /></Button>
        <Button variant="ghost" size="icon" aria-label="Next screen" disabled={!onNext} onClick={onNext}><ChevronRight /></Button>
        <span className="mx-1 h-4 w-px bg-line" />
        <Button variant="ghost" size="icon" aria-label="Fit to view" onClick={() => setZoom("fit")}><Maximize2 /></Button>
        <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, (z === "fit" ? 1 : z) - 0.5))}><ZoomOut /></Button>
        <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, (z === "fit" ? 1 : z) + 0.5))}><ZoomIn /></Button>
        <span className="w-10 text-right text-xs text-muted num">{zoom === "fit" ? "Fit" : `${zoom * 100}%`}</span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto bg-side p-4">
        {!path ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-muted">
            <ImageOff className="size-5" />No screenshot for this finding.<span className="text-xs">It may be a journey-level finding such as a missing screen.</span>
          </div>
        ) : isError ? (
          <p className="text-sm text-muted">Could not load the screenshot.</p>
        ) : !url ? (
          <div className="mx-auto h-full w-2/3 animate-pulse rounded bg-hover" />
        ) : (
          <div className={cn("relative mx-auto", zoom === "fit" ? "h-full w-fit" : "w-fit")}>
            <img src={url} alt={title} className={cn("block select-none rounded border border-line", zoom === "fit" && "h-full w-auto max-w-full object-contain")}
              style={zoom === "fit" ? undefined : { width: `${zoom * 100}%`, maxWidth: "none" }} draggable={false}
              onLoad={(e) => { if (zoom !== "fit") return; const img = e.currentTarget; img.style.maxHeight = "100%"; }} />
            {overlays.map((o) => (
              <button key={o.id} ref={o.active ? activeRef : undefined} onClick={() => onSelectOverlay?.(o.id)}
                aria-label={o.active ? "Selected finding region (approximate)" : `Other finding: ${o.label ?? ""}`}
                className={cn("absolute rounded-sm", o.active ? "border-2 border-accent bg-accent/10" : "border border-dashed border-text/30 hover:border-text/60")}
                style={{ left: `${o.region.x * 100}%`, top: `${o.region.y * 100}%`, width: `${o.region.w * 100}%`, height: `${o.region.h * 100}%` }}>
                {o.active && <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-accent px-1 text-[10px] font-medium text-[rgb(var(--on-accent))]">approximate</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
