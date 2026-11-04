import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Drawer } from "@/components/ui";
import { findingsService, type Finding } from "@/services/findings";
import type { DesignSubmission } from "@/services/designs";
import { FindingList } from "./FindingList";
import { ScreenshotViewer, type Overlay, type Region } from "@/features/reviews/ScreenshotViewer";

/** A design screen with the findings Claude pinned on it. Accept or dismiss here; assign and edit stay in the Findings Inbox. */
export function ScreenFindings({ campaignId, sub, index, onIndex, onClose }: {
  campaignId: string; sub: DesignSubmission; index: number; onIndex: (i: number) => void; onClose: () => void;
}) {
  const asset = sub.design_assets[index]!;
  const { data } = useQuery({ queryKey: ["findings", "canvas", campaignId], queryFn: () => findingsService.list({ campaignId }) });
  const here = (data ?? []).filter((f) => f.design_asset_id === asset.id && f.status !== "dismissed");
  const [selected, setSelected] = React.useState<string | null>(null);
  // Start with the first finding on this screen selected, so its region is highlighted.
  const firstId = here[0]?.id ?? null;
  React.useEffect(() => setSelected(firstId), [asset.id, firstId]);

  const regionOf = (f: Finding): Region | null => {
    const evidence = f.finding_evidence ?? [];
    const e = evidence.find((x) => x.kind === "region" && x.design_asset_id === asset.id) ?? evidence.find((x) => x.kind === "region");
    const r = e?.region as Region | null | undefined;
    return r && typeof r.x === "number" ? r : null;
  };
  const overlays: Overlay[] = here.flatMap((f) => { const region = regionOf(f); return region ? [{ id: f.id, region, active: f.id === selected, label: f.title }] : []; });


  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} width={1040} title={asset.screen_name} subtitle={`${sub.title} · v${sub.version_no} · ${here.length} finding${here.length === 1 ? "" : "s"}`}
      actions={<Button asChild size="sm" variant="ghost"><Link to={`/reviews?campaign=${campaignId}`}>Open Findings Inbox</Link></Button>}>
      <div className="grid h-[calc(100vh-150px)] min-h-[420px] grid-cols-1 gap-0 lg:grid-cols-[1fr_340px]">
        <div className="min-h-0 border-b border-line lg:border-b-0 lg:border-r">
          <ScreenshotViewer bucket={asset.bucket} path={asset.storage_path} title={asset.screen_name} overlays={overlays}
            position={`${index + 1} / ${sub.design_assets.length}`} onPrev={index > 0 ? () => onIndex(index - 1) : undefined}
            onNext={index < sub.design_assets.length - 1 ? () => onIndex(index + 1) : undefined} onSelectOverlay={setSelected} />
        </div>
        <div className="min-h-0 overflow-y-auto"><FindingList campaignId={campaignId} findings={here} selected={selected} onSelect={setSelected} emptyText="No findings on this screen. Run SOW vs Design to check it against the accepted requirements." /></div>
      </div>
    </Drawer>
  );
}
