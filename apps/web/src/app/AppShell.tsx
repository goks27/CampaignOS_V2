import * as React from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutGrid, FolderKanban, ListChecks, Sparkles, Users, CalendarRange, BarChart3, Settings, Search, Moon, Sun,
  Bell, ChevronDown, LogOut, ChevronRight, Upload, Sparkles as SparklesIcon,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { useCampaigns, useNotifications, useRealtimeBridge, qk } from "@/hooks/queries";
import { ErrorBoundary } from "./ErrorBoundary";
import { notificationsService } from "@/services/activity";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, DemoBadge } from "@/components/common";
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  Kbd, Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui";
import { CommandMenu } from "./CommandMenu";
import { AiStatusIndicator } from "./AiStatusIndicator";
import { AssistantPanel } from "@/features/assistant/AssistantPanel";
import { useTheme } from "./theme";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, end: true },
  { to: "/campaigns", label: "Campaigns", icon: FolderKanban },
  { to: "/tasks", label: "Tasks & Feedback", icon: ListChecks },
  { to: "/reviews", label: "AI Reviews", icon: Sparkles },
  { to: "/team", label: "Team", icon: Users },
  { to: "/timeline", label: "Timeline", icon: CalendarRange },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const [mobileNav, setMobileNav] = React.useState(false);
  const [assistantOpen, setAssistantOpen] = React.useState(false);
  const loc = useLocation();
  useRealtimeBridge();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAssistantOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  React.useEffect(() => setMobileNav(false), [loc.pathname]);

  return (
    <div className="flex h-full">
      <aside className={cn("fixed inset-y-0 left-0 z-30 w-[232px] shrink-0 border-r border-line bg-side transition-transform lg:static lg:translate-x-0",
        mobileNav ? "translate-x-0" : "-translate-x-full")}>
        <Sidebar onSearch={() => setCmdOpen(true)} />
      </aside>
      {mobileNav && <div className="fixed inset-0 z-20 bg-black/20 lg:hidden" onClick={() => setMobileNav(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileNav(true)} onAssistant={() => setAssistantOpen((o) => !o)} assistantOpen={assistantOpen} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-content px-4 py-[22px] sm:px-6">
            <ErrorBoundary resetKey={loc.pathname}><Outlet /></ErrorBoundary>
          </div>
        </main>
      </div>
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  );
}

function Sidebar({ onSearch }: { onSearch: () => void }) {
  const { me, signOut, isManager } = useAuth();
  const { data: campaigns } = useCampaigns();
  const mine = (campaigns ?? []).filter((c) => c.status === "active" && c.campaign_members.some((m) => m.user_id === me?.id)).slice(0, 8);
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col">
      <div className="px-2.5 pt-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-item px-2 py-1.5 text-left hover:bg-hover">
            <span className="flex size-6 items-center justify-center rounded-ctl bg-accent text-xs font-semibold text-white">C</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{me?.workspaceName ?? "CampaignOS"}</span>
            </span>
            <ChevronDown className="size-3.5 text-muted" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[212px]">
            <DropdownMenuLabel>Workspace</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => navigate("/settings")}><Settings />Workspace settings</DropdownMenuItem>
            {isManager && <DropdownMenuItem onSelect={() => navigate("/import")}><Upload />Import from Notion</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}><LogOut />Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button onClick={onSearch} className="mt-1.5 flex h-8 w-full items-center gap-2 rounded-ctl border border-line bg-surface px-2 text-sm text-muted hover:border-line-strong">
          <Search className="size-4" /> <span className="flex-1 text-left">Search</span> <Kbd>⌘K</Kbd>
        </button>
      </div>
      <nav className="mt-3 flex flex-col gap-px px-2.5">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => cn("flex items-center gap-2.5 rounded-item px-2 py-1.5 text-sm text-text-2 hover:bg-hover hover:text-text",
              isActive && "bg-active font-medium text-text")}>
            <n.icon className="size-4" /> {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-2.5">
        <p className="px-2 pb-1 text-xs text-muted">Your campaigns</p>
        {mine.length === 0 && <p className="px-2 text-xs text-muted">Campaigns you are assigned to appear here.</p>}
        {mine.map((c) => (
          <NavLink key={c.id} to={`/campaigns/${c.id}`}
            className={({ isActive }) => cn("flex items-center gap-2 truncate rounded-item px-2 py-1.5 text-sm text-text-2 hover:bg-hover hover:text-text", isActive && "bg-active text-text")}>
            <span className="size-1.5 shrink-0 rounded-full bg-accent" />
            <span className="truncate">{c.name}</span>
          </NavLink>
        ))}
      </div>
      <div className="border-t border-line p-2.5">
        <div className="flex items-center gap-2 px-2 py-1">
          <Avatar name={me?.fullName} size={22} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{me?.fullName}</p>
            <p className="truncate text-xs text-muted">{me?.role ? ROLE_LABEL[me.role] : ""}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function useBreadcrumbs() {
  const loc = useLocation();
  const { data: campaigns } = useCampaigns();
  const parts = loc.pathname.split("/").filter(Boolean);
  const crumbs: { label: string; to?: string }[] = [];
  const top = NAV.find((n) => n.to !== "/" && n.to === `/${parts[0]}`);
  if (!parts.length) crumbs.push({ label: "Dashboard" });
  else if (parts[0] === "import") crumbs.push({ label: "Campaigns", to: "/campaigns" }, { label: "Import from Notion" });
  else if (top) crumbs.push({ label: top.label, to: parts.length > 1 ? top.to : undefined });
  let demo = false;
  if (parts[0] === "campaigns" && parts[1]) {
    const c = campaigns?.find((x) => x.id === parts[1]);
    demo = Boolean(c?.is_demo);
    crumbs.push({ label: c?.name ?? "Campaign", to: parts[2] ? `/campaigns/${parts[1]}` : undefined });
    if (parts[2]) crumbs.push({ label: parts[2].charAt(0).toUpperCase() + parts[2].slice(1).replace("-", " ") });
  }
  if (!parts.length || parts[0] === "campaigns" && !parts[1]) demo = Boolean(campaigns?.some((c) => c.is_demo));
  return { crumbs, demo };
}

function TopBar({ onMenu, onAssistant, assistantOpen }: { onMenu: () => void; onAssistant: () => void; assistantOpen: boolean }) {
  const { crumbs, demo } = useBreadcrumbs();
  const { theme, toggle } = useTheme();
  return (
    <header className="flex h-[46px] shrink-0 items-center gap-2 border-b border-line bg-bg px-4">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <LayoutGrid />
      </Button>
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted" />}
            {c.to ? <Link to={c.to} className="truncate text-text-2 hover:text-text">{c.label}</Link>
              : <span className="truncate font-medium text-text">{c.label}</span>}
          </React.Fragment>
        ))}
        {demo && <span className="ml-2"><DemoBadge /></span>}
      </nav>
      <AiStatusIndicator />
      <Button variant={assistantOpen ? "secondary" : "ghost"} size="sm" onClick={onAssistant} aria-label="Ask Claude" aria-pressed={assistantOpen} title="Ask Claude (Ctrl+J)">
        <SparklesIcon />Ask Claude
      </Button>
      <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
        {theme === "dark" ? <Sun /> : <Moon />}
      </Button>
      <NotificationsButton />
    </header>
  );
}

