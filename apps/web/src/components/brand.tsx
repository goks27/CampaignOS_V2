import { cn } from "@/lib/utils";

/** The Journ mark: two points and the line between them. A journey, drawn once. */
export function JournMark({ size = 20, className, animate = false }: { size?: number; className?: string; animate?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cn(animate && "mark-draw", className)}>
      <path d="M10 22c0-7 12-3 12-12" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <circle cx="10" cy="22" r="2.6" fill="currentColor" />
      <circle cx="22" cy="10" r="2.6" fill="currentColor" />
    </svg>
  );
}

/** The wordmark: lowercase "journ" in the display serif, with the mark. */
export function Wordmark({ size = 22, className, animate = false, markOnly = false }: { size?: number; className?: string; animate?: boolean; markOnly?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-text", className)} aria-label="Journ">
      <JournMark size={markOnly ? size : Math.round(size * 0.8)} className="text-accent" animate={animate} />
      {!markOnly && <span className="font-display leading-none tracking-tight" style={{ fontSize: size }}>journ</span>}
    </span>
  );
}

const GLYPH_COLOURS = ["#7C5AD6", "#3A6FE0", "#2E9A5B", "#C98A12", "#D2463C", "#0E8F8F", "#B5479B"];
/** A stable colour for a campaign, so it is recognisable in the rail without an image. */
export const glyphColour = (id: string) => GLYPH_COLOURS[[...id].reduce((s, ch) => s + ch.charCodeAt(0), 0) % GLYPH_COLOURS.length]!;

/** A campaign's small square icon: its first letter on its own colour. */
export function CampaignGlyph({ id, name, size = 22, className }: { id: string; name: string; size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-ctl font-semibold text-white", className)} aria-hidden
      style={{ width: size, height: size, background: glyphColour(id), fontSize: Math.round(size * 0.5) }}>
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}
