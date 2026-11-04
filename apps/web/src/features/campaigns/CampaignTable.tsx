import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn, formatDate, isOverdue } from "@/lib/utils";
import { HEALTH_LABEL, HEALTH_TONE, TRACK_LABEL, TRACK_TONE, type TrackStatus } from "@/lib/labels";
import { Pill, StageRing, StatusDot, Table, Th, Td, Tr, EmptyState, DemoBadge } from "@/components/common";
import type { CampaignWithRelations } from "@/services/campaigns";
import { useProfiles } from "@/hooks/queries";

function Track({ s }: { s: TrackStatus }) {
  return <StatusDot tone={TRACK_TONE[s]} label={TRACK_LABEL[s]} />;
}

export function primaryManager(c: CampaignWithRelations) {
  return c.campaign_members.find((m) => m.campaign_role === "primary_manager");
}

export function CampaignTable({ campaigns, onOpen, selectedIndex, emptyAction }: {
  campaigns: CampaignWithRelations[]; onOpen: (c: CampaignWithRelations) => void; selectedIndex?: number; emptyAction?: React.ReactNode;
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const { name } = useProfiles();
  if (!campaigns.length) {
    return (
      <div className="rounded-box border border-line bg-surface">
        <EmptyState title="No campaigns match" body="Create a campaign, import from Notion, or clear the filters." action={emptyAction} />
      </div>
    );
  }
  const toggle = (id: string) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-[26%]">Campaign</Th><Th>Client</Th><Th>Manager</Th><Th>Stage</Th><Th>Design</Th><Th>Development</Th>
          <Th>QA</Th><Th>UAT</Th><Th>Launch</Th><Th>Health</Th>
        </tr>
      </thead>
      <tbody>
        {campaigns.map((c, i) => {
          const open = expanded.has(c.id);
          const pm = primaryManager(c);
          return (
            <React.Fragment key={c.id}>
              <Tr onClick={() => onOpen(c)} selected={selectedIndex === i} aria-selected={selectedIndex === i}>
                <Td>
                  <div className="flex items-center gap-1">
                    {c.journeys.length > 0 ? (
                      <button aria-label={open ? "Hide journeys" : "Show journeys"} aria-expanded={open}
                        onClick={(e) => { e.stopPropagation(); toggle(c.id); }}
                        className="rounded p-0.5 text-muted hover:bg-active hover:text-text">
                        <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />
                      </button>
                    ) : <span className="w-[18px]" />}
                    <span className="truncate font-medium">{c.name}</span>
                    {c.is_demo && <DemoBadge />}
                    {c.journeys.length > 0 && <span className="text-xs text-muted num">{c.journeys.length}</span>}
                  </div>
                </Td>
                <Td className="text-text-2">{c.clients?.name ?? "—"}</Td>
                <Td className="whitespace-nowrap text-text-2">{pm ? name(pm.user_id) : "—"}</Td>
                <Td><StageRing stage={c.stage} /></Td>
                <Td><Track s={c.design_status} /></Td>
                <Td><Track s={c.development_status} /></Td>
                <Td><Track s={c.qa_status} /></Td>
                <Td><Track s={c.uat_status} /></Td>
                <Td className={cn("whitespace-nowrap num", isOverdue(c.target_launch_date, c.status === "completed" ? "done" : "") && "text-st-amber")}>
                  {formatDate(c.target_launch_date, true)}
                </Td>
                <Td><Pill tone={HEALTH_TONE[c.health]}>{HEALTH_LABEL[c.health]}</Pill></Td>
              </Tr>
              {open && c.journeys.map((j) => (
                <Tr key={j.id} onClick={() => onOpen(c)} className="bg-side/50">
                  <Td><span className="pl-8 text-text-2">{j.name}</span></Td>
                  <Td /><Td />
                  <Td><StageRing stage={j.stage} /></Td>
                  <Td><Track s={j.design_status} /></Td>
                  <Td><Track s={j.development_status} /></Td>
                  <Td><Track s={j.qa_status} /></Td>
                  <Td><Track s={j.uat_status} /></Td>
                  <Td /><Td />
                </Tr>
              ))}
            </React.Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}