function NotificationsButton() {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const unread = (data ?? []).filter((n) => !n.read_at);
  const markAll = async () => {
    await notificationsService.markRead(unread.map((n) => n.id));
    void qc.invalidateQueries({ queryKey: qk.notifications });
  };
  const open = async (n: NonNullable<typeof data>[number]) => {
    if (!n.read_at) {
      await notificationsService.markRead([n.id]);
      void qc.invalidateQueries({ queryKey: qk.notifications });
    }
    if (n.entity_type === "task") navigate(`/tasks?task=${n.entity_id}`);
    else if (n.entity_type === "review_job") navigate(n.kind.includes("sow") || n.title.startsWith("SOW") ? `/campaigns/${n.campaign_id}/requirements` : `/reviews?campaign=${n.campaign_id}`);
    else if (n.campaign_id) navigate(`/campaigns/${n.campaign_id}`);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ""}`} className="relative">
          <Bell />
          {unread.length > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-accent" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="section-title">Notifications</span>
          {unread.length > 0 && <Button variant="link" size="sm" onClick={markAll}>Mark all read</Button>}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {(data ?? []).length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No notifications yet. Task assignments and finished reviews show up here.</p>}
          {(data ?? []).map((n) => (
            <button key={n.id} onClick={() => void open(n)} className="flex w-full items-start gap-2 border-b border-line px-3 py-2 text-left last:border-0 hover:bg-hover">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
              <span className="flex-1 text-sm">{n.title}</span>
              <span className="text-xs text-muted whitespace-nowrap">{timeAgo(n.created_at)}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
