import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Trash2, Unlink, X } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Pill, StatusDot } from "@/components/common";
import { REQ_STATUS_LABEL, REQ_STATUS_TONE, VERIFICATION_LABEL, VERIFICATION_TONE, type Tone } from "@/lib/labels";
import type { Finding } from "@/services/findings";
import type { Requirement, RequirementCheck } from "@/services/requirements";
import { FindingList } from "./FindingList";
import { KIND_META, canDelete, type GraphEdge, type GraphNode } from "./graph";
import { KIND_ICON } from "./nodes";

/** What the inspector is showing. It follows whatever object you select: a step, a connection, a finding or a requirement. */
export type Focus = { t: "node"; id: string } | { t: "edge"; id: string } | { t: "finding"; id: string } | { t: "req"; id: string };

const Head = ({ eyebrow, title, right, onClose }: { eyebrow: string; title: React.ReactNode; right?: React.ReactNode; onClose: () => void }) => (
  <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
    <div className="min-w-0 flex-1"><p className="text-xs text-muted">{eyebrow}</p><h2 className="truncate text-sm font-semibold">{title}</h2></div>
    {right}
    <Button variant="ghost" size="icon" aria-label="Close inspector" onClick={onClose}><X /></Button>
  </div>
);
const Back = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button onClick={onClick} className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-text"><ArrowLeft className="size-3.5" />{label}</button>
);

