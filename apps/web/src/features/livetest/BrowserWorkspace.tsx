import * as React from "react";
import { AlertTriangle, PanelLeftClose, PanelLeftOpen, ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, ExternalLink, ListTodo, Loader2, Lock, Maximize2, Minimize2, MonitorPlay, RotateCw, ShieldAlert, WifiOff, X, XCircle } from "lucide-react";
import { Button, Card, Checkbox, Select, Tabs } from "@/components/ui";
import { StatusDot } from "@/components/common";
import { useToast } from "@/components/toast";
import { useAction } from "@/hooks/useAction";
import { cn } from "@/lib/utils";
import { tasksService } from "@/services/tasks";
import type { BrowserEvent, BrowserPreset, LiveTestState } from "@/services/connector";
import { CATEGORY_LABEL, contentRect, filterEvents, isProblem, keyInput, normalizeAddress, stateMessage, taskFromEvent, timeOnly, toFraction, type Category } from "./browserModel";
import type { Browser } from "./useBrowserSession";

type Run = Exclude<LiveTestState, { status: "idle" }>;
const ZOOMS = [{ value: "fit", label: "Fit" }, { value: "50", label: "50%" }, { value: "75", label: "75%" }, { value: "100", label: "100%" }, { value: "125", label: "125%" }];
const TONE_TEXT = { gray: "text-text-2", blue: "text-text-2", amber: "text-st-amber", red: "text-st-red" } as const;
const sevTone = (s: string) => (s === "high" || s === "critical" ? "red" : s === "medium" ? "amber" : "gray") as "red" | "amber" | "gray";

/** The picture's state in words, for the pane when there is nothing to look at. */
function Placeholder({ tone, title, detail, busy }: { tone: "gray" | "blue" | "amber" | "red"; title: string; detail: string; busy?: boolean }) {
  return (
    <div className="flex w-full flex-col items-center gap-2 px-6 py-16 text-center" data-testid="pane-message" data-tone={tone}>
      {busy ? <Loader2 className="size-5 animate-spin text-muted motion-reduce:animate-none" aria-hidden /> : tone === "red" ? <XCircle className="size-5 text-st-red" aria-hidden /> : tone === "amber" ? <WifiOff className="size-5 text-st-amber" aria-hidden /> : <MonitorPlay className="size-5 text-muted" aria-hidden />}
      <p className={cn("text-sm font-medium", TONE_TEXT[tone])}>{title}</p>
      <p className="max-w-sm text-sm text-text-2">{detail}</p>
    </div>
  );
}

/**
 * The centre panel: browser chrome (back, forward, reload, address bar, loading indicator, new tab, viewport, zoom, full screen) and the
 * page itself. The page is the real site in a real browser on this PC, shown as a live picture; your clicks, scrolling and typing are
 * sent to it as fractions of the picture, so they land in the right place at any zoom or screen size.
 */
