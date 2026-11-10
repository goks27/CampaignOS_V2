import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { FileUp, ListTodo, Play, Plus, Save, Trash2 } from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { ConfirmDialog, Section, StatusDot } from "@/components/common";
import { useToast } from "@/components/toast";
import { useAction } from "@/hooks/useAction";
import { useAuth } from "@/lib/auth";
import { cn, timeAgo } from "@/lib/utils";
import { developmentService } from "@/services/development";
import { qk } from "@/hooks/queries";
import { rulesService, type RuleRunRow, type RuleScenarioRow } from "@/services/rules";
import { tasksService } from "@/services/tasks";
import type { CampaignWithRelations } from "@/services/campaigns";
import { EXAMPLE_SCENARIO, parseParticipantsCsv, runScenario, type Check, type RunResult, type Scenario, type Status, type Winner } from "./engine";
import { ApiFetch } from "./ApiFetch";
import { useSettings } from "@/hooks/queries";

export const STATUS_LABEL: Record<Status, string> = { passed: "Passed", failed: "Failed", needs_verification: "Needs verification", not_run: "Not run", blocked: "Blocked" };
const TONE: Record<Status, "green" | "red" | "amber" | "gray"> = { passed: "green", failed: "red", needs_verification: "amber", not_run: "gray", blocked: "amber" };
const RUN_TONE = { passed: "green", failed: "red", incomplete: "amber" } as const;
const RUN_LABEL = { passed: "Passed", failed: "Failed", incomplete: "Incomplete: not everything was verified" } as const;

/** Parses the editor text as a scenario, or says what is wrong with it. */
export function parseScenario(text: string): { scenario: Scenario } | { error: string } {
  let v: unknown;
  try { v = JSON.parse(text); } catch (e) { return { error: `This is not valid JSON: ${(e as Error).message}` }; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "A scenario is a JSON object." };
  const s = v as Partial<Scenario>;
  if (typeof s.name !== "string" || !s.name.trim()) return { error: "The scenario needs a name." };
  if (!s.rules || typeof s.rules !== "object") return { error: "The scenario needs rules, even an empty object: \"rules\": {}." };
  if (!s.actual || typeof s.actual !== "object") return { error: "The scenario needs what the system actually did: \"actual\": { \"winners\": [...] }." };
  return { scenario: s as Scenario };
}

function CheckRow({ c, onTask }: { c: Check; onTask?: (c: Check) => void }) {
  const [open, setOpen] = React.useState(c.status === "failed");
  return (
    <li className="px-3 py-2.5 text-sm" data-testid={`check-${c.id}`} data-status={c.status}>
      <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="mt-1"><StatusDot tone={TONE[c.status]} /></span>
        <span className="min-w-0 flex-1"><span className="block font-medium">{c.title}</span><span className="block text-xs text-muted">{STATUS_LABEL[c.status]}{c.actual ? ` · ${c.actual}` : ""}</span></span>
      </button>
      {open && (c.expected || c.details.length > 0) && (
        <div className="mt-1.5 space-y-1 pl-4 text-xs">
          {c.expected && <p><span className="text-muted">Expected: </span>{c.expected}</p>}
          {c.details.length > 0 && <ul className="list-disc pl-4 text-text-2">{c.details.slice(0, 20).map((d, i) => <li key={i}>{d}</li>)}</ul>}
          {c.status === "failed" && onTask && <Button size="sm" onClick={() => onTask(c)}><ListTodo />Create Journey task</Button>}
        </div>
      )}
    </li>
  );
}

