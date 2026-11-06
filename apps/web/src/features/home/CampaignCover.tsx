import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { JourneyMark, CampaignGlyph } from "@/components/brand";
import { Pill, PhaseStrip } from "@/components/common";
import { AssetImage } from "@/features/shared/AssetImage";
import { HEALTH_LABEL, HEALTH_TONE } from "@/lib/labels";
import { campaignPath } from "@/lib/nav";
import { formatDate } from "@/lib/utils";
import { designsService } from "@/services/designs";
import type { CampaignWithRelations } from "@/services/campaigns";
import { pickCovers } from "./model";

/** The first design screen of each campaign, so a campaign is recognised by its look, not only its name. */
export function useCovers(ids: string[]) {
  const key = [...ids].sort().join(",");
  const q = useQuery({ queryKey: ["covers", key], queryFn: () => designsService.coverRows(ids), enabled: ids.length > 0, staleTime: 60_000 });
  return React.useMemo(() => pickCovers(q.data ?? []), [q.data]);
}

export function CampaignCover({ c, cover }: { c: CampaignWithRelations; cover?: { bucket: string; path: string } }) {
  return (
    <Link to={campaignPath(c.id)} className="group block overflow-hidden rounded-box border border-line bg-surface transition-colors hover:border-line-strong">
      <div className="aspect-[16/10] overflow-hidden border-b border-line bg-side">
        {cover
          ? <AssetImage bucket={cover.bucket} path={cover.path} alt={`${c.name} cover`} className="h-full w-full" imgClassName="object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]" />
          : <div className="flex h-full items-center justify-center"><JourneyMark size={44} className="text-line-strong" /></div>}
      </div>
      <div className="space-y-1.5 p-3">
        <div className="flex items-center gap-2">
          <CampaignGlyph id={c.id} name={c.name} size={20} />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</h3>
          <Pill tone={HEALTH_TONE[c.health]}>{HEALTH_LABEL[c.health]}</Pill>
        </div>
        <p className="truncate text-xs text-muted">{c.clients?.name ?? "No client"} · {c.journeys.length} journey{c.journeys.length === 1 ? "" : "s"}{c.target_launch_date ? ` · launch ${formatDate(c.target_launch_date, true)}` : ""}</p>
        <PhaseStrip stage={c.stage} compact />
      </div>
    </Link>
  );
}
