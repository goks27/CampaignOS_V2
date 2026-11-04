import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, RotateCcw, SendHorizontal, Sparkles, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useCampaigns, useConnectorStatus, usePeople } from "@/hooks/queries";
import { Button, Spinner, Textarea } from "@/components/ui";
import { useAssistant, type Item } from "./useAssistant";
import type { Lookup } from "./tools";
import { useAssistantHint } from "@/features/canvas/assistantHint";

const SUGGESTIONS = [
  "What needs my attention today?",
  "Which campaigns are at risk, and why?",
  "Summarise the findings awaiting review",
  "Which tasks are overdue?",
];

const LOOKUP_LABEL: Record<string, string> = {
  list_campaigns: "Reading campaigns", get_campaign: "Reading campaign details", list_requirements: "Reading requirements",
  list_requirement_checks: "Reading verification results", list_findings: "Reading findings", list_tasks: "Reading tasks",
  list_reviews: "Reading AI reviews", list_activity: "Reading recent activity", list_people: "Reading the team", dashboard_summary: "Reading the summary",
};

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, isViewer } = useAuth();
  const { data: campaigns } = useCampaigns();
  const { people } = usePeople();
  const connector = useConnectorStatus().data;
  const hint = useAssistantHint();
  const loc = useLocation();
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState("");
  const scroller = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLTextAreaElement>(null);

  const lookup = React.useMemo<Lookup>(() => ({
    campaign: (id) => campaigns?.find((c) => c.id === id)?.name ?? (id ? `Campaign ${id.slice(0, 8)}` : "—"),
    person: (id) => people.find((p) => p.id === id)?.name ?? (id ? `User ${id.slice(0, 8)}` : "—"),
  }), [campaigns, people]);

  // Read at send time, so every message carries the current page and data without re-creating the conversation.
  const contextRef = React.useRef<() => Record<string, unknown>>(() => ({}));
  contextRef.current = () => {
    const m = loc.pathname.match(/^\/campaigns\/([0-9a-f-]{36})/);
    return {
      user: { name: me?.fullName, role: me?.role }, today: new Date().toISOString().slice(0, 10), page: loc.pathname,
      open_campaign_id: m?.[1] ?? null,
      canvas_selection: hint ? { campaign_id: hint.campaignId, card: hint.label } : null,
      campaigns: (campaigns ?? []).slice(0, 60).map((c) => ({ id: c.id, name: c.name, client: c.clients?.name ?? null, stage: c.stage, status: c.status, health: c.health, target_launch_date: c.target_launch_date })),
      people: people.map((p) => ({ id: p.id, name: p.name, role: p.role })),
    };
  };

  const a = useAssistant({ lookup, context: () => contextRef.current(), onChanged: () => void qc.invalidateQueries() });

  React.useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [a.items, a.busy]);
  React.useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 150); }, [open]);

  const submit = () => { const t = draft; setDraft(""); void a.send(t); };

  return (
    <aside aria-label="Claude assistant" aria-hidden={!open}
      className={cn("fixed bottom-0 right-0 top-[46px] z-40 flex w-full max-w-[440px] flex-col border-l border-line bg-bg shadow-overlay transition-transform duration-200",
        open ? "translate-x-0" : "invisible translate-x-full")}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Sparkles className="size-4 text-accent" />
        <h2 className="flex-1 text-sm font-semibold">Claude assistant</h2>
        <span className="flex items-center gap-1.5 text-xs text-muted" title={connector ? "Claude connector is running on this PC" : "Claude connector is not running"}>
          <span className={cn("size-2 rounded-full", connector ? "bg-st-green" : "bg-line-strong")} />{connector ? "Connected" : "Not running"}
        </span>
        <Button variant="ghost" size="icon" onClick={a.reset} aria-label="New chat" title="New chat" disabled={!a.items.length}><RotateCcw /></Button>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close assistant"><X /></Button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {a.items.length === 0 && (
          <div className="space-y-3 pt-2">
            <p className="text-sm text-text-2">Ask about campaigns, requirements, findings, tasks and reviews. I can also prepare changes: you see each one and click Confirm before anything happens.</p>
            {!connector && <OfflineNote />}
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => void a.send(s)} disabled={a.busy}
                  className="rounded-box border border-line bg-surface px-3 py-2 text-left text-sm text-text-2 hover:border-line-strong hover:text-text">{s}</button>
              ))}
            </div>
          </div>
        )}
        {a.items.map((it) => <ItemView key={it.id} item={it} canWrite={!isViewer} onConfirm={a.confirm} onSkip={a.skip} />)}
        {a.busy && <p className="flex items-center gap-2 text-xs text-muted"><Spinner className="size-3.5" />Claude is working…</p>}
      </div>

      <footer className="border-t border-line p-3">
        <div className="flex items-end gap-2">
          <Textarea ref={input} rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask Claude…" aria-label="Message to Claude"
            className="min-h-[52px] flex-1 resize-none"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
          {a.busy
            ? <Button variant="secondary" size="icon" onClick={a.stop} aria-label="Stop" title="Stop"><Square /></Button>
            : <Button variant="primary" size="icon" onClick={submit} disabled={!draft.trim()} aria-label="Send"><SendHorizontal /></Button>}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted">
          Claude sees what you can see. Anything it reads is sent to Anthropic through your Claude plan. It never approves requirements, findings, designs, builds or launches.
          {a.auditMissing && <span className="mt-1 block text-st-amber">Changes were applied, but the assistant audit log is not set up yet. Run supabase/migrations/20261104000200_assistant_audit.sql in Supabase.</span>}
        </p>
      </footer>
    </aside>
  );
}

