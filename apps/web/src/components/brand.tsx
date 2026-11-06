import { cn } from "@/lib/utils";

/** The Journey mark: an open geometric frame (two corner brackets, a workspace) with a path moving through it to a point (direction, and what is possible). */
export function JourneyMark({ size = 20, className, animate = false }: { size?: number; className?: string; animate?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cn(animate && "mark-draw", className)}>
      <path d="M4 12V4h8M28 20v8h-8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path className="mark-path" d="M4 22c6 0 6-6 12-6s6-6 12-6" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="28" cy="10" r="2.4" fill="currentColor" />
    </svg>
  );
}

/** The wordmark: lowercase "journey" in the display serif, with the mark. */
export function Wordmark({ size = 22, className, animate = false, markOnly = false }: { size?: number; className?: string; animate?: boolean; markOnly?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-text", className)} aria-label="Journey">
      <JourneyMark size={markOnly ? size : Math.round(size * 0.8)} className="text-accent" animate={animate} />
      {!markOnly && <span className="font-display leading-none tracking-tight" style={{ fontSize: size }}>journey</span>}
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
