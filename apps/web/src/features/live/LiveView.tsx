import * as React from "react";
import { ChevronDown, Maximize2, Minimize2, MonitorPlay, Pause } from "lucide-react";
import { REVIEW_TYPE_LABEL, type ReviewType } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { useConnectorStatus, useLive } from "@/hooks/queries";
import { connectorService, type LiveState } from "@/services/connector";
import { liveHeadline, placeLabel } from "./model";

const KEY = "journ-live";
type Prefs = { collapsed: boolean; large: boolean };
const read = (): Prefs => { try { return { collapsed: false, large: false, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>) }; } catch { return { collapsed: false, large: false }; } };

/** The latest picture of the test browser. Fetched again each time the connector has a new one. */
function useFrame(live: Extract<LiveState, { active: true }> | null) {
  const [url, setUrl] = React.useState<string | null>(null);
  const seq = live?.seq ?? 0, has = live?.hasFrame ?? false;
  React.useEffect(() => {
    if (!has) { setUrl(null); return; }
    let gone = false;
    void connectorService.liveFrame().then((b) => {
      if (gone || !b) return;
      setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b); });
    });
    return () => { gone = true; };
  }, [seq, has]);
  React.useEffect(() => () => setUrl((old) => { if (old) URL.revokeObjectURL(old); return null; }), []);
  return url;
}

/**
 * Watch the check as it runs: a live picture of the page the test browser is on, and the steps in plain words.
 * It appears only while the connector on THIS PC is running a job, and is view only: nothing you do here reaches the browser.
 */
export function LiveView() {
  const status = useConnectorStatus().data;
  const running = Boolean(status?.busy);
  const { data } = useLive(running);
  const live = running && data?.active ? data : null;
  const frame = useFrame(live);
  const [prefs, setPrefs] = React.useState(read);
  const set = (p: Partial<Prefs>) => setPrefs((o) => { const n = { ...o, ...p }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* a convenience only */ } return n; });
  const logRef = React.useRef<HTMLOListElement>(null);
  const steps = live?.steps ?? [];
  React.useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [steps.length]);

  if (!live) return null;
  const label = REVIEW_TYPE_LABEL[live.type as ReviewType] ?? "Review";
  const where = placeLabel(live.where);
  const current = steps.at(-1)?.text ?? "Starting";
  const browserJob = ["site_check", "design_vs_development", "functional_qa", "regression", "sow_vs_development"].includes(live.type);

  if (prefs.collapsed) {
    return (
      <button onClick={() => set({ collapsed: false })} aria-label="Show the live view" data-testid="live-pill"
        className="fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-line-strong bg-surface px-3 py-2 text-sm shadow-lg hover:border-text-2">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
        <span className="truncate"><span className="font-medium">Live</span> · {label}{where ? ` · ${where}` : ""}</span>
      </button>
    );
  }
  return (
    <section aria-label="Live view" data-testid="live-view"
      className={cn("fixed bottom-4 right-4 z-40 flex max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-box border border-line-strong bg-surface shadow-xl", prefs.large ? "w-[640px]" : "w-[360px]")}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Live · {label}</p>
          <p className="truncate text-xs text-muted" data-testid="live-where">{where || "Preparing"}</p>
        </div>
        <button onClick={() => set({ large: !prefs.large })} className="rounded-ctl p-1 text-muted hover:bg-hover hover:text-text" aria-label={prefs.large ? "Smaller" : "Larger"} title={prefs.large ? "Smaller" : "Larger"}>
          {prefs.large ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
        <button onClick={() => set({ collapsed: true })} className="rounded-ctl p-1 text-muted hover:bg-hover hover:text-text" aria-label="Hide the live view" title="Hide"><ChevronDown className="size-4" /></button>
      </header>

      <div className="relative flex min-h-[120px] items-center justify-center bg-side" data-testid="live-frame">
        {frame ? <img src={frame} alt="Live picture of the test browser" className={cn("block max-h-[46vh] w-full object-contain", live.where?.device === "mobile" && "w-auto max-w-[60%]")} draggable={false} />
          : live.paused ? <p className="flex items-center gap-2 px-4 py-8 text-center text-xs text-text-2"><Pause className="size-4" />Picture paused while login details are entered.</p>
          : <p className="flex items-center gap-2 px-4 py-8 text-center text-xs text-text-2"><MonitorPlay className="size-4" />{browserJob ? "Waiting for the test browser…" : "Claude is working on the files. There is no browser to show for this review."}</p>}
      </div>

      <div className="min-h-0 border-t border-line px-3 py-2">
        <p className="text-sm font-medium" aria-live="polite" data-testid="live-now">{liveHeadline(current)}</p>
        <ol ref={logRef} className="mt-1.5 max-h-24 space-y-0.5 overflow-y-auto text-xs text-muted" data-testid="live-steps">
          {steps.slice(-8, -1).map((s, i) => <li key={`${s.at}-${i}`} className="truncate">{s.text}</li>)}
        </ol>
        <p className="mt-1.5 text-[11px] text-muted">Live on this PC only. Nothing is saved, and you cannot control the browser from here.</p>
      </div>
    </section>
  );
}
