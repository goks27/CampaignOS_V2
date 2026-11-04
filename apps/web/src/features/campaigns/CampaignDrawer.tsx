import * as React from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Pencil } from "lucide-react";
import { Button, Drawer } from "@/components/ui";
import { KeyValue, Pill, StageRing, StatusDot, Section, Avatar, DemoBadge } from "@/components/common";
import {
  CAMPAIGN_ROLE_LABEL, CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE, HEALTH_LABEL, HEALTH_TONE, PRIORITY_LABEL, TRACK_LABEL, TRACK_TONE,
} from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import type { CampaignWithRelations } from "@/services/campaigns";
import { useAuth } from "@/lib/auth";
import { useProfiles } from "@/hooks/queries";
import { CampaignFormDialog } from "./CampaignForm";

export function CampaignDrawer({ campaign, onOpenChange }: { campaign: CampaignWithRelations | null; onOpenChange: (o: boolean) => void }) {
  const { canEdit } = useAuth();
  const { name } = useProfiles();
  const [editing, setEditing] = React.useState(false);
  if (!campaign) return null;
  const c = campaign;
  return (
    <>
      <Drawer open={Boolean(campaign)} onOpenChange={onOpenChange} title={<span className="flex items-center gap-2">{c.name}{c.is_demo && <DemoBadge />}</span>}
        subtitle={c.clients?.name ?? "No client set"}
        actions={<>
          {canEdit && <Button size="sm" onClick={() => setEditing(true)}><Pencil />Edit</Button>}
          <Button size="sm" variant="primary" asChild><Link to={`/campaigns/${c.id}`}>Open workspace</Link></Button>
        </>}>
        <div className="space-y-6 px-5 py-4">
          <KeyValue items={[
            { label: "Stage", value: <StageRing stage={c.stage} /> },
            { label: "Status", value: <StatusDot tone={CAMPAIGN_STATUS_TONE[c.status]} label={CAMPAIGN_STATUS_LABEL[c.status]} /> },
            { label: "Health", value: <Pill tone={HEALTH_TONE[c.health]}>{HEALTH_LABEL[c.health]}</Pill> },
            { label: "Priority", value: PRIORITY_LABEL[c.priority] },
            { label: "Start", value: formatDate(c.start_date) },
            { label: "Target launch", value: formatDate(c.target_launch_date) },
            { label: "Staging", value: c.staging_url ? <a className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline" href={c.staging_url} target="_blank" rel="noreferrer">{c.staging_url}<ExternalLink className="size-3" /></a> : "—" },
            { label: "Production", value: c.production_url ? <a className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline" href={c.production_url} target="_blank" rel="noreferrer">{c.production_url}<ExternalLink className="size-3" /></a> : "—" },
          ]} />
          {c.description && <p className="text-sm text-text-2 whitespace-pre-wrap">{c.description}</p>}
          <Section title="Delivery tracks">
            <KeyValue items={[
              { label: "Design", value: <StatusDot tone={TRACK_TONE[c.design_status]} label={TRACK_LABEL[c.design_status]} /> },
              { label: "Development", value: <StatusDot tone={TRACK_TONE[c.development_status]} label={TRACK_LABEL[c.development_status]} /> },
              { label: "QA", value: <StatusDot tone={TRACK_TONE[c.qa_status]} label={TRACK_LABEL[c.qa_status]} /> },
              { label: "UAT", value: <StatusDot tone={TRACK_TONE[c.uat_status]} label={TRACK_LABEL[c.uat_status]} /> },
            ]} />
            <p className="mt-2 text-xs text-muted">Set by a manager.</p>
          </Section>
          <Section title={`Journeys · ${c.journeys.length}`}>
            {c.journeys.length === 0 ? <p className="text-sm text-muted">No journeys yet. Add them in the workspace.</p> : (
              <ul className="divide-y divide-line rounded-box border border-line">
                {c.journeys.map((j) => (
                  <li key={j.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{j.name}</span><StageRing stage={j.stage} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Team">
            {c.campaign_members.length === 0 ? <p className="text-sm text-muted">Nobody assigned yet.</p> : (
              <ul className="space-y-1.5">
                {c.campaign_members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    <Avatar name={name(m.user_id)} /> <span>{name(m.user_id)}</span>
                    <span className="text-xs text-muted">{CAMPAIGN_ROLE_LABEL[m.campaign_role]}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </Drawer>
      {editing && <CampaignFormDialog open={editing} onOpenChange={setEditing} campaign={c} />}
    </>
  );
}
