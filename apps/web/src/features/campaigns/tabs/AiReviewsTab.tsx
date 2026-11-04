import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { Section } from "@/components/common";
import { FINDING_STATUS_LABEL, type FindingStatus } from "@/lib/labels";
import { reportsService } from "@/services/settings";
import type { CampaignWithRelations } from "@/services/campaigns";
import { JobsTable } from "@/features/shared/JobsTable";

export function AiReviewsTab({ campaign: c }: { campaign: CampaignWithRelations }) {
  const report = useQuery({ queryKey: ["report", c.id], queryFn: () => reportsService.campaign(c.id) });
  const byStatus = ((report.data?.findings_by_status ?? {}) as Record<FindingStatus, number>);
  const order: FindingStatus[] = ["awaiting_review", "accepted", "assigned", "in_progress", "ready_for_retest", "fixed", "verified", "reopened", "dismissed"];
  return (
    <>
      <Section title="Findings" actions={<Button asChild size="sm" variant="primary"><Link to={`/reviews?campaign=${c.id}`}><Inbox />Open Findings Inbox</Link></Button>}>
        <Card className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 [&>*]:border-line [&>*:not(:last-child)]:border-r">
          {order.map((s) => (
            <Link key={s} to={`/reviews?campaign=${c.id}&status=${s}`} className="px-3 py-2.5 hover:bg-hover">
              <p className="text-xs text-muted">{FINDING_STATUS_LABEL[s]}</p>
              <p className="text-lg font-semibold num">{byStatus[s] ?? 0}</p>
            </Link>
          ))}
        </Card>
        <p className="mt-2 text-xs text-muted">AI findings are suggestions. A manager accepts or dismisses each one; nothing is approved automatically.</p>
      </Section>
      <Section title="Review jobs"><JobsTable campaignId={c.id} /></Section>
    </>
  );
}
