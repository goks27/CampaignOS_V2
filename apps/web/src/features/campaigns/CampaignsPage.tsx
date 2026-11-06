import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { LayoutGrid, List, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/common";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useCampaigns } from "@/hooks/queries";
import { useListKeys } from "@/hooks/useListKeys";
import type { CampaignWithRelations } from "@/services/campaigns";
import { CampaignCover, useCovers } from "@/features/home/CampaignCover";
import { CampaignTable } from "./CampaignTable";
import { CampaignDrawer } from "./CampaignDrawer";
import { CampaignFormDialog } from "./CampaignForm";
import { CampaignFilters, DEFAULT_FILTER, applyCampaignFilter, type CampaignFilter } from "./CampaignFilters";

const VIEW_KEY = "campaignos-projects-view";
const readView = (): "grid" | "list" => { try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid"; } catch { return "grid"; } };

/** Every campaign. Covers show what each one looks like; the list is there for scanning and filtering a lot of them. */
export function CampaignsPage() {
  const { canEdit } = useAuth();
  const { data, isLoading, error, refetch } = useCampaigns();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = React.useState<CampaignFilter>({ ...DEFAULT_FILTER, status: "" });
  const [peek, setPeek] = React.useState<CampaignWithRelations | null>(null);
  const [view, setView] = React.useState<"grid" | "list">(readView);
  const creating = params.get("new") === "1";
  const setCreating = (o: boolean) => setParams(o ? { new: "1" } : {});
  const list = React.useMemo(() => applyCampaignFilter(data ?? [], filter), [data, filter]);
  const covers = useCovers(view === "grid" ? list.map((c) => c.id) : []);
  const { index } = useListKeys(list, setPeek);
  const pick = (v: "grid" | "list") => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* a convenience only */ } };
  const newBtn = canEdit && <Button variant="primary" onClick={() => setCreating(true)}><Plus />New project</Button>;

  return (
    <>
      <PageHeader title="Projects" description="Every campaign, its journeys and where each one stands."
        actions={<>
          <div className="flex rounded-ctl border border-line-strong p-0.5" role="group" aria-label="View">
            <button onClick={() => pick("grid")} aria-pressed={view === "grid"} aria-label="Grid view" className={cn("rounded px-1.5 py-1 text-muted hover:text-text", view === "grid" && "bg-active text-text")}><LayoutGrid className="size-4" /></button>
            <button onClick={() => pick("list")} aria-pressed={view === "list"} aria-label="List view" className={cn("rounded px-1.5 py-1 text-muted hover:text-text", view === "list" && "bg-active text-text")}><List className="size-4" /></button>
          </div>
          {newBtn}
        </>} />
      <CampaignFilters campaigns={data ?? []} value={filter} onChange={setFilter} />
      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <LoadingRows /> : view === "grid" ? (
        !list.length ? <EmptyState title="No projects match" body="Change the filters, or create a new project." action={newBtn} /> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{list.map((c) => <CampaignCover key={c.id} c={c} cover={covers[c.id]} />)}</div>
        )
      ) : (
        <>
          <CampaignTable campaigns={list} onOpen={setPeek} selectedIndex={index} emptyAction={newBtn} />
          <p className="mt-2 text-xs text-muted">J/K to move, Enter to peek.</p>
        </>
      )}
      <CampaignDrawer campaign={peek} onOpenChange={(o) => !o && setPeek(null)} />
      {canEdit && <CampaignFormDialog open={creating} onOpenChange={setCreating} />}
    </>
  );
}