export function BrowserPane({ browser, presets, offline, embedNote, testing, onCaptured, onAllowHost, setupHidden, onToggleSetup, onOpenAddress }: { onOpenAddress?: (url: string) => void; browser: Browser; presets: BrowserPreset[]; setupHidden?: boolean; onToggleSetup?: () => void; onAllowHost?: (host: string) => Promise<void> | void; offline: boolean; embedNote: string | null; testing: boolean; onCaptured: (msg: string) => void }) {
  const { state: s, frame, connection } = browser;
  const [address, setAddress] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [zoom, setZoom] = React.useState("fit");
  const [full, setFull] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState(false);
  const shell = React.useRef<HTMLDivElement>(null);
  const img = React.useRef<HTMLImageElement>(null);
  const url = s?.url ?? "";
  React.useEffect(() => { if (!editing) setAddress(url); }, [url, editing]);

  const usable = Boolean(s && (s.status === "ready" || s.status === "loading") && connection !== "lost");
  const locked = Boolean(s?.locked);
  const canType = usable && !locked && !s?.paused;
  const run = async (fn: () => Promise<unknown>) => { setProblem(null); try { await fn(); } catch (e) { setProblem(e instanceof Error ? e.message : "That did not work."); } };

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const next = normalizeAddress(address);
    if (!next) { setProblem("Enter a full web address, like https://example.com"); return; }
    setEditing(false);
    // with no preview open yet (or after it closed), the address bar opens one, like typing into a new tab
    if (!browser.token || s?.status === "closed" || s?.status === "disconnected") { onOpenAddress?.(next); return; }
    void run(() => browser.command({ type: "navigate", url: next }));
  };

  const aspect = s ? s.viewport.width / s.viewport.height : 0;
  const point = (e: { clientX: number; clientY: number }) => (img.current ? toFraction(contentRect(img.current.getBoundingClientRect(), aspect), e.clientX, e.clientY) : null);
  const onClick = (e: React.MouseEvent) => { if (!canType) return; shell.current?.focus(); const p = point(e); if (p) browser.send({ type: "click", ...p, count: e.detail >= 3 ? 3 : e.detail === 2 ? 2 : 1 }); };
  const onContext = (e: React.MouseEvent) => { e.preventDefault(); if (!canType) return; const p = point(e); if (p) browser.send({ type: "click", ...p, button: "right" }); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!canType) return;
    const k = keyInput(e);
    if (!k) return;
    e.preventDefault();
    browser.send(k);
  };
  const onPaste = (e: React.ClipboardEvent) => { if (!canType) return; const t = e.clipboardData.getData("text"); if (t) { e.preventDefault(); browser.send({ type: "text", text: t.slice(0, 500) }); } };
  // wheel must be a non-passive listener to stop the dashboard scrolling while the page does
  const pending = React.useRef({ dx: 0, dy: 0, fx: 0, fy: 0, t: 0 as unknown as ReturnType<typeof setTimeout> | 0 });
  React.useEffect(() => {
    const el = img.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!canType) return;
      e.preventDefault();
      const p = toFraction(contentRect(el.getBoundingClientRect(), aspect), e.clientX, e.clientY);
      const q = pending.current;
      q.dx += e.deltaX; q.dy += e.deltaY; q.fx = p.fx; q.fy = p.fy;
      if (!q.t) q.t = setTimeout(() => { const { dx, dy, fx, fy } = pending.current; pending.current = { dx: 0, dy: 0, fx, fy, t: 0 }; browser.send({ type: "wheel", fx, fy, dx, dy }); }, 40);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  React.useEffect(() => { const f = () => setFull(document.fullscreenElement === shell.current?.parentElement); document.addEventListener("fullscreenchange", f); return () => document.removeEventListener("fullscreenchange", f); }, []);
  const toggleFull = () => { const box = shell.current?.parentElement; if (!box) return; if (document.fullscreenElement) void document.exitFullscreen(); else void box.requestFullscreen?.().catch(() => setProblem("Full screen is not available in this browser.")); };
  const capture = () => void run(async () => { await browser.command({ type: "capture", note: "Screenshot captured" }); onCaptured("Screenshot captured. It is in the Errors tab under notes."); });

  const blockedHosts = React.useMemo(() => [...new Set(browser.events.filter((e) => e.category === "blocked").map((e) => { try { return new URL(e.url).hostname; } catch { return ""; } }).filter(Boolean))].slice(0, 4), [browser.events]);
  const message = stateMessage(s, Boolean(browser.token) || browser.opening, offline);
  const showMessage = !frame && message;
  const loading = Boolean(s && (s.loading || s.status === "launching" || s.status === "loading")) || browser.opening;
  const fitted = zoom === "fit";
  const width = s && !fitted ? `${Math.round(s.viewport.width * Number(zoom) / 100)}px` : "100%";
  const deviceOptions = presets.map((p) => ({ value: p.id, label: `${p.label} ${p.width}×${p.height}` }));

  return (
    <Card className={cn("flex min-w-0 flex-col overflow-hidden", full ? "h-screen rounded-none" : "h-[calc(100vh-150px)] min-h-[480px]")} data-testid="browser-pane">
      {/* ---- Chrome-style: a tab, the address row, then a thin device bar like the device mode in Chrome's own tools */}
      <div className="flex items-end gap-2 bg-hover px-2 pt-1.5" data-testid="browser-tabs">
        {onToggleSetup && <Button size="sm" variant="ghost" className="mb-1 hidden lg:inline-flex" onClick={onToggleSetup} aria-expanded={!setupHidden} data-testid="toggle-setup" title={setupHidden ? "Show set-up" : "Hide set-up"}>{setupHidden ? <PanelLeftOpen /> : <PanelLeftClose />}<span className="sr-only">{setupHidden ? "Show set-up" : "Hide set-up"}</span></Button>}
        <div className="flex min-w-0 max-w-[260px] items-center gap-2 rounded-t-lg bg-surface px-3 py-1.5 text-xs">
          {loading ? <Loader2 className="size-3.5 shrink-0 animate-spin text-muted motion-reduce:animate-none" aria-label="Loading" data-testid="loading" /> : <Lock className="size-3.5 shrink-0 text-muted" aria-hidden />}
          <span className="min-w-0 flex-1 truncate" data-testid="tab-title">{s?.title || (url ? new URL(url, "http://x").hostname : "New tab")}</span>
          {browser.token && <button className="shrink-0 rounded p-0.5 text-muted hover:bg-hover hover:text-text" aria-label="Close preview" title="Close the preview" onClick={() => void browser.close()}><X className="size-3.5" /></button>}
        </div>
      </div>
      <div className="flex items-center gap-1 border-b border-line bg-surface px-2 py-1.5" data-testid="browser-toolbar">
        <Button size="sm" variant="ghost" aria-label="Back" disabled={!usable || locked || !s?.canGoBack} onClick={() => void run(() => browser.command({ type: "back" }))}><ArrowLeft /></Button>
        <Button size="sm" variant="ghost" aria-label="Forward" disabled={!usable || locked || !s?.canGoForward} onClick={() => void run(() => browser.command({ type: "forward" }))}><ArrowRight /></Button>
        <Button size="sm" variant="ghost" aria-label="Refresh" disabled={!usable || locked} onClick={() => void run(() => browser.command({ type: "reload" }))}><RotateCw /></Button>
        <form className="flex min-w-[160px] flex-1 items-center gap-2 rounded-full bg-hover px-3" onSubmit={go}>
          <input aria-label="Address" value={address} disabled={locked || (connection === "lost" && Boolean(browser.token))} onFocus={(e) => { setEditing(true); e.currentTarget.select(); }} onBlur={() => setEditing(false)} onChange={(e) => setAddress(e.target.value)} placeholder="Search or enter a web address" spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-text outline-none placeholder:text-muted disabled:opacity-70" />
        </form>
        <Button size="sm" variant="ghost" aria-label="Capture screenshot" title="Capture screenshot" disabled={!usable} onClick={capture}><Camera /></Button>
        <Button size="sm" variant="ghost" aria-label="Open in a new tab" title="Open in a new tab (opens the site on its own, without this session)" disabled={!url} onClick={() => window.open(url, "_blank", "noopener,noreferrer")}><ExternalLink /></Button>
        <Button size="sm" variant="ghost" aria-label={full ? "Exit full screen" : "Full screen"} onClick={toggleFull}>{full ? <Minimize2 /> : <Maximize2 />}</Button>
      </div>
      <div className="flex items-center gap-2 border-b border-line bg-side px-2 py-1 text-xs text-text-2" data-testid="device-bar" title="Emulated in Chromium on this PC: screen size, pixel density, touch and user agent. It is not a physical phone or Safari's engine.">
        <Select aria-label="Screen size" className="w-[170px]" value={s?.device ?? "desktop"} disabled={!usable || locked} onChange={(e) => void run(() => browser.command({ type: "device", device: e.target.value }))} options={deviceOptions} />
        <Select aria-label="Zoom" className="w-[80px]" value={zoom} onChange={(e) => setZoom(e.target.value)} options={ZOOMS} />
        <span className="ml-auto hidden text-muted sm:inline" data-testid="focus-hint">{focused && canType ? "Typing goes to the page" : canType ? "Click the page, then type" : "Emulated device"}</span>
      </div>

      {/* ---- banners */}
      {problem && <p className="border-b border-line bg-st-red/5 px-3 py-1.5 text-xs text-st-red" role="alert" data-testid="pane-problem">{problem}</p>}
      {connection === "lost" && s?.status !== "closed" && <p className="flex items-center gap-2 border-b border-line bg-st-amber/10 px-3 py-1.5 text-xs text-st-amber" data-testid="lost"><WifiOff className="size-3.5" />The connection to the preview was lost. It reconnects by itself; if not, open the preview again.</p>}
      {s?.headed && <p className="flex items-center gap-2 border-b border-line bg-st-blue/10 px-3 py-1.5 text-xs text-st-blue" data-testid="headed"><ExternalLink className="size-3.5" />A Chrome window is open on this PC. Use that window; the picture here follows it, and errors and screenshots are still recorded. Closing the window ends the session.</p>}
      {s?.captcha && <p className="flex items-center gap-2 border-b border-line bg-st-amber/10 px-3 py-1.5 text-xs text-st-amber" data-testid="captcha"><ShieldAlert className="size-3.5" />A CAPTCHA is on this page. It is never bypassed: solve it yourself here, then carry on.</p>}
      {locked && <p className="flex items-center gap-2 border-b border-line bg-st-blue/10 px-3 py-1.5 text-xs text-st-blue" data-testid="locked"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />{s?.lockedBy ? `${s.lockedBy[0]!.toUpperCase()}${s.lockedBy.slice(1)}` : "A test is running"}. You can watch; clicking and typing are off until it ends.</p>}
      {s?.paused && <p className="flex items-center gap-2 border-b border-line bg-side px-3 py-1.5 text-xs text-text-2" data-testid="paused"><Lock className="size-3.5" />Picture paused while a secret is typed.</p>}
      {testing && <p className="flex items-center gap-2 border-b border-line bg-st-blue/10 px-3 py-1.5 text-xs text-st-blue" data-testid="testing-banner"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />An all-device test is running in its own browser. This preview is untouched.</p>}

      {blockedHosts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-st-amber/10 px-3 py-1.5 text-xs text-st-amber" data-testid="blocked-hosts">
          <span className="min-w-0">Some of the page (pictures, fonts) comes from {blockedHosts.length === 1 ? "a host" : "hosts"} that {blockedHosts.length === 1 ? "is" : "are"} not allowed, so it may look broken:</span>
          {blockedHosts.map((h) => (onAllowHost
            ? <Button key={h} size="sm" onClick={() => void run(async () => { await onAllowHost(h); })} data-testid={`allow-${h}`}>Allow {h}</Button>
            : <span key={h} className="font-mono">{h}</span>))}
          {!onAllowHost && <span>Ask an admin to allow {blockedHosts.length === 1 ? "it" : "them"} in Settings.</span>}
        </div>
      )}

      {/* ---- the page */}
      <div ref={shell} tabIndex={0} role="application" aria-label="Live browser preview" onKeyDown={onKeyDown} onPaste={onPaste} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        className={cn("relative flex min-h-0 flex-1 justify-center bg-side outline-none focus-visible:ring-2 focus-visible:ring-accent/40", fitted ? "items-center overflow-hidden p-2" : "items-start overflow-auto")} data-testid="viewport">
        {frame && s?.status !== "closed" ? (
          <div className={cn("shrink-0", fitted && "h-full")} style={fitted && s ? { aspectRatio: `${s.viewport.width} / ${s.viewport.height}`, maxWidth: "100%" } : undefined} data-testid="fit-box">
          <img ref={img} src={frame} alt={s?.title ? `Live preview of ${s.title}` : "Live preview of the site"} draggable={false} onClick={onClick} onContextMenu={onContext}
            className={cn("block select-none bg-white", fitted ? "h-full w-full object-contain" : "h-auto max-w-none", s && s.device !== "desktop" && s.device !== "laptop" && "shadow-md ring-1 ring-line", canType ? "cursor-pointer" : "cursor-default")} style={fitted ? undefined : { width }} data-testid="picture" />
          </div>
        ) : showMessage ? <Placeholder {...message} busy={message.tone === "blue"} /> : (
          <Placeholder tone="blue" title="Loading the page…" detail={url ? `Waiting for ${url}` : "Waiting for the first picture."} busy />
        )}
      </div>

      {s?.status === "error" && frame && <p className="border-t border-line bg-st-red/5 px-3 py-1.5 text-xs text-st-red" data-testid="pane-error">{message?.title}: {message?.detail}</p>}
      {embedNote && <p className="truncate border-t border-line px-3 py-1 text-[11px] text-muted" title={embedNote} data-testid="embed-note">{embedNote}</p>}
    </Card>
  );
}

