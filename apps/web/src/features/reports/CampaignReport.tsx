import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui";
import { KeyValue, Pill, StageRing, StatusDot } from "@/components/common";
import {
  FINDING_STATUS_LABEL, HEALTH_LABEL, HEALTH_TONE, REQ_STATUS_LABEL, SEVERITIES, SEVERITY_LABEL, TASK_STATUS_LABEL,
  TRACK_LABEL, VERIFICATION_LABEL, VERIFICATION_TONE, DECISION_LABEL, DEPLOYMENT_STATUS_LABEL,
  type FindingStatus, type RequirementStatus, type TaskStatus, type VerificationState,
} from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import { reportsService } from "@/services/settings";
import { deliveryService } from "@/services/delivery";
import type { CampaignWithRelations } from "@/services/campaigns";

type Report = {
  requirements: Record<string, number>; findings_by_severity: Record<string, number>; findings_by_status: Record<string, number>;
  tasks: Record<string, number>; overdue_tasks: number; compliance: Record<string, number>; accepted_requirements: number; reviews: Record<string, number>;
};

function Counts<T extends string>({ title, data, labels, order }: { title: string; data?: Record<string, number>; labels: Record<T, string>; order?: T[] }) {
  const keys = (order ?? (Object.keys(labels) as T[])).filter((k) => (data?.[k] ?? 0) > 0);
  return (
    <Card className="p-3">
      <p className="label mb-2">{title}</p>
      {!keys.length ? <p className="text-sm text-muted">None</p> : (
        <ul className="space-y-1 text-sm">{keys.map((k) => <li key={k} className="flex justify-between"><span className="text-text-2">{labels[k]}</span><span className="num">{data![k]}</span></li>)}</ul>
      )}
    </Card>
  );
}

export function CampaignReport({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { data: r } = useQuery({ queryKey: ["report", c.id], queryFn: () => reportsService.campaign(c.id) }) as { data?: Report };
  const approvals = useQuery({ queryKey: ["delivery", "approvals", c.id], queryFn: () => deliveryService.approvals(c.id) });
  const deployments = useQuery({ queryKey: ["delivery", "deployments", c.id], queryFn: () => deliveryService.deployments(c.id) });
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-lg font-semibold">{c.name}</h3>
        <p className="mb-3 text-sm text-muted">{c.clients?.name} · report generated {formatDate(new Date().toISOString())}</p>
        <KeyValue items={[
          { label: "Stage", value: <StageRing stage={c.stage} /> },
          { label: "Health", value: <Pill tone={HEALTH_TONE[c.health]}>{HEALTH_LABEL[c.health]}</Pill> },
          { label: "Target launch", value: formatDate(c.target_launch_date) },
          { label: "Tracks", value: `Design ${TRACK_LABEL[c.design_status]} · Development ${TRACK_LABEL[c.development_status]} · QA ${TRACK_LABEL[c.qa_status]} · UAT ${TRACK_LABEL[c.uat_status]}` },
          { label: "Journeys", value: c.journeys.map((j) => j.name).join(", ") || "—" },
          { label: "Production URL", value: c.production_url ?? "—" },
        ]} />
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Counts title="Requirements" data={r?.requirements} labels={REQ_STATUS_LABEL as Record<RequirementStatus, string>} />
        <Counts title="Findings by severity (excl. dismissed)" data={r?.findings_by_severity} labels={SEVERITY_LABEL} order={SEVERITIES} />
        <Counts title="Findings by status" data={r?.findings_by_status} labels={FINDING_STATUS_LABEL as Record<FindingStatus, string>} />
        <Counts title="Tasks" data={r?.tasks} labels={TASK_STATUS_LABEL as Record<TaskStatus, string>} />
      </div>
      <Card className="p-3">
        <p className="label mb-2">SOW compliance (latest check per requirement)</p>
        <div className="flex flex-wrap gap-4">
          {(Object.keys(VERIFICATION_LABEL) as VerificationState[]).map((k) => (
            <StatusDot key={k} tone={VERIFICATION_TONE[k]} label={<>{VERIFICATION_LABEL[k]} <span className="num text-text">{r?.compliance?.[k] ?? 0}</span></>} />
          ))}
          <span className="text-sm text-muted">of {r?.accepted_requirements ?? 0} accepted requirements</span>
        </div>
        <p className="mt-2 text-xs text-muted">A screenshot never proves a backend rule; backend rules stay “Needs verification” until tested.</p>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <p className="label border-b border-line px-3 py-2">Approvals</p>
          <ul className="divide-y divide-line text-sm">
            {(approvals.data ?? []).map((a) => <li key={a.id} className="flex justify-between px-3 py-2"><span>{a.subject_label} · {a.approver}</span><span className="text-text-2">{DECISION_LABEL[a.decision]} · {formatDate(a.decided_on, true)}</span></li>)}
            {!approvals.data?.length && <li className="px-3 py-3 text-muted">None recorded</li>}
          </ul>
        </Card>
        <Card>
          <p className="label border-b border-line px-3 py-2">Deployments</p>
          <ul className="divide-y divide-line text-sm">
            {(deployments.data ?? []).map((d) => <li key={d.id} className="flex justify-between gap-2 px-3 py-2"><span className="truncate font-mono text-xs">{d.url}</span><span className="text-text-2 whitespace-nowrap">{DEPLOYMENT_STATUS_LABEL[d.status]}</span></li>)}
            {!deployments.data?.length && <li className="px-3 py-3 text-muted">None tracked</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
