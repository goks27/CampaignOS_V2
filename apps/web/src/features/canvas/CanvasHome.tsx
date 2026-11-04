import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LoadingRows } from "@/components/common";
import { qk } from "@/hooks/queries";
import type { CampaignWithRelations } from "@/services/campaigns";
import { designsService } from "@/services/designs";
import { JourneyCanvas } from "./JourneyCanvas";
import { PipelineCanvas } from "./CampaignCanvas";
import { JourneySelect } from "./CanvasControls";
import { UNASSIGNED } from "./journeyModel";

const ALL = "all";

/**
 * A campaign's canvas. A dropdown picks the journey (each journey has its own canvas of screens) or "All journeys"
 * for the whole-campaign pipeline. The chosen journey lives in the address (?j=...), so a link or a refresh keeps it.
 */
export function CampaignCanvas({ campaign: c }: { campaign: CampaignWithRelations }) {
  const [params, setParams] = useSearchParams();
  const designs = useQuery({ queryKey: qk.designs(c.id), queryFn: () => designsService.list(c.id) });
  const hasUnassigned = (designs.data ?? []).some((d) => d.journey_id === null);

  const tabs = React.useMemo(() => [
    ...c.journeys.map((j) => ({ value: j.id, label: j.name })),
    // A campaign without journeys still gets one canvas, so there is always somewhere to drop screens.
    ...(!c.journeys.length || hasUnassigned ? [{ value: UNASSIGNED, label: c.journeys.length ? "Unassigned" : "Main journey" }] : []),
    { value: ALL, label: "All journeys (pipeline)" },
  ], [c.journeys, hasUnassigned]);

  if (designs.isLoading) return <div className="p-6"><LoadingRows rows={4} /></div>;

  const wanted = params.get("j");
  const withDesigns = (key: string) => (designs.data ?? []).some((d) => (key === UNASSIGNED ? d.journey_id === null : d.journey_id === key));
  const fallback = tabs.find((t) => t.value !== ALL && withDesigns(t.value))?.value ?? ALL;
  const current = tabs.some((t) => t.value === wanted) ? (wanted as string) : fallback;
  const pick = (v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("j", v); return n; }, { replace: true });
  const manage = () => setParams((p) => { const n = new URLSearchParams(p); n.set("panel", "journeys"); return n; }, { replace: true });
  const name = tabs.find((t) => t.value === current)?.label ?? "Journey";
  const selector = <JourneySelect tabs={tabs} current={current} onPick={pick} onManage={manage} />;

  return current === ALL
    ? <PipelineCanvas campaign={c} selector={selector} />
    : <JourneyCanvas key={current} campaign={c} journeyKey={current} journeyName={name} selector={selector} />;
}
