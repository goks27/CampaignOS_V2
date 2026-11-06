import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronRight, Circle, Clock, Download, Loader2, Lock, MonitorPlay, Play, Plus, RotateCcw, Save, Send, Square, Trash2, XCircle } from "lucide-react";
import { Button, Card, Checkbox, Dialog, DialogContent, Field, Input, Select, Tabs, Textarea } from "@/components/ui";
import { PageHeader, Pill, StatusDot } from "@/components/common";
import { useToast } from "@/components/toast";
import { useAction } from "@/hooks/useAction";
import { qk, useCampaigns, useConnectorStatus, useSettings } from "@/hooks/queries";
import { DEVICE_LABEL } from "@/lib/devices";
import { SEVERITY_LABEL, SEVERITY_TONE, type Severity } from "@/lib/labels";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";
import { browserService, connectorService, liveTestService, type AutoResult, type BrowserPreset, type LiveTestState, type LiveTestStep } from "@/services/connector";
import { developmentService, type Step } from "@/services/development";
import { liveSessionsService } from "@/services/liveSessions";
import type { CampaignWithRelations } from "@/services/campaigns";
import { placeLabel } from "@/features/live/model";
import { BrowserPane, InspectPanel } from "./BrowserWorkspace";
import { PRESET_FALLBACK } from "./browserModel";
import { useBrowserSession } from "./useBrowserSession";
import { ACTIONS, META, STATUS_LABEL, STATUS_TONE, autoRequest, bySeverity, fromScenario, logText, looksLikeUrl, loginProblem, needsValue, newStep, placeholdersOf, problem, resultLine, stepSentence, toRequest, toScenario, type Credentials, type EditStep, type Inputs } from "./model";

type Run = Exclude<LiveTestState, { status: "idle" }>;
const DEVICES = Object.entries(DEVICE_LABEL).filter(([id]) => id !== "mobile").map(([value, label]) => ({ value, label }));
const DEVICE_NAME: Record<string, string> = { desktop: "Desktop", laptop: "Laptop", tablet: "iPad", iphone: "iPhone", android: "Android" };
const SECRETISH = /pass|otp|pin|code|secret|token/i;
const RESULT_TEXT = { green: "text-st-green", red: "text-st-red", amber: "text-st-amber", blue: "text-st-blue", gray: "text-text-2" } as const;
const LOGIN_LABEL: Record<string, string> = { ok: "Signed in", registered: "Registered", none: "No login used", failed: "Sign-in failed", needs: "Needs details", blocked: "CAPTCHA" };

/** Keeps a blob URL for as long as the blob is wanted, and frees it afterwards. */
function useBlobUrl(blob: Blob | null) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function StepIcon({ status }: { status: LiveTestStep["status"] }) {
  const c = "mt-0.5 size-4 shrink-0";
  if (status === "passed") return <CheckCircle2 className={cn(c, "text-st-green")} aria-label="Passed" />;
  if (status === "failed") return <XCircle className={cn(c, "text-st-red")} aria-label="Failed" />;
  if (status === "running") return <Loader2 className={cn(c, "animate-spin text-st-blue motion-reduce:animate-none")} aria-label="Running" />;
  if (status === "asking") return <Clock className={cn(c, "text-st-amber")} aria-label="Waiting for you" />;
  return <Circle className={cn(c, "text-muted")} aria-label={status === "skipped" ? "Skipped" : "Not run yet"} />;
}

function StepRow({ s, i, last, onChange, onMove, onRemove, disabled }: { s: EditStep; i: number; last: boolean; onChange: (p: Partial<EditStep>) => void; onMove: (d: number) => void; onRemove: () => void; disabled: boolean }) {
  const m = META.get(s.action)!;
  const hideable = s.action === "ask" || s.action === "fill";
  return (
    <li className="space-y-1.5 rounded-box border border-line p-2" data-testid={`step-${i}`}>
      <div className="flex items-center gap-1.5">
        <span className="w-4 shrink-0 text-center text-xs text-muted num">{i + 1}</span>
        <div className="min-w-0 flex-1">
          <Select aria-label={`Step ${i + 1} action`} disabled={disabled} value={s.action} onChange={(e) => onChange({ action: e.target.value as EditStep["action"], secret: e.target.value === "ask" ? true : s.secret, value: needsValue(e.target.value as EditStep["action"]) ? s.value : "" })}
            options={ACTIONS.map((a) => ({ value: a.value, label: a.label }))} />
        </div>
        {hideable && <Checkbox disabled={disabled} checked={s.secret} onChange={(e) => onChange({ secret: e.target.checked })} label="Hide value" className="shrink-0 text-xs" />}
        <Button size="icon" variant="ghost" aria-label="Move up" disabled={disabled || i === 0} onClick={() => onMove(-1)}><ArrowUp /></Button>
        <Button size="icon" variant="ghost" aria-label="Move down" disabled={disabled || last} onClick={() => onMove(1)}><ArrowDown /></Button>
        <Button size="icon" variant="ghost" aria-label={`Remove step ${i + 1}`} disabled={disabled} onClick={onRemove}><Trash2 /></Button>
      </div>
      <div className={cn("grid gap-1.5", needsValue(s.action) && "grid-cols-2")}>
        <Input aria-label={`Step ${i + 1} ${m.target}`} disabled={disabled} value={s.target} onChange={(e) => onChange({ target: e.target.value })} placeholder={m.targetHint} />
        {needsValue(s.action) && <Input aria-label={`Step ${i + 1} ${m.valueLabel}`} disabled={disabled} value={s.value} onChange={(e) => onChange({ value: e.target.value })} placeholder={m.valueHint} />}
      </div>
    </li>
  );
}

