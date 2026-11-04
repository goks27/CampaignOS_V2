import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Menu, Moon, Sparkles as SparklesIcon, Sun } from "lucide-react";
import { parseCampaignPath } from "@/lib/nav";
import { useCampaigns } from "@/hooks/queries";
import { DemoBadge } from "@/components/common";
import { Button } from "@/components/ui";
import { CampaignBar } from "@/features/campaigns/CampaignBar";
import { AiStatusIndicator } from "./AiStatusIndicator";
import { NotificationsButton } from "./Notifications";
import { useTheme } from "./theme";

const TITLES: Record<string, string> = {
  "": "Home", inbox: "My Inbox", tasks: "Tasks", projects: "Projects", campaigns: "Projects", playground: "Playground", team: "Team", settings: "Settings",
  timeline: "Timeline", reports: "Reports", import: "Import from Notion", reviews: "Findings Inbox",
};

function PageCrumbs() {
  const loc = useLocation();
  const { data: campaigns } = useCampaigns();
  const top = loc.pathname.split("/").filter(Boolean)[0] ?? "";
  const label = TITLES[top] ?? "Journ";
  const demo = (top === "" || top === "projects" || top === "campaigns") && Boolean(campaigns?.some((c) => c.is_demo));
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
      {top === "import" && <><Link to="/projects" className="text-text-2 hover:text-text">Projects</Link><ChevronRight className="size-3.5 shrink-0 text-muted" /></>}
      <span className="truncate font-medium text-text">{label}</span>
      {demo && <span className="ml-2"><DemoBadge /></span>}
    </nav>
  );
}

/** One bar for the whole app. Inside a campaign its left side becomes the campaign bar (name, team, Share, Run tests). */
export function TopBar({ onMenu, onAssistant, assistantOpen }: { onMenu: () => void; onAssistant: () => void; assistantOpen: boolean }) {
  const loc = useLocation();
  const { theme, toggle } = useTheme();
  const camp = parseCampaignPath(loc.pathname);
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-bg px-3 sm:px-4">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu /></Button>
      {camp ? <CampaignBar id={camp.id} /> : <PageCrumbs />}
      <span className="hidden xl:block"><AiStatusIndicator /></span>
      <Button variant={assistantOpen ? "secondary" : "ghost"} size="sm" onClick={onAssistant} aria-label="Ask Claude" aria-pressed={assistantOpen} title="Ask Claude (Ctrl+J)">
        <SparklesIcon /><span className="hidden lg:inline">Ask Claude</span>
      </Button>
      <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
        {theme === "dark" ? <Sun /> : <Moon />}
      </Button>
      <NotificationsButton />
    </header>
  );
}
