import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, X, Pencil, UserPlus, Search, ShieldCheck, RotateCcw, Inbox, Plus } from "lucide-react";
import { Button, Card, Dialog, DialogContent, Drawer, Field, Input, Kbd, Select, Tabs, Textarea } from "@/components/ui";
import { EmptyState, ErrorState, LoadingRows, Mono, PageHeader, Pill, StatusDot } from "@/components/common";
import {
  CONFIDENCE_LABEL, FINDING_STATUS_LABEL, FINDING_STATUS_TONE, OPEN_FINDING_STATUSES, PRIORITY_LABEL, REVIEW_TYPE_LABEL, SEVERITIES,
  SEVERITY_LABEL, SEVERITY_TONE, TONE_HEX, options, type FindingStatus, type ReviewType, type Severity, type Priority,
} from "@/lib/labels";
import { cn, formatDateTime, todayISO } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { qk, useCampaigns, usePeople, useProfiles, useWorkerState } from "@/hooks/queries";
import { useAction } from "@/hooks/useAction";
import { defaultFeedback, findingsService, type Feedback, type Finding } from "@/services/findings";
import { requirementsService } from "@/services/requirements";
import { JobsTable } from "@/features/shared/JobsTable";
import { deviceLabel } from "@/lib/devices";
import { ScreenshotViewer, type Overlay, type Region } from "./ScreenshotViewer";

type Filters = { q: string; campaign: string; severity: Severity | ""; type: ReviewType | ""; owner: string; status: FindingStatus | "" | "open"; since: string; job: string };

export function ReviewsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "queue" ? "queue" : "inbox";
  return (
    <>
      {!embedded && <PageHeader title="Findings" description="Claude’s findings are drafts. Nothing is approved or assigned until you decide." />}
      <Tabs className="mb-4" value={view} onChange={(v) => setParams((cur) => { const n = new URLSearchParams(cur); if (v === "queue") n.set("view", "queue"); else n.delete("view"); return n; })}
        tabs={[{ value: "inbox", label: "Findings Inbox" }, { value: "queue", label: "Review queue" }]} />
      {view === "queue" ? <JobsTable /> : <FindingsInbox />}
    </>
  );
}