/** Each device with what it found, live. A click opens the problems seen on it. */
function DeviceList({ auto, running }: { auto: AutoResult; running: boolean }) {
  const [open, setOpen] = React.useState<string | null>(null);
  if (!auto.devices.length) return <p className="px-3 py-4 text-sm text-text-2">{running ? "The first device is still being checked…" : "No device finished."}</p>;
  return (
    <ul className="divide-y divide-line" data-testid="auto-devices">
      {auto.devices.map((d) => {
        const ran = d.pages_tested > 0;
        return (
          <li key={d.id} data-testid={`auto-device-${d.id}`}>
            <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-hover disabled:cursor-default" disabled={!d.top_issues.length} onClick={() => setOpen(open === d.id ? null : d.id)} aria-expanded={open === d.id}>
              <ChevronRight className={cn("size-4 shrink-0 text-muted transition-transform", open === d.id && "rotate-90", !d.top_issues.length && "opacity-0")} />
              <span className="min-w-0 flex-1"><span className="font-medium">{d.label}</span><span className="block text-xs text-muted">{d.family} · {ran ? `${d.pages_tested} page${d.pages_tested === 1 ? "" : "s"}` : "not tested"}{d.login !== "none" ? ` · ${LOGIN_LABEL[d.login] ?? d.login}` : ""}</span></span>
              {!ran ? <StatusDot tone="gray" label="Not tested" /> : d.issues ? <StatusDot tone={d.pages_failed ? "red" : "amber"} label={`${d.issues} issue${d.issues === 1 ? "" : "s"}`} /> : <StatusDot tone="green" label="No issues" />}
            </button>
            {open === d.id && <ul className="list-disc space-y-0.5 bg-side px-8 py-2 text-sm" data-testid={`auto-device-${d.id}-issues`}>{d.top_issues.map((t) => <li key={t}>{t}</li>)}</ul>}
          </li>
        );
      })}
    </ul>
  );
}

function FindingsList({ auto }: { auto: AutoResult }) {
  if (!auto.findings.length) return <p className="px-3 py-4 text-sm text-text-2">Nothing to report yet.</p>;
  return (
    <ul className="divide-y divide-line" data-testid="auto-findings">
      {bySeverity(auto.findings).map((f, i) => (
        <li key={i} className="space-y-1 px-3 py-2.5 text-sm">
          <div className="flex items-start gap-2"><Pill tone={SEVERITY_TONE[f.severity as Severity] ?? "gray"}>{SEVERITY_LABEL[f.severity as Severity] ?? f.severity}</Pill><span className="min-w-0 flex-1 font-medium">{f.title}</span></div>
          {f.description && <p className="text-text-2">{f.description}</p>}
          {f.fix && <p className="text-xs text-muted">Fix: {f.fix}</p>}
          {f.seen && <p className="text-xs text-muted">{f.seen}</p>}
        </li>
      ))}
    </ul>
  );
}

