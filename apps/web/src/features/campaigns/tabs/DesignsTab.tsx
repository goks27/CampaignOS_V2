import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, FileUp, Frame as Figma, ImagePlus, RotateCcw, Trash2, X } from "lucide-react";
import { Button, Card, Dialog, DialogContent, Field, Input, Select, Textarea } from "@/components/ui";
import { EmptyState, ErrorState, LoadingRows, Mono, StatusDot } from "@/components/common";
import { SUBMISSION_STATUS_LABEL, SUBMISSION_STATUS_TONE } from "@/lib/labels";
import { cn, formatDateTime } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { qk, useSettings } from "@/hooks/queries";
import { useAction } from "@/hooks/useAction";
import { designsService, type DesignSubmission, type NewScreen } from "@/services/designs";
import { deliveryService } from "@/services/delivery";
import { validateFile } from "@/services/storage";
import { pdfToImages, prepareImage } from "@/lib/images";
import { useToast } from "@/components/toast";
import type { CampaignWithRelations } from "@/services/campaigns";
import { RunReviewButton } from "@/features/shared/RunReview";
import { AssetImage } from "@/features/shared/AssetImage";

const SCREEN_TYPES = ["screen", "modal", "form", "error state", "success state", "email", "landing", "other"].map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));

export function DesignsTab({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit, me } = useAuth();
  const canSubmit = canEdit || (me?.role === "team_member" && c.campaign_members.some((m) => m.user_id === me.id));
  const key = qk.designs(c.id);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => designsService.list(c.id) });
  const [uploading, setUploading] = React.useState(false);
  const [viewer, setViewer] = React.useState<{ sub: DesignSubmission; index: number } | null>(null);
  const [journey, setJourney] = React.useState("");
  const list = (data ?? []).filter((s) => !journey || s.journey_id === journey);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Journey" className="w-60" value={journey} onChange={(e) => setJourney(e.target.value)} placeholder="All journeys"
          options={c.journeys.map((j) => ({ value: j.id, label: j.name }))} />
        <div className="flex-1" />
        {canSubmit && <Button variant="primary" onClick={() => setUploading(true)}><FileUp />Submit designs</Button>}
      </div>
      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <LoadingRows /> : !list.length ? (
        <Card><EmptyState icon={ImagePlus} title="No design submissions yet"
          body="Upload screens as PDF, PNG, JPG or WEBP (or link Figma if it’s enabled in Settings). Then run SOW vs Design to check them against accepted requirements."
          action={canSubmit && <Button variant="primary" onClick={() => setUploading(true)}><FileUp />Submit designs</Button>} /></Card>
      ) : (
        <div className="space-y-4">
          {list.map((s) => <SubmissionCard key={s.id} campaign={c} sub={s} onView={(i) => setViewer({ sub: s, index: i })} />)}
        </div>
      )}
      {uploading && <UploadDialog campaign={c} onClose={() => setUploading(false)} />}
      {viewer && <ScreenViewer sub={viewer.sub} index={viewer.index} onIndex={(i) => setViewer({ ...viewer, index: i })} onClose={() => setViewer(null)} />}
    </>
  );
}

function SubmissionCard({ campaign: c, sub, onView }: { campaign: CampaignWithRelations; sub: DesignSubmission; onView: (i: number) => void }) {
  const { canEdit } = useAuth();
  const journey = c.journeys.find((j) => j.id === sub.journey_id);
  const [deciding, setDeciding] = React.useState<"approved" | "changes_requested" | null>(null);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2.5">
        <Mono>v{sub.version_no}</Mono>
        <span className="font-medium">{sub.title}</span>
        <span className="text-xs text-muted">{journey?.name ?? "Campaign-wide"} · {sub.source === "figma" ? "Figma" : `${sub.design_assets.length} screen${sub.design_assets.length === 1 ? "" : "s"}`} · {formatDateTime(sub.created_at)}</span>
        <StatusDot tone={SUBMISSION_STATUS_TONE[sub.status]} label={SUBMISSION_STATUS_LABEL[sub.status]} />
        <div className="flex-1" />
        {canEdit && sub.status !== "superseded" && (
          <div className="flex flex-wrap gap-1.5">
            <RunReviewButton size="sm" variant="primary" campaignId={c.id} reviewType="sow_vs_design" source={{ design_submission_id: sub.id }} label="SOW vs Design" />
            <RunReviewButton size="sm" campaignId={c.id} reviewType="design_consistency" source={{ design_submission_id: sub.id }} label="Consistency" />
            {sub.status !== "approved" && <Button size="sm" onClick={() => setDeciding("approved")}><Check />Approve</Button>}
            {sub.status !== "changes_requested" && <Button size="sm" onClick={() => setDeciding("changes_requested")}><RotateCcw />Request changes</Button>}
          </div>
        )}
      </div>
      {sub.figma_url && <p className="border-b border-line px-3 py-2 font-mono text-xs text-text-2">{sub.figma_url}</p>}
      {sub.notes && <p className="border-b border-line px-3 py-2 text-sm text-text-2">{sub.notes}</p>}
      {sub.design_assets.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4 lg:grid-cols-6">
          {sub.design_assets.map((a, i) => (
            <button key={a.id} onClick={() => onView(i)} className="group text-left">
              <AssetImage bucket={a.bucket} path={a.storage_path} alt={a.screen_name} className="aspect-[3/4] rounded-item border border-line group-hover:border-line-strong" />
              <p className="mt-1 truncate text-xs">{a.screen_name}</p>
              <p className="text-xs text-muted">{a.screen_type}</p>
            </button>
          ))}
        </div>
      ) : <p className="px-3 py-4 text-sm text-muted">{sub.source === "figma" ? "Frames are exported by the AI worker when a review runs." : "No screens."}</p>}
      {deciding && <DecisionDialog campaign={c} sub={sub} decision={deciding} onClose={() => setDeciding(null)} />}
    </Card>
  );
}

