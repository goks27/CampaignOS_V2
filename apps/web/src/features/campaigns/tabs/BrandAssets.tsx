import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Palette, Pencil, Trash2, Upload } from "lucide-react";
import { Button, Card, Dialog, DialogContent, Field, Input, Select } from "@/components/ui";
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, Section } from "@/components/common";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth";
import { BRAND_ACCEPT, BRAND_KINDS, BRAND_KIND_LABEL, isPicture, type BrandKind } from "@/lib/brand";
import { cn, formatBytes } from "@/lib/utils";
import { useAction } from "@/hooks/useAction";
import type { CampaignWithRelations } from "@/services/campaigns";
import { brandAssetsService, type BrandAsset } from "@/services/brandAssets";
import { AssetImage } from "@/features/shared/AssetImage";

const KIND_ORDER = new Map(BRAND_KINDS.map((k, i) => [k as string, i]));

/**
 * The logo (SVG preferred), icons, brand guide, fonts and other files that come with the SOW. They are stored for the team
 * and nothing reads them automatically. Managers and team members on the campaign can add, relabel, rename and delete;
 * everyone else who can see the campaign can view and download.
 */
export function BrandAssets({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit, me } = useAuth();
  const toast = useToast();
  const canChange = canEdit || (me?.role === "team_member" && c.campaign_members.some((m) => m.user_id === me.id));
  const key = React.useMemo(() => ["brand-assets", c.id], [c.id]);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => brandAssetsService.list(c.id) });
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const [renaming, setRenaming] = React.useState<BrandAsset | null>(null);
  const [deleting, setDeleting] = React.useState<BrandAsset | null>(null);

  const upload = useAction(async (files: File[]) => {
    const failed: string[] = [];
    let done = 0;
    for (const f of files) {
      try { await brandAssetsService.upload(c.id, f); done++; } catch (e) { failed.push(e instanceof Error ? e.message : `${f.name}: could not upload`); }
    }
    if (failed.length) toast.error(new Error(failed.join(" ")), done ? `${done} added, ${failed.length} failed` : "Upload failed");
    return done;
  }, { invalidate: [key], success: (n) => (n ? `${n} brand asset${n === 1 ? "" : "s"} added` : "") });

  const relabel = useAction(({ id, kind }: { id: string; kind: BrandKind }) => brandAssetsService.update(id, { kind }), { invalidate: [key], error: "Could not change the label" });
  const rename = useAction(({ id, name }: { id: string; name: string }) => brandAssetsService.update(id, { file_name: name }), { invalidate: [key], success: "Renamed", onSuccess: () => setRenaming(null) });
  const remove = useAction((a: BrandAsset) => brandAssetsService.remove(a), { invalidate: [key], success: "Deleted", onSuccess: () => setDeleting(null) });

  const pick = (list: FileList | File[] | null) => { const f = Array.from(list ?? []); if (f.length && canChange) upload.mutate(f); };
  const download = async (a: BrandAsset) => {
    try { window.open(await brandAssetsService.downloadUrl(a), "_blank", "noopener"); } catch (e) { toast.error(e, "Could not open the file"); }
  };
  const rows = [...(data ?? [])].sort((a, b) => (KIND_ORDER.get(a.kind) ?? 9) - (KIND_ORDER.get(b.kind) ?? 9));

  return (
    <Section title="Brand assets" actions={canChange && <Button size="sm" loading={upload.isPending} onClick={() => fileRef.current?.click()}><Upload />Add assets</Button>}>
      <input ref={fileRef} type="file" multiple accept={BRAND_ACCEPT} className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      <div onDragOver={(e) => { if (canChange && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { setOver(false); if (!canChange) return; e.preventDefault(); pick(e.dataTransfer.files); }} className={cn("rounded-box", over && "cos-drop-active")}>
        {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <LoadingRows rows={2} /> : !rows.length ? (
          <Card><EmptyState icon={Palette} title="No brand assets yet"
            body={canChange ? "Add the logo (SVG preferred) and the other files that came with the SOW: icons, brand guide, fonts, imagery. Drop them here or use Add assets. They are stored for the team; nothing reads them automatically." : "Nobody has added the logo or other brand files yet."}
            action={canChange && <Button variant="primary" onClick={() => fileRef.current?.click()}><Upload />Add assets</Button>} /></Card>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="brand-assets">
            {rows.map((a) => (
              <li key={a.id}><Card className="flex gap-3 p-2.5">
                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-box border border-line bg-hover">
                  {isPicture(a.mime_type) ? <AssetImage bucket="brand" path={a.storage_path} alt={a.file_name} className="size-full bg-transparent p-1.5" /> : <FileText className="size-6 text-muted" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={a.file_name}>{a.file_name}</p>
                  <p className="text-xs text-muted num">{BRAND_KIND_LABEL[a.kind as BrandKind] ?? a.kind} · {formatBytes(a.size_bytes)}</p>
                  <div className="mt-1.5 flex items-center gap-1">
                    {canChange && <div className="w-[116px]"><Select value={a.kind} aria-label={`Label for ${a.file_name}`} onChange={(e) => relabel.mutate({ id: a.id, kind: e.target.value as BrandKind })} options={BRAND_KINDS.map((k) => ({ value: k, label: BRAND_KIND_LABEL[k] }))} /></div>}
                    <Button size="icon" variant="ghost" aria-label={`Download ${a.file_name}`} title="Download" onClick={() => void download(a)}><Download /></Button>
                    {canChange && <Button size="icon" variant="ghost" aria-label={`Rename ${a.file_name}`} title="Rename" onClick={() => setRenaming(a)}><Pencil /></Button>}
                    {canChange && <Button size="icon" variant="ghost" aria-label={`Delete ${a.file_name}`} title="Delete" onClick={() => setDeleting(a)}><Trash2 /></Button>}
                  </div>
                </div>
              </Card></li>
            ))}
          </ul>
        )}
      </div>
      {!canChange && rows.length > 0 && <p className="mt-1.5 text-xs text-muted">You can view and download these. Managers and team members on this campaign can change them.</p>}
      {renaming && <RenameDialog asset={renaming} loading={rename.isPending} onClose={() => setRenaming(null)} onSave={(name) => rename.mutate({ id: renaming.id, name })} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} danger loading={remove.isPending} confirmLabel="Delete"
        title={`Delete ${deleting?.file_name ?? "this file"}?`} body="The file is removed for everyone on the campaign. It cannot be undone." onConfirm={() => deleting && remove.mutate(deleting)} />
    </Section>
  );
}

function RenameDialog({ asset, loading, onClose, onSave }: { asset: BrandAsset; loading: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = React.useState(asset.file_name);
  const ok = name.trim().length > 0 && name.trim() !== asset.file_name;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Rename file" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} loading={loading} onClick={() => onSave(name.trim())}>Save</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); if (ok) onSave(name.trim()); }}>
          <Field label="File name"><Input value={name} maxLength={200} autoFocus onChange={(e) => setName(e.target.value)} /></Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
