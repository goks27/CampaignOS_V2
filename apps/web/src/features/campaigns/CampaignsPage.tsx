import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui";
import { ErrorState, LoadingRows, PageHeader } from "@/components/common";
import { useAuth } from "@/lib/auth";
import { useCampaigns } from "@/hooks/queries";
import { useListKeys } from "@/hooks/useListKeys";
import type { CampaignWithRelations } from "@/services/campaigns";
import { CampaignTable } from "./CampaignTable";
import { CampaignDrawer } from "./CampaignDrawer";
import { CampaignFormDialog } from "./CampaignForm";
import { CampaignFilters, DEFAULT_FILTER, applyCampaignFilter, type CampaignFilter } from "./CampaignFilters";

export function CampaignsPage() {
  const { canEdit } = useAuth();
  const { data, isLoading, error, refetch } = useCampaigns();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = React.useState<CampaignFilter>({ ...DEFAULT_FILTER, status: "" });
  const [peek, setPeek] = React.useState<CampaignWithRelations | null>(null);
  const creating = params.get("new") === "1";
  const setCreating = (o: boolean) => setParams(o ? { new: "1" } : {});
  const list = React.useMemo(() => applyCampaignFilter(data ?? [], filter), [data, filter]);
  const { index } = useListKeys(list, setPeek);

  return (
    <>
      <PageHeader title="Campaigns" description="Every campaign, its journeys and where each one stands."
        actions={canEdit && <>
          <Button asChild><Link to="/import"><Upload />Import from Notion</Link></Button>
          <Button variant="primary" onClick={() => setCreating(true)}><Plus />New campaign</Button>
        </>} />
      <CampaignFilters campaigns={data ?? []} value={filter} onChange={setFilter} />
      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <LoadingRows /> : (
        <CampaignTable campaigns={list} onOpen={setPeek} selectedIndex={index}
          emptyAction={canEdit && <Button variant="primary" onClick={() => setCreating(true)}><Plus />New campaign</Button>} />
      )}
      <p className="mt-2 text-xs text-muted">J/K to move, Enter to peek.</p>
      <CampaignDrawer campaign={peek} onOpenChange={(o) => !o && setPeek(null)} />
      {canEdit && <CampaignFormDialog open={creating} onOpenChange={setCreating} />}
    </>
  );
}