/** The browser's address bar: which page it is on and, while it runs, which device and page of the site. */
function BrowserBar({ url, where, busy }: { url: string; where: string; busy: boolean }) {
  return (
    <div className="flex items-center gap-2 border-b border-line bg-side px-3 py-1.5" data-testid="browser-bar">
      <Lock className="size-3.5 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate rounded-ctl bg-surface px-2 py-1 font-mono text-xs text-text-2" title={url}>{url}</span>
      {where && <span className="hidden shrink-0 text-xs text-muted sm:inline" data-testid="browser-where">{where}</span>}
      {busy && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted motion-reduce:animate-none" aria-label="Loading" />}
    </div>
  );
}

type ErrorRow = { device: string; page: string; severity: string; title: string };
/** The errors found so far, next to the test browser, newest first. They arrive while the test is still running. */
function ErrorsPanel({ errors, waiting, started }: { errors: ErrorRow[]; waiting: boolean; started: boolean }) {
  const list = [...errors].reverse();
  const bad = errors.filter((e) => ["critical", "high", "medium"].includes(e.severity)).length;
  return (
    <Card className="flex max-h-[520px] min-h-[160px] flex-col overflow-hidden" data-testid="errors-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <AlertTriangle className="size-4 text-muted" aria-hidden />
        <p className="flex-1 text-sm font-medium">Errors</p>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium num", bad ? "bg-st-red/15 text-st-red" : errors.length ? "bg-st-amber/15 text-st-amber" : "bg-hover text-text-2")} data-testid="errors-count">{errors.length}</span>
      </div>
      {!list.length ? (
        <p className="px-3 py-4 text-sm text-text-2" data-testid="errors-empty">{!started ? "Errors found while the test runs appear here, one by one." : waiting ? "None so far. New ones appear here as they are found." : "No errors were found."}</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto" data-testid="errors-list" aria-live="polite">
          {list.map((e, i) => (
            <li key={`${e.device}|${e.page}|${e.title}|${i}`} className="px-3 py-2 text-sm">
              <div className="flex items-start gap-2"><StatusDot tone={e.severity === "critical" || e.severity === "high" ? "red" : e.severity === "medium" ? "amber" : "gray"} /><span className="min-w-0 flex-1 font-medium">{e.title}</span></div>
              <p className="mt-0.5 pl-4 text-xs text-muted">{e.device} · {e.page}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The standalone page: any campaign, or none. */
export function LiveTestPage() { return <LiveTest />; }

/**
 * The live test. Put a URL in and it runs by itself on every device (and signs in if you gave it login details). Your own steps
 * are an option underneath. On its own page it works for any campaign (or none). Inside a campaign's Development section the URL
 * starts as the latest staging build, the allowed domains come from its test environments, scenarios and recent runs are its own,
 * and "Save as scenario" saves back to it.
 */
export function LiveTest({ campaign }: { campaign?: CampaignWithRelations }) {
  const toast = useToast();
  const qc = useQueryClient();
  const connector = useConnectorStatus().data;
  const settings = useSettings().data;
  const campaigns = useCampaigns().data ?? [];

  const [url, setUrl] = React.useState("");
  const [creds, setCreds] = React.useState<Credentials>({ username: "", password: "", extra: "" });
  const [device, setDevice] = React.useState("desktop");
  const [steps, setSteps] = React.useState<EditStep[]>([{ ...newStep("click"), action: "expect_text" }]);
  const [inputs, setInputs] = React.useState<Inputs>({});
  const [pickedCampaign, setPicked] = React.useState("");
  const campaignId = campaign?.id ?? pickedCampaign;
  const campaignName = campaign?.name ?? campaigns.find((c) => c.id === pickedCampaign)?.name ?? "";
  const [scenarioId, setScenarioId] = React.useState("");
  const [tab, setTab] = React.useState<"devices" | "findings" | "progress" | "steps" | "console">("devices");
  const [viewRun, setViewRun] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState<number | null>(null);
  const [answer, setAnswer] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [pick, setPick] = React.useState<"browser" | "run" | null>(null);
  const [previewDevice, setPreviewDevice] = React.useState("desktop");
  const [embedNote, setEmbedNote] = React.useState<string | null>(null);
  const browser = useBrowserSession();
  const savedSessions = useQuery({ queryKey: ["live-sessions", campaignId], queryFn: () => liveSessionsService.list(campaignId), enabled: Boolean(campaignId), retry: false });
  const saveSession = useAction(() => {
    const st = browser.state!;
    return liveSessionsService.save({ campaignId, buildLabel: (builds.data ?? []).find((b) => b.staging_url === url)?.version_label, url: st.url, device: st.device, sessionRef: st.id, startedAt: st.startedAt, events: browser.events, reviewed: browser.reviewed, counts: st.counts });
  }, { error: "Could not save the session", invalidate: [["live-sessions"]], onSuccess: () => toast.success("Session saved. Screenshots are not saved.") });
  const removeSession = useAction((id: string) => liveSessionsService.remove(id), { error: "Could not delete", invalidate: [["live-sessions"]] });
  const presets = useQuery({ queryKey: ["browser", "presets"], queryFn: () => browserService.presets(), retry: false, staleTime: 60_000 });
  const presetList: BrowserPreset[] = presets.data ?? PRESET_FALLBACK;

  const builds = useQuery({ queryKey: [...qk.dev(campaignId), "subs"], queryFn: () => developmentService.submissions(campaignId), enabled: Boolean(campaignId) });
  const envs = useQuery({ queryKey: [...qk.dev(campaignId), "env"], queryFn: () => developmentService.environments(campaignId), enabled: Boolean(campaignId) });
  // Inside a campaign the URL starts as its latest staging build (or its test environment), so there is nothing to look up. Only fills an empty box.
  React.useEffect(() => {
    setUrl((u) => u || builds.data?.[0]?.staging_url || envs.data?.[0]?.base_url || "");
  }, [builds.data, envs.data]);
  const scenarios = useQuery({ queryKey: [...qk.dev(campaignId), "cases"], queryFn: () => developmentService.testCases(campaignId), enabled: Boolean(campaignId) });

  // ---- the runs, as the connector reports them (kept in memory on this PC until it restarts)
  const allRuns = useQuery({ queryKey: ["livetest", "runs"], queryFn: () => liveTestService.runs(), retry: false, refetchInterval: (q) => (q.state.data?.some((r) => !r.finishedAt) ? 1000 : 4000) });
  const anyActive = Boolean(allRuns.data?.some((r) => !r.finishedAt));
  const runs = React.useMemo(() => (allRuns.data ?? []).filter((r) => !campaign || r.campaignId === campaign.id), [allRuns.data, campaign]);
  const latestId = runs[0]?.runId ?? null;
  const selectedId = viewRun ?? latestId;
  React.useEffect(() => { setViewRun(null); setViewing(null); setAnswer(""); }, [latestId]);
  const state = useQuery({ queryKey: ["livetest", "state", selectedId], queryFn: () => liveTestService.state(selectedId ?? undefined), enabled: Boolean(selectedId), retry: false, refetchInterval: (q) => { const d = q.state.data; return d && d.status !== "idle" && !d.finishedAt ? 600 : false; } });
  const run: Run | null = selectedId && state.data && state.data.status !== "idle" ? state.data : null;
  const isAuto = run?.mode === "auto";
  const active = Boolean(run && !run.finishedAt);
  const online = connector != null;
  const jobRunning = Boolean(connector?.busy);
  // the tab that makes sense for the kind of run being looked at
  React.useEffect(() => { setTab((t) => (isAuto ? (["steps", "console"].includes(t) ? "devices" : t) : (["devices", "findings", "progress"].includes(t) ? "steps" : t))); }, [isAuto, run?.runId]);

  // ---- the picture: live while it runs, then the picture kept for the step you click
  const [liveBlob, setLiveBlob] = React.useState<Blob | null>(null);
  const [shotBlob, setShotBlob] = React.useState<Blob | null>(null);
  React.useEffect(() => {
    if (!active) return;
    let gone = false;
    const tick = async () => { const b = await connectorService.liveFrame(); if (!gone && b) setLiveBlob(b); };
    void tick();
    const t = setInterval(() => void tick(), 450);
    return () => { gone = true; clearInterval(t); };
  }, [active]);
  const lastShot = run ? [...run.steps].reverse().find((s) => s.hasShot)?.i ?? null : null;
  const shownStep = viewing ?? (!active ? lastShot : null);
  const shownRunId = run?.runId, shownFinished = run?.finishedAt;
  React.useEffect(() => {
    if (shownStep == null || !shownRunId) { setShotBlob(null); return; }
    let gone = false;
    void liveTestService.shot(shownStep, shownRunId).then((b) => { if (!gone) setShotBlob(b); });
    return () => { gone = true; };
  }, [shownStep, shownRunId, shownFinished]);
  const liveUrl = useBlobUrl(liveBlob), shotUrl = useBlobUrl(shotBlob);
  const whereQuery = useQuery({ queryKey: ["live", "where"], queryFn: () => connectorService.live(), enabled: active, retry: false, refetchInterval: 1000 });
  const whereLabel = active && whereQuery.data?.active ? placeLabel(whereQuery.data.where) : "";
  const picture = viewing != null || !active ? shotUrl : liveUrl;

  // ---- what to run
  const allowed = React.useMemo(() => [...(settings?.allowed_domains ?? []), ...(envs.data ?? []).flatMap((e) => e.allowed_domains ?? [])], [settings, envs.data]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["livetest"] }); };
  const ready = online && !jobRunning && !anyActive;
  const view: "browser" | "run" = pick ?? (selectedId && state.data && state.data.status !== "idle" ? "run" : "browser");
  const sessionReady = Boolean(browser.token && browser.state && (browser.state.status === "ready" || browser.state.status === "loading") && !browser.state.locked);
  const openPreview = async (override?: string) => {
    const target = (override ?? url).trim();
    if (!online || !looksLikeUrl(target)) return;
    setPick("browser"); setEmbedNote(null);
    void browser.open({ url: target, device: previewDevice, allowed, campaign: campaignId ? { id: campaignId, name: campaignName } : undefined, credentials: creds.extra.trim() ? { extra: creds.extra } : undefined });
    const check = await browserService.embeddable(target, allowed);
    setEmbedNote(check?.embeddable === false
      ? `${check.reason ?? "The site blocks embedding."} Journey does not need to embed it: the page runs in a real browser on this PC and is shown here as a live picture.`
      : "Shown as a live picture of a real browser on this PC (not an embedded frame), so clicks, tests and error capture all happen in the same page.");
  };
  const autoBlocker = !looksLikeUrl(url) ? "Enter the staging URL, starting with https://" : loginProblem(creds);
  const startAuto = useAction((override?: string) => liveTestService.start(autoRequest(override ?? url, creds, allowed, campaignId ? { id: campaignId, name: campaignName } : undefined)), { error: "Could not start", onSuccess: () => { setPick("run"); refresh(); } });

  // Pasting a web address starts the test straight away; so does Enter. Typing alone never does.
  const onPasteUrl = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").trim();
    if (!looksLikeUrl(text)) return;
    e.preventDefault();
    setUrl(text);
    void openPreview(text);
  };

  // ---- your own steps (optional)
  const names = React.useMemo(() => placeholdersOf(steps), [steps]);
  const inputOf = (n: string) => inputs[n] ?? { value: "", secret: SECRETISH.test(n) };
  const setInput = (n: string, p: Partial<Inputs[string]>) => setInputs((o) => ({ ...o, [n]: { ...inputOf(n), ...p } }));
  const full: Inputs = Object.fromEntries(names.map((n) => [n, inputOf(n)]));
  const stepsBlocker = problem(url, steps, full);
  const patch = (id: string, p: Partial<EditStep>) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => setSteps((s) => { const n = [...s]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); return n; });
  const startSteps = useAction(() => liveTestService.start({ ...toRequest(url, device, steps, full, allowed, campaignId ? { id: campaignId, name: campaignName } : undefined), ...(sessionReady ? { session_token: browser.token! } : {}) }), { error: "Could not start", onSuccess: () => { setPick(sessionReady ? "browser" : "run"); refresh(); } });
  const send = useAction((skip?: boolean) => liveTestService.answer(run!.prompt!.id, answer, Boolean(skip)), { error: "Could not send", onSuccess: () => { setAnswer(""); refresh(); } });
  const stop = useAction(() => liveTestService.stop(), { onSuccess: refresh });

  const pickScenario = (id: string) => {
    setScenarioId(id);
    const tc = (scenarios.data ?? []).find((x) => x.id === id);
    if (tc) { setSteps(fromScenario((tc.steps as Step[]) ?? [])); setInputs({}); }
  };
  const download = () => {
    if (!run) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([logText(run)], { type: "text/plain" }));
    a.download = `live-test-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const starting = startAuto.isPending || startSteps.isPending;
  // an automatic run lists the problems it finds; a run of your own steps lists its console errors and failed requests
  const errorRows: ErrorRow[] = !run ? [] : isAuto ? (run.auto?.errors ?? [])
    : [...run.console.map((c) => ({ device: run.deviceLabel, page: "console", severity: c.type === "warning" ? "low" : "medium", title: c.text })), ...run.failed.map((f) => ({ device: run.deviceLabel, page: "network", severity: "medium", title: `${f.status ?? f.error ?? "failed"} ${f.url}` }))];
  const startHint = !online ? "The connector is not running on this PC. Run npm run claude in the project folder, then try again." : jobRunning ? "A review is running on this PC. Start the test when it finishes." : anyActive ? "A test is running." : autoBlocker;
  const result = run ? resultLine(run) : null;
  const hostPath = (u: string) => { try { const x = new URL(u); return `${x.host}${x.pathname === "/" ? "" : x.pathname}`; } catch { return u; } };
  const currentStep = run ? (viewing ?? (active ? run.steps.find((x) => x.status === "running" || x.status === "asking")?.i : lastShot)) : null;
  const usingSteps = !isAuto;

  return (
    <div className={campaign ? "min-w-0" : "mx-auto w-full max-w-[1400px] p-4 md:p-6"}>
      {!campaign && <PageHeader title="Live test" description="Paste a staging URL and it tests every page on every device by itself, in a real browser on this PC. If the page asks you to register, it finds the fields and asks you for what it needs (a mobile number, an OTP), once." />}
      {!online && <p className="mb-3 rounded-box border border-line bg-side px-3 py-2 text-sm text-text-2" data-testid="offline">The connector isn’t running on this PC, so a live test can’t start. Run <span className="font-mono text-xs">npm run claude</span> in the project folder.</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          {/* ------------------------------------------------ set up: a URL, and that is all most runs need */}
          <Card className="min-w-0 space-y-3 p-3">
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void openPreview(); }}>
              <Field label="Staging URL"><Input value={url} disabled={active} onChange={(e) => setUrl(e.target.value)} onPaste={onPasteUrl} placeholder="Paste the staging URL to test it on every device" autoFocus={!campaign} /></Field>
              {campaign && (
                <Field label="Staging build"><Select value={(builds.data ?? []).some((x) => x.staging_url === url) ? url : ""} disabled={active || !builds.data?.length} onChange={(e) => e.target.value && setUrl(e.target.value)} placeholder={builds.data?.length ? "Choose a build" : "No builds yet"}
                  options={(builds.data ?? []).map((x) => ({ value: x.staging_url ?? "", label: `${x.version_label} · ${hostPath(x.staging_url ?? "")}` })).filter((o) => o.value)} /></Field>
              )}
              {!campaign && (
                <Field label="Campaign (optional)"><Select value={campaignId} disabled={active} onChange={(e) => { setPicked(e.target.value); setScenarioId(""); }} placeholder="None" options={campaigns.map((c) => ({ value: c.id, label: c.name }))} /></Field>
              )}

              <Field label="Screen size" hint="Emulated in Chromium: screen size, pixel density, touch and user agent. Not a physical device.">
                <Select value={browser.state?.device ?? previewDevice} disabled={active}
                  onChange={(e) => { setPreviewDevice(e.target.value); if (sessionReady) void browser.command({ type: "device", device: e.target.value }).catch(() => undefined); }}
                  options={presetList.map((p) => ({ value: p.id, label: `${p.label} ${p.width}×${p.height}` }))} />
              </Field>

              <details className="group rounded-box border border-line" data-testid="login-details">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm"><ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" />Add details in advance<span className="text-xs text-muted">(optional)</span></summary>
                <div className="space-y-2 border-t border-line p-3">
                  <Field label="Details the page asks for" hint="One per line, like Mobile number = 9876543210. You do not have to: the test finds the fields on the page and asks you for what it needs. A one-time code is always asked for, never stored."><Textarea rows={2} autoComplete="off" disabled={active} value={creds.extra} onChange={(e) => setCreds((c) => ({ ...c, extra: e.target.value }))} placeholder={"Mobile number = 9876543210\nName = Test Tester"} /></Field>
                  <p className="pt-1 text-xs font-medium text-text-2">Only if the site has a password login</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Username"><Input autoComplete="off" disabled={active} value={creds.username} onChange={(e) => setCreds((c) => ({ ...c, username: e.target.value }))} /></Field>
                    <Field label="Password"><Input type="password" autoComplete="new-password" disabled={active} value={creds.password} onChange={(e) => setCreds((c) => ({ ...c, password: e.target.value }))} /></Field>
                  </div>
                  <p className="text-xs text-muted">Used only for this run, on this PC. Never saved, shown or logged. The first device registers or signs in, and every other device carries on from that.</p>
                </div>
              </details>

              <Button type="submit" variant="primary" className="w-full" disabled={!online || !looksLikeUrl(url) || browser.opening} loading={browser.opening}><MonitorPlay />Open preview</Button>
              {!active ? <Button type="button" variant="secondary" className="w-full" disabled={!ready || Boolean(autoBlocker)} loading={startAuto.isPending} onClick={() => startAuto.mutate(undefined)}><Play />Run test on every device</Button>
                : <Button type="button" variant="danger" className="w-full" loading={stop.isPending} onClick={() => stop.mutate(undefined)}><Square />Stop</Button>}
              {browser.token && browser.state && browser.state.status !== "closed" && (
                <Button type="button" variant="secondary" className="w-full" disabled={!campaignId} loading={saveSession.isPending} onClick={() => saveSession.mutate(undefined)} title={campaignId ? "" : "Choose a campaign to save this to"} data-testid="save-session"><Save />Save session{campaignId ? "" : " (choose a campaign)"}</Button>
              )}
              {browser.openError && <p className="text-xs text-st-red" role="alert" data-testid="open-error">{browser.openError}</p>}
              {!active && startHint && <p className="text-xs text-muted" data-testid="start-hint">{startHint}</p>}
            </form>
            <p className="text-xs text-muted">It opens every page it finds on desktop, laptop, iPhone, Android and iPad (emulated), and lists what is wrong on which device. Only the site’s own host and the domains allowed in Settings are opened. A CAPTCHA stops the test; it is never bypassed.</p>
          </Card>

          {/* ------------------------------------------------ your own steps, if you want to test a particular flow */}
          <details className="group rounded-box border border-line bg-surface" data-testid="own-steps">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm"><ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" />Test a particular flow with your own steps<span className="text-xs text-muted">(advanced)</span></summary>
            <div className="space-y-3 border-t border-line p-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Device"><Select value={device} disabled={active} onChange={(e) => setDevice(e.target.value)} options={DEVICES} /></Field>
                <Field label="Start from a saved scenario"><Select value={scenarioId} disabled={active || !campaignId} onChange={(e) => pickScenario(e.target.value)} placeholder={!campaignId ? "Choose a campaign first" : scenarios.data?.length ? "Choose" : "None saved yet"} options={(scenarios.data ?? []).map((t) => ({ value: t.id, label: t.title }))} /></Field>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-text-2">Steps <span className="font-normal text-muted">(the page is opened first)</span></p>
                <ol className="space-y-2" data-testid="steps-editor">
                  {steps.map((s, i) => <StepRow key={s.id} s={s} i={i} last={i === steps.length - 1} disabled={active} onChange={(p) => patch(s.id, p)} onMove={(d) => move(i, d)} onRemove={() => setSteps((x) => x.filter((y) => y.id !== s.id))} />)}
                </ol>
                <Button size="sm" variant="ghost" className="mt-1.5" disabled={active || steps.length >= 60} onClick={() => setSteps((s) => [...s, newStep("click")])}><Plus />Add step</Button>
              </div>
              {names.length > 0 && (
                <div className="space-y-2 rounded-box border border-line bg-side p-3" data-testid="inputs">
                  <p className="text-sm font-medium">Values for this run</p>
                  {names.map((n) => (
                    <div key={n} className="flex items-end gap-2">
                      <Field label={`{{${n}}}`} className="min-w-0 flex-1"><Input type={inputOf(n).secret ? "password" : "text"} autoComplete="off" disabled={active} value={inputOf(n).value} onChange={(e) => setInput(n, { value: e.target.value })} /></Field>
                      <Checkbox className="pb-2" disabled={active} checked={inputOf(n).secret} onChange={(e) => setInput(n, { secret: e.target.checked })} label="Hide" />
                    </div>
                  ))}
                  <p className="text-xs text-muted">Typed here for this run only. Use an “Ask me to type” step for OTPs and anything secret.</p>
                </div>
              )}
              <Button variant="secondary" className="w-full" disabled={!ready || Boolean(stepsBlocker)} loading={startSteps.isPending} onClick={() => startSteps.mutate(undefined)}><Play />Run my steps</Button>
              {stepsBlocker && <p className="text-xs text-muted" data-testid="steps-hint">{stepsBlocker}</p>}
            </div>
          </details>

          {campaignId && (savedSessions.data?.length ?? 0) > 0 && (
            <Card className="overflow-hidden" data-testid="saved-sessions">
              <p className="border-b border-line px-3 py-2 text-xs text-muted">Saved sessions (problems found; screenshots are not kept)</p>
              <ul className="max-h-[240px] divide-y divide-line overflow-y-auto">
                {savedSessions.data!.map((x) => {
                  const list = (Array.isArray(x.events) ? x.events : []) as { severity?: string; reviewed?: boolean }[];
                  const open = list.filter((e) => e.severity !== "info" && !e.reviewed).length;
                  return (
                    <li key={x.id} className="flex items-start gap-2 px-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs">{hostPath(x.url)}</span>
                        <span className="block text-xs text-muted">{x.build_label ? `${x.build_label} · ` : ""}{DEVICE_NAME[x.device] ?? x.device} · {timeAgo(x.created_at)} · {open} to review of {list.length}</span>
                      </span>
                      <button className="text-xs text-text-2 hover:text-text hover:underline" onClick={() => { setUrl(x.url); setPreviewDevice(x.device); void openPreview(x.url); }}>Open again</button>
                      <button className="text-xs text-text-2 hover:text-st-red hover:underline" aria-label="Delete saved session" onClick={() => removeSession.mutate(x.id)}><Trash2 className="size-3.5" /></button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {/* ------------------------------------------------ recent runs */}
          <Card className="overflow-hidden" data-testid="recent-runs">
            <p className="border-b border-line px-3 py-2 text-xs text-muted">Recent runs</p>
            {runs.length === 0 ? <p className="px-3 py-4 text-sm text-text-2">No runs yet. They are kept here until the connector restarts.</p> : (
              <ul className="max-h-[320px] divide-y divide-line overflow-y-auto">
                {runs.map((r) => (
                  <li key={r.runId}>
                    <button onClick={() => { setViewRun(r.runId); setViewing(null); }} data-testid={`recent-${r.runId}`} data-status={r.status}
                      className={cn("flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-hover", r.runId === selectedId && "bg-active")}>
                      <StatusDot tone={STATUS_TONE[r.status]} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{r.campaignName ? `${r.campaignName} · ` : ""}<span className="font-mono text-xs">{hostPath(r.url)}</span></span>
                        <span className="block text-xs text-muted">{STATUS_LABEL[r.status]} · {r.deviceLabel} · {timeAgo(new Date(r.startedAt).toISOString())}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* ------------------------------------------------ preview */}
        <div className="min-w-0 space-y-4" data-testid="preview">
          {browser.token && run && (
            <div className="flex gap-1.5" role="group" aria-label="What to show">
              <Button size="sm" variant={view === "browser" ? "primary" : "secondary"} onClick={() => setPick("browser")} data-testid="show-browser"><MonitorPlay />Preview</Button>
              <Button size="sm" variant={view === "run" ? "primary" : "secondary"} onClick={() => setPick("run")} data-testid="show-run">{active ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Play />}Test run</Button>
            </div>
          )}
          {view === "browser" && (
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]" data-testid="browser-view">
              <BrowserPane browser={browser} presets={presetList} offline={!online && !browser.token} embedNote={embedNote} testing={active && isAuto} onCaptured={(m) => toast.success(m)} />
              <InspectPanel browser={browser} run={run} campaignId={campaignId} device={presetList.find((p) => p.id === (browser.state?.device ?? previewDevice))?.label ?? previewDevice} />
            </div>
          )}
          {view === "run" && (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="overflow-hidden">
            {(run || starting) && <BrowserBar url={run?.url ?? url} where={whereLabel} busy={active || starting} />}
            <div className="flex min-h-[260px] items-center justify-center bg-side">
              {picture ? <img src={picture} alt={viewing != null ? `Picture after step ${viewing}` : "Live picture of the test browser"} className="block max-h-[60vh] w-full object-contain" draggable={false} data-testid="picture" />
                : active || starting ? (
                  <div className="flex w-full flex-col items-center gap-3 px-4 py-16 text-sm text-text-2" data-testid="opening">
                    <div className="w-2/3 max-w-sm space-y-2" aria-hidden><div className="h-3 animate-pulse rounded bg-hover motion-reduce:animate-none" /><div className="h-3 w-4/5 animate-pulse rounded bg-hover motion-reduce:animate-none" /><div className="h-24 animate-pulse rounded bg-hover motion-reduce:animate-none" /></div>
                    <p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />Opening {hostPath(run?.url ?? url)}…</p>
                  </div>
                ) : <p className="flex items-center gap-2 px-4 py-14 text-center text-sm text-text-2"><MonitorPlay className="size-4 text-muted" />{run ? "No picture was kept for this run." : "Paste a URL and the test browser appears here."}</p>}
            </div>
            {viewing != null && active && <p className="border-t border-line px-3 py-1.5 text-xs text-muted">Showing the picture after step {viewing}. <button className="text-accent hover:underline" onClick={() => setViewing(null)}>Back to live</button></p>}
            {run?.prompt && (
              <form className="space-y-2 border-t border-line bg-st-amber/5 px-3 py-3" data-testid="prompt" onSubmit={(e) => { e.preventDefault(); if (answer) send.mutate(false); }}>
                <p className="text-sm font-medium">{run.prompt.label}</p>
                <div className="flex gap-2">
                  <Input autoFocus aria-label="Your answer" type={run.prompt.secret ? "password" : "text"} autoComplete="one-time-code" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type it here" />
                  <Button type="submit" variant="primary" disabled={!answer} loading={send.isPending}><Send />Send</Button>
                  {run.prompt.skippable && <Button type="button" onClick={() => send.mutate(true)} disabled={send.isPending}>Skip</Button>}
                </div>
                <p className="text-xs text-muted">The test is paused until you answer (it waits up to 5 minutes).{run.prompt.secret ? " What you type is hidden and is not shown in the picture or the log." : ""}{isAuto ? " It is entered once, on the first device; the others carry on from that." : ""}{run.prompt.skippable ? " Skip leaves this form alone and tests the public pages instead." : ""}</p>
              </form>
            )}
            {run && result && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-3 py-2.5" data-testid="result" data-tone={result.tone}>
                <span className={cn("flex min-w-0 flex-1 items-start gap-2 text-sm", RESULT_TEXT[result.tone])}>
                  {result.tone === "green" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : result.tone === "red" ? <XCircle className="mt-0.5 size-4 shrink-0" /> : result.tone === "blue" ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" /> : <Clock className="mt-0.5 size-4 shrink-0" />}
                  <span className="min-w-0">{result.text}</span>
                </span>
                <span className="text-xs text-muted">{formatDateTime(new Date(run.startedAt).toISOString())}</span>
                {!active && (
                  <span className="flex w-full flex-wrap gap-1.5 sm:w-auto">
                    <Button size="sm" disabled={!ready || (isAuto ? Boolean(autoBlocker) : Boolean(stepsBlocker))} onClick={() => (isAuto ? startAuto.mutate(undefined) : startSteps.mutate(undefined))}><RotateCcw />Run again</Button>
                    {usingSteps && <Button size="sm" onClick={() => setSaving(true)}><Save />Save as scenario</Button>}
                    <Button size="sm" onClick={download}><Download />Log</Button>
                  </span>
                )}
              </div>
            )}
            {run?.error && !isAuto && <p className="border-t border-line px-3 py-2 text-sm text-st-red">{run.error}</p>}
          </Card>
          <ErrorsPanel errors={errorRows} waiting={active || starting} started={Boolean(run) || starting} />
          </div>
          )}

          {view === "run" && run && (
            <Card className="overflow-hidden">
              {isAuto && run.auto ? (
                <>
                  <Tabs value={tab} onChange={setTab} className="px-3" tabs={[{ value: "devices", label: "Devices", count: run.auto.devices.length }, { value: "findings", label: "Findings", count: run.auto.findings.length }, { value: "progress", label: "Progress", count: run.steps.length }]} />
                  {tab === "devices" && <DeviceList auto={run.auto} running={active} />}
                  {tab === "findings" && (active && !run.auto.findings.length ? <p className="px-3 py-4 text-sm text-text-2">Findings appear here when every device has been checked.</p> : <FindingsList auto={run.auto} />)}
                  {tab === "progress" && (
                    <ol className="max-h-[360px] divide-y divide-line overflow-y-auto" data-testid="run-steps">
                      {run.steps.map((s) => (
                        <li key={s.i} className="flex items-start gap-2.5 px-3 py-2" data-testid={`run-step-${s.i}`} data-status={s.status}>
                          <StepIcon status={s.status} /><span className="min-w-0 flex-1 text-sm">{stepSentence(s)}{s.note && <span className="block text-xs text-muted">{s.note}</span>}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              ) : (
                <>
                  <Tabs value={tab} onChange={setTab} className="px-3" tabs={[{ value: "steps", label: "Steps", count: run.steps.length }, { value: "console", label: "Console & network", count: run.console.length + run.failed.length }]} />
                  {tab === "steps" ? (
                    <ol className="divide-y divide-line" data-testid="run-steps">
                      {run.steps.map((s) => (
                        <li key={s.i} className={cn("flex items-start gap-2.5 px-3 py-2.5", currentStep === s.i && "bg-active")} data-testid={`run-step-${s.i}`} data-status={s.status}>
                          <StepIcon status={s.status} />
                          <span className="min-w-0 flex-1 text-sm">
                            {stepSentence(s)}
                            {s.note && s.i > 0 && <span className={cn("block text-xs", s.status === "failed" ? "text-st-red" : "text-muted")}>{s.note}</span>}
                            {s.i === 0 && s.status === "failed" && <span className="block text-xs text-st-red">{s.note}</span>}
                          </span>
                          {s.ms != null && <span className="shrink-0 text-xs text-muted num">{(s.ms / 1000).toFixed(1)}s</span>}
                          {s.hasShot && <button className="shrink-0 text-xs text-text-2 hover:text-text hover:underline" onClick={() => setViewing(s.i)} aria-label={`Screenshot after step ${s.i}`}>Screenshot</button>}
                        </li>
                      ))}
                    </ol>
                  ) : run.console.length + run.failed.length === 0 ? <p className="px-3 py-4 text-sm text-text-2">No console errors or failed requests.</p> : (
                    <ul className="max-h-[320px] divide-y divide-line overflow-y-auto font-mono text-xs" data-testid="run-console">
                      {run.console.map((c, i) => <li key={`c${i}`} className={cn("px-3 py-1.5", c.type !== "warning" && "text-st-red")}>{c.type}: {c.text}</li>)}
                      {run.failed.map((f, i) => <li key={`f${i}`} className="px-3 py-1.5"><span className="text-st-red">{f.status ?? f.error ?? "failed"}</span> {f.url}</li>)}
                    </ul>
                  )}
                </>
              )}
            </Card>
          )}
        </div>
      </div>
      {saving && <SaveDialog fixed={Boolean(campaign)} steps={steps} defaultCampaign={campaignId} url={url} onClose={() => setSaving(false)} campaigns={campaigns} onSaved={(n) => toast.success(n)} />}
    </div>
  );
}

function SaveDialog({ fixed = false, steps, url, defaultCampaign, campaigns, onClose, onSaved }: { fixed?: boolean; steps: EditStep[]; url: string; defaultCampaign: string; campaigns: { id: string; name: string }[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const [campaign, setCampaign] = React.useState(defaultCampaign);
  const [title, setTitle] = React.useState(`Live test${host ? `: ${host}` : ""}`);
  const { steps: out, dropped } = toScenario(steps);
  const save = useAction(() => developmentService.saveTestCase({ campaign_id: campaign, title, steps: out, expected: "All steps pass.", enabled: true }), { invalidate: [["dev"]], onSuccess: () => { onSaved("Scenario saved"); onClose(); } });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Save as scenario" description="So it can run again in a review, or from the Testing section."
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!campaign || !title.trim() || !out.length} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save scenario</Button></>}>
        <div className="space-y-3">
          {!fixed && <Field label="Campaign"><Select value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Choose a campaign" options={campaigns.map((c) => ({ value: c.id, label: c.name }))} /></Field>}
          <Field label="Name"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <p className="text-sm text-text-2">{out.length} step{out.length === 1 ? "" : "s"} will be saved. {dropped ? `${dropped} “Ask me to type” step${dropped === 1 ? " is" : "s are"} left out, because a scheduled review has nobody to ask. ` : ""}Values you entered for {"{{names}}"} are not saved; stored credentials fill {"{{username}}"} and {"{{password}}"} in reviews.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
