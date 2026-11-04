import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Button, Drawer } from "@/components/ui";
import { Pill, StatusDot } from "@/components/common";
import { FINDING_STATUS_LABEL, FINDING_STATUS_TONE, SEVERITY_LABEL, SEVERITY_TONE } from "@/lib/labels";
import { useAuth } from "@/lib/auth";
import { useAction } from "@/hooks/useAction";
import { findingsService, type Finding } from "@/services/findings";
import type { DesignSubmission } from "@/services/designs";
import { ScreenshotViewer, type Overlay, type Region } from "@/features/reviews/ScreenshotViewer";

/** A design screen with the findings Claude pinned on it. Accept or dismiss here; assign and edit stay in the Findings Inbox. */
export function ScreenFindings({ campaignId, sub, index, onIndex, onClose }: {
  campaignId: string; sub: DesignSubmission; index: number; onIndex: (i: number) => void; onClose: () => void;
}) {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
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

  const decide = useAction(({ id, status }: { id: string; status: "accepted" | "dismissed" }) => findingsService.setStatus([id], status), {
    success: "Saved", error: "Could not save",
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["findings"] }); void qc.invalidateQueries({ queryKey: ["report", campaignId] }); },
  });

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} width={1040} title={asset.screen_name} subtitle={`${sub.title} · v${sub.version_no} · ${here.length} finding${here.length === 1 ? "" : "s"}`}
      actions={<Button asChild size="sm" variant="ghost"><Link to={`/reviews?campaign=${campaignId}`}>Open Findings Inbox</Link></Button>}>
      <div className="grid h-[calc(100vh-150px)] min-h-[420px] grid-cols-1 gap-0 lg:grid-cols-[1fr_340px]">
        <div className="min-h-0 border-b border-line lg:border-b-0 lg:border-r">
          <ScreenshotViewer bucket={asset.bucket} path={asset.storage_path} title={asset.screen_name} overlays={overlays}
            position={`${index + 1} / ${sub.design_assets.length}`} onPrev={index > 0 ? () => onIndex(index - 1) : undefined}
            onNext={index < sub.design_assets.length - 1 ? () => onIndex(index + 1) : undefined} onSelectOverlay={setSelected} />
        </div>
        <ul className="min-h-0 divide-y divide-line overflow-y-auto">
          {!here.length && <li className="p-4 text-sm text-muted">No findings on this screen. Run SOW vs Design to check it against the accepted requirements.</li>}
          {here.map((f) => (
            <li key={f.id} onClick={() => setSelected(f.id)} className={`cursor-pointer p-3 text-sm ${f.id === selected ? "bg-active" : "hover:bg-hover"}`}>
              <div className="mb-1 flex items-center gap-2">
                <Pill tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</Pill>
                <StatusDot tone={FINDING_STATUS_TONE[f.status]} label={FINDING_STATUS_LABEL[f.status]} className="text-xs" />
              </div>
              <p className="font-medium">{f.title}</p>
              <p className="mt-0.5 text-xs text-muted">{f.requirements ? `${f.requirements.ref} · ${f.requirements.title}` : "Additional observation (no requirement)"}</p>
              {f.observed && <p className="mt-1.5 text-text-2"><span className="text-muted">Seen: </span>{f.observed}</p>}
              {f.expected && <p className="text-text-2"><span className="text-muted">Expected: </span>{f.expected}</p>}
              {f.suggested_correction && <p className="text-text-2"><span className="text-muted">Fix: </span>{f.suggested_correction}</p>}
              {f.confidence && f.confidence !== "high" && <p className="mt-1 text-xs text-muted">Confidence: {f.confidence.replace(/_/g, " ")}. Region is approximate.</p>}
              {canEdit && (f.status === "new" || f.status === "awaiting_review") && (
                <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="primary" loading={decide.isPending} onClick={() => decide.mutate({ id: f.id, status: "accepted" })}><Check />Accept</Button>
                  <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ id: f.id, status: "dismissed" })}><X />Dismiss</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Drawer>
  );
}