function useWide() {
  const [wide, setWide] = React.useState(() => window.matchMedia("(min-width: 1280px)").matches);
  React.useEffect(() => {
    const m = window.matchMedia("(min-width: 1280px)");
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

function FindingsInbox() {
  const [params, setParams] = useSearchParams();
  const { canEdit } = useAuth();
  const { data: campaigns } = useCampaigns();
  const { people } = usePeople();
  const wide = useWide();
  const [filters, setFilters] = React.useState<Filters>({
    q: "", campaign: params.get("campaign") ?? "", severity: (params.get("severity") as Severity) ?? "", type: "", owner: "",
    status: (params.get("status") as FindingStatus) ?? (params.get("finding") ? "" : "open"), since: "", job: params.get("job") ?? "",
  });
  const worker = useWorkerState();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.findings(filters.campaign || "all"), queryFn: () => findingsService.list({ campaignId: filters.campaign || undefined }),
    refetchInterval: worker.data?.state === "busy" || (worker.data?.queued ?? 0) > 0 ? 8_000 : 60_000,
  });
  const list = React.useMemo(() => (data ?? []).filter((f) => {
    if (filters.q && !`${f.title} ${f.ref} ${f.description} ${f.design_assets?.screen_name ?? ""}`.toLowerCase().includes(filters.q.toLowerCase())) return false;
    if (filters.severity && f.severity !== filters.severity) return false;
    if (filters.type && f.review_type !== filters.type) return false;
    if (filters.owner && f.owner_id !== filters.owner) return false;
    if (filters.status === "open" && !OPEN_FINDING_STATUSES.includes(f.status)) return false;
    if (filters.status && filters.status !== "open" && f.status !== filters.status) return false;
    if (filters.since && f.created_at.slice(0, 10) < filters.since) return false;
    if (filters.job && f.review_job_id !== filters.job) return false;
    return true;
  }).sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || b.created_at.localeCompare(a.created_at)), [data, filters]);

  const selectedId = params.get("finding") ?? list[0]?.id ?? null;
  const selected = (data ?? []).find((f) => f.id === selectedId) ?? null;
  const select = React.useCallback((id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("finding", id); return n; }, { replace: true }), [setParams]);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [assigning, setAssigning] = React.useState(false);
  const [adding, setAdding] = React.useState(false);

  const invalidate = [["findings"], ["report"], qk.summary, ["attention", "findings"]];
  const setStatus = useAction(({ id, status }: { id: string; status: FindingStatus }) => findingsService.setStatus([id], status), {
    invalidate, success: "Finding updated",
  });
  const idx = list.findIndex((f) => f.id === selectedId);
  const move = React.useCallback((d: number) => {
    const next = list[Math.max(0, Math.min(list.length - 1, idx + d))];
    if (next) select(next.id);
  }, [list, idx, select]);

  // Keyboard: J/K move, A accept, D dismiss, E edit, Enter assign.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (!selected || !canEdit) return;
      else if (e.key === "a") { e.preventDefault(); setStatus.mutate({ id: selected.id, status: "accepted" }); }
      else if (e.key === "d") { e.preventDefault(); setStatus.mutate({ id: selected.id, status: "dismissed" }); }
      else if (e.key === "e") { e.preventDefault(); setEditing(true); }
      else if (e.key === "Enter") { e.preventDefault(); if (wide) setAssigning(true); else setDrawerOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, selected, canEdit, setStatus, wide]);

  const set = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));
  const detail = selected && (
    <FindingDetail finding={selected} onEdit={() => setEditing(true)} onAssign={() => setAssigning(true)}
      onStatus={(s) => setStatus.mutate({ id: selected.id, status: s })} busy={setStatus.isPending} />
  );

  return (
    <>
      <Card className="flex h-[calc(100vh-200px)] min-h-[560px] overflow-hidden">
        {/* Left: filters + list */}
        <div className="flex w-[320px] shrink-0 flex-col border-r border-line">
          <div className="space-y-2 border-b border-line p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted" />
              <Input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search findings" className="pl-7" aria-label="Search findings" />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Select aria-label="Campaign" value={filters.campaign} onChange={(e) => set({ campaign: e.target.value, job: "" })} placeholder="All campaigns" options={(campaigns ?? []).map((c) => ({ value: c.id, label: c.name }))} />
              <Select aria-label="Severity" value={filters.severity} onChange={(e) => set({ severity: e.target.value as Severity | "" })} placeholder="Any severity" options={options(SEVERITY_LABEL)} />
              <Select aria-label="Review type" value={filters.type} onChange={(e) => set({ type: e.target.value as ReviewType | "" })} placeholder="Any review" options={options(REVIEW_TYPE_LABEL).filter((o) => o.value !== "sow_analysis")} />
              <Select aria-label="Owner" value={filters.owner} onChange={(e) => set({ owner: e.target.value })} placeholder="Any owner" options={people.map((p) => ({ value: p.id, label: p.name }))} />
              <Select aria-label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value as Filters["status"] })} placeholder="Any status" options={[{ value: "open", label: "Open" }, ...options(FINDING_STATUS_LABEL)]} />
              <Input type="date" aria-label="Since" value={filters.since} onChange={(e) => set({ since: e.target.value })} />
            </div>
            {filters.job && <Button size="sm" variant="ghost" onClick={() => set({ job: "" })}>One review only ×</Button>}
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted">
            <span className="num">{list.length} findings</span>
            {canEdit && <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 hover:text-text"><Plus className="size-3.5" />Add manually</button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error ? <div className="p-2"><ErrorState error={error} onRetry={() => void refetch()} /></div> : isLoading ? <LoadingRows /> : list.length === 0 ? (
              <EmptyState icon={Inbox} title="No findings" body="Findings appear after a design or development review completes. Try clearing filters." />
            ) : (
              <ul>
                {list.map((f) => (
                  <li key={f.id}>
                    <button onClick={() => { select(f.id); if (!wide) setDrawerOpen(true); }}
                      className={cn("block w-full border-b border-line px-3 py-2.5 text-left hover:bg-hover", f.id === selectedId && "bg-active")}>
                      <div className="flex items-center gap-2">
                        <Pill tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</Pill>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.title}</span>
                        <span className="size-2 shrink-0 rounded-full" style={{ background: TONE_HEX[FINDING_STATUS_TONE[f.status]] }} title={FINDING_STATUS_LABEL[f.status]} />
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                        <span className="truncate">{f.design_assets?.screen_name ?? f.affected_page ?? f.dev_captures?.url ?? f.campaigns?.name}</span>
                        <span className="flex-1" />
                        {f.requirements ? <Mono className="text-muted">{f.requirements.ref}</Mono> : <span>Additional</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-muted">
            <span><Kbd>J</Kbd>/<Kbd>K</Kbd> move</span>{canEdit && <><span><Kbd>A</Kbd> accept</span><span><Kbd>D</Kbd> dismiss</span><span><Kbd>E</Kbd> edit</span><span><Kbd>↵</Kbd> assign</span></>}
          </div>
        </div>
        {/* Centre: screenshot */}
        <div className="min-w-0 flex-1">
          {selected ? <FindingScreen finding={selected} all={data ?? []} onSelect={select} /> : <EmptyState title="Select a finding" body="Its screen and evidence region appear here." className="h-full" />}
        </div>
        {/* Right: details (drawer below 1280px) */}
        {wide && <div className="w-[380px] shrink-0 overflow-y-auto border-l border-line">{detail ?? <EmptyState title="No finding selected" />}</div>}
      </Card>
      {!wide && selected && (
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title={selected.title} subtitle={<Mono>{selected.ref}</Mono>} width={420}>{detail}</Drawer>
      )}
      {editing && selected && <EditFinding finding={selected} onClose={() => setEditing(false)} />}
      {assigning && selected && <AssignFinding finding={selected} onClose={() => setAssigning(false)} />}
      {adding && <AddFinding defaultCampaign={filters.campaign} onClose={() => setAdding(false)} />}
    </>
  );
}

function FindingScreen({ finding: f, all, onSelect }: { finding: Finding; all: Finding[]; onSelect: (id: string) => void }) {
  const isDev = Boolean(f.dev_captures?.storage_path);
  const bucket = isDev ? "captures" : f.design_assets?.bucket ?? null;
  const path = isDev ? f.dev_captures!.storage_path : f.design_assets?.storage_path ?? null;
  const screenKey = isDev ? f.dev_capture_id : f.design_asset_id;
  // Screens with findings in the same review, for previous/next navigation.
  const screens = React.useMemo(() => {
    const seen = new Map<string, Finding>();
    all.filter((x) => x.review_job_id === f.review_job_id).forEach((x) => {
      const k = isDev ? x.dev_capture_id : x.design_asset_id;
      if (k && !seen.has(k)) seen.set(k, x);
    });
    return [...seen.entries()];
  }, [all, f.review_job_id, isDev]);
  const pos = screens.findIndex(([k]) => k === screenKey);
  const overlays: Overlay[] = all
    .filter((x) => (isDev ? x.dev_capture_id : x.design_asset_id) === screenKey && screenKey)
    .flatMap((x) => x.finding_evidence.filter((e) => e.kind === "region" && e.region).map((e) => ({ id: x.id, region: e.region as Region, active: x.id === f.id, label: x.title })));
  return (
    <ScreenshotViewer bucket={bucket} path={path} overlays={overlays} onSelectOverlay={onSelect}
      title={isDev ? `${f.dev_captures?.url} · ${deviceLabel(f.dev_captures?.viewport)}` : f.design_assets?.screen_name ?? "No screen"}
      position={pos >= 0 ? `Screen ${pos + 1} of ${screens.length}` : undefined}
      onPrev={pos > 0 ? () => onSelect(screens[pos - 1]![1].id) : undefined}
      onNext={pos >= 0 && pos < screens.length - 1 ? () => onSelect(screens[pos + 1]![1].id) : undefined} />
  );
}

function FindingDetail({ finding: f, onEdit, onAssign, onStatus, busy }: {
  finding: Finding; onEdit: () => void; onAssign: () => void; onStatus: (s: FindingStatus) => void; busy: boolean;
}) {
  const { canEdit } = useAuth();
  const { name } = useProfiles();
  const tasks = useQuery({ queryKey: ["finding-tasks", f.id], queryFn: () => findingsService.tasksFor(f.id) });
  const ai = f.ai_original as Record<string, unknown> | null;
  const edited = Boolean(f.edited_at);
  const fb = f.feedback ? defaultFeedback(f) : null;
  const console_ = f.finding_evidence.find((e) => e.kind === "console");
  const network = f.finding_evidence.find((e) => e.kind === "network");
  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Pill tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</Pill>
          <Mono>{f.ref}</Mono>
          <StatusDot tone={FINDING_STATUS_TONE[f.status]} label={FINDING_STATUS_LABEL[f.status]} />
        </div>
        <h2 className="text-[15px] font-semibold leading-snug">{f.title}</h2>
        <p className="mt-0.5 text-xs text-muted">{REVIEW_TYPE_LABEL[f.review_type]} · {f.campaigns?.name}{f.journeys ? ` · ${f.journeys.name}` : ""} · {formatDateTime(f.created_at)}</p>
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          {["new", "awaiting_review", "dismissed", "reopened"].includes(f.status) && <Button size="sm" variant="primary" loading={busy} onClick={() => onStatus("accepted")}><Check />Accept</Button>}
          {!["dismissed", "verified"].includes(f.status) && <Button size="sm" onClick={() => onStatus("dismissed")}><X />Dismiss</Button>}
          <Button size="sm" onClick={onEdit}><Pencil />Edit</Button>
          {["accepted", "awaiting_review", "new", "reopened"].includes(f.status) && <Button size="sm" onClick={onAssign}><UserPlus />Assign</Button>}
          {["fixed", "ready_for_retest"].includes(f.status) && <Button size="sm" onClick={() => onStatus("verified")}><ShieldCheck />Mark verified</Button>}
          {["fixed", "ready_for_retest", "verified"].includes(f.status) && <Button size="sm" onClick={() => onStatus("reopened")}><RotateCcw />Reopen</Button>}
        </div>
      )}
      {f.description && <p className="whitespace-pre-wrap text-sm text-text-2">{f.description}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-box border border-line p-2.5"><p className="label mb-1">Expected</p><p className="whitespace-pre-wrap text-sm">{f.expected || "—"}</p></div>
        <div className="rounded-box border border-line p-2.5"><p className="label mb-1">Observed</p><p className="whitespace-pre-wrap text-sm">{f.observed || "—"}</p></div>
      </div>
      {f.suggested_correction && <div><p className="label mb-1">Suggested correction</p><p className="whitespace-pre-wrap text-sm">{f.suggested_correction}</p></div>}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div><p className="label">Confidence</p><p>{CONFIDENCE_LABEL[f.confidence]}</p></div>
        <div><p className="label">Owner</p><p>{f.owner_id ? name(f.owner_id) : "—"}</p></div>
        {f.test_scenario && <div className="col-span-2"><p className="label">Test scenario</p><p>{f.test_scenario}</p></div>}
        {f.reproducibility && <div className="col-span-2"><p className="label">Reproducibility</p><p>{f.reproducibility}</p></div>}
        {f.evidence_note && <div className="col-span-2"><p className="label">Evidence note</p><p className="text-text-2">{f.evidence_note}</p></div>}
      </div>
      <div className="rounded-box border border-line bg-side p-2.5">
        <p className="label mb-1">Linked requirement</p>
        {f.requirements ? (
          <>
            <p className="text-sm"><Mono>{f.requirements.ref}</Mono> {f.requirements.title}</p>
            {f.requirements.source_text && <blockquote className="mt-1.5 border-l-2 border-line-strong pl-2 text-xs text-text-2 whitespace-pre-wrap">{f.requirements.source_text}{f.requirements.source_pages.length ? ` (p. ${f.requirements.source_pages.join(", ")})` : ""}</blockquote>}
          </>
        ) : <p className="text-sm text-text-2">Additional observation — not linked to an accepted requirement.</p>}
      </div>
      {(console_ || network) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-text-2">Console and network evidence</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-ctl border border-line bg-side p-2 font-mono text-xs">{JSON.stringify({ console: console_?.data, network: network?.data }, null, 2)}</pre>
        </details>
      )}
      {fb && (
        <div>
          <p className="section-title mb-1">Feedback</p>
          <dl className="space-y-1 text-sm">
            {(["issue", "location", "observation", "expected", "action_required"] as const).map((k) => (
              <div key={k} className="grid grid-cols-[110px_1fr] gap-2"><dt className="text-muted capitalize">{k.replace("_", " ")}</dt><dd>{fb[k] || "—"}</dd></div>
            ))}
            <div className="grid grid-cols-[110px_1fr] gap-2"><dt className="text-muted">Priority</dt><dd>{PRIORITY_LABEL[fb.priority]}</dd></div>
          </dl>
        </div>
      )}
      {(tasks.data ?? []).length > 0 && (
        <div>
          <p className="label mb-1">Tasks</p>
          {tasks.data!.map((t) => <a key={t.id} href={`/tasks?task=${t.id}`} className="block text-sm hover:text-accent"><Mono>{t.ref}</Mono> {t.title}</a>)}
        </div>
      )}
      {edited && ai && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-text-2">Original AI output (edited by {name(f.edited_by)} · {formatDateTime(f.edited_at)})</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-ctl border border-line bg-side p-2 font-mono text-xs">{JSON.stringify(ai, null, 2)}</pre>
        </details>
      )}
      {f.decided_by && <p className="text-xs text-muted">Last decision by {name(f.decided_by)} · {formatDateTime(f.decided_at)}</p>}
    </div>
  );
}

