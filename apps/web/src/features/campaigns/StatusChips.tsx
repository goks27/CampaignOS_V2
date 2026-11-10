import { ChevronDown } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { qk } from "@/hooks/queries";
import { useAction } from "@/hooks/useAction";
import { HEALTH_LABEL, HEALTH_TONE, TRACK_LABEL, TRACK_TONE, type Health, type TrackStatus } from "@/lib/labels";
import { StatusDot } from "@/components/common";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui";
import { campaignsService, type CampaignWithRelations } from "@/services/campaigns";

const TRACKS = [["design_status", "Design"], ["development_status", "Development"], ["qa_status", "QA"], ["uat_status", "UAT"]] as const;

/** One chip: the current value, and one click opens the list to change it. Read-only for people who cannot edit. */
function Chip<T extends string>({ label, value, labels, tone, editable, onPick }: { label: string; value: T; labels: Record<T, string>; tone: (v: T) => Parameters<typeof StatusDot>[0]["tone"]; editable: boolean; onPick: (v: T) => void }) {
  const body = <><span className="text-muted">{label}</span><StatusDot tone={tone(value)} label={labels[value]} /></>;
  if (!editable) return <span className="flex items-center gap-1.5 rounded-ctl px-1.5 py-1 text-xs">{body}</span>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`${label}: ${labels[value]}. Change`} className="flex items-center gap-1.5 rounded-ctl px-1.5 py-1 text-xs hover:bg-hover">{body}<ChevronDown className="size-3 text-muted" /></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[190px]">
        {(Object.keys(labels) as T[]).map((k) => (
          <DropdownMenuItem key={k} onSelect={() => k !== value && onPick(k)}><StatusDot tone={tone(k)} label={labels[k]} /></DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Health and the four delivery statuses, in the campaign header. They stay manual: Journey never works them out for you. */
export function StatusChips({ c }: { c: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const update = useAction((patch: Parameters<typeof campaignsService.update>[1]) => campaignsService.update(c.id, patch), { invalidate: [qk.campaign(c.id), qk.campaigns, qk.summary, ["progress", c.id]], error: "Could not update" });
  return (
    <div className="hidden items-center gap-0.5 lg:flex" data-testid="status-chips">
      <Chip<Health> label="Health" value={c.health} labels={HEALTH_LABEL} tone={(v) => HEALTH_TONE[v]} editable={canEdit} onPick={(v) => update.mutate({ health: v })} />
      {TRACKS.map(([key, label]) => (
        <Chip<TrackStatus> key={key} label={label} value={c[key]} labels={TRACK_LABEL} tone={(v) => TRACK_TONE[v]} editable={canEdit} onPick={(v) => update.mutate({ [key]: v })} />
      ))}
    </div>
  );
}
