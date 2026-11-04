import { useNavigate, useParams } from "react-router-dom";
import * as React from "react";
import { Pencil } from "lucide-react";
import { useCampaign } from "@/hooks/queries";
import { useAuth } from "@/lib/auth";
import { Button, Tabs } from "@/components/ui";
import { DemoBadge, ErrorState, LoadingRows, Pill, StageRing } from "@/components/common";
import { HEALTH_LABEL, HEALTH_TONE } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import { CampaignFormDialog } from "./CampaignForm";
import { OverviewTab } from "./tabs/OverviewTab";
import { RequirementsTab } from "./tabs/RequirementsTab";
import { JourneysTab } from "./tabs/JourneysTab";
import { DesignsTab } from "./tabs/DesignsTab";
import { DevelopmentTab } from "./tabs/DevelopmentTab";
import { AiReviewsTab } from "./tabs/AiReviewsTab";
import { CampaignTasksTab } from "./tabs/CampaignTasksTab";
import { ApprovalsTab } from "./tabs/ApprovalsTab";
import { DocumentsTab } from "./tabs/DocumentsTab";
import { ActivityTab } from "./tabs/ActivityTab";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "requirements", label: "Requirements" },
  { value: "journeys", label: "Journeys" },
  { value: "designs", label: "Designs" },
  { value: "development", label: "Development" },
  { value: "ai-reviews", label: "AI Reviews" },
  { value: "tasks", label: "Tasks" },
  { value: "approvals", label: "Approvals" },
  { value: "documents", label: "Documents" },
  { value: "activity", label: "Activity" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export function CampaignWorkspace() {
  const { id, tab } = useParams();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const { data: c, isLoading, error, refetch } = useCampaign(id);
  const [editing, setEditing] = React.useState(false);
  const current = (TABS.some((t) => t.value === tab) ? tab : "overview") as Tab;

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isLoading || !c) return <LoadingRows rows={8} />;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold">{c.name}</h1>
            {c.is_demo && <DemoBadge />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-2">
            <span>{c.clients?.name ?? "No client"}</span>
            <StageRing stage={c.stage} />
            <Pill tone={HEALTH_TONE[c.health]}>{HEALTH_LABEL[c.health]}</Pill>
            <span className="num">Launch {formatDate(c.target_launch_date)}</span>
          </div>
        </div>
        {canEdit && <Button onClick={() => setEditing(true)}><Pencil />Edit campaign</Button>}
      </div>
      <Tabs className="mb-5" value={current} onChange={(v) => navigate(`/campaigns/${c.id}/${v}`, { replace: true })} tabs={[...TABS]} />
      {current === "overview" && <OverviewTab campaign={c} />}
      {current === "requirements" && <RequirementsTab campaign={c} />}
      {current === "journeys" && <JourneysTab campaign={c} />}
      {current === "designs" && <DesignsTab campaign={c} />}
      {current === "development" && <DevelopmentTab campaign={c} />}
      {current === "ai-reviews" && <AiReviewsTab campaign={c} />}
      {current === "tasks" && <CampaignTasksTab campaign={c} />}
      {current === "approvals" && <ApprovalsTab campaign={c} />}
      {current === "documents" && <DocumentsTab campaign={c} />}
      {current === "activity" && <ActivityTab campaign={c} />}
      {editing && <CampaignFormDialog open={editing} onOpenChange={setEditing} campaign={c} />}
    </>
  );
}