function FeedbackFields({ value, onChange }: { value: Feedback; onChange: (v: Feedback) => void }) {
  const set = (p: Partial<Feedback>) => onChange({ ...value, ...p });
  return (
    <div className="grid gap-2.5">
      <Field label="Issue"><Input value={value.issue} onChange={(e) => set({ issue: e.target.value })} /></Field>
      <Field label="Location"><Input value={value.location} onChange={(e) => set({ location: e.target.value })} /></Field>
      <Field label="Observation"><Textarea rows={2} value={value.observation} onChange={(e) => set({ observation: e.target.value })} /></Field>
      <Field label="Expected"><Textarea rows={2} value={value.expected} onChange={(e) => set({ expected: e.target.value })} /></Field>
      <Field label="Action required"><Textarea rows={2} value={value.action_required} onChange={(e) => set({ action_required: e.target.value })} /></Field>
      <Field label="Priority"><Select value={value.priority} onChange={(e) => set({ priority: e.target.value as Priority })} options={options(PRIORITY_LABEL)} /></Field>
    </div>
  );
}

function EditFinding({ finding: f, onClose }: { finding: Finding; onClose: () => void }) {
  const [title, setTitle] = React.useState(f.title);
  const [severity, setSeverity] = React.useState<Severity>(f.severity);
  const [description, setDescription] = React.useState(f.description);
  const [expected, setExpected] = React.useState(f.expected ?? "");
  const [observed, setObserved] = React.useState(f.observed ?? "");
  const [correction, setCorrection] = React.useState(f.suggested_correction ?? "");
  const [fb, setFb] = React.useState<Feedback>(defaultFeedback(f));
  const original = React.useMemo(() => defaultFeedback(f), [f]);
  const save = useAction(() => {
    // Feedback fields the manager didn't touch follow the edited finding.
    const synced: Feedback = {
      ...fb,
      issue: fb.issue === original.issue ? title : fb.issue,
      observation: fb.observation === original.observation ? observed || description : fb.observation,
      expected: fb.expected === original.expected ? expected : fb.expected,
      action_required: fb.action_required === original.action_required ? correction : fb.action_required,
    };
    return findingsService.update(f.id, { title, severity, description, expected, observed, suggested_correction: correction, feedback: synced });
  },
    { invalidate: [["findings"]], success: "Finding saved. The original AI output is kept.", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Edit ${f.ref}`} description="Your edits are saved alongside the original AI output, which never changes." className="max-w-3xl"
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="grid content-start gap-2.5">
            <p className="section-title">Finding</p>
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Severity"><Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} options={options(SEVERITY_LABEL)} /></Field>
            <Field label="Description"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <Field label="Expected"><Textarea rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
            <Field label="Observed"><Textarea rows={2} value={observed} onChange={(e) => setObserved(e.target.value)} /></Field>
            <Field label="Suggested correction"><Textarea rows={2} value={correction} onChange={(e) => setCorrection(e.target.value)} /></Field>
          </div>
          <div className="grid content-start gap-2.5">
            <p className="section-title">Feedback for the team</p>
            <FeedbackFields value={fb} onChange={setFb} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssignFinding({ finding: f, onClose }: { finding: Finding; onClose: () => void }) {
  const { people } = usePeople();
  const { data: campaigns } = useCampaigns();
  const camp = campaigns?.find((c) => c.id === f.campaign_id);
  const preferred = camp?.campaign_members.find((m) => (f.review_type.includes("development") || f.review_type === "functional_qa" ? m.campaign_role === "developer" : m.campaign_role === "designer"))?.user_id;
  const [owner, setOwner] = React.useState(f.owner_id ?? preferred ?? "");
  const [due, setDue] = React.useState(() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10); });
  const [fb, setFb] = React.useState<Feedback>(defaultFeedback(f));
  const save = useAction(() => findingsService.assign(f, { ownerId: owner, dueDate: due || null, priority: fb.priority, feedback: fb }),
    { invalidate: [["findings"], ["tasks"], ["finding-tasks", f.id]], success: "Task created and finding assigned", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Assign ${f.ref}`} description="Creates a task that keeps the finding ID, requirement, campaign, journey, submission and evidence." className="max-w-xl"
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!owner} loading={save.isPending} onClick={() => save.mutate(undefined)}>Assign and create task</Button></>}>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Owner"><Select value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Choose a person" options={people.filter((p) => p.role !== "viewer").map((p) => ({ value: p.id, label: p.name }))} /></Field>
            <Field label="Due date"><Input type="date" min={todayISO()} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          </div>
          <FeedbackFields value={fb} onChange={setFb} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddFinding({ defaultCampaign, onClose }: { defaultCampaign: string; onClose: () => void }) {
  const { data: campaigns } = useCampaigns();
  const [campaign, setCampaign] = React.useState(defaultCampaign);
  const reqs = useQuery({ queryKey: qk.requirements(campaign), queryFn: () => requirementsService.list(campaign), enabled: Boolean(campaign) });
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [severity, setSeverity] = React.useState<Severity>("medium");
  const [req, setReq] = React.useState("");
  const [type, setType] = React.useState<ReviewType>("sow_vs_design");
  const save = useAction(() => findingsService.addManual({ campaignId: campaign, title, description, severity, requirementId: req || null, reviewType: type }),
    { invalidate: [["findings"]], success: "Finding added", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add a finding" description="For issues you spotted yourself. It’s accepted immediately."
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!campaign || !title} loading={save.isPending} onClick={() => save.mutate(undefined)}>Add finding</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Campaign"><Select value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Choose" options={(campaigns ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Area"><Select value={type} onChange={(e) => setType(e.target.value as ReviewType)} options={options(REVIEW_TYPE_LABEL).filter((o) => o.value !== "sow_analysis")} /></Field>
          <Field label="Title" className="col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Description" className="col-span-2"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Severity"><Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} options={options(SEVERITY_LABEL)} /></Field>
          <Field label="Requirement"><Select value={req} onChange={(e) => setReq(e.target.value)} placeholder="Additional observation"
            options={(reqs.data ?? []).filter((r) => r.status === "accepted").map((r) => ({ value: r.id, label: `${r.ref} · ${r.title}` }))} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
