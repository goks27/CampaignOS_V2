import type { CampaignWithRelations } from "@/services/campaigns";
import { TaskList } from "@/features/tasks/TaskList";

export function CampaignTasksTab({ campaign: c }: { campaign: CampaignWithRelations }) {
  return <TaskList campaignId={c.id} />;
}
