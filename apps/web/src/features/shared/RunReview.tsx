import * as React from "react";
import { Play } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui";
import { ConfirmDialog } from "@/components/common";
import { useToast, friendly } from "@/components/toast";
import { useQueryClient } from "@tanstack/react-query";
import { jobsService } from "@/services/jobs";
import { progressService, type ReviewAction } from "@/services/progress";
import { connectorService } from "@/services/connector";
import { REVIEW_TYPE_LABEL, type ReviewType } from "@/lib/labels";
import { qk, useWorkerState } from "@/hooks/queries";

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
      // Hand it to the Claude connector right away. If it is not running, the review waits in the queue.
      const started = await connectorService.wake();
      if (started) {
        toast.success(`${REVIEW_TYPE_LABEL[type]} started. Claude is analysing it; results appear here when it finishes.`);
        void qc.invalidateQueries({ queryKey: qk.connector });
      } else {
        toast.success(`${REVIEW_TYPE_LABEL[type]} queued.${state === "offline" || state === "not_set_up" ? " The Claude connector is not running on this PC. Start it with npm run claude and the review runs." : ""}`);
      }
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
      body={<>This exact content was already reviewed{pending ? ` (${REVIEW_TYPE_LABEL[pending.type]})` : ""}. Running it again uses Claude’s time and may produce duplicate findings. Run again anyway?</>}
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

export const ACTION_LABEL: Record<ReviewAction, string> = { check_sow: "Check SOW", review_designs: "Review designs", test_build: "Test build" };
const CHECK_LABEL: Record<string, string> = { sow_analysis: "SOW analysis", sow_vs_design: "SOW vs design", design_consistency: "design consistency", design_vs_development: "design vs build", functional_qa: "scenarios", sow_vs_development: "SOW vs build", site_check: "site check" };

/** The three review actions. Each one queues every check that applies and says plainly why it skipped the others. */
export function useRunReviewAction(campaignId: string) {
  const toast = useToast();
  const qc = useQueryClient();
  const [pending, setPending] = React.useState<{ action: ReviewAction; source: Record<string, string> } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = React.useCallback(async (action: ReviewAction, source: Record<string, string>, runAgain = false) => {
    setBusy(true);
    try {
      const out = await progressService.review(campaignId, action, source, runAgain);
      const queued = out.filter((o) => o.status === "queued");
      const skipped = out.filter((o) => o.status === "skipped");
      if (!queued.length && skipped.some((o) => o.reason?.startsWith("This exact content"))) { setPending({ action, source }); return; }
      const started = queued.length ? await connectorService.wake() : false;
      const said = queued.length
        ? `${ACTION_LABEL[action]}: ${queued.map((o) => CHECK_LABEL[o.type] ?? o.type).join(", ")} ${started ? "started" : "queued. The Claude connector is not running on this PC; start it with npm run claude and they run"}.`
        : `${ACTION_LABEL[action]}: nothing to run yet.`;
      const why = skipped.map((o) => `${CHECK_LABEL[o.type] ?? o.type}: ${o.reason}`).join(" ");
      if (queued.length) toast.success(why ? `${said} Skipped: ${why}` : said); else toast.error(why ? `${said} ${why}` : said);
      void qc.invalidateQueries({ queryKey: ["jobs"] }); void qc.invalidateQueries({ queryKey: ["progress"] }); void qc.invalidateQueries({ queryKey: ["sow"] }); void qc.invalidateQueries({ queryKey: qk.connector });
      setPending(null);
    } catch (e) {
      toast.error(e, `Could not run ${ACTION_LABEL[action].toLowerCase()}`);
    } finally { setBusy(false); }
  }, [campaignId, qc, toast]);

  const dialog = (
    <ConfirmDialog open={Boolean(pending)} onOpenChange={(o) => !o && setPending(null)} title="Already checked"
      body={<>This exact content was already checked. Running it again uses Claude’s time and may produce duplicate findings. Run again anyway?</>}
      confirmLabel="Run again" loading={busy} onConfirm={() => pending && void run(pending.action, pending.source, true)} />
  );
  return { run, busy, dialog };
}

export function ReviewActionButton({ campaignId, action, source, label, ...props }: { campaignId: string; action: ReviewAction; source: Record<string, string>; label?: string } & Omit<ButtonProps, "onClick" | "type">) {
  const { run, busy, dialog } = useRunReviewAction(campaignId);
  return (<><Button loading={busy} onClick={() => void run(action, source)} {...props}><Play />{label ?? ACTION_LABEL[action]}</Button>{dialog}</>);
}
