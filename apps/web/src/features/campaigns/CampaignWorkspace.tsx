import * as React from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { Activity, AlertCircle, Code2, FlaskConical, ImagePlus, ListChecks, ScanSearch, Workflow } from "lucide-react";
import { useCampaign } from "@/hooks/queries";
import { ErrorState, LoadingRows, Section } from "@/components/common";
import { cn } from "@/lib/utils";
import { campaignPath, resolveSection, SECTIONS, SECTION_LABEL, type Section as SectionId } from "@/lib/nav";
import type { CampaignWithRelations } from "@/services/campaigns";
import { CampaignCanvas } from "@/features/canvas/CanvasHome";
import { RequirementsTab } from "./tabs/RequirementsTab";
import { DesignsTab } from "./tabs/DesignsTab";
import { DevelopmentTab } from "./tabs/DevelopmentTab";
import { AiReviewsTab } from "./tabs/AiReviewsTab";
import { ApprovalsTab } from "./tabs/ApprovalsTab";
import { DocumentsTab } from "./tabs/DocumentsTab";
import { CampaignTasksTab } from "./tabs/CampaignTasksTab";
import { ActivityTab } from "./tabs/ActivityTab";

const ICON: Record<SectionId, React.ComponentType<{ className?: string }>> = {
  canvas: Workflow, requirements: ListChecks, designs: ImagePlus, review: ScanSearch, development: Code2, testing: FlaskConical, issues: AlertCircle, activity: Activity,
};

/** The campaign's sections, as one row under the top bar. The canvas is the home; everything else is one click away. */
export function SectionTabs({ id, current }: { id: string; current: SectionId }) {
  const { search } = useLocation();
  return (
    <nav aria-label="Campaign sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-bg px-3 sm:px-4">
      {SECTIONS.map((s) => {
        const Icon = ICON[s];
        const on = s === current;
        return (
          <Link key={s} to={{ pathname: campaignPath(id, s), search: s === "canvas" ? search : "" }} aria-current={on ? "page" : undefined}
            className={cn("relative flex h-11 shrink-0 items-center gap-1.5 px-3 text-sm text-text-2 hover:text-text", on && "font-medium text-text")}>
            <Icon className={cn("size-4", on ? "text-accent" : "text-muted")} />{SECTION_LABEL[s]}
            {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </Link>
        );
      })}
    </nav>
  );
}

function Body({ c, section }: { c: CampaignWithRelations; section: SectionId }) {
  switch (section) {
    case "requirements": return <><RequirementsTab campaign={c} /><Section title="Documents"><DocumentsTab campaign={c} /></Section></>;
    case "designs": return <DesignsTab campaign={c} />;
    case "review": return <><AiReviewsTab campaign={c} /><Section title="Approvals"><ApprovalsTab campaign={c} /></Section></>;
    case "development": return <DevelopmentTab campaign={c} part="build" />;
    case "testing": return <DevelopmentTab campaign={c} part="testing" />;
    case "issues": return <CampaignTasksTab campaign={c} />;
    case "activity": return <ActivityTab campaign={c} />;
    default: return null;
  }
}

export function CampaignWorkspace() {
  const { id, tab } = useParams();
  const { search } = useLocation();
  const { data: c, isLoading, error, refetch } = useCampaign(id);
  const { section, redirect } = resolveSection(tab);

  // Old addresses (…/overview, …/ai-reviews, …) keep working: they land on the section that holds that content now.
  if (redirect && id) return <Navigate to={{ pathname: campaignPath(id, section), search }} replace />;
  if (!id) return null;

  return (
    <>
      <SectionTabs id={id} current={section} />
      {error ? <div className="p-6"><ErrorState error={error} onRetry={() => void refetch()} /></div>
        : isLoading || !c ? <div className="p-6"><LoadingRows rows={8} /></div>
        : section === "canvas" ? <div className="flex min-h-0 flex-1 flex-col"><CampaignCanvas campaign={c} /></div>
        : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-content px-4 py-5 sm:px-6"><div key={section} className="page-enter"><Body c={c} section={section} /></div></div>
          </div>
        )}
    </>
  );
}
