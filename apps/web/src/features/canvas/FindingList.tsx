import { useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui";
import { Pill, StatusDot } from "@/components/common";
import { FINDING_STATUS_LABEL, FINDING_STATUS_TONE, SEVERITY_LABEL, SEVERITY_TONE } from "@/lib/labels";
import { useAuth } from "@/lib/auth";
import { useAction } from "@/hooks/useAction";
import { findingsService, type Finding } from "@/services/findings";
import { cn } from "@/lib/utils";

/** Findings as rows. A manager accepts or dismisses here; assigning and editing stay in the Findings Inbox. */
export function FindingList({ campaignId, findings, selected, onSelect, emptyText }: {
  campaignId: string; findings: Finding[]; selected?: string | null; onSelect?: (id: string) => void; emptyText?: string;
}) {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const decide = useAction(({ id, status }: { id: string; status: "accepted" | "dismissed" }) => findingsService.setStatus([id], status), {
    success: "Saved", error: "Could not save",
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["findings"] }); void qc.invalidateQueries({ queryKey: ["report", campaignId] }); },
  });
  return (
    <ul className="divide-y divide-line">
      {!findings.length && <li className="p-4 text-sm text-muted">{emptyText ?? "No findings."}</li>}
      {findings.map((f) => (
        <li key={f.id} onClick={() => onSelect?.(f.id)} className={cn("p-3 text-sm", onSelect && "cursor-pointer", f.id === selected ? "bg-active" : onSelect && "hover:bg-hover")}>
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
  );
}
