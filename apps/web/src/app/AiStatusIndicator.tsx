import { Link } from "react-router-dom";
import { useConnectorStatus, useWorkerState } from "@/hooks/queries";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { KeyValue } from "@/components/common";
import { TONE_HEX } from "@/lib/labels";
import { timeAgo } from "@/lib/utils";

/** Top-bar AI status per DESIGN.md. Offline is muted grey — an expected state, not an error. */
export function AiStatusIndicator() {
  const { data, isLoading } = useWorkerState();
  const connector = useConnectorStatus().data;
  if (isLoading || !data) return null;
  const { state, worker, queued } = data;
  const label =
    connector ? (connector.busy ? "Claude analysing…" : `Claude connected${queued ? ` · ${queued} queued` : ""}`)
    : state === "not_set_up" ? "Not set up"
      : state === "offline" ? "AI offline · jobs will wait"
        : state === "busy" ? `AI busy${queued ? ` · ${queued} queued` : ""}`
          : `AI online${queued ? ` · ${queued} queued` : ""}`;
  const color = connector ? (connector.busy ? TONE_HEX.blue : TONE_HEX.green) : state === "online" ? TONE_HEX.green : state === "busy" ? TONE_HEX.blue : TONE_HEX.gray;
  const modelReady = worker?.model_ready;
  return (
    <Popover>
      <PopoverTrigger className="flex h-7 items-center gap-1.5 rounded-ctl px-2 text-xs text-text-2 hover:bg-hover">
        <span className="size-2 rounded-full" style={{ background: color }} />
        <span className="hidden sm:inline">{label}</span>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <p className="section-title mb-2">{connector ? "Claude connector" : "Local AI worker"}</p>
        {connector ? (
          <KeyValue items={[
            { label: "Status", value: connector.busy ? "Analysing a review" : "Connected, waiting for reviews" },
            { label: "Doing now", value: connector.job ? connector.job.step : "—" },
            { label: "Claude Code", value: <span className="font-mono text-xs">{connector.claude.version || "—"}</span> },
            { label: "Model", value: <span className="font-mono text-xs">{connector.model}</span> },
            { label: "Queue", value: `${queued} waiting` },
          ]} />
        ) : state === "not_set_up" ? (
          <p className="text-sm text-text-2">
            Nothing is connected yet. To use Claude on this PC, run <span className="font-mono text-xs">npm run claude</span> in the project folder. Reviews you start wait until it is running.
          </p>
        ) : (
          <KeyValue items={[
            { label: "Status", value: state === "offline" ? "Offline (no heartbeat for 2 min)" : state === "busy" ? "Busy" : "Online" },
            { label: "Last seen", value: timeAgo(worker?.last_seen_at) },
            { label: "Worker", value: worker?.worker_name },
            { label: "Model", value: <span className="font-mono text-xs">{worker?.model ?? "—"}</span> },
            { label: "Model ready", value: modelReady ? "Ready" : worker?.model_message || "Not ready" },
            { label: "Runs on", value: worker?.accelerator === "gpu" ? "GPU" : worker?.accelerator === "cpu" ? "CPU (slow)" : "Unknown" },
            { label: "Queue", value: `${queued} waiting` },
          ]} />
        )}
        <Link to="/reviews?view=queue" className="mt-3 block text-xs text-accent hover:underline">View review queue</Link>
      </PopoverContent>
    </Popover>
  );
}