/** The result of one run: what passed, what failed, what could not be verified and what was not run. Never "all good" when something was not tested. */
export function RunReport({ result, onTask }: { result: RunResult; onTask?: (c: Check) => void }) {
  return (
    <Card className="overflow-hidden" data-testid="run-report" data-status={result.status}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-3 py-2.5">
        <StatusDot tone={RUN_TONE[result.status]} label={<span className="font-medium text-text">{RUN_LABEL[result.status]}</span>} />
        <span className="text-xs text-muted">{result.counts.passed} passed · {result.counts.failed} failed · {result.counts.needs_verification} need verification · {result.counts.not_run} not run</span>
      </div>
      {result.notTested.length > 0 && (
        <div className="border-b border-line bg-st-amber/5 px-3 py-2 text-xs" data-testid="not-tested">
          <p className="font-medium text-st-amber">Not verified</p>
          <ul className="list-disc pl-4 text-text-2">{result.notTested.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
      <ul className="divide-y divide-line">{result.checks.filter((c) => c.status !== "not_run").map((c) => <CheckRow key={c.id} c={c} onTask={onTask} />)}</ul>
      {result.checks.some((c) => c.status === "not_run") && (
        <details className="border-t border-line px-3 py-2 text-xs text-muted"><summary className="cursor-pointer">Checks that did not apply ({result.checks.filter((c) => c.status === "not_run").length})</summary>
          <ul className="mt-1 list-disc pl-4">{result.checks.filter((c) => c.status === "not_run").map((c) => <li key={c.id}>{c.title}: {c.actual}</li>)}</ul></details>
      )}
    </Card>
  );
}

/**
 * Rules lab: write a scenario (the rules, the data, and what the system actually did), run it, and read the result. Every check is
 * deterministic, with defined inputs and expected outputs. AI takes no part in deciding whether a rule holds.
 */
export function RulesLab({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const settings = useSettings().data;
  const scenarios = useQuery({ queryKey: ["rules", "scenarios", c.id], queryFn: () => rulesService.scenarios(c.id) });
  const runs = useQuery({ queryKey: ["rules", "runs", c.id], queryFn: () => rulesService.runs(c.id) });
  const builds = useQuery({ queryKey: [...qk.dev(c.id), "subs"], queryFn: () => developmentService.submissions(c.id) });

  const [selected, setSelected] = React.useState<RuleScenarioRow | null>(null);
  const [text, setText] = React.useState(() => JSON.stringify(EXAMPLE_SCENARIO, null, 2));
  const [suite, setSuite] = React.useState("General");
  const [build, setBuild] = React.useState("");
  const [result, setResult] = React.useState<RunResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<RuleScenarioRow | null>(null);
  const file = React.useRef<HTMLInputElement>(null);

  const open = (row: RuleScenarioRow | null) => {
    setSelected(row); setResult(null); setError(null);
    setText(JSON.stringify(row ? row.scenario : EXAMPLE_SCENARIO, null, 2));
    setSuite(row?.suite ?? "General");
  };
  const lastRun = (id: string) => (runs.data ?? []).find((r) => r.scenario_id === id);
  const history = selected ? (runs.data ?? []).filter((r) => r.scenario_id === selected.id).slice(0, 6) : [];
  const buildLabel = build || (builds.data?.[0]?.version_label ?? "");

  const save = useAction(async () => {
    const p = parseScenario(text);
    if ("error" in p) throw new Error(p.error);
    return rulesService.saveScenario({ id: selected?.id, campaignId: c.id, suite, name: p.scenario.name, scenario: p.scenario });
  }, { invalidate: [["rules"]], error: "Could not save", onSuccess: (row) => { setSelected(row); toast.success(selected ? `Saved as version ${row.version}` : "Scenario saved"); } });

  const run = useAction(async () => {
    const p = parseScenario(text);
    if ("error" in p) { setError(p.error); return; }
    setError(null);
    let r: RunResult;
    try { r = runScenario(p.scenario); } catch (e) { setError(`The scenario could not be run: ${(e as Error).message}`); return; }
    setResult(r);
    if (canEdit) await rulesService.saveRun({ campaignId: c.id, scenarioId: selected?.id, scenarioVersion: selected?.version, buildLabel, result: r });
  }, { invalidate: [["rules"]], error: "The result could not be saved" });

  const remove = useAction((id: string) => rulesService.removeScenario(id), { invalidate: [["rules"]], onSuccess: () => { setRemoving(null); open(null); } });
  const task = useAction((chk: Check) => tasksService.create({ campaign_id: c.id, title: `Rule failed: ${chk.title}`.slice(0, 200), priority: "high",
    description: [`Scenario: ${result?.name}`, `Build: ${buildLabel || "not recorded"}`, `Expected: ${chk.expected}`, `Actual: ${chk.actual}`, ...chk.details.map((d) => `- ${d}`), "", "Found by a deterministic rule check in the Rules lab."].join("\n") }),
    { invalidate: [["tasks"], ["progress", c.id]], error: "Could not create the task", onSuccess: () => toast.success("Task created") });

  const useWinners = (winners: Winner[]) => {
    const p = parseScenario(text);
    if ("error" in p) { setError(p.error); return; }
    setText(JSON.stringify({ ...p.scenario, actual: { ...p.scenario.actual, winners } }, null, 2)); setError(null); setResult(null);
    toast.success(`${winners.length} winners taken from the API answer`);
  };
  const importCsv = async (f: File) => {
    try {
      const p = parseScenario(text);
      if ("error" in p) { setError(p.error); return; }
      const participants = parseParticipantsCsv(await f.text());
      setText(JSON.stringify({ ...p.scenario, participants }, null, 2)); setError(null);
      toast.success(`${participants.length} participants imported into the scenario`);
    } catch (e) { setError((e as Error).message); }
  };

  const bySuite = new Map<string, RuleScenarioRow[]>();
  for (const s of scenarios.data ?? []) bySuite.set(s.suite, [...(bySuite.get(s.suite) ?? []), s]);

  return (
    <Section title="Rules lab" actions={canEdit && <Button size="sm" onClick={() => open(null)}><Plus />New scenario</Button>}>
      <p className="mb-3 text-sm text-text-2">Check the campaign’s rules (who can win, how many, which codes work, which reward is given) against made-up or masked data. Every check is deterministic; AI does not decide whether a rule holds. Use fixtures, never real participants’ details, and never run this against production.</p>
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="overflow-hidden self-start" data-testid="scenario-list">
          {!scenarios.data?.length ? <p className="px-3 py-4 text-sm text-text-2">No scenarios yet. Edit the example and save it, or start from an empty one.</p> : (
            <ul>{[...bySuite.entries()].map(([name, rows]) => (
              <li key={name}><p className="border-b border-line bg-side px-3 py-1.5 text-xs font-medium text-muted">{name}</p>
                <ul className="divide-y divide-line">{rows.map((s) => {
                  const r = lastRun(s.id);
                  return <li key={s.id}><button onClick={() => open(s)} className={cn("flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-hover", selected?.id === s.id && "bg-active")} data-testid={`scenario-${s.id}`}>
                    <span className="mt-1.5"><StatusDot tone={r ? RUN_TONE[r.status as keyof typeof RUN_TONE] : "gray"} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate">{s.name}</span><span className="block text-xs text-muted">v{s.version}{!s.accepted ? " · suggested, not accepted" : ""}{r ? ` · ${RUN_LABEL[r.status as keyof typeof RUN_LABEL].split(":")[0]} ${timeAgo(r.ran_at)}` : " · never run"}</span></span>
                  </button></li>;
                })}</ul></li>
            ))}</ul>
          )}
        </Card>

        <div className="min-w-0 space-y-3">
          <Card className="space-y-3 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_180px_180px]">
              <Field label="Suite" hint="Scenarios are grouped, so a suite can be run again on the next build."><Input value={suite} onChange={(e) => setSuite(e.target.value)} disabled={!canEdit} /></Field>
              <Field label="Build to record"><Select value={build} onChange={(e) => setBuild(e.target.value)} placeholder={builds.data?.[0] ? `Latest: ${builds.data[0].version_label}` : "No build yet"} options={(builds.data ?? []).map((b) => ({ value: b.version_label, label: b.version_label }))} /></Field>
              <div className="flex items-end gap-1.5">
                <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ""; }} />
                <Button size="sm" onClick={() => file.current?.click()} disabled={!canEdit} title="A CSV with a header row and an id column"><FileUp />Participants CSV</Button>
              </div>
            </div>
            <ApiFetch allowed={settings?.allowed_domains ?? []} onWinners={useWinners} />
            <Field label="Scenario (JSON)" hint="rules: what must hold. participants / codes: the data. actual: what the system did (winners, redemptions, cases, draws). expected: what it should have done.">
              <Textarea rows={16} spellCheck={false} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} aria-label="Scenario JSON" />
            </Field>
            {error && <p className="text-sm text-st-red" role="alert" data-testid="scenario-error">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => run.mutate(undefined)} loading={run.isPending} data-testid="run-scenario"><Play />Run checks</Button>
              {canEdit && <Button onClick={() => save.mutate(undefined)} loading={save.isPending}><Save />{selected ? "Save changes" : "Save scenario"}</Button>}
              {canEdit && selected && <Button variant="ghost" onClick={() => setRemoving(selected)}><Trash2 />Delete</Button>}
            </div>
          </Card>
          {result && <RunReport result={result} onTask={canEdit ? (chk) => task.mutate(chk) : undefined} />}
          {history.length > 0 && (
            <Card className="overflow-hidden"><p className="border-b border-line px-3 py-2 text-xs text-muted">Earlier runs of this scenario</p>
              <ul className="divide-y divide-line text-sm">{history.map((r: RuleRunRow) => (
                <li key={r.id} className="flex items-center gap-2 px-3 py-2"><StatusDot tone={RUN_TONE[r.status as keyof typeof RUN_TONE]} /><span className="flex-1">{RUN_LABEL[r.status as keyof typeof RUN_LABEL].split(":")[0]}{r.build_label ? ` on ${r.build_label}` : ""}{r.scenario_version ? ` · v${r.scenario_version}` : ""}</span><span className="text-xs text-muted">{timeAgo(r.ran_at)}</span></li>
              ))}</ul></Card>
          )}
        </div>
      </div>
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} title="Delete this scenario?" body={<>“{removing?.name}” is deleted. Its earlier runs stay in the history.</>} confirmLabel="Delete" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)} />
    </Section>
  );
}