function OfflineNote() {
  return (
    <p className="rounded-box border border-line bg-side px-3 py-2 text-sm text-text-2">
      The Claude connector is not running on this PC. Run <span className="font-mono text-xs">npm run claude</span> in the project folder, then ask again.
    </p>
  );
}

function ItemView({ item, canWrite, onConfirm, onSkip }: { item: Item; canWrite: boolean; onConfirm: (id: string) => void; onSkip: (id: string) => void }) {
  switch (item.kind) {
    case "user":
      return <div className="ml-8 whitespace-pre-wrap rounded-box bg-active px-3 py-2 text-sm">{item.text}</div>;
    case "assistant":
      return <div className="whitespace-pre-wrap text-sm leading-relaxed">{item.text}</div>;
    case "lookup":
      return (
        <p className={cn("flex items-center gap-1.5 text-xs", item.status === "failed" ? "text-st-red" : "text-muted")}>
          {item.status === "running" ? <Spinner className="size-3" /> : item.status === "done" ? <Check className="size-3" /> : <X className="size-3" />}
          {LOOKUP_LABEL[item.tool] ?? item.tool}{item.status === "failed" && item.error ? `: ${item.error}` : ""}
        </p>
      );
    case "error":
      return (
        <div className="rounded-box border border-line bg-side px-3 py-2 text-sm text-st-red">
          {item.text}
        </div>
      );
    case "proposal": {
      const settled = item.status !== "pending" && item.status !== "applying";
      return (
        <div className={cn("rounded-box border bg-surface", item.status === "applied" ? "border-st-green/40" : item.status === "failed" ? "border-st-red/40" : "border-line")}>
          <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
            <span className="text-xs font-semibold">{item.card.title}</span>
            <span className="text-[11px] text-muted">{item.status === "pending" ? "Needs your confirmation" : item.status === "applying" ? "Applying…" : item.status === "applied" ? "Applied" : item.status === "skipped" ? "Skipped" : "Failed"}</span>
          </div>
          <dl className="space-y-1 px-3 py-2 text-sm">
            {item.card.fields.map((f) => (
              <div key={f.label} className="grid grid-cols-[96px_1fr] gap-2">
                <dt className="text-xs text-muted">{f.label}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words">{f.value}</dd>
              </div>
            ))}
          </dl>
          {item.status === "failed" && <p className="px-3 pb-2 text-xs text-st-red">{item.error}</p>}
          {item.status === "applied" && (
            <p className="px-3 pb-2 text-xs text-text-2">{item.detail}{item.link && <> · <Link to={item.link} className="text-accent hover:underline">Open</Link></>}</p>
          )}
          {!settled && (
            <div className="flex items-center justify-end gap-2 border-t border-line px-3 py-2">
              {!canWrite && <span className="mr-auto text-xs text-muted">Viewers can’t make changes.</span>}
              <Button size="sm" variant="ghost" onClick={() => onSkip(item.id)} disabled={item.status === "applying"}>Skip</Button>
              <Button size="sm" variant="primary" onClick={() => onConfirm(item.id)} disabled={!canWrite} loading={item.status === "applying"}>Confirm</Button>
            </div>
          )}
        </div>
      );
    }
  }
}
