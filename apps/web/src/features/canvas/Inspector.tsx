import * as React from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Maximize2, Plus, X } from "lucide-react";
import { Button, Dialog, DialogContent, Field, Input, Select, Tabs, Textarea } from "@/components/ui";
import { Pill, StatusDot } from "@/components/common";
import { useAuth } from "@/lib/auth";
import { useAction } from "@/hooks/useAction";
import { usePeople } from "@/hooks/queries";
import { PRIORITY_LABEL, SUBMISSION_STATUS_LABEL, TASK_STATUS_LABEL, TASK_STATUS_TONE, TRACK_LABEL, TRACK_TONE, VERIFICATION_LABEL, VERIFICATION_TONE, type Priority, type Tone } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import type { CampaignWithRelations } from "@/services/campaigns";
import { tasksService } from "@/services/tasks";
import { RunReviewButton } from "@/features/shared/RunReview";
import { AssetImage, useSignedUrl } from "@/features/shared/AssetImage";
import { FindingList } from "./FindingList";
import { UNASSIGNED, type JourneyModel, type ScreenModel } from "./journeyModel";
import type { Requirement } from "@/services/requirements";
import type { Focus } from "./ObjectPanels";

type Tab = "overview" | "findings" | "requirements" | "tests" | "tasks";
const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" }, { value: "findings", label: "Findings" }, { value: "requirements", label: "Requirements" },
  { value: "tests", label: "Tests" }, { value: "tasks", label: "Tasks" },
];

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[88px_1fr] gap-2 py-1 text-sm"><dt className="text-xs text-muted">{label}</dt><dd className="min-w-0">{children}</dd></div>
);

/** Design screenshot with the findings pinned on it. Regions are approximate, so they are drawn dashed and labelled. */
function PinnedImage({ screen, onOpen }: { screen: ScreenModel; onOpen: () => void }) {
  const { data: url } = useSignedUrl(screen.asset.bucket, screen.asset.storage_path);
  const pins = screen.open.flatMap((f) => {
    const r = (f.finding_evidence ?? []).find((e) => e.kind === "region")?.region as { x: number; y: number; w: number; h: number } | null | undefined;
    return r && typeof r.x === "number" ? [{ id: f.id, r, title: f.title }] : [];
  });
  return (
    <div className="relative overflow-hidden rounded-box border border-line bg-side">
      {url ? <img src={url} alt={screen.asset.screen_name} className="block max-h-[420px] w-full object-contain" draggable={false} /> : <div className="h-60 animate-pulse bg-hover" />}
      {url && pins.map((p) => <span key={p.id} title={`${p.title} (approximate)`} className="absolute rounded-sm border border-dashed border-st-red/80 bg-st-red/10"
        style={{ left: `${p.r.x * 100}%`, top: `${p.r.y * 100}%`, width: `${p.r.w * 100}%`, height: `${p.r.h * 100}%` }} />)}
      <Button size="icon" variant="secondary" className="absolute right-2 top-2" aria-label="Open full screen" title="Open full screen" onClick={onOpen}><Maximize2 /></Button>
    </div>
  );
}