// ---------------------------------------------------------------- a logic step
export function NodePanel({ node, nodes, edges, requirements, linked, canWrite, readOnlyReason, onSave, onDelete, onSelect, onLink, onUnlink, onClose }: {
  node: GraphNode; nodes: GraphNode[]; edges: GraphEdge[]; requirements: Requirement[]; linked: Requirement[]; canWrite: boolean; readOnlyReason?: string;
  onSave: (patch: { label: string; config: Record<string, unknown> }) => Promise<unknown>; onDelete: () => void;
  onSelect: (f: Focus) => void; onLink: (requirementId: string) => void; onUnlink: (requirementId: string) => void; onClose: () => void;
}) {
  const meta = KIND_META[node.kind], Icon = KIND_ICON[node.kind];
  const [label, setLabel] = React.useState(node.label);
  const [config, setConfig] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    setLabel(node.label);
    setConfig(Object.fromEntries(meta.fields.map((f) => [f.key, String(node.config[f.key] ?? "")])));
  }, [node.id, node.version, node.label, node.config, meta.fields]);
  const dirty = label !== node.label || meta.fields.some((f) => (config[f.key] ?? "") !== String(node.config[f.key] ?? ""));
  const name = (id: string) => nodes.find((n) => n.id === id)?.label || KIND_META[nodes.find((n) => n.id === id)?.kind ?? "screen"].label;
  const out = edges.filter((e) => e.source_id === node.id), inc = edges.filter((e) => e.target_id === node.id);
  const pickable = requirements.filter((r) => r.status !== "rejected" && !linked.some((l) => l.id === r.id));
  const ro = !canWrite;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="inspector" data-focus="node">
      <Head eyebrow={meta.label} title={node.label || meta.label} right={<Icon className="size-4 text-muted" />} onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <p className="text-xs text-muted">{meta.hint}.{node.kind !== "note" && node.kind !== "start" && node.kind !== "end" ? " This step documents the journey; Journey does not test it until a scenario covers it." : ""}</p>
        {ro && readOnlyReason && <p className="rounded-box border border-line bg-side px-2.5 py-1.5 text-xs text-text-2">{readOnlyReason}</p>}
        {node.kind !== "start" && node.kind !== "end" && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!dirty || ro) return; setSaving(true); void onSave({ label: label.trim(), config: { ...node.config, ...config } }).finally(() => setSaving(false)); }}>
            <Field label="Name"><Input value={label} maxLength={200} disabled={ro} onChange={(e) => setLabel(e.target.value)} placeholder={meta.label} /></Field>
            {meta.fields.map((f) => (
              <Field key={f.key} label={f.label}>
                {f.multiline ? <Textarea rows={3} value={config[f.key] ?? ""} disabled={ro} maxLength={1500} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))} placeholder={f.placeholder} />
                  : <Input value={config[f.key] ?? ""} disabled={ro} maxLength={400} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))} placeholder={f.placeholder} />}
              </Field>
            ))}
            {!ro && <Button type="submit" variant="primary" size="sm" disabled={!dirty} loading={saving}>Save</Button>}
          </form>
        )}

        <div>
          <p className="mb-1 text-xs font-medium text-text-2">Requirements this step answers to</p>
          {linked.length ? <ul className="space-y-1">{linked.map((r) => (
            <li key={r.id} className="flex items-start gap-2 text-sm">
              <button className="min-w-0 flex-1 text-left hover:underline" onClick={() => onSelect({ t: "req", id: r.id })}><span className="font-mono text-xs text-muted">{r.ref}</span> {r.title}</button>
              {!ro && <button aria-label={`Unlink ${r.ref}`} title="Unlink" className="rounded-ctl p-1 text-muted hover:bg-hover hover:text-text" onClick={() => onUnlink(r.id)}><Unlink className="size-3.5" /></button>}
            </li>))}</ul> : <p className="text-sm text-text-2">None linked yet.</p>}
          {!ro && pickable.length > 0 && <div className="mt-2"><Select value="" onChange={(e) => e.target.value && onLink(e.target.value)} placeholder="Link a requirement…" options={pickable.map((r) => ({ value: r.id, label: `${r.ref} · ${r.title}` }))} /></div>}
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-text-2">Connections</p>
          {inc.length + out.length === 0 ? <p className="text-sm text-text-2">Not connected yet. Drag from a dot on this step to another step.</p> : (
            <ul className="space-y-1">
              {inc.map((e) => <li key={e.id}><button className="flex w-full items-center gap-1.5 text-left text-sm hover:underline" onClick={() => onSelect({ t: "edge", id: e.id })}><span className="truncate">{name(e.source_id)}</span><ArrowRight className="size-3.5 shrink-0 text-muted" /><span className="shrink-0 text-muted">this step</span>{e.label && <span className="truncate text-xs text-muted">· {e.label}</span>}</button></li>)}
              {out.map((e) => <li key={e.id}><button className="flex w-full items-center gap-1.5 text-left text-sm hover:underline" onClick={() => onSelect({ t: "edge", id: e.id })}><span className="shrink-0 text-muted">this step</span><ArrowRight className="size-3.5 shrink-0 text-muted" /><span className="truncate">{name(e.target_id)}</span>{e.label && <span className="truncate text-xs text-muted">· {e.label}</span>}</button></li>)}
            </ul>
          )}
        </div>
        {!ro && canDelete(node.kind) && <Button size="sm" variant="ghost" onClick={onDelete} className="text-st-red"><Trash2 />Delete this step</Button>}
        {!ro && node.kind === "start" && <p className="text-xs text-muted">Start cannot be deleted: every journey has one.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a connection
export function EdgePanel({ edge, nodes, canWrite, onSave, onDelete, onSelect, onClose }: {
  edge: GraphEdge; nodes: GraphNode[]; canWrite: boolean; onSave: (label: string) => Promise<unknown>; onDelete: () => void; onSelect: (f: Focus) => void; onClose: () => void;
}) {
  const [label, setLabel] = React.useState(edge.label);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setLabel(edge.label), [edge.id, edge.version, edge.label]);
  const s = nodes.find((n) => n.id === edge.source_id), t = nodes.find((n) => n.id === edge.target_id);
  const nm = (n?: GraphNode) => n?.label || (n ? KIND_META[n.kind].label : "?");
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="inspector" data-focus="edge">
      <Head eyebrow="Connection" title={<>{nm(s)} <span className="text-muted">to</span> {nm(t)}</>} onClose={onClose} />
      <div className="space-y-4 overflow-y-auto p-3">
        <div className="flex flex-wrap gap-1.5 text-sm">
          {s && <Button size="sm" variant="secondary" onClick={() => onSelect({ t: "node", id: s.id })}>From: {nm(s)}</Button>}
          {t && <Button size="sm" variant="secondary" onClick={() => onSelect({ t: "node", id: t.id })}>To: {nm(t)}</Button>}
        </div>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (label === edge.label || !canWrite) return; setSaving(true); void onSave(label.trim()).finally(() => setSaving(false)); }}>
          <Field label="Label" hint="What makes the journey take this path, for example “Code valid” or “After 3 attempts”.">
            <Input value={label} maxLength={120} disabled={!canWrite} onChange={(e) => setLabel(e.target.value)} placeholder="Optional" />
          </Field>
          {canWrite && <Button type="submit" variant="primary" size="sm" disabled={label === edge.label} loading={saving}>Save</Button>}
        </form>
        {canWrite && <Button size="sm" variant="ghost" onClick={onDelete} className="text-st-red"><Trash2 />Delete this connection</Button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a finding
export function FindingPanel({ campaignId, finding, backLabel, onBack, onSelect, onClose }: {
  campaignId: string; finding: Finding; backLabel: string; onBack: () => void; onSelect: (f: Focus) => void; onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="inspector" data-focus="finding">
      <Head eyebrow="Finding" title={finding.title} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 pt-2.5"><Back label={backLabel} onClick={onBack} /></div>
        <FindingList campaignId={campaignId} findings={[finding]} />
        {finding.requirements && finding.requirement_id && (
          <div className="border-t border-line p-3"><Button size="sm" variant="secondary" onClick={() => onSelect({ t: "req", id: finding.requirement_id! })}>Open {finding.requirements.ref}</Button></div>
        )}
        <p className="px-3 pb-3 text-xs text-muted">A finding is a draft from Claude. A manager accepts or dismisses it.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a requirement
export function RequirementPanel({ campaignId, requirement, check, steps, backLabel, onBack, onSelect, onClose }: {
  campaignId: string; requirement: Requirement; check: RequirementCheck | null; steps: GraphNode[]; backLabel: string; onBack: () => void; onSelect: (f: Focus) => void; onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="inspector" data-focus="req">
      <Head eyebrow={`Requirement ${requirement.ref}`} title={requirement.title} right={<Pill tone={REQ_STATUS_TONE[requirement.status]}>{REQ_STATUS_LABEL[requirement.status]}</Pill>} onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <Back label={backLabel} onClick={onBack} />
        {requirement.description && <p className="whitespace-pre-wrap text-sm text-text-2">{requirement.description}</p>}
        <div>
          <p className="mb-1 text-xs font-medium text-text-2">Verification</p>
          {check ? <StatusDot tone={VERIFICATION_TONE[check.result] as Tone} label={VERIFICATION_LABEL[check.result]} /> : <p className="text-sm text-text-2">Not checked yet.</p>}
          <p className="mt-1 text-xs text-muted">A screenshot never proves a backend rule: those stay “Needs verification” until a test or a person confirms them.</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-text-2">Steps linked to it</p>
          {steps.length ? <ul className="space-y-1">{steps.map((n) => <li key={n.id}><button className="text-left text-sm hover:underline" onClick={() => onSelect({ t: "node", id: n.id })}>{n.label || KIND_META[n.kind].label} <span className="text-xs text-muted">· {KIND_META[n.kind].label}</span></button></li>)}</ul> : <p className="text-sm text-text-2">No step is linked to this requirement yet.</p>}
        </div>
        <Button asChild size="sm" variant="ghost"><Link to={`/campaigns/${campaignId}/requirements`}>Open in Requirements</Link></Button>
      </div>
    </div>
  );
}
