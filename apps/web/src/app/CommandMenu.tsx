import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";
import { FlaskConical, Radio, FolderKanban, Inbox, ListChecks, Plus, Sparkles, Users, CalendarRange, BarChart3, Settings } from "lucide-react";
import { STEPS, STEP_LABEL, parseCampaignPath, campaignPath } from "@/lib/nav";
import { useLocation } from "react-router-dom";
import { useCampaigns } from "@/hooks/queries";
import { useAuth } from "@/lib/auth";

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const here = parseCampaignPath(useLocation().pathname);
  const { data: campaigns } = useCampaigns();
  const { isManager } = useAuth();
  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };
  const item = "flex cursor-pointer items-center gap-2 rounded-ctl px-2 py-1.5 text-sm text-text aria-selected:bg-hover [&_svg]:size-4 [&_svg]:text-muted";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/25" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-box border border-line bg-surface shadow-overlay">
          <DialogPrimitive.Title className="sr-only">Command menu</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search campaigns and jump to pages</DialogPrimitive.Description>
          <Command label="Command menu" loop>
            <Command.Input autoFocus placeholder="Search campaigns, pages and actions…"
              className="h-11 w-full border-b border-line bg-transparent px-3.5 text-sm outline-none placeholder:text-muted" />
            <Command.List className="max-h-[360px] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No results.</Command.Empty>
              {isManager && (
                <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted">
                  <Command.Item className={item} onSelect={() => go("/projects?new=1")}><Plus />New project</Command.Item>
                  <Command.Item className={item} onSelect={() => go("/tasks?new=1")}><Plus />New task</Command.Item>
                </Command.Group>
              )}
              {here && (
                <Command.Group heading="This campaign" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted">
                  {STEPS.map((s) => <Command.Item key={s} value={`campaign ${STEP_LABEL[s]}`} className={item} onSelect={() => go(campaignPath(here.id, s))}><FolderKanban />{STEP_LABEL[s]}</Command.Item>)}
                </Command.Group>
              )}
              <Command.Group heading="Projects" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted">
                {(campaigns ?? []).map((c) => (
                  <Command.Item key={c.id} value={`${c.name} ${c.clients?.name ?? ""}`} className={item} onSelect={() => go(`/campaigns/${c.id}`)}>
                    <FolderKanban />{c.name}<span className="ml-auto text-xs text-muted">{c.clients?.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted">
                <Command.Item className={item} onSelect={() => go("/inbox")}><Inbox />My Inbox</Command.Item>
                <Command.Item className={item} onSelect={() => go("/projects")}><FolderKanban />Projects</Command.Item>
                <Command.Item className={item} onSelect={() => go("/tasks")}><ListChecks />Tasks</Command.Item>
                <Command.Item className={item} onSelect={() => go("/playground")}><FlaskConical />Playground</Command.Item>
                <Command.Item className={item} onSelect={() => go("/live-test")}><Radio />Live test</Command.Item>
                <Command.Item className={item} onSelect={() => go("/reviews")}><Sparkles />Findings Inbox</Command.Item>
                <Command.Item className={item} onSelect={() => go("/team")}><Users />Team</Command.Item>
                <Command.Item className={item} onSelect={() => go("/timeline")}><CalendarRange />Timeline</Command.Item>
                <Command.Item className={item} onSelect={() => go("/reports")}><BarChart3 />Reports</Command.Item>
                <Command.Item className={item} onSelect={() => go("/settings")}><Settings />Settings</Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