function AddTaskDialog({ campaignId, journeyId, screen, onClose }: { campaignId: string; journeyId: string | null; screen: ScreenModel; onClose: () => void }) {
  const { people } = usePeople();
  const [title, setTitle] = React.useState(`${screen.asset.screen_name}: `);
  const [description, setDescription] = React.useState("");
  const [assignee, setAssignee] = React.useState("");
  const [priority, setPriority] = React.useState<Priority>("medium");
  const [due, setDue] = React.useState("");
  const save = useAction(() => tasksService.create({ campaign_id: campaignId, journey_id: journeyId, title: title.trim(), description: description || null, assignee_id: assignee || null, priority, due_date: due || null }),
    { invalidate: [["tasks"]], success: "Task created", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add a task" description={`For the “${screen.asset.screen_name}” screen`}
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={title.trim().length < 3} loading={save.isPending} onClick={() => save.mutate(undefined)}>Create task</Button></>}>
        <div className="space-y-3">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
          <Field label="Details"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Assignee"><Select value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Unassigned" options={people.map((p) => ({ value: p.id, label: p.name }))} /></Field>
            <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} options={(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} /></Field>
            <Field label="Due"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Right-hand panel. With nothing selected it summarises the journey; with a screen selected it shows everything about that screen. */
export function Inspector({ campaign: c, model, journeyName, screen, onClose, onOpenViewer, onSubmitDesigns, onAddBuild, onFocus, linked = [], pickable = [], canLink = false, onLink, onUnlink }: {
  campaign: CampaignWithRelations; model: JourneyModel; journeyName: string; screen: ScreenModel | null; onClose: () => void;
  onOpenViewer: (index: number) => void; onSubmitDesigns: () => void; onAddBuild: () => void;
  onFocus?: (f: Focus) => void;
  /** Requirements linked to this screen's step, the ones that could still be linked, and who may link them. */
  linked?: Requirement[]; pickable?: Requirement[]; canLink?: boolean; onLink?: (requirementId: string) => void; onUnlink?: (requirementId: string) => void;
}) {
  const { canEdit } = useAuth();
  const [tab, setTab] = React.useState<Tab>("overview");
  const [adding, setAdding] = React.useState(false);
  React.useEffect(() => setTab("overview"), [screen?.asset.id]);
  const journey = c.journeys.find((j) => j.id === model.key);
  const journeyId = model.key === UNASSIGNED ? null : model.key;
  const sub = model.submission, build = model.build, t = model.tests;

  const actions = canEdit && (
    <div className="flex flex-wrap gap-1.5">
      {sub && !model.working.design && <RunReviewButton size="sm" variant="primary" campaignId={c.id} reviewType="sow_vs_design" source={{ design_submission_id: sub.id }} label="Check designs vs SOW" />}
      {build && !model.working.build && <RunReviewButton size="sm" variant={sub ? "secondary" : "primary"} campaignId={c.id} reviewType="site_check" source={{ development_submission_id: build.id }} label="Test now" />}
      {build && sub && !model.working.build && <RunReviewButton size="sm" variant="ghost" campaignId={c.id} reviewType="design_vs_development" source={{ development_submission_id: build.id }} label="Compare with built page" />}
    </div>
  );

  // ---------------------------------------------------------------- journey summary
  if (!screen) {
    const metric = (n: number | string, label: string) => <div className="rounded-box border border-line px-2.5 py-2"><p className="text-lg font-semibold num">{n}</p><p className="text-xs text-muted">{label}</p></div>;
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="inspector">
        <div className="border-b border-line px-3 py-2.5"><p className="text-xs text-muted">Journey</p><h2 className="text-sm font-semibold">{journeyName}</h2></div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          {journey && (
            <dl>{([["Design", journey.design_status], ["Development", journey.development_status], ["QA", journey.qa_status], ["Client UAT", journey.uat_status]] as const).map(([l, v]) =>
              <Row key={l} label={l}><StatusDot tone={TRACK_TONE[v]} label={TRACK_LABEL[v]} /></Row>)}</dl>
          )}
          <div className="grid grid-cols-2 gap-2">
            {metric(model.summary.screens, "screens")}
            {metric(model.summary.awaitingReview, "findings to review")}
            {metric(model.summary.acceptedRequirements, "accepted requirements")}
            {metric(t.total ? `${t.passed}/${t.total}` : "—", "scenarios passed")}
          </div>
          {sub ? <p className="text-xs text-muted">Designs: {sub.title} v{sub.version_no} · {SUBMISSION_STATUS_LABEL[sub.status]}</p> : <p className="text-sm text-text-2">No designs for this journey yet. Drop screens on the canvas or submit them below.</p>}
          {build ? <p className="text-xs text-muted">Build: {build.version_label} · <span className="break-all">{build.staging_url}</span></p> : <p className="text-sm text-text-2">No staging build yet. Add the URL and Claude looks through the site for errors.</p>}
          {actions}
          {canEdit && <div className="flex flex-wrap gap-1.5"><Button size="sm" onClick={onSubmitDesigns}><Plus />Submit designs</Button><Button size="sm" onClick={onAddBuild}><Plus />Add staging build</Button></div>}
          {t.failing.length > 0 && (
            <div><p className="mb-1 text-xs font-medium text-text-2">Needs attention in tests</p>
              <ul className="space-y-1.5">{t.failing.map((f) => <li key={f.id} className="rounded-box border border-line px-2.5 py-1.5 text-sm"><StatusDot tone={f.result === "failed" ? "red" : "amber"} label={f.title} />{f.actual && <p className="mt-0.5 text-xs text-muted">{f.actual}</p>}</li>)}</ul>
            </div>
          )}
          <p className="text-xs text-muted">Select a screen on the canvas to inspect it. Claude’s findings are drafts: a manager accepts or dismisses each one.</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- one screen
  const cited = new Map<string, { ref: string; title: string; n: number }>();
  for (const f of screen.findings) if (f.requirements) { const r = cited.get(f.requirements.ref) ?? { ref: f.requirements.ref, title: f.requirements.title, n: 0 }; r.n++; cited.set(f.requirements.ref, r); }
  const designUrl = screen.capture;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="inspector">
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">Screen {String(screen.index + 1).padStart(2, "0")} · {screen.asset.screen_type}</p>
          <h2 className="truncate text-sm font-semibold">{screen.asset.screen_name}</h2>
        </div>
        <Pill tone={screen.tone}>{screen.label}</Pill>
        <Button variant="ghost" size="icon" aria-label="Close inspector" onClick={onClose}><X /></Button>
      </div>
      <div className="overflow-x-auto px-3"><Tabs value={tab} onChange={setTab} tabs={TABS.map((x) => ({ ...x, label: x.value === "findings" ? `Findings${screen.open.length ? ` ${screen.open.length}` : ""}` : x.label }))} /></div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "overview" && (
          <div className="space-y-3 p-3">
            <PinnedImage screen={screen} onOpen={() => onOpenViewer(screen.index)} />
            <dl>
              <Row label="Design">{sub ? `${sub.title} v${sub.version_no} · ${SUBMISSION_STATUS_LABEL[sub.status]}` : "—"}</Row>
              <Row label="Built">{screen.built}{build ? <span className="text-muted"> · {build.version_label}</span> : null}</Row>
              <Row label="Tests">{t.total ? `${t.passed}/${t.total} scenarios passed${t.failed ? `, ${t.failed} failed` : ""}${t.blocked ? `, ${t.blocked} blocked` : ""}` : "No scenarios yet"}<p className="text-xs text-muted">Scenarios belong to the journey, not to one screen.</p></Row>
            </dl>
            {designUrl && (
              <div>
                <p className="mb-1 text-xs font-medium text-text-2">Design and built page, side by side</p>
                <div className="grid grid-cols-2 gap-2">
                  <AssetImage bucket={screen.asset.bucket} path={screen.asset.storage_path} alt="Design" className="max-h-56 rounded border border-line" />
                  <AssetImage bucket="captures" path={designUrl.storage_path} alt="Built page" className="max-h-56 rounded border border-line" />
                </div>
                <p className="mt-1 text-xs text-muted">Built page captured from {designUrl.url}.</p>
              </div>
            )}
            {actions}
            <p className="text-xs text-muted">Checks run on every screen of this version, not just this one.</p>
            {canEdit && <Button size="sm" onClick={() => setAdding(true)}><Plus />Add a task</Button>}
          </div>
        )}
        {tab === "findings" && <FindingList campaignId={c.id} onSelect={onFocus ? (id) => onFocus({ t: "finding", id }) : undefined} findings={screen.findings.filter((f) => f.status !== "dismissed")} emptyText="No findings on this screen. Run “Check designs vs SOW” to check it against the accepted requirements." />}
        {tab === "requirements" && (
          <div className="space-y-3 p-3">
            <div>
              <p className="mb-1 text-xs font-medium text-text-2">Linked to this screen</p>
              {linked.length ? <ul className="space-y-1">{linked.map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-sm">
                  <button className="min-w-0 flex-1 text-left hover:underline" onClick={() => onFocus?.({ t: "req", id: r.id })}><span className="font-mono text-xs text-muted">{r.ref}</span> {r.title}</button>
                  {canLink && <button aria-label={`Unlink ${r.ref}`} className="rounded-ctl px-1.5 text-xs text-muted hover:bg-hover hover:text-text" onClick={() => onUnlink?.(r.id)}>Unlink</button>}
                </li>))}</ul> : <p className="text-sm text-text-2">No requirement is linked to this screen yet.</p>}
              {canLink && pickable.length > 0 && <div className="mt-2"><Select value="" onChange={(e) => e.target.value && onLink?.(e.target.value)} placeholder="Link a requirement…" options={pickable.map((r) => ({ value: r.id, label: `${r.ref} · ${r.title}` }))} /></div>}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-text-2">Cited by findings on this screen</p>
              {cited.size ? <ul className="space-y-1">{[...cited.values()].map((r) => <li key={r.ref} className="text-sm"><span className="font-mono text-xs text-muted">{r.ref}</span> {r.title} <span className="text-xs text-muted">· {r.n} finding{r.n === 1 ? "" : "s"}</span></li>)}</ul> : <p className="text-sm text-text-2">No finding on this screen cites a requirement yet.</p>}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-text-2">Accepted requirements of this journey</p>
              {model.accepted.length ? <ul className="space-y-1">{model.accepted.map((r) => {
                const chk = model.checkOf.get(r.id);
                return <li key={r.id} className="flex items-start gap-2 text-sm"><span className="font-mono text-xs text-muted">{r.ref}</span><button className="min-w-0 flex-1 text-left hover:underline" onClick={() => onFocus?.({ t: "req", id: r.id })}>{r.title}</button>{chk && <StatusDot tone={VERIFICATION_TONE[chk.result] as Tone} label={VERIFICATION_LABEL[chk.result]} className="text-xs" />}</li>;
              })}</ul> : <p className="text-sm text-text-2">No accepted requirements yet. A manager accepts Claude’s drafts on the Requirements tab.</p>}
              <p className="mt-2 text-xs text-muted">A requirement is not tied to a screen unless a finding cites it. A screenshot never proves a backend rule.</p>
            </div>
          </div>
        )}
        {tab === "tests" && (
          <div className="space-y-2 p-3">
            <p className="text-xs text-muted">Scenarios belong to the journey. They run against the staging build.</p>
            {t.results.length ? <ul className="space-y-1.5">{t.results.map((r) => (
              <li key={r.id} className="rounded-box border border-line px-2.5 py-1.5 text-sm">
                <StatusDot tone={r.result === "verified" ? "green" : r.result === "failed" ? "red" : r.result === "blocked" ? "amber" : "gray"} label={`${r.title} · ${r.result === "verified" ? "Passed" : r.result === "failed" ? "Failed" : r.result === "blocked" ? "Blocked" : "Not run"}`} />
                {r.actual && r.result !== "verified" && <p className="mt-0.5 text-xs text-muted">{r.actual}</p>}
              </li>))}</ul> : <p className="text-sm text-text-2">No scenarios for this journey yet. Add them on the Development tab.</p>}
            {canEdit && build && t.total > 0 && !model.working.build && <RunReviewButton size="sm" campaignId={c.id} reviewType="functional_qa" source={{ development_submission_id: build.id }} label="Run scenarios" />}
          </div>
        )}
        {tab === "tasks" && (
          <div className="space-y-2 p-3">
            {screen.tasks.length ? <ul className="space-y-1.5">{screen.tasks.map((k) => (
              <li key={k.id} className="rounded-box border border-line px-2.5 py-1.5 text-sm">
                <p className="font-medium">{k.ref ? <span className="mr-1 font-mono text-xs text-muted">{k.ref}</span> : null}{k.title}</p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-muted"><StatusDot tone={TASK_STATUS_TONE[k.status]} label={TASK_STATUS_LABEL[k.status]} className="text-xs" />{k.assignee?.full_name ?? "Unassigned"}{k.due_date ? ` · due ${formatDate(k.due_date, true)}` : ""}</p>
              </li>))}</ul> : <p className="text-sm text-text-2">No tasks from this screen’s findings yet.</p>}
            <div className="flex flex-wrap gap-1.5">
              {canEdit && <Button size="sm" onClick={() => setAdding(true)}><Plus />Add a task</Button>}
              <Button asChild size="sm" variant="ghost"><Link to={`/tasks`}><ExternalLink />All tasks</Link></Button>
            </div>
          </div>
        )}
      </div>
      {adding && <AddTaskDialog campaignId={c.id} journeyId={journeyId} screen={screen} onClose={() => setAdding(false)} />}
    </div>
  );
}

