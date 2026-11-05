import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Plus, Check, X, HelpCircle, RotateCcw, FileText } from "lucide-react";
import { useForm } from "react-hook-form";
import { Button, Card, Checkbox, Dialog, DialogContent, Drawer, Field, Input, Select, Textarea } from "@/components/ui";
import { EmptyState, ErrorState, LoadingRows, Mono, Section, StatusDot, Table, Td, Th, Tr, KeyValue } from "@/components/common";
import {
  CATEGORY_LABEL, CONFIDENCE_LABEL, JOB_STATUS_TONE, PRIORITY_LABEL, REQ_STATUS_LABEL, REQ_STATUS_TONE, VERIFICATION_LABEL,
  VERIFICATION_TONE, METHOD_LABEL, REVIEW_TYPE_LABEL, options, type RequirementStatus,
} from "@/lib/labels";
import { cn, formatBytes, formatDateTime } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { qk, useProfiles } from "@/hooks/queries";
import { useAction } from "@/hooks/useAction";
import { useListKeys } from "@/hooks/useListKeys";
import { requirementsService, sowService, type Requirement, type SowDocument, type SowVersion } from "@/services/requirements";
import { storageService, validateFile } from "@/services/storage";
import type { CampaignWithRelations } from "@/services/campaigns";
import { useToast } from "@/components/toast";
import { RunReviewButton } from "@/features/shared/RunReview";
import { BrandAssets } from "./BrandAssets";

export function RequirementsTab({ campaign: c }: { campaign: CampaignWithRelations }) {
  return (
    <>
      <SowPanel campaign={c} />
      <BrandAssets campaign={c} />
      <RequirementsWorkspace campaign={c} />
    </>
  );
}

const EXTRACTION_TONE: Record<string, keyof typeof JOB_STATUS_TONE> = { uploaded: "cancelled", queued: "queued", processing: "processing", extracted: "completed", failed: "failed" };
const EXTRACTION_LABEL: Record<string, string> = { uploaded: "Not analysed", queued: "Queued", processing: "Analysing", extracted: "Extracted", failed: "Failed" };

