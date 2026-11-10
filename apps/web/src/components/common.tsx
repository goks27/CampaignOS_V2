import * as React from "react";
import { PHASES, phaseDone, phaseIndex } from "@/lib/phases";
import { AlertTriangle, Inbox } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { STAGES, STAGE_LABEL, TONE_HEX, type Stage, type Tone } from "@/lib/labels";
import { Button, Dialog, DialogContent } from "@/components/ui";

/** Dot + label: the default status treatment (DESIGN.md). */
export function StatusDot({ tone, label, className }: { tone: Tone; label?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-text-2 whitespace-nowrap", className)}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: TONE_HEX[tone] }} />
      {label}
    </span>
  );
}

/** Tinted pill: only for Health, Severity and the Demo data badge. */
export function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  const hex = TONE_HEX[tone];
  return (
    <span className={cn("inline-flex items-center rounded-[5px] px-1.5 py-px text-xs font-medium whitespace-nowrap", className)}
      style={{ color: hex, background: `${hex}1A` }}>
      {children}
    </span>
  );
}

export function StageRing({ stage, showLabel = true }: { stage: Stage; showLabel?: boolean }) {
  const idx = STAGES.indexOf(stage);
  const pct = stage === "completed" ? 1 : (idx + 0.5) / (STAGES.length - 1);
  const r = 6;
  const c = 2 * Math.PI * r;
  const color = stage === "completed" ? TONE_HEX.green : "rgb(var(--accent))";
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={`Stage ${idx + 1} of 7: ${STAGE_LABEL[stage]}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r={r} fill="none" stroke="rgb(var(--line-strong))" strokeWidth="2" />
        <circle cx="8" cy="8" r={r} fill="none" stroke={color} strokeWidth="2" strokeDasharray={`${pct * c} ${c}`}
          strokeLinecap="round" transform="rotate(-90 8 8)" />
      </svg>
      {showLabel && <span className="text-sm text-text">{STAGE_LABEL[stage]}</span>}
    </span>
  );
}

/** Plan, Build, Review, Launch: where the campaign is, at a glance. The exact stage is spelled out beside it. */
export function PhaseStrip({ stage, compact = false }: { stage: Stage; compact?: boolean }) {
  const now = phaseIndex(stage);
  if (compact) {
    // Four dots and the current phase: small enough for a cover card or the sidebar.
    return (
      <div className="inline-flex items-center gap-2 whitespace-nowrap text-xs" title={`Stage ${STAGES.indexOf(stage) + 1} of 7: ${STAGE_LABEL[stage]}`}>
        <span className="inline-flex items-center gap-1" aria-hidden>
          {PHASES.map((p, i) => <span key={p} className={cn("size-1.5 rounded-full", phaseDone(stage, i) || (i === now && stage !== "completed") ? "bg-accent" : "bg-line-strong", i === now && stage !== "completed" && "ring-2 ring-accent/25")} />)}
        </span>
        <span className="text-text-2">{stage === "completed" ? "Completed" : `${PHASES[now]} · ${STAGE_LABEL[stage]}`}</span>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 whitespace-nowrap" title={`Stage ${STAGES.indexOf(stage) + 1} of 7: ${STAGE_LABEL[stage]}`}>
      <ol className="inline-flex items-center text-xs" aria-label="Phase">
        {PHASES.map((p, i) => {
          const done = phaseDone(stage, i);
          const current = i === now && stage !== "completed";
          return (
            <li key={p} className="flex items-center gap-1" aria-current={current ? "step" : undefined}>
              <span className={cn("size-1.5 rounded-full", done || current ? "bg-accent" : "bg-line-strong", current && "ring-2 ring-accent/25")} />
              <span className={cn(current ? "font-medium text-text" : done ? "text-text-2" : "text-muted")}>{p}{current && <span className="font-normal text-text-2"> · {STAGE_LABEL[stage]}</span>}</span>
              {i < PHASES.length - 1 && <span className={cn("mx-1.5 h-px w-4", done ? "bg-accent/50" : "bg-line-strong")} />}
            </li>
          );
        })}
      </ol>
      {stage === "completed" && <span className="text-sm text-text-2">· Completed</span>}
    </div>
  );
}

export function Avatar({ name, size = 20, className }: { name?: string | null; size?: number; className?: string }) {
  let h = 0;
  for (const ch of name ?? "") h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${h} 45% 52%)` }} title={name ?? undefined}>
      {initials(name)}
    </span>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs text-text-2", className)}>{children}</span>;
}

export function EmptyState({ icon: Icon = Inbox, title, body, action, className }: {
  icon?: React.ComponentType<{ className?: string }>; title: string; body?: React.ReactNode; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <Icon className="size-5 text-muted" />
      <p className="text-sm font-medium text-text">{title}</p>
      {body && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: string }).message) : "Could not load this data.";
  return (
    <div className="flex items-start gap-2 rounded-box border border-st-red/30 bg-st-red/5 px-3 py-2.5 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-st-red" />
      <div className="flex-1">
        <p className="text-text">Could not load data: {msg}</p>
        <p className="text-xs text-muted">Check your connection and that Supabase is reachable.</p>
      </div>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-normal tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className, id }: { title: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("mb-6 scroll-mt-4", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="section-title">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function KeyValue({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map((i) => (
        <React.Fragment key={i.label}>
          <dt className="text-muted">{i.label}</dt>
          <dd className="min-w-0 break-words text-text">{i.value ?? "—"}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, onConfirm, danger, loading }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; body: React.ReactNode; confirmLabel: string;
  onConfirm: () => void; danger?: boolean; loading?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title}
        footer={<>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>}>
        <div className="text-sm text-text-2">{body}</div>
      </DialogContent>
    </Dialog>
  );
}

/** Region-based table primitives (borders do the separating). */
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-box border border-line bg-surface", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("border-b border-line px-3 py-2 text-left text-xs font-normal text-muted whitespace-nowrap", className)}>{children}</th>;
}
export function Td({ children, className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-line px-3 py-[9px] align-middle last-of-type:border-r-0", className)} {...p}>{children}</td>;
}
export function Tr({ children, className, onClick, selected, ...p }: React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr className={cn("[&:last-child>td]:border-b-0", onClick && "cursor-pointer hover:bg-hover", selected && "bg-active", className)} onClick={onClick} {...p}>
      {children}
    </tr>
  );
}

export function DemoBadge() {
  return <Pill tone="amber">Demo data</Pill>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-ctl bg-hover", className)} />;
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-6 w-full" />)}
    </div>
  );
}
