import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Card, Input, Select } from "@/components/ui";
import { ConfirmDialog, EmptyState, StageRing, StatusDot, Table, Td, Th, Tr } from "@/components/common";
import { STAGES, STAGE_LABEL, TRACK_LABEL, TRACK_TONE, options, type Stage, type TrackStatus } from "@/lib/labels";
import { useAuth } from "@/lib/auth";
import { qk } from "@/hooks/queries";
import { useAction } from "@/hooks/useAction";
import { journeysService, type CampaignWithRelations, type Journey } from "@/services/campaigns";

type TrackKey = "design_status" | "development_status" | "qa_status" | "uat_status";

export function JourneysTab({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const [name, setName] = React.useState("");
  const [confirm, setConfirm] = React.useState<Journey | null>(null);
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null);
  const invalidate = [qk.campaign(c.id), qk.campaigns];
  const add = useAction(() => journeysService.create({ campaign_id: c.id, name: name.trim(), sort_order: c.journeys.length }), { invalidate, success: "Journey added", onSuccess: () => setName("") });
  const update = useAction(({ id, patch }: { id: string; patch: Parameters<typeof journeysService.update>[1] }) => journeysService.update(id, patch), { invalidate });
  const remove = useAction((id: string) => journeysService.remove(id), { invalidate, success: "Journey removed", onSuccess: () => setConfirm(null) });
  const move = useAction((ids: string[]) => journeysService.reorder(ids), { invalidate });
  const swap = (i: number, d: number) => {
    const ids = c.journeys.map((j) => j.id);
    const [a] = ids.splice(i, 1);
    ids.splice(i + d, 0, a!);
    move.mutate(ids);
  };
  const trackCell = (j: Journey, k: TrackKey) => canEdit
    ? <Select aria-label={k} className="h-7 w-40" value={j[k]} options={options(TRACK_LABEL)} onChange={(e) => update.mutate({ id: j.id, patch: { [k]: e.target.value as TrackStatus } })} />
    : <StatusDot tone={TRACK_TONE[j[k]]} label={TRACK_LABEL[j[k]]} />;

  return (
    <>
      <p className="mb-3 text-sm text-muted">Journeys are the separate flows inside one campaign, for example a consumer promotion and regional retailer schemes. Requirements, designs and builds are tracked per journey.</p>
      {c.journeys.length === 0 ? (
        <Card><EmptyState title="No journeys yet" body="Add the user journeys this campaign covers." /></Card>
      ) : (
        <Table>
          <thead><tr>{canEdit && <Th className="w-16" />}<Th>Journey</Th><Th>Stage</Th><Th>Design</Th><Th>Development</Th><Th>QA</Th><Th>UAT</Th>{canEdit && <Th className="w-10" />}</tr></thead>
          <tbody>
            {c.journeys.map((j, i) => (
              <Tr key={j.id}>
                {canEdit && (
                  <Td>
                    <div className="flex">
                      <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => swap(i, -1)}><ArrowUp /></Button>
                      <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === c.journeys.length - 1} onClick={() => swap(i, 1)}><ArrowDown /></Button>
                    </div>
                  </Td>
                )}
                <Td>
                  {renaming?.id === j.id ? (
                    <form onSubmit={(e) => { e.preventDefault(); update.mutate({ id: j.id, patch: { name: renaming.name } }); setRenaming(null); }}>
                      <Input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: j.id, name: e.target.value })} onBlur={() => setRenaming(null)} aria-label="Journey name" />
                    </form>
                  ) : (
                    <button disabled={!canEdit} onClick={() => setRenaming({ id: j.id, name: j.name })} className="text-left font-medium hover:text-accent disabled:hover:text-text">{j.name}</button>
                  )}
                </Td>
                <Td>{canEdit ? <Select aria-label="Stage" className="h-7 w-44" value={j.stage} options={STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))}
                  onChange={(e) => update.mutate({ id: j.id, patch: { stage: e.target.value as Stage } })} /> : <StageRing stage={j.stage} />}</Td>
                <Td>{trackCell(j, "design_status")}</Td><Td>{trackCell(j, "development_status")}</Td><Td>{trackCell(j, "qa_status")}</Td><Td>{trackCell(j, "uat_status")}</Td>
                {canEdit && <Td><Button variant="ghost" size="icon" aria-label={`Delete ${j.name}`} onClick={() => setConfirm(j)}><Trash2 /></Button></Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {canEdit && (
        <form className="mt-3 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(undefined); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New journey, e.g. Telangana retailer contest" aria-label="New journey name" />
          <Button type="submit" disabled={!name.trim()} loading={add.isPending}><Plus />Add journey</Button>
        </form>
      )}
      <ConfirmDialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)} title={`Delete “${confirm?.name}”?`}
        body="Requirements, designs and tasks linked to this journey stay on the campaign without a journey." confirmLabel="Delete journey" danger
        loading={remove.isPending} onConfirm={() => confirm && remove.mutate(confirm.id)} />
    </>
  );
}
