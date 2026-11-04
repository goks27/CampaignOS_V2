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
export function Wordmark({ size = 22, className, animate = false }: { size?: number; className?: string; animate?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-text", className)} aria-label="Journ">
      <JournMark size={Math.round(size * 0.8)} className="text-accent" animate={animate} />
      <span className="font-display leading-none tracking-tight" style={{ fontSize: size }}>journ</span>
    </span>
  );
}
