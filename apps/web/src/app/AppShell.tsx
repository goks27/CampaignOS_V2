import * as React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { parseCampaignPath, pushRecent, readRecent, writeRecent } from "@/lib/nav";
import { useRealtimeBridge } from "@/hooks/queries";
import { ErrorBoundary } from "./ErrorBoundary";
import { CommandMenu } from "./CommandMenu";
import { Rail } from "./Rail";
import { TopBar } from "./TopBar";
import { AssistantPanel } from "@/features/assistant/AssistantPanel";
import { LiveView } from "@/features/live/LiveView";

const COLLAPSE_KEY = "campaignos-rail-collapsed";
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } };

export function AppShell() {
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const [mobileNav, setMobileNav] = React.useState(false);
  const [assistantOpen, setAssistantOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(readCollapsed);
  const [recent, setRecent] = React.useState<string[]>(readRecent);
  const loc = useLocation();
  const camp = parseCampaignPath(loc.pathname);
  useRealtimeBridge();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen((o) => !o); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setAssistantOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  React.useEffect(() => setMobileNav(false), [loc.pathname]);

  // The campaigns you open are remembered, per browser, to fill "Continue" on Home and to order the rail.
  const campId = camp?.id;
  React.useEffect(() => {
    if (!campId) return;
    setRecent((cur) => { const next = pushRecent(cur, campId); writeRecent(next); return next; });
  }, [campId]);

  const toggle = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem(COLLAPSE_KEY, n ? "1" : "0"); } catch { /* a convenience only */ } return n; });

  return (
    <div className="flex h-full">
      <aside className={cn("fixed inset-y-0 left-0 z-30 shrink-0 border-r border-line bg-side transition-[width,transform] lg:static lg:translate-x-0",
        mobileNav ? "w-[240px] translate-x-0" : cn("-translate-x-full lg:translate-x-0", collapsed ? "lg:w-[60px]" : "lg:w-[240px]"))}>
        <Rail onSearch={() => setCmdOpen(true)} collapsed={collapsed && !mobileNav} onToggle={toggle} recent={recent} />
      </aside>
      {mobileNav && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setMobileNav(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileNav(true)} onAssistant={() => setAssistantOpen((o) => !o)} assistantOpen={assistantOpen} />
        {camp ? (
          // A campaign is a workspace, not a page: it fills the window and manages its own scrolling.
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden"><ErrorBoundary resetKey={loc.pathname}><Outlet /></ErrorBoundary></main>
        ) : (
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-content px-4 py-[22px] sm:px-6">
              <div key={loc.pathname.split("/").slice(0, 2).join("/")} className="page-enter"><ErrorBoundary resetKey={loc.pathname}><Outlet /></ErrorBoundary></div>
            </div>
          </main>
        )}
      </div>
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
      <LiveView />
    </div>
  );
}
