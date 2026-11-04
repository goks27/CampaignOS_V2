import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui";
import { ErrorState, LoadingRows } from "@/components/common";
import { activityService } from "@/services/activity";
import { qk } from "@/hooks/queries";
import type { CampaignWithRelations } from "@/services/campaigns";
import { ActivityFeed } from "@/features/shared/activity";

export function ActivityTab({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: qk.activity(c.id), queryFn: () => activityService.list({ campaignId: c.id, limit: 200 }) });
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  return (
    <>
      <p className="mb-3 text-sm text-muted">Every change on this campaign, newest first. The log is append-only.</p>
      <Card>{isLoading ? <LoadingRows /> : <ActivityFeed items={data ?? []} showCampaign={false} />}</Card>
    </>
  );
}
