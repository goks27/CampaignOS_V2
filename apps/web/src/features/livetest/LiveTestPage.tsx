import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, MonitorPlay, Play, Plus, RotateCcw, Save, Send, Square, Trash2 } from "lucide-react";
import { Button, Card, Checkbox, Dialog, DialogContent, Field, Input, Select, Tabs } from "@/components/ui";
import { PageHeader, StatusDot } from "@/components/common";
import { useToast } from "@/components/toast";
import { useAction } from "@/hooks/useAction";
import { qk, useCampaigns, useConnectorStatus, useSettings } from "@/hooks/queries";
import { DEVICE_LABEL } from "@/lib/devices";
import { cn } from "@/lib/utils";
import { connectorService, liveTestService, type LiveTestState } from "@/services/connector";
import { developmentService, type Step } from "@/services/development";
import { ACTIONS, META, STATUS_LABEL, STATUS_TONE, fromScenario, isActive, logText, needsValue, newStep, placeholdersOf, problem, toRequest, toScenario, type EditStep, type Inputs } from "./model";

type Run = Exclude<LiveTestState, { status: "idle" }>;
const DEVICES = Object.entries(DEVICE_LABEL).filter(([id]) => id !== "mobile").map(([value, label]) => ({ value, label }));
const SECRETISH = /pass|otp|pin|code|secret|token/i;
const STEP_TONE = { pending: "gray", running: "blue", asking: "amber", passed: "green", failed: "red", skipped: "gray" } as const;

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

function StepRow({ s, i, last, onChange, onMove, onRemove, disabled }: { s: EditStep; i: number; last: boolean; onChange: (p: Partial<EditStep>) => void; onMove: (d: number) => void; onRemove: () => void; disabled: boolean }) {
  const m = META.get(s.action)!;
  return (
    <li className="space-y-1.5 rounded-box border border-line p-2" data-testid={`step-${i}`}>
      <div className="flex items-center gap-1.5">
        <span className="w-5 shrink-0 text-center text-xs text-muted num">{i + 1}</span>
        <div className="min-w-0 flex-1">
          <Select aria-label={`Step ${i + 1} action`} disabled={disabled} value={s.action} onChange={(e) => onChange({ action: e.target.value as EditStep["action"], secret: e.target.value === "ask" ? true : s.secret, value: needsValue(e.target.value as EditStep["action"]) ? s.value : "" })}
            options={ACTIONS.map((a) => ({ value: a.value, label: a.label }))} />
        </div>
        <Button size="icon" variant="ghost" aria-label="Move up" disabled={disabled || i === 0} onClick={() => onMove(-1)}><ArrowUp /></Button>
        <Button size="icon" variant="ghost" aria-label="Move down" disabled={disabled || last} onClick={() => onMove(1)}><ArrowDown /></Button>
        <Button size="icon" variant="ghost" aria-label={`Remove step ${i + 1}`} disabled={disabled} onClick={onRemove}><Trash2 /></Button>
      </div>
      <Input aria-label={`Step ${i + 1} ${m.target}`} disabled={disabled} value={s.target} onChange={(e) => onChange({ target: e.target.value })} placeholder={m.targetHint} />
      {needsValue(s.action) && <Input aria-label={`Step ${i + 1} ${m.valueLabel}`} disabled={disabled} value={s.value} onChange={(e) => onChange({ value: e.target.value })} placeholder={m.valueHint} />}
      {(s.action === "ask" || s.action === "fill") && <Checkbox disabled={disabled} checked={s.secret} onChange={(e) => onChange({ secret: e.target.checked })} label={s.action === "ask" ? "Hide what I type (no picture, not in the log)" : "Hide this value (no picture after typing it)"} />}
    </li>
  );
}