/** One problem, opened: what it was, where, when, the picture taken at that moment, and what to do with it. */
function EventDetail({ ev, browser, reviewed, onReview, campaignId, device }: { ev: BrowserEvent; browser: Browser; reviewed: boolean; onReview: () => void; campaignId: string; device: string }) {
  const toast = useToast();
  const [blob, setBlob] = React.useState<string | null>(null);
  const [missing, setMissing] = React.useState(false);
  React.useEffect(() => {
    setBlob(null); setMissing(false);
    if (!ev.shotRef) return;
    let gone = false, made: string | null = null;
    void browser.shot(ev.shotRef).then((b) => { if (gone) return; if (!b) { setMissing(true); return; } made = URL.createObjectURL(b); setBlob(made); });
    return () => { gone = true; if (made) URL.revokeObjectURL(made); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev.id, ev.shotRef, browser.token]);
  const task = useAction(() => { const t = taskFromEvent(ev, { device }); return tasksService.create({ campaign_id: campaignId, title: t.title, description: t.description, priority: ev.severity === "high" ? "high" : "medium" }); }, { error: "Could not create the task", invalidate: [["tasks"]], onSuccess: () => toast.success("Task created in the campaign") });
  return (
    <div className="space-y-2 border-t border-line bg-side px-3 py-3 text-sm" data-testid="event-detail">
      <p className="break-words font-medium">{ev.message}</p>
      <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted">Page</dt><dd className="break-all font-mono">{ev.page || ev.url}</dd>
        {ev.url && ev.url !== ev.page && <><dt className="text-muted">Request</dt><dd className="break-all font-mono">{ev.method} {ev.url}</dd></>}
        {ev.status ? <><dt className="text-muted">Status</dt><dd>{ev.status}</dd></> : null}
        <dt className="text-muted">Time</dt><dd>{timeOnly(ev.at)}</dd>
        <dt className="text-muted">Type</dt><dd>{CATEGORY_LABEL[(({ "page-error": "javascript", "console-error": "javascript", "console-warning": "javascript", "network-failed": "network", blocked: "network", "http-error": "http", navigation: "navigation", crash: "navigation", captcha: "navigation", test: "test" }) as Record<string, Category>)[ev.category] ?? "other"]}</dd>
        {ev.evidence && <><dt className="text-muted">Evidence</dt><dd className="whitespace-pre-wrap break-words font-mono">{ev.evidence}</dd></>}
      </dl>
      {ev.category === "http-error" && <p className="text-xs text-muted">A 4xx or 5xx is not always a bug: a missing favicon or a tracker that is blocked can look like this. Check whether the page itself is affected.</p>}
      {ev.shotRef ? (blob ? <img src={blob} alt="Screenshot taken when this happened" className="max-h-56 w-full rounded-box border border-line object-contain" data-testid="evidence" /> : missing ? <p className="text-xs text-muted">The screenshot is no longer available.</p> : <p className="text-xs text-muted">Loading the screenshot…</p>) : <p className="text-xs text-muted">No screenshot was kept for this one.</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={onReview} data-testid="mark-reviewed"><Check />{reviewed ? "Mark as not reviewed" : "Mark reviewed"}</Button>
        <Button size="sm" disabled={!campaignId} loading={task.isPending} onClick={() => task.mutate(undefined)} title={campaignId ? "" : "Choose a campaign first"} data-testid="make-task"><ListTodo />Create Journey task</Button>
      </div>
    </div>
  );
}

/** The right panel: Errors, Console, Network, Test steps, Findings. */
export function InspectPanel({ browser, run, campaignId, device }: { browser: Browser; run: Run | null; campaignId: string; device: string }) {
  const [tab, setTab] = React.useState<"errors" | "console" | "network" | "steps" | "findings">("errors");
  const [category, setCategory] = React.useState<Category>("all");
  const [showInfo, setShowInfo] = React.useState(false);
  const [hideReviewed, setHideReviewed] = React.useState(false);
  const { reviewed, toggleReviewed } = browser;
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [netFilter, setNetFilter] = React.useState<"all" | "failed">("all");

  const problems = browser.events.filter(isProblem);
  const shown = filterEvents(browser.events, category, showInfo, reviewed, hideReviewed);
  const list = [...shown].reverse();
  const open = browser.events.find((e) => e.id === openId) ?? null;
  const captures = browser.events.filter((e) => e.category === "capture");
  const net = netFilter === "failed" ? browser.network.filter((n) => n.failed || (n.status ?? 0) >= 400) : browser.network;
  const runFindings = run?.mode === "auto" ? (run.auto?.findings ?? []) : [];
  const stepCount = run ? run.steps.length : 0;

  return (
    <Card className="flex h-[calc(100vh-150px)] min-h-[480px] min-w-0 flex-col overflow-hidden" data-testid="inspect">
      <Tabs value={tab} onChange={setTab} className="px-2"
        tabs={[{ value: "errors", label: "Errors", count: problems.length || undefined }, { value: "console", label: "Console", count: browser.consoleLog.length || undefined }, { value: "network", label: "Network", count: browser.network.length || undefined }, { value: "steps", label: "Steps", count: stepCount || undefined }, { value: "findings", label: "Findings", count: runFindings.length || undefined }]} />

      {tab === "errors" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <Select aria-label="Filter by category" className="w-[130px]" value={category} onChange={(e) => setCategory(e.target.value as Category)} options={(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
            <Checkbox checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} label="Notes" />
            <Checkbox checked={hideReviewed} onChange={(e) => setHideReviewed(e.target.checked)} label="Hide reviewed" />
          </div>
          {!list.length ? (
            <p className="px-3 py-4 text-sm text-text-2" data-testid="errors-empty">{!browser.token ? "Problems found while you use the site appear here, with a screenshot." : problems.length ? "Nothing matches the filter." : "No errors so far. New ones appear here as they happen."}</p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto" data-testid="errors-list" aria-live="polite">
              {list.map((e) => (
                <li key={e.id}>
                  <button className={cn("flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-hover", e.id === openId && "bg-active")} onClick={() => setOpenId(e.id === openId ? null : e.id)} data-testid={`ev-${e.id}`} data-reviewed={reviewed.has(e.id)} data-category={e.category}>
                    <StatusDot tone={sevTone(e.severity)} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block break-words text-sm", reviewed.has(e.id) && "text-muted line-through")}>{e.message}</span>
                      <span className="block truncate text-xs text-muted">{timeOnly(e.at)} · {e.page || e.url}{e.hasShot || e.shotRef ? " · screenshot" : ""}</span>
                    </span>
                    {reviewed.has(e.id) && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-st-green" aria-label="Reviewed" />}
                  </button>
                  {e.id === openId && open && <EventDetail ev={open} browser={browser} reviewed={reviewed.has(open.id)} onReview={() => toggleReviewed(open.id)} campaignId={campaignId} device={device} />}
                </li>
              ))}
            </ul>
          )}
          {captures.length > 0 && <p className="border-t border-line px-3 py-1.5 text-xs text-muted">{captures.length} screenshot{captures.length === 1 ? "" : "s"} captured. Turn on “Notes” to open them.</p>}
        </div>
      )}

      {tab === "console" && (browser.consoleLog.length === 0 ? <p className="px-3 py-4 text-sm text-text-2" data-testid="console-empty">Nothing has been logged by the page yet.</p> : (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto font-mono text-xs" data-testid="console-list">
          {[...browser.consoleLog].reverse().map((c) => <li key={c.id} className={cn("px-3 py-1.5", c.type === "error" && "text-st-red", c.type === "warning" && "text-st-amber")}><span className="text-muted">{timeOnly(c.at)}</span> {c.type}: {c.text}{c.location ? <span className="block text-muted">{c.location}</span> : null}</li>)}
        </ul>
      ))}

      {tab === "network" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2"><Select aria-label="Network filter" className="w-[150px]" value={netFilter} onChange={(e) => setNetFilter(e.target.value as "all" | "failed")} options={[{ value: "all", label: "All requests" }, { value: "failed", label: "Failed only" }]} /><span className="text-xs text-muted">The last 500 requests</span></div>
          {net.length === 0 ? <p className="px-3 py-4 text-sm text-text-2" data-testid="network-empty">No requests to show.</p> : (
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto font-mono text-xs" data-testid="network-list">
              {[...net].reverse().map((n) => <li key={n.id} className="px-3 py-1.5"><span className={cn("mr-1", n.failed || (n.status ?? 0) >= 500 ? "text-st-red" : (n.status ?? 0) >= 400 ? "text-st-amber" : "text-muted")}>{n.failed ? "failed" : n.status ?? "…"}</span><span className="text-muted">{n.method}</span> <span className="break-all">{n.url}</span>{n.ms != null && <span className="text-muted"> · {n.ms} ms</span>}</li>)}
            </ul>
          )}
        </div>
      )}

      {tab === "steps" && (!run ? <p className="px-3 py-4 text-sm text-text-2" data-testid="steps-empty">Steps of the test you run appear here, one by one.</p> : (
        <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto" data-testid="inspect-steps">
          {run.steps.map((st) => <li key={st.i} className="flex items-start gap-2 px-3 py-2 text-sm" data-status={st.status}><StatusDot tone={st.status === "passed" ? "green" : st.status === "failed" ? "red" : st.status === "running" || st.status === "asking" ? "blue" : "gray"} /><span className="min-w-0 flex-1 break-words">{st.action} {st.target}{st.note && <span className="block text-xs text-muted">{st.note}</span>}</span></li>)}
        </ol>
      ))}

      {tab === "findings" && (!runFindings.length ? <p className="px-3 py-4 text-sm text-text-2" data-testid="findings-empty">{run?.mode === "auto" && !run.finishedAt ? "Findings appear here when every device has been checked." : "Run the all-device test to get findings grouped by the devices they were seen on."}</p> : (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto" data-testid="inspect-findings">
          {runFindings.map((f, i) => <li key={i} className="space-y-0.5 px-3 py-2 text-sm"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted" /><span className="min-w-0 flex-1 font-medium">{f.title}</span></div><p className="pl-6 text-xs text-muted">{f.seen}</p><p className="pl-6 text-xs text-text-2">{f.description}</p></li>)}
        </ul>
      ))}
    </Card>
  );
}
