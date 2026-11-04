import * as React from "react";
import { Play } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui";
import { ConfirmDialog } from "@/components/common";
import { useToast, friendly } from "@/components/toast";
import { useQueryClient } from "@tanstack/react-query";
import { jobsService } from "@/services/jobs";
import { REVIEW_TYPE_LABEL, type ReviewType } from "@/lib/labels";
import { useWorkerState } from "@/hooks/queries";

/** Queues a review. A duplicate (same content already reviewed) asks before running again. */
export function useRunReview(campaignId: string) {
  const toast = useToast();
  const qc = useQueryClient();
  const worker = useWorkerState();
  const [pending, setPending] = React.useState<{ type: ReviewType; source: Record<string, string> } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = React.useCallback(async (type: ReviewType, source: Record<string, string>, runAgain = false) => {
    setBusy(true);
    try {
      await jobsService.enqueue(campaignId, type, source, runAgain);
      const state = worker.data?.state;
      toast.success(`${REVIEW_TYPE_LABEL[type]} queued.${state === "offline" || state === "not_set_up" ? " The AI worker is offline; it will run when the worker connects." : ""}`);
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["sow"] });
      setPending(null);
    } catch (e) {
      if (friendly(e).startsWith("This exact content")) setPending({ type, source });
      else toast.error(e, `Could not start ${REVIEW_TYPE_LABEL[type]}`);
    } finally {
      setBusy(false);
    }
  }, [campaignId, qc, toast, worker.data?.state]);

  const dialog = (
    <ConfirmDialog open={Boolean(pending)} onOpenChange={(o) => !o && setPending(null)} title="Already reviewed"
      body={<>This exact content was already reviewed{pending ? ` (${REVIEW_TYPE_LABEL[pending.type]})` : ""}. Running it again uses the worker’s time and may produce duplicate findings. Run again anyway?</>}
      confirmLabel="Run again" loading={busy} onConfirm={() => pending && void run(pending.type, pending.source, true)} />
  );
  return { run, busy, dialog };
}

export function RunReviewButton({ campaignId, reviewType: type, source, label, ...props }: {
  campaignId: string; reviewType: ReviewType; source: Record<string, string>; label?: string;
} & Omit<ButtonProps, "onClick" | "type">) {
  const { run, busy, dialog } = useRunReview(campaignId);
  return (
    <>
      <Button loading={busy} onClick={() => void run(type, source)} {...props}><Play />{label ?? `Run ${REVIEW_TYPE_LABEL[type]}`}</Button>
      {dialog}
    </>
  );
}
