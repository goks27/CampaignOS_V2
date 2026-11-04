import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Link2, MoreHorizontal, Pencil, Route, Share2, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { qk, useCampaign } from "@/hooks/queries";
import { HEALTH_LABEL, HEALTH_TONE } from "@/lib/labels";
import { campaignPath } from "@/lib/nav";
import { Avatar, DemoBadge, Pill } from "@/components/common";
import { CampaignGlyph } from "@/components/brand";
import { useToast } from "@/components/toast";
import { Button, Drawer, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui";
import { developmentService } from "@/services/development";
import type { CampaignWithRelations } from "@/services/campaigns";
import { RunReviewButton } from "@/features/shared/RunReview";
import { CampaignFormDialog } from "./CampaignForm";
import { OverviewTab } from "./tabs/OverviewTab";
import { JourneysTab } from "./tabs/JourneysTab";

/** Team avatars, overlapping, with a +N for the rest. */
function Team({ c }: { c: CampaignWithRelations }) {
  const people = c.campaign_members;
  const shown = people.slice(0, 4);
  if (!people.length) return null;
  return (
    <div className="hidden items-center md:flex" aria-label={`${people.length} team member${people.length === 1 ? "" : "s"}`}>
      {shown.map((m, i) => <span key={m.id ?? i} className="-ml-1.5 rounded-full ring-2 ring-bg first:ml-0" title={m.profiles?.full_name ?? m.profiles?.email ?? ""}><Avatar name={m.profiles?.full_name ?? m.profiles?.email} size={26} /></span>)}
      {people.length > shown.length && <span className="-ml-1.5 flex size-[26px] items-center justify-center rounded-full bg-hover text-[11px] font-medium text-text-2 ring-2 ring-bg num">+{people.length - shown.length}</span>}
    </div>
  );
}

/** "Run tests" starts a Site check on the latest build. With no build yet it takes you to add one. */
function RunTests({ c }: { c: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const subs = useQuery({ queryKey: [...qk.dev(c.id), "subs"], queryFn: () => developmentService.submissions(c.id) });
  if (!canEdit) return null;
  const build = subs.data?.[0];
  return build
    ? <RunReviewButton size="sm" campaignId={c.id} reviewType="site_check" source={{ development_submission_id: build.id }} label="Run tests" />
    : <Button size="sm" onClick={() => navigate(campaignPath(c.id, "development"))}>Run tests</Button>;
}

/** The top bar inside a campaign: where you are, who is on it, and the actions that matter. */
export function CampaignBar({ id }: { id: string }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const { data: c } = useCampaign(id);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = React.useState(false);
  const panel = params.get("panel");
  const setPanel = (p: string | null) => setParams((cur) => { const n = new URLSearchParams(cur); if (p) n.set("panel", p); else n.delete("panel"); return n; }, { replace: true });

  const copy = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}${campaignPath(id)}`); toast.success("Link copied"); } catch { toast.error("Could not copy the link"); }
  };

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Link to="/projects" aria-label="Back to projects" className="rounded-ctl p-1 text-muted hover:bg-hover hover:text-text"><ChevronLeft className="size-4" /></Link>
        <Link to="/projects" className="hidden text-sm text-text-2 hover:text-text sm:inline">Projects</Link>
        <span className="hidden text-muted sm:inline">/</span>
        {c ? (
          <>
            <CampaignGlyph id={c.id} name={c.name} size={22} />
            <h1 className="truncate text-[15px] font-semibold">{c.name}</h1>
            {c.is_demo && <DemoBadge />}
            <span className="hidden lg:inline"><Pill tone={HEALTH_TONE[c.health]}>{HEALTH_LABEL[c.health]}</Pill></span>
          </>
        ) : <span className="h-4 w-32 animate-pulse rounded bg-hover" />}
      </div>
      {c && (
        <>
          <Team c={c} />
          <Button size="sm" className="hidden md:inline-flex" onClick={() => void copy()} title="Copy a link to this campaign"><Share2 />Share</Button>
          <span className="hidden md:contents"><RunTests c={c} /></span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More campaign actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[210px]">
              <DropdownMenuItem onSelect={() => setPanel("summary")}><SlidersHorizontal />Campaign summary</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPanel("journeys")}><Route />Manage journeys</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copy()}><Link2 />Copy link</DropdownMenuItem>
              {canEdit && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setEditing(true)}><Pencil />Edit campaign</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
          <Drawer open={panel === "summary"} onOpenChange={(o) => !o && setPanel(null)} width={720} title="Campaign summary" subtitle={c.name}><OverviewTab campaign={c} /></Drawer>
          <Drawer open={panel === "journeys"} onOpenChange={(o) => !o && setPanel(null)} width={720} title="Journeys" subtitle={c.name}><JourneysTab campaign={c} /></Drawer>
          {editing && <CampaignFormDialog open={editing} onOpenChange={setEditing} campaign={c} />}
        </>
      )}
    </>
  );
}