export function LiveTestPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const connector = useConnectorStatus().data;
  const settings = useSettings().data;
  const campaigns = useCampaigns().data ?? [];

  const [url, setUrl] = React.useState("");
  const [device, setDevice] = React.useState("desktop");
  const [steps, setSteps] = React.useState<EditStep[]>([{ ...newStep("click"), action: "expect_text" }]);
  const [inputs, setInputs] = React.useState<Inputs>({});
  const [campaignId, setCampaignId] = React.useState("");
  const [scenarioId, setScenarioId] = React.useState("");
  const [tab, setTab] = React.useState<"steps" | "console" | "network">("steps");
  const [viewing, setViewing] = React.useState<number | null>(null);
  const [answer, setAnswer] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const scenarios = useQuery({ queryKey: [...qk.dev(campaignId), "cases"], queryFn: () => developmentService.testCases(campaignId), enabled: Boolean(campaignId) });

  // ---- the run, as the connector reports it
  const state = useQuery({ queryKey: ["livetest"], queryFn: liveTestService.state, retry: false, refetchInterval: (q) => (isActive(q.state.data) ? 600 : 4000) });
  const run: Run | null = state.data && state.data.status !== "idle" ? state.data : null;
  const active = isActive(state.data);
  const online = connector != null;
  const jobRunning = Boolean(connector?.busy);

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
  React.useEffect(() => {
    if (shownStep == null) { setShotBlob(null); return; }
    let gone = false;
    void liveTestService.shot(shownStep).then((b) => { if (!gone) setShotBlob(b); });
    return () => { gone = true; };
  }, [shownStep, run?.runId, run?.finishedAt]);
  React.useEffect(() => { if (run?.runId) { setViewing(null); setAnswer(""); } }, [run?.runId]);
  const liveUrl = useBlobUrl(liveBlob), shotUrl = useBlobUrl(shotBlob);
  const picture = viewing != null || !active ? shotUrl : liveUrl;

  // ---- what the steps need
  const names = React.useMemo(() => placeholdersOf(steps), [steps]);
  const inputOf = (n: string) => inputs[n] ?? { value: "", secret: SECRETISH.test(n) };
  const setInput = (n: string, p: Partial<Inputs[string]>) => setInputs((o) => ({ ...o, [n]: { ...inputOf(n), ...p } }));
  const full: Inputs = Object.fromEntries(names.map((n) => [n, inputOf(n)]));
  const blocker = problem(url, steps, full);
  const allowed = React.useMemo(() => settings?.allowed_domains ?? [], [settings]);

  const patch = (id: string, p: Partial<EditStep>) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => setSteps((s) => { const n = [...s]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); return n; });

  const start = useAction(() => liveTestService.start(toRequest(url, device, steps, full, allowed)), { error: "Could not start", onSuccess: () => void qc.invalidateQueries({ queryKey: ["livetest"] }) });
  const send = useAction(() => liveTestService.answer(run!.prompt!.id, answer), { error: "Could not send", onSuccess: () => { setAnswer(""); void qc.invalidateQueries({ queryKey: ["livetest"] }); } });
  const stop = useAction(() => liveTestService.stop(), { onSuccess: () => void qc.invalidateQueries({ queryKey: ["livetest"] }) });

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

  const canStart = online && !jobRunning && !active && !blocker;
  const startHint = !online ? "The connector is not running on this PC. Run npm run claude in the project folder, then try again." : jobRunning ? "A review is running on this PC. Start the test when it finishes." : active ? "A test is running." : blocker;

  return (
    <div className="mx-auto w-full max-w-[1400px] p-4 md:p-6">
      <PageHeader title="Live test" description="Paste a staging URL, write the steps, and watch the test run in a real browser on this PC. It can stop and ask you to type something, like an OTP." />
      {!online && <p className="mb-3 rounded-box border border-line bg-side px-3 py-2 text-sm text-text-2" data-testid="offline">The connector isn’t running on this PC, so a live test can’t start. Run <span className="font-mono text-xs">npm run claude</span> in the project folder.</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* ------------------------------------------------ set up */}
        <Card className="min-w-0 space-y-3 p-3">
          <Field label="Staging URL"><Input value={url} disabled={active} onChange={(e) => setUrl(e.target.value)} placeholder="https://staging.example.com/register" /></Field>
          <Field label="Device"><Select value={device} disabled={active} onChange={(e) => setDevice(e.target.value)} options={DEVICES} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start from a campaign scenario"><Select value={campaignId} disabled={active} onChange={(e) => { setCampaignId(e.target.value); setScenarioId(""); }} placeholder="None" options={campaigns.map((c) => ({ value: c.id, label: c.name }))} /></Field>
            <Field label="Scenario"><Select value={scenarioId} disabled={active || !campaignId} onChange={(e) => pickScenario(e.target.value)} placeholder={campaignId ? "Choose" : "—"} options={(scenarios.data ?? []).map((t) => ({ value: t.id, label: t.title }))} /></Field>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-text-2">Steps <span className="font-normal text-muted">(the page is opened first)</span></p>
            <ol className="space-y-2" data-testid="steps-editor">
              {steps.map((s, i) => <StepRow key={s.id} s={s} i={i} last={i === steps.length - 1} disabled={active} onChange={(p) => patch(s.id, p)} onMove={(d) => move(i, d)} onRemove={() => setSteps((x) => x.filter((y) => y.id !== s.id))} />)}
            </ol>
            <Button size="sm" className="mt-2" disabled={active || steps.length >= 60} onClick={() => setSteps((s) => [...s, newStep("click")])}><Plus />Add step</Button>
          </div>

          {names.length > 0 && (
            <div className="space-y-2" data-testid="inputs">
              <p className="text-xs font-medium text-text-2">Your details for this run</p>
              {names.map((n) => (
                <div key={n} className="flex items-end gap-2">
                  <Field label={`{{${n}}}`} className="min-w-0 flex-1"><Input type={inputOf(n).secret ? "password" : "text"} autoComplete="off" disabled={active} value={inputOf(n).value} onChange={(e) => setInput(n, { value: e.target.value })} /></Field>
                  <Checkbox className="pb-2" disabled={active} checked={inputOf(n).secret} onChange={(e) => setInput(n, { secret: e.target.checked })} label="Hide" />
                </div>
              ))}
              <p className="text-xs text-muted">Entered here for this run only. They are sent to the connector on this PC, never saved, and never shown in the log.</p>
            </div>
          )}

          <p className="text-xs text-muted">Only the site’s own host and the domains allowed in Settings are opened. Your office or home network stays blocked. A CAPTCHA stops the test; it is never bypassed.</p>
          <div className="flex flex-wrap items-center gap-2">
            {!active ? <Button variant="primary" disabled={!canStart} loading={start.isPending} onClick={() => start.mutate(undefined)}><Play />Start test</Button>
              : <Button variant="danger" loading={stop.isPending} onClick={() => stop.mutate(undefined)}><Square />Stop</Button>}
            {!active && startHint && <span className="text-xs text-muted" data-testid="start-hint">{startHint}</span>}
          </div>
        </Card>

        {/* ------------------------------------------------ preview */}
        <Card className="min-w-0 overflow-hidden" data-testid="preview">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
            <MonitorPlay className="size-4 text-muted" />
            {run ? <><StatusDot tone={STATUS_TONE[run.status]} label={STATUS_LABEL[run.status]} /><span className="text-sm text-muted">{run.deviceLabel}</span><span className="min-w-0 flex-1 truncate text-xs text-muted">{run.url}</span></> : <span className="text-sm text-muted">Nothing running yet</span>}
            {run && !active && (
              <span className="ml-auto flex gap-1.5">
                <Button size="sm" disabled={!canStart} onClick={() => start.mutate(undefined)}><RotateCcw />Run again</Button>
                <Button size="sm" onClick={() => setSaving(true)}><Save />Save as scenario</Button>
                <Button size="sm" onClick={download}><Download />Log</Button>
              </span>
            )}
          </div>

          <div className="flex min-h-[220px] items-center justify-center bg-side">
            {picture ? <img src={picture} alt={viewing != null ? `Picture after step ${viewing}` : "Live picture of the test browser"} className="block max-h-[60vh] w-full object-contain" draggable={false} data-testid="picture" />
              : <p className="px-4 py-12 text-center text-sm text-text-2">{active ? "Waiting for the first picture…" : run ? "No picture was kept for this step." : "The test browser will appear here while it runs."}</p>}
          </div>
          {viewing != null && active && <p className="border-t border-line px-3 py-1.5 text-xs text-muted">Showing the picture after step {viewing}. <button className="text-accent hover:underline" onClick={() => setViewing(null)}>Back to live</button></p>}

          {run?.prompt && (
            <form className="space-y-2 border-t border-line bg-amber-500/5 px-3 py-3" data-testid="prompt" onSubmit={(e) => { e.preventDefault(); if (answer) send.mutate(undefined); }}>
              <p className="text-sm font-medium">{run.prompt.label}</p>
              <div className="flex gap-2">
                <Input autoFocus aria-label="Your answer" type={run.prompt.secret ? "password" : "text"} autoComplete="one-time-code" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type it here" />
                <Button type="submit" variant="primary" disabled={!answer} loading={send.isPending}><Send />Send</Button>
              </div>
              <p className="text-xs text-muted">The test is paused until you answer (it waits up to 5 minutes).{run.prompt.secret ? " What you type is hidden and is not shown in the picture or the log." : ""}</p>
            </form>
          )}
          {run?.error && <p className="border-t border-line px-3 py-2 text-sm text-st-red">{run.error}</p>}

          {run && (
            <div className="border-t border-line">
              <Tabs value={tab} onChange={setTab} className="px-3" tabs={[{ value: "steps", label: "Steps" }, { value: "console", label: "Console", count: run.console.length }, { value: "network", label: "Network", count: run.failed.length }]} />
              {tab === "steps" && (
                <ol className="max-h-[320px] divide-y divide-line overflow-y-auto" data-testid="run-steps">
                  {run.steps.map((s) => (
                    <li key={s.i}>
                      <button className={cn("flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-hover", (viewing ?? (active ? run.steps.find((x) => x.status === "running" || x.status === "asking")?.i : lastShot)) === s.i && "bg-active")} onClick={() => s.hasShot && setViewing(s.i)} data-testid={`run-step-${s.i}`} data-status={s.status}>
                        <StatusDot tone={STEP_TONE[s.status]} />
                        <span className="min-w-0 flex-1"><span className="font-medium">{s.i === 0 ? "Open the page" : META.get(s.action as never)?.label ?? s.action}</span>{s.i > 0 && <span className="text-text-2"> · {s.target}</span>}{s.value && s.action !== "ask" ? <span className="text-muted"> = {s.value}</span> : null}
                          {s.note && s.i > 0 && <span className={cn("block text-xs", s.status === "failed" ? "text-st-red" : "text-muted")}>{s.note}</span>}
                          {s.i === 0 && s.status === "failed" && <span className="block text-xs text-st-red">{s.note}</span>}</span>
                        <span className="shrink-0 text-xs text-muted num">{s.ms != null ? `${(s.ms / 1000).toFixed(1)}s` : s.hasShot ? "" : ""}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {tab === "console" && (run.console.length ? <ul className="max-h-[320px] divide-y divide-line overflow-y-auto font-mono text-xs">{run.console.map((c, i) => <li key={i} className={cn("px-3 py-1.5", c.type !== "warning" && "text-st-red")}>{c.type}: {c.text}</li>)}</ul> : <p className="px-3 py-4 text-sm text-text-2">No console errors or warnings.</p>)}
              {tab === "network" && (run.failed.length ? <ul className="max-h-[320px] divide-y divide-line overflow-y-auto font-mono text-xs">{run.failed.map((f, i) => <li key={i} className="px-3 py-1.5"><span className="text-st-red">{f.status ?? f.error ?? "failed"}</span> {f.url}</li>)}</ul> : <p className="px-3 py-4 text-sm text-text-2">No failed requests.</p>)}
            </div>
          )}
        </Card>
      </div>
      {saving && <SaveDialog steps={steps} defaultCampaign={campaignId} url={url} onClose={() => setSaving(false)} campaigns={campaigns} onSaved={(n) => toast.success(n)} />}
    </div>
  );
}

function SaveDialog({ steps, url, defaultCampaign, campaigns, onClose, onSaved }: { steps: EditStep[]; url: string; defaultCampaign: string; campaigns: { id: string; name: string }[]; onClose: () => void; onSaved: (msg: string) => void }) {
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
          <Field label="Campaign"><Select value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Choose a campaign" options={campaigns.map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Name"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <p className="text-sm text-text-2">{out.length} step{out.length === 1 ? "" : "s"} will be saved. {dropped ? `${dropped} “Ask me to type” step${dropped === 1 ? " is" : "s are"} left out, because a scheduled review has nobody to ask. ` : ""}Values you entered for {"{{names}}"} are not saved; stored credentials fill {"{{username}}"} and {"{{password}}"} in reviews.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
