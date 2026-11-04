import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileUp, Trash2, Files } from "lucide-react";
import { Button, Card, Dialog, DialogContent, Field, Input, Select } from "@/components/ui";
import { ConfirmDialog, EmptyState, Table, Td, Th, Tr } from "@/components/common";
import { formatBytes, formatDateTime } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { qk, useProfiles } from "@/hooks/queries";
import { useAction } from "@/hooks/useAction";
import { useToast } from "@/components/toast";
import { deliveryService, type DocumentRow } from "@/services/delivery";
import { storageService, validateFile } from "@/services/storage";
import type { CampaignWithRelations } from "@/services/campaigns";

const KINDS = [
  { value: "brief", label: "Brief" }, { value: "legal", label: "Legal (T&C, privacy)" }, { value: "creative", label: "Creative" },
  { value: "technical", label: "Technical" }, { value: "client", label: "Client correspondence" }, { value: "other", label: "Other" },
];

export function DocumentsTab({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const { name } = useProfiles();
  const toast = useToast();
  const key = qk.delivery("documents", c.id);
  const { data } = useQuery({ queryKey: key, queryFn: () => deliveryService.documents(c.id) });
  const [file, setFile] = React.useState<File | null>(null);
  const [confirm, setConfirm] = React.useState<DocumentRow | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const remove = useAction((d: DocumentRow) => deliveryService.removeDocument(d), { invalidate: [key], success: "Document deleted", onSuccess: () => setConfirm(null) });
  const open = async (d: DocumentRow) => {
    try { window.open(await storageService.signedUrl("documents", d.storage_path, 600), "_blank", "noopener"); } catch (e) { toast.error(e, "Could not open the document"); }
  };
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted">Supporting files: briefs, legal copy, creative references. SOWs live on the Requirements tab.</p>
        {canEdit && <Button variant="primary" onClick={() => inputRef.current?.click()}><FileUp />Upload document</Button>}
        <input ref={inputRef} type="file" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const p = validateFile("documents", f);
          if (p) toast.error(p); else setFile(f);
        }} />
      </div>
      {!data?.length ? <Card><EmptyState icon={Files} title="No documents yet" body="PDF, Word, Excel, PowerPoint, images, text and CSV up to 25 MB." /></Card> : (
        <Table>
          <thead><tr><Th>Title</Th><Th>Type</Th><Th>File</Th><Th>Size</Th><Th>Uploaded</Th><Th /></tr></thead>
          <tbody>
            {data.map((d) => (
              <Tr key={d.id}>
                <Td className="font-medium">{d.title}</Td>
                <Td className="text-text-2">{KINDS.find((k) => k.value === d.kind)?.label}</Td>
                <Td className="max-w-[220px] truncate text-text-2">{d.file_name}</Td>
                <Td className="text-xs text-muted num">{formatBytes(d.size_bytes)}</Td>
                <Td className="text-xs text-muted">{name(d.created_by)} · {formatDateTime(d.created_at)}</Td>
                <Td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" onClick={() => void open(d)}><Download />Open</Button>
                  {canEdit && <Button size="icon" variant="ghost" aria-label="Delete document" onClick={() => setConfirm(d)}><Trash2 /></Button>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {file && <UploadDocument campaign={c} file={file} onClose={() => setFile(null)} />}
      <ConfirmDialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)} title={`Delete “${confirm?.title}”?`} body="The file is removed from storage. This can’t be undone."
        confirmLabel="Delete document" danger loading={remove.isPending} onConfirm={() => confirm && remove.mutate(confirm)} />
    </>
  );
}

function UploadDocument({ campaign: c, file, onClose }: { campaign: CampaignWithRelations; file: File; onClose: () => void }) {
  const [title, setTitle] = React.useState(file.name.replace(/\.[^.]+$/, ""));
  const [kind, setKind] = React.useState<DocumentRow["kind"]>("other");
  const save = useAction(() => deliveryService.uploadDocument(c.id, file, title, kind), { invalidate: [qk.delivery("documents", c.id)], success: "Document uploaded", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Upload document" description={`${file.name} · ${formatBytes(file.size)}`}
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title} loading={save.isPending} onClick={() => save.mutate(undefined)}>Upload</Button></>}>
        <div className="grid gap-3">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value as DocumentRow["kind"])} options={KINDS} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
