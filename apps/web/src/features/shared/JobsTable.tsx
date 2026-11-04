import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { EmptyState, ErrorState, LoadingRows, StatusDot, Table, Td, Th, Tr } from "@/components/common";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE, REVIEW_TYPE_LABEL } from "@/lib/labels";
import { formatDateTime } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useAction } from "@/hooks/useAction";
import { useProfiles, useWorkerState, qk } from "@/hooks/queries";
import { jobsService } from "@/services/jobs";

export function JobsTable({ campaignId }: { campaignId?: string }) {
  const { canEdit } = useAuth();
  const { name } = useProfiles();
  const worker = useWorkerState();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.jobs(campaignId ?? "all"),
    queryFn: () => jobsService.list({ campaignId, limit: 60 }),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === "queued" || j.status === "processing") ? 10_000 : false),
  });
  const cancel = useAction((id: string) => jobsService.cancel(id), { invalidate: [["jobs"]], success: "Cancellation requested" });
  const [expanded, setExpanded] = React.useState<string | null>(null);

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isLoading) return <LoadingRows />;
  if (!data?.length) return <Card><EmptyState title="No reviews have run yet" body="Start a SOW analysis on the Requirements tab, or a design or development review from their tabs." /></Card>;
  const offline = worker.data && (worker.data.state === "offline" || worker.data.state === "not_set_up");
  return (
    <>
      {offline && data.some((j) => j.status === "queued") && (
        <p className="mb-2 rounded-box border border-line bg-side px-3 py-2 text-sm text-text-2">
          The AI worker is offline, so queued reviews are waiting. They start automatically when the worker on the AI PC connects. Nothing is sent to a cloud AI service.
        </p>
      )}
      <Table>
        <thead><tr><Th>Review</Th>{!campaignId && <Th>Campaign</Th>}<Th>Status</Th><Th>Result</Th><Th>Started by</Th><Th>Queued</Th><Th>Duration</Th>{canEdit && <Th />}</tr></thead>
        <tbody>
          {data.map((j) => {
            const s = (j.result_summary ?? {}) as { findings?: number; requirements?: number; checks?: number; tests?: number };
            return (
              <React.Fragment key={j.id}>
                <Tr onClick={() => setExpanded(expanded === j.id ? null : j.id)}>
                  <Td className="font-medium whitespace-nowrap">{REVIEW_TYPE_LABEL[j.review_type]}{j.triggered_by === "automatic" && <span className="ml-1.5 text-xs font-normal text-muted">auto</span>}</Td>
                  {!campaignId && <Td><Link onClick={(e) => e.stopPropagation()} to={`/campaigns/${j.campaign_id}/ai-reviews`} className="text-text-2 hover:text-text">{j.campaigns?.name}</Link></Td>}
                  <Td><StatusDot tone={JOB_STATUS_TONE[j.status]} label={`${JOB_STATUS_LABEL[j.status]}${j.status === "queued" && j.attempts > 0 ? ` (retry ${j.attempts}/${j.max_attempts - 1})` : ""}${j.cancel_requested && j.status === "processing" ? " · cancelling" : ""}`} /></Td>
                  <Td className="text-text-2">
                    {j.status === "completed" ? (j.review_type === "sow_analysis" ? `${s.requirements ?? 0} draft requirements` : `${s.findings ?? 0} findings${s.checks ? ` · ${s.checks} need verification` : ""}${s.tests ? ` · ${s.tests} scenarios` : ""}`)
                      : j.status === "failed" ? <span className="text-st-red">{j.error?.slice(0, 80)}</span> : "—"}
                  </Td>
                  <Td className="text-text-2 whitespace-nowrap">{j.created_by ? name(j.created_by) : "Automatic"}</Td>
                  <Td className="text-xs text-muted whitespace-nowrap">{formatDateTime(j.created_at)}</Td>
                  <Td className="text-xs text-muted num">{j.duration_ms ? `${Math.round(j.duration_ms / 1000)}s` : "—"}</Td>
                  {canEdit && <Td onClick={(e) => e.stopPropagation()}>
                    {(j.status === "queued" || (j.status === "processing" && !j.cancel_requested)) && (
                      <Button size="sm" variant="ghost" onClick={() => cancel.mutate(j.id)}><X />Cancel</Button>
                    )}
                  </Td>}
                </Tr>
                {expanded === j.id && (
                  <tr><td colSpan={8} className="border-b border-line bg-side px-4 py-3 text-xs text-text-2">
                    <div className="grid gap-1 sm:grid-cols-2">
                      <span>Model: <span className="font-mono">{j.model ?? "—"}</span></span>
                      <span>Prompt version: <span className="font-mono">{j.prompt_version ?? "—"}</span></span>
                      <span>Attempts: {j.attempts} of {j.max_attempts}</span>
                      <span>Finished: {formatDateTime(j.finished_at)}</span>
                    </div>
                    {j.error && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-st-red">{j.error}</pre>}
                    {j.status === "completed" && j.review_type !== "sow_analysis" && (
                      <Link to={`/reviews?campaign=${j.campaign_id}&job=${j.id}`} className="mt-2 inline-block text-accent hover:underline">Open these findings in the inbox</Link>
                    )}
                  </td></tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
