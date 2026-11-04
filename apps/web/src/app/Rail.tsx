import * as React from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { ChevronDown, FlaskConical, Home, Inbox, ListChecks, LogOut, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Users, CalendarRange, BarChart3, Upload, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { useCampaigns } from "@/hooks/queries";
import { Avatar } from "@/components/common";
import { CampaignGlyph, Wordmark } from "@/components/brand";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Kbd } from "@/components/ui";
import { continueList } from "@/features/home/model";
import { useInboxCount } from "@/features/inbox/useInbox";

/** The global left rail: where you are in Journ, and your campaigns. It does not change inside a campaign. */
export function Rail({ onSearch, collapsed, onToggle, recent }: { onSearch: () => void; collapsed: boolean; onToggle: () => void; recent: string[] }) {
  const { me, signOut, isManager } = useAuth();
  const { data: campaigns } = useCampaigns();
  const inbox = useInboxCount();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(true);
  const workspaces = continueList((campaigns ?? []).filter((c) => c.status === "active"), recent, 12);

  const item = ({ isActive }: { isActive: boolean }) => cn("group relative flex items-center gap-2.5 rounded-item px-2 py-1.5 text-sm text-text-2 hover:bg-hover hover:text-text", collapsed && "justify-center", isActive && "bg-active font-medium text-text");
  const NAV = [
    { to: "/", label: "Home", icon: Home, end: true }, { to: "/inbox", label: "My Inbox", icon: Inbox, badge: inbox },
    { to: "/tasks", label: "Tasks", icon: ListChecks }, { to: "/projects", label: "Projects", icon: FolderKanban },
    { to: "/playground", label: "Playground", icon: FlaskConical },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-[52px] items-center px-3", collapsed ? "justify-center" : "justify-between")}>
        <Link to="/" aria-label="Journ home"><Wordmark size={collapsed ? 22 : 24} markOnly={collapsed} /></Link>
        {!collapsed && <button onClick={onToggle} aria-label="Collapse the sidebar" title="Collapse the sidebar" className="rounded-ctl p-1 text-muted hover:bg-hover hover:text-text"><PanelLeftClose className="size-4" /></button>}
      </div>
      {collapsed && <button onClick={onToggle} aria-label="Expand the sidebar" title="Expand the sidebar" className="mx-auto mb-1 rounded-ctl p-1 text-muted hover:bg-hover hover:text-text"><PanelLeftOpen className="size-4" /></button>}

      <div className="px-2.5">
        <button onClick={onSearch} title="Search (Ctrl+K)" className={cn("flex h-8 w-full items-center gap-2 rounded-ctl border border-line bg-surface px-2 text-sm text-muted hover:border-line-strong", collapsed && "justify-center px-0")}>
          <Search className="size-4" />{!collapsed && <><span className="flex-1 text-left">Search</span><Kbd>⌘K</Kbd></>}
        </button>
      </div>

      <nav className="mt-3 flex flex-col gap-px px-2.5" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={item} title={collapsed ? n.label : undefined}>
            <n.icon className="size-4 shrink-0" />
            {!collapsed && <span className="flex-1">{n.label}</span>}
            {n.badge ? <span className={cn("rounded-full bg-accent px-1.5 text-[11px] font-semibold text-[rgb(var(--on-accent))] num", collapsed && "absolute right-1 top-0.5 px-1 text-[10px]")}>{n.badge > 99 ? "99+" : n.badge}</span> : null}
          </NavLink>
        ))}
      </nav>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-2.5">
        {!collapsed && (
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted hover:text-text-2">
            Workspaces <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
          </button>
        )}
        {(open || collapsed) && (
          <div className="flex flex-col gap-px">
            {workspaces.length === 0 && !collapsed && <p className="px-2 text-xs text-muted">Campaigns you work on appear here.</p>}
            {workspaces.map((c) => (
              <NavLink key={c.id} to={`/campaigns/${c.id}`} className={item} title={collapsed ? c.name : undefined}>
                <CampaignGlyph id={c.id} name={c.name} size={20} />
                {!collapsed && <span className="truncate">{c.name}</span>}
              </NavLink>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5 border-t border-line p-2.5">
        {isManager && (
          <button onClick={() => navigate("/projects?new=1")} title="New project" className={cn("flex h-8 w-full items-center gap-2 rounded-ctl bg-hover px-2 text-sm text-text-2 hover:bg-active hover:text-text", collapsed && "justify-center px-0")}>
            <Plus className="size-4" />{!collapsed && "New Project"}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger className={cn("flex w-full items-center gap-2 rounded-item px-1.5 py-1 text-left hover:bg-hover", collapsed && "justify-center")} aria-label="Account menu">
            <Avatar name={me?.fullName} size={26} />
            {!collapsed && <><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{me?.fullName}</span><span className="block truncate text-xs text-muted">{me?.role ? ROLE_LABEL[me.role] : ""}</span></span><ChevronDown className="size-3.5 text-muted" /></>}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[220px]">
            <DropdownMenuLabel>{me?.workspaceName ?? "Workspace"}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => navigate("/team")}><Users />Team</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/timeline")}><CalendarRange />Timeline</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/reports")}><BarChart3 />Reports</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/settings")}><Settings />Settings</DropdownMenuItem>
            {isManager && <DropdownMenuItem onSelect={() => navigate("/import")}><Upload />Import from Notion</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}><LogOut />Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