function SowPanel({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const key = qk.sow(c.id);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: key, queryFn: () => sowService.list(c.id),
    // Poll while an analysis is queued or running, so results appear even without Realtime.
    refetchInterval: (q) => (q.state.data?.some((d) => d.sow_versions.some((v) => ["queued", "processing"].includes(v.extraction_status))) ? 5_000 : 30_000),
  });
  const busyVersions = (data ?? []).flatMap((d) => d.sow_versions).filter((v) => ["queued", "processing"].includes(v.extraction_status)).length;
  const prevBusy = React.useRef(busyVersions);
  React.useEffect(() => {
    if (prevBusy.current > busyVersions) {
      void qc.invalidateQueries({ queryKey: qk.requirements(c.id) });
      void qc.invalidateQueries({ queryKey: ["report", c.id] });
    }
    prevBusy.current = busyVersions;
  }, [busyVersions, qc, c.id]);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [target, setTarget] = React.useState<SowDocument | null>(null);
  const upload = useAction((f: File) => sowService.upload(c.id, f, target?.id), {
    invalidate: [key], error: "Upload failed",
    success: (r) => `SOW v${r.version.version_no} uploaded${r.converted ? " and converted to PDF" : ""}${r.autoQueued ? " and queued for analysis" : ". Run the analysis when ready"}. Add the logo and other brand files under Brand assets below.`,
  });
  const pick = (doc: SowDocument | null) => { setTarget(doc); fileRef.current?.click(); };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const problem = validateFile("sow", f);
    if (problem) return toast.error(problem);
    upload.mutate(f);
  };
  const open = async (v: SowVersion) => {
    try { window.open(await storageService.signedUrl("sow", v.storage_path, 600), "_blank", "noopener"); } catch (e) { toast.error(e, "Could not open the file"); }
  };

  return (
    <Section title="SOW documents" actions={canEdit && <Button size="sm" loading={upload.isPending && !target} onClick={() => pick(null)}><FileUp />Upload SOW</Button>}>
      <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
      {error ? <ErrorState error={error} /> : isLoading ? <LoadingRows rows={2} /> : !data?.length ? (
        <Card><EmptyState icon={FileText} title="No SOW uploaded yet" body="Upload the client’s SOW (PDF, Word, Excel, PowerPoint, text or image; non-PDF files are converted to PDF). The local AI worker extracts draft requirements with page references for you to verify. Scanned PDFs are read with local OCR."
          action={canEdit && <Button variant="primary" onClick={() => pick(null)}><FileUp />Upload SOW</Button>} /></Card>
      ) : (
        <div className="space-y-2">
          {data.map((d) => (
            <Card key={d.id}>
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <span className="text-sm font-medium">{d.title}</span>
                {canEdit && <Button size="sm" variant="ghost" loading={upload.isPending && target?.id === d.id} onClick={() => pick(d)}><FileUp />New version</Button>}
              </div>
              <ul className="divide-y divide-line">
                {d.sow_versions.map((v, i) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <Mono>v{v.version_no}</Mono>
                    <button onClick={() => void open(v)} className="min-w-0 flex-1 truncate text-left hover:text-accent">{v.file_name}</button>
                    <span className="text-xs text-muted num">{formatBytes(v.size_bytes)}{v.page_count ? ` · ${v.page_count} pages` : ""}</span>
                    <StatusDot tone={JOB_STATUS_TONE[EXTRACTION_TONE[v.extraction_status] ?? "queued"]} label={EXTRACTION_LABEL[v.extraction_status]} />
                    <span className="text-xs text-muted">{formatDateTime(v.created_at)}</span>
                    {canEdit && i === 0 && !["queued", "processing"].includes(v.extraction_status) && (
                      <RunReviewButton size="sm" campaignId={c.id} reviewType="sow_analysis" source={{ sow_version_id: v.id }}
                        label={v.extraction_status === "extracted" ? "Analyse again" : "Run SOW analysis"} variant={v.extraction_status === "extracted" ? "ghost" : "primary"} />
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}

function RequirementsWorkspace({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const key = qk.requirements(c.id);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => requirementsService.list(c.id) });
  const checks = useQuery({ queryKey: qk.checks(c.id), queryFn: () => requirementsService.checks(c.id) });
  const [statusFilter, setStatusFilter] = React.useState<RequirementStatus | "">("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [open, setOpen] = React.useState<Requirement | null>(null);
  const [adding, setAdding] = React.useState(false);
  const bulk = useAction(({ ids, status }: { ids: string[]; status: RequirementStatus }) => requirementsService.setStatus(ids, status), {
    invalidate: [key, ["report", c.id]], success: "Requirements updated", onSuccess: () => setSelected(new Set()),
  });

  const checkRows = React.useMemo(() => checks.data ?? [], [checks.data]);
  const latestCheck = React.useMemo(() => {
    const m = new Map<string, (typeof checkRows)[number]>();
    for (const ch of checkRows) if (!m.has(ch.requirement_id)) m.set(ch.requirement_id, ch);
    return m;
  }, [checkRows]);

  const rows = (data ?? []).filter((r) => !statusFilter || r.status === statusFilter);
  const groups = React.useMemo(() => {
    const g: { id: string | null; name: string; items: Requirement[] }[] = c.journeys.map((j) => ({ id: j.id, name: j.name, items: [] }));
    const none = { id: null, name: "Campaign-wide / no journey", items: [] as Requirement[] };
    for (const r of rows) (g.find((x) => x.id === r.journey_id) ?? none).items.push(r);
    return [...g, none].filter((x) => x.items.length);
  }, [rows, c.journeys]);
  const flat = groups.flatMap((g) => g.items);
  const { index } = useListKeys(flat, setOpen);
  const counts = (data ?? []).reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Section title="Requirements" actions={canEdit && <Button size="sm" onClick={() => setAdding(true)}><Plus />Add requirement</Button>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Status" className="w-56" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as RequirementStatus | "")}
          placeholder={`All statuses (${data?.length ?? 0})`} options={options(REQ_STATUS_LABEL).map((o) => ({ ...o, label: `${o.label} (${counts[o.value] ?? 0})` }))} />
        <p className="text-xs text-muted">Only accepted requirements form the baseline that designs and builds are checked against.</p>
        {canEdit && selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted">{selected.size} selected</span>
            <Button size="sm" variant="primary" onClick={() => bulk.mutate({ ids: [...selected], status: "accepted" })}><Check />Accept</Button>
            <Button size="sm" onClick={() => bulk.mutate({ ids: [...selected], status: "needs_clarification" })}><HelpCircle />Needs clarification</Button>
            <Button size="sm" variant="danger" onClick={() => bulk.mutate({ ids: [...selected], status: "rejected" })}><X />Reject</Button>
          </div>
        )}
      </div>
      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <LoadingRows /> : !rows.length ? (
        <Card><EmptyState title={data?.length ? "No requirements with this status" : "No requirements yet"}
          body={data?.length ? undefined : "Run the SOW analysis to extract drafts, or add requirements by hand."} /></Card>
      ) : (
        <Table>
          <thead><tr>
            {canEdit && <Th className="w-8" />}<Th className="w-20">ID</Th><Th>Requirement</Th><Th>Category</Th><Th>Priority</Th><Th>Status</Th><Th>Pages</Th><Th>Latest check</Th>
          </tr></thead>
          <tbody>
            {groups.map((g) => (
              <React.Fragment key={g.id ?? "none"}>
                <tr><td colSpan={8} className="border-b border-line bg-side px-3 py-1.5 text-xs font-medium text-text-2">{g.name} <span className="text-muted num">· {g.items.length}</span></td></tr>
                {g.items.map((r) => {
                  const ch = latestCheck.get(r.id);
                  return (
                    <Tr key={r.id} onClick={() => setOpen(r)} selected={flat[index]?.id === r.id}>
                      {canEdit && <Td onClick={(e) => e.stopPropagation()}><Checkbox aria-label={`Select ${r.ref}`} checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} /></Td>}
                      <Td><Mono>{r.ref}</Mono></Td>
                      <Td className="max-w-[420px]">
                        <p className="truncate">{r.title}</p>
                        {r.origin === "ai" && r.confidence && r.status === "draft" && <p className="text-xs text-muted">AI draft · {CONFIDENCE_LABEL[r.confidence]}</p>}
                      </Td>
                      <Td className="whitespace-nowrap text-text-2">{CATEGORY_LABEL[r.category]}</Td>
                      <Td className="text-text-2">{PRIORITY_LABEL[r.priority]}</Td>
                      <Td><StatusDot tone={REQ_STATUS_TONE[r.status]} label={REQ_STATUS_LABEL[r.status]} /></Td>
                      <Td className="text-xs text-muted num">{r.source_pages.length ? `p. ${r.source_pages.join(", ")}` : "—"}</Td>
                      <Td>{ch ? <StatusDot tone={VERIFICATION_TONE[ch.result]} label={VERIFICATION_LABEL[ch.result]} /> : <span className="text-xs text-muted">Not checked</span>}</Td>
                    </Tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </Table>
      )}
      <RequirementDrawer campaign={c} requirement={open} onClose={() => setOpen(null)} checks={(checks.data ?? []).filter((x) => x.requirement_id === open?.id)} />
      {adding && <RequirementDialog campaign={c} onClose={() => setAdding(false)} />}
    </Section>
  );
}

type ReqForm = { title: string; description: string; category: Requirement["category"]; priority: Requirement["priority"]; acceptance_criteria: string; journey_id: string };

function RequirementDialog({ campaign: c, onClose }: { campaign: CampaignWithRelations; onClose: () => void }) {
  const form = useForm<ReqForm>({ defaultValues: { title: "", description: "", category: "functional", priority: "medium", acceptance_criteria: "", journey_id: "" } });
  const save = useAction((v: ReqForm) => requirementsService.create({
    campaign_id: c.id, ref: "", title: v.title, description: v.description, category: v.category, priority: v.priority,
    acceptance_criteria: v.acceptance_criteria || null, journey_id: v.journey_id || null, status: "accepted", source_text: "Added manually",
  }), { invalidate: [qk.requirements(c.id)], success: "Requirement added to the baseline", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add requirement" description="Manually added requirements are accepted straight into the baseline."
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>Add requirement</Button></>}>
        <RequirementFields form={form} campaign={c} />
      </DialogContent>
    </Dialog>
  );
}

function RequirementFields({ form, campaign: c }: { form: ReturnType<typeof useForm<ReqForm>>; campaign: CampaignWithRelations }) {
  return (
    <div className="grid gap-3">
      <Field label="Title" error={form.formState.errors.title?.message}><Input {...form.register("title", { required: "Give it a title" })} /></Field>
      <Field label="Description"><Textarea rows={3} {...form.register("description")} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Category"><Select options={options(CATEGORY_LABEL)} {...form.register("category")} /></Field>
        <Field label="Priority"><Select options={options(PRIORITY_LABEL)} {...form.register("priority")} /></Field>
        <Field label="Journey"><Select options={c.journeys.map((j) => ({ value: j.id, label: j.name }))} placeholder="Campaign-wide" {...form.register("journey_id")} /></Field>
      </div>
      <Field label="Acceptance criteria"><Textarea rows={3} {...form.register("acceptance_criteria")} /></Field>
    </div>
  );
}

function RequirementDrawer({ campaign: c, requirement: r, onClose, checks }: {
  campaign: CampaignWithRelations; requirement: Requirement | null; onClose: () => void; checks: ReturnType<typeof requirementsService.checks> extends Promise<infer T> ? T : never;
}) {
  const { canEdit } = useAuth();
  const { name } = useProfiles();
  const [editing, setEditing] = React.useState(false);
  const form = useForm<ReqForm>();
  React.useEffect(() => {
    setEditing(false);
    if (r) form.reset({ title: r.title, description: r.description, category: r.category, priority: r.priority, acceptance_criteria: r.acceptance_criteria ?? "", journey_id: r.journey_id ?? "" });
  }, [r, form]);
  const invalidate = [qk.requirements(c.id), ["report", c.id]];
  const setStatus = useAction((s: RequirementStatus) => requirementsService.update(r!.id, { status: s }), { invalidate, success: "Requirement updated", onSuccess: onClose });
  const save = useAction((v: ReqForm) => requirementsService.update(r!.id, {
    title: v.title, description: v.description, category: v.category, priority: v.priority, acceptance_criteria: v.acceptance_criteria || null, journey_id: v.journey_id || null,
  }), { invalidate, success: "Changes saved", onSuccess: () => setEditing(false) });
  const pages = useQuery({ queryKey: ["sow-pages", r?.source_version_id], queryFn: () => sowService.pages(r!.source_version_id!), enabled: Boolean(r?.source_version_id) });
  if (!r) return null;
  const ai = r.ai_original as Record<string, unknown> | null;
  const editedFromAi = ai && (ai.title !== r.title || (ai.description ?? "") !== r.description);
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={r.title} subtitle={<><Mono>{r.ref}</Mono> · {CATEGORY_LABEL[r.category]} · {REQ_STATUS_LABEL[r.status]}</>}
      actions={canEdit && !editing && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}>
      <div className="space-y-5 px-5 py-4">
        {editing ? (
          <>
            <RequirementFields form={form} campaign={c} />
            <div className="flex justify-end gap-2"><Button onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>Save</Button></div>
          </>
        ) : (
          <>
            <p className="whitespace-pre-wrap text-sm">{r.description || <span className="text-muted">No description.</span>}</p>
            <KeyValue items={[
              { label: "Journey", value: c.journeys.find((j) => j.id === r.journey_id)?.name ?? (r.journey_hint ? `Unmatched: “${r.journey_hint}”` : "Campaign-wide") },
              { label: "Priority", value: PRIORITY_LABEL[r.priority] },
              { label: "Acceptance criteria", value: r.acceptance_criteria ? <span className="whitespace-pre-wrap">{r.acceptance_criteria}</span> : "—" },
              { label: "Origin", value: r.origin === "ai" ? `AI extraction${r.confidence ? ` · ${CONFIDENCE_LABEL[r.confidence]}` : ""}` : "Added manually" },
              { label: "Decision", value: r.decided_by ? `${REQ_STATUS_LABEL[r.status]} by ${name(r.decided_by)} · ${formatDateTime(r.decided_at)}` : "Not decided yet" },
            ]} />
          </>
        )}
        <div>
          <p className="section-title mb-1.5">Source {r.source_pages.length > 0 && <span className="font-normal text-muted">· page {r.source_pages.join(", ")}</span>}</p>
          <blockquote className="rounded-box border border-line bg-side px-3 py-2 text-sm text-text-2 whitespace-pre-wrap">{r.source_text || "No source text recorded."}</blockquote>
          {pages.data && r.source_pages.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-xs text-text-2">Show full page text</summary>
              {pages.data.filter((p) => r.source_pages.includes(p.page_no)).map((p) => (
                <div key={p.id} className="mt-2">
                  <p className="text-xs text-muted">Page {p.page_no} · {p.method === "ocr" ? "OCR (local)" : "Text extraction"}</p>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-ctl border border-line bg-side p-2 font-sans text-xs">{p.text}</pre>
                </div>
              ))}
            </details>
          )}
        </div>
        {editedFromAi && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-text-2">Original AI output</summary>
            <pre className="mt-1 overflow-auto rounded-ctl border border-line bg-side p-2 font-mono text-xs">{JSON.stringify(ai, null, 2)}</pre>
          </details>
        )}
        {checks.length > 0 && (
          <div>
            <p className="section-title mb-1.5">Checks</p>
            <ul className="space-y-1.5">
              {checks.map((ch) => (
                <li key={ch.id} className="text-sm">
                  <StatusDot tone={VERIFICATION_TONE[ch.result]} label={VERIFICATION_LABEL[ch.result]} />
                  <span className="ml-2 text-xs text-muted">{REVIEW_TYPE_LABEL[ch.review_type]}{ch.method ? ` · ${METHOD_LABEL[ch.method]}` : ""} · {formatDateTime(ch.created_at)}</span>
                  {ch.note && <p className="ml-3.5 text-xs text-text-2">{ch.note}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {canEdit && !editing && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {r.status !== "accepted" && <Button variant="primary" loading={setStatus.isPending} onClick={() => setStatus.mutate("accepted")}><Check />Accept</Button>}
            {r.status !== "needs_clarification" && <Button onClick={() => setStatus.mutate("needs_clarification")}><HelpCircle />Needs client clarification</Button>}
            {r.status !== "rejected" && <Button variant="danger" onClick={() => setStatus.mutate("rejected")}><X />Reject</Button>}
            {r.status !== "draft" && <Button variant="ghost" onClick={() => setStatus.mutate("draft")}><RotateCcw />Back to draft</Button>}
          </div>
        )}
        <p className={cn("text-xs text-muted", !canEdit && "hidden")}>Rejecting keeps the record for history; it is excluded from the baseline.</p>
      </div>
    </Drawer>
  );
}
