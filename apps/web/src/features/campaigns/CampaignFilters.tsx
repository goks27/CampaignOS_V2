import * as React from "react";
import { Search, X } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { CAMPAIGN_STATUS_LABEL, STAGES, STAGE_LABEL, options, type CampaignStatus, type Stage } from "@/lib/labels";
import type { CampaignWithRelations } from "@/services/campaigns";
import { useProfiles } from "@/hooks/queries";
import { primaryManager } from "./CampaignTable";

export type CampaignFilter = { q: string; manager: string; client: string; status: CampaignStatus | "" | "open"; stage: Stage | ""; launchBy: string };
export const DEFAULT_FILTER: CampaignFilter = { q: "", manager: "", client: "", status: "open", stage: "", launchBy: "" };

export function applyCampaignFilter(list: CampaignWithRelations[], f: CampaignFilter) {
  const q = f.q.trim().toLowerCase();
  return list.filter((c) => {
    if (q && !`${c.name} ${c.clients?.name ?? ""} ${c.journeys.map((j) => j.name).join(" ")}`.toLowerCase().includes(q)) return false;
    if (f.manager && !c.campaign_members.some((m) => m.user_id === f.manager && (m.campaign_role === "primary_manager" || m.campaign_role === "supporting_manager"))) return false;
    if (f.client && c.client_id !== f.client) return false;
    if (f.status === "open" && !(c.status === "active" || c.status === "on_hold")) return false;
    if (f.status && f.status !== "open" && c.status !== f.status) return false;
    if (f.stage && c.stage !== f.stage) return false;
    if (f.launchBy && (!c.target_launch_date || c.target_launch_date > f.launchBy)) return false;
    return true;
  });
}

export function CampaignFilters({ campaigns, value, onChange }: { campaigns: CampaignWithRelations[]; value: CampaignFilter; onChange: (f: CampaignFilter) => void }) {
  const { name } = useProfiles();
  const managers = React.useMemo(() => {
    const ids = new Set<string>();
    campaigns.forEach((c) => { const pm = primaryManager(c); if (pm) ids.add(pm.user_id); });
    return [...ids].map((id) => ({ value: id, label: name(id) }));
  }, [campaigns, name]);
  const clients = React.useMemo(() => {
    const m = new Map<string, string>();
    campaigns.forEach((c) => c.clients && m.set(c.clients.id, c.clients.name));
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [campaigns]);
  const set = (patch: Partial<CampaignFilter>) => onChange({ ...value, ...patch });
  const dirty = JSON.stringify(value) !== JSON.stringify(DEFAULT_FILTER);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted" />
        <Input value={value.q} onChange={(e) => set({ q: e.target.value })} placeholder="Filter campaigns" className="w-52 pl-7" aria-label="Filter campaigns" />
      </div>
      <Select aria-label="Manager" className="w-40" value={value.manager} onChange={(e) => set({ manager: e.target.value })} options={managers} placeholder="Any manager" />
      <Select aria-label="Client" className="w-40" value={value.client} onChange={(e) => set({ client: e.target.value })} options={clients} placeholder="Any client" />
      <Select aria-label="Status" className="w-36" value={value.status} onChange={(e) => set({ status: e.target.value as CampaignFilter["status"] })}
        options={[{ value: "open", label: "Active & on hold" }, ...options(CAMPAIGN_STATUS_LABEL)]} placeholder="Any status" />
      <Select aria-label="Stage" className="w-40" value={value.stage} onChange={(e) => set({ stage: e.target.value as Stage | "" })}
        options={STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))} placeholder="Any stage" />
      <label className="flex items-center gap-1.5 text-xs text-muted">Launch by
        <Input type="date" className="w-36" value={value.launchBy} onChange={(e) => set({ launchBy: e.target.value })} aria-label="Launch by" />
      </label>
      {dirty && <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_FILTER)}><X />Clear</Button>}
    </div>
  );
}