function DecisionDialog({ campaign: c, sub, decision, onClose }: { campaign: CampaignWithRelations; sub: DesignSubmission; decision: "approved" | "changes_requested"; onClose: () => void }) {
  const [approver, setApprover] = React.useState<"internal" | "client">("internal");
  const [contact, setContact] = React.useState("");
  const [note, setNote] = React.useState("");
  const save = useAction(async () => {
    await deliveryService.recordApproval({
      campaign_id: c.id, journey_id: sub.journey_id, subject_type: "design_submission", subject_id: sub.id,
      subject_label: `${sub.title} v${sub.version_no}`, approver, client_contact: contact || null, decision, note: note || null,
    });
    await designsService.setStatus(sub.id, decision);
  }, { invalidate: [qk.designs(c.id), qk.delivery("approvals", c.id)], success: decision === "approved" ? "Approval recorded" : "Change request recorded", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={decision === "approved" ? "Record design approval" : "Request design changes"} description={`${sub.title} v${sub.version_no}. Decisions are append-only.`}
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Record decision</Button></>}>
        <div className="grid gap-3">
          <Field label="Decided by"><Select value={approver} onChange={(e) => setApprover(e.target.value as "internal" | "client")} options={[{ value: "internal", label: "Internal (manager)" }, { value: "client", label: "Client" }]} /></Field>
          {approver === "client" && <Field label="Client contact"><Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Name and how they confirmed (email, call)" /></Field>}
          <Field label="Note"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** `initialFiles`: files dropped onto the canvas, prepared as soon as the dialog opens. */
export function UploadDialog({ campaign: c, onClose, initialFiles, defaultJourney }: { campaign: CampaignWithRelations; onClose: () => void; initialFiles?: File[]; defaultJourney?: string }) {
  const toast = useToast();
  const { data: settings } = useSettings();
  const limits = (settings?.limits ?? {}) as { image_long_edge?: number; max_pdf_pages?: number; max_screens_per_review?: number };
  const longEdge = limits.image_long_edge ?? 1600;
  const [mode, setMode] = React.useState<"upload" | "figma">("upload");
  const [journey, setJourney] = React.useState(defaultJourney ?? c.journeys[0]?.id ?? "");
  const [title, setTitle] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [figmaUrl, setFigmaUrl] = React.useState("");
  const [screens, setScreens] = React.useState<NewScreen[]>([]);
  const [preparing, setPreparing] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [drag, setDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | File[]) => {
    setPreparing(true);
    try {
      const out: NewScreen[] = [];
      for (const f of Array.from(files)) {
        const isPdf = f.type === "application/pdf";
        if (!isPdf) {
          const problem = validateFile("designs", f);
          if (problem) { toast.error(problem); continue; }
        }
        const prepared = isPdf ? await pdfToImages(f, longEdge, limits.max_pdf_pages ?? 30) : [await prepareImage(f, longEdge)];
        prepared.forEach((p) => out.push({ ...p, screenName: p.name.replace(/\.(png|jpe?g|webp)$/i, ""), screenType: "screen", sourceFile: f.name }));
      }
      setScreens((s) => {
        const seen = new Set(s.map((x) => x.hash));
        return [...s, ...out.filter((x) => !seen.has(x.hash) && seen.add(x.hash))];
      });
    } catch (e) {
      toast.error(e, "Could not read the file");
    } finally {
      setPreparing(false);
    }
  };

  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current || !initialFiles?.length) return;
    started.current = true;
    void addFiles(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  const save = useAction(() => designsService.create({
    campaignId: c.id, journeyId: journey || null, title: title || (mode === "figma" ? "Figma design" : "Design submission"), notes,
    figmaUrl: mode === "figma" ? figmaUrl : undefined, screens: mode === "figma" ? [] : screens, onProgress: setProgress,
  }), {
    invalidate: [qk.designs(c.id)], error: "Submission failed",
    success: (r) => `Design submission v${r.submission.version_no} saved${r.autoQueued ? `; ${r.autoQueued} review(s) queued automatically` : ""}.`, onSuccess: onClose,
  });

  const tooMany = screens.length > (limits.max_screens_per_review ?? 12);
  const figmaValid = /^https:\/\/(www\.)?figma\.com\/(design|file|proto)\//.test(figmaUrl);
  const canSave = mode === "figma" ? figmaValid : screens.length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent title="Submit designs" className="max-w-3xl" description="Earlier submissions for the same journey are kept and marked Superseded."
        footer={<>
          {save.isPending && <span className="mr-auto text-xs text-muted num">Uploading {progress}/{screens.length}…</span>}
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="primary" disabled={!canSave || preparing} loading={save.isPending} onClick={() => save.mutate(undefined)}>Submit {mode === "upload" && screens.length ? `${screens.length} screens` : ""}</Button>
        </>}>
        <div className="grid gap-3">
          {settings?.figma_enabled && (
            <div className="flex gap-1 rounded-ctl border border-line p-0.5 text-sm">
              <button className={cn("flex-1 rounded px-2 py-1", mode === "upload" && "bg-active font-medium")} onClick={() => setMode("upload")}>Upload files</button>
              <button className={cn("flex-1 rounded px-2 py-1", mode === "figma" && "bg-active font-medium")} onClick={() => setMode("figma")}><Figma className="mr-1 inline size-3.5" />Figma link</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Journey"><Select value={journey} onChange={(e) => setJourney(e.target.value)} placeholder="Campaign-wide" options={c.journeys.map((j) => ({ value: j.id, label: j.name }))} /></Field>
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Registration flow" /></Field>
          </div>
          {mode === "figma" ? (
            <Field label="Figma URL" hint="Design, file or frame URL. The AI worker reads it with its own Figma token; if it can’t access the file, the review fails and says so — upload exports instead."
              error={figmaUrl && !figmaValid ? "Paste a figma.com/design/… or /file/… link" : undefined}>
              <Input value={figmaUrl} onChange={(e) => setFigmaUrl(e.target.value)} placeholder="https://www.figma.com/design/…" />
            </Field>
          ) : (
            <>
              <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}
                className={cn("flex flex-col items-center justify-center gap-1 rounded-box border border-dashed border-line-strong px-4 py-6 text-center", drag && "border-accent bg-accent/5")}>
                <ImagePlus className="size-5 text-muted" />
                <p className="text-sm">Drop PDF, PNG, JPG or WEBP files here</p>
                <p className="text-xs text-muted">PDF pages become separate screens. Images are downscaled to {longEdge}px before upload.</p>
                <Button size="sm" className="mt-2" loading={preparing} onClick={() => inputRef.current?.click()}>Choose files</Button>
                <input ref={inputRef} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden"
                  onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
              </div>
              {tooMany && <p className="text-xs text-st-amber">{screens.length} screens: a single review covers at most {limits.max_screens_per_review ?? 12}. Split this into smaller submissions or raise the limit in Settings.</p>}
              {screens.length > 0 && (
                <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-box border border-line">
                  {screens.map((s, i) => (
                    <li key={s.hash} className="flex items-center gap-2 px-2 py-1.5">
                      <img src={URL.createObjectURL(s.blob)} alt="" className="h-10 w-8 rounded border border-line object-cover" />
                      <Input aria-label="Screen name" value={s.screenName} onChange={(e) => setScreens((xs) => xs.map((x, k) => k === i ? { ...x, screenName: e.target.value } : x))} />
                      <Select aria-label="Screen type" className="w-36" value={s.screenType} options={SCREEN_TYPES} onChange={(e) => setScreens((xs) => xs.map((x, k) => k === i ? { ...x, screenType: e.target.value } : x))} />
                      <span className="whitespace-nowrap text-xs text-muted num">{s.width}×{s.height}</span>
                      <Button variant="ghost" size="icon" aria-label="Remove screen" onClick={() => setScreens((xs) => xs.filter((_, k) => k !== i))}><Trash2 /></Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <Field label="Notes for the reviewer"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScreenViewer({ sub, index, onIndex, onClose }: { sub: DesignSubmission; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const a = sub.design_assets[index];
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onIndex(Math.min(sub.design_assets.length - 1, index + 1));
      if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [index, onIndex, sub.design_assets.length]);
  if (!a) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={a.screen_name} description={`${index + 1} of ${sub.design_assets.length} · ${a.original_width}×${a.original_height} original`} className="max-w-4xl"
        footer={<>
          <Button disabled={index === 0} onClick={() => onIndex(index - 1)}>Previous</Button>
          <Button disabled={index === sub.design_assets.length - 1} onClick={() => onIndex(index + 1)}>Next</Button>
          <Button onClick={onClose}><X />Close</Button>
        </>}>
        <AssetImage bucket={a.bucket} path={a.storage_path} alt={a.screen_name} className="h-[60vh] rounded-item" />
      </DialogContent>
    </Dialog>
  );
}
