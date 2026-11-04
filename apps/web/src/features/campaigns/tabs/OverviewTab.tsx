import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Card, Input, Select } from "@/components/ui";
import { Avatar, KeyValue, Section, StatusDot, ConfirmDialog } from "@/components/common";
import {
  CAMPAIGN_ROLE_LABEL, HEALTH_LABEL, STAGES, STAGE_LABEL, TRACK_LABEL, TRACK_TONE, options, type CampaignRole, type TrackStatus,
} from "@/lib/labels";
import { cn, formatDate, isOverdue } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { usePeople, useProfiles, qk } from "@/hooks/queries";
import { useAction } from "@/hooks/useAction";
import { campaignMembersService, campaignsService, type CampaignWithRelations } from "@/services/campaigns";
import { reportsService } from "@/services/settings";
import { deliveryService } from "@/services/delivery";

export function OverviewTab({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const report = useQuery({ queryKey: ["report", c.id], queryFn: () => reportsService.campaign(c.id) });
  const r = report.data as Record<string, Record<string, number>> & { overdue_tasks?: number; accepted_requirements?: number } | undefined;
  const sum = (o?: Record<string, number>, keys?: string[]) => Object.entries(o ?? {}).filter(([k]) => !keys || keys.includes(k)).reduce((a, [, v]) => a + v, 0);
  const invalidate = [qk.campaign(c.id), qk.campaigns, qk.summary];
  const update = useAction((patch: Parameters<typeof campaignsService.update>[1]) => campaignsService.update(c.id, patch), { invalidate, error: "Could not update" });

  const metrics = [
    { label: "Accepted requirements", value: r?.accepted_requirements ?? 0, to: "requirements" },
    { label: "Drafts to verify", value: r?.requirements?.draft ?? 0, to: "requirements" },
    { label: "Open findings", value: sum(r?.findings_by_status, ["new", "awaiting_review", "accepted", "assigned", "in_progress", "ready_for_retest", "reopened"]), to: "ai-reviews" },
    { label: "Open tasks", value: sum(r?.tasks, ["todo", "in_progress", "ready_for_review", "blocked"]), to: "tasks" },
    { label: "Overdue tasks", value: r?.overdue_tasks ?? 0, to: "tasks" },
  ];

  const track = (key: "design_status" | "development_status" | "qa_status" | "uat_status", label: string) => ({
    label,
    value: canEdit ? (
      <Select aria-label={label} className="h-7 w-48" value={c[key]} options={options(TRACK_LABEL)}
        onChange={(e) => update.mutate({ [key]: e.target.value as TrackStatus })} />
    ) : <StatusDot tone={TRACK_TONE[c[key]]} label={TRACK_LABEL[c[key]]} />,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        <Card className="mb-6 grid grid-cols-2 sm:grid-cols-5 [&>*:not(:last-child)]:border-r [&>*]:border-line">
          {metrics.map((m) => (
            <Link key={m.label} to={`/campaigns/${c.id}/${m.to}`} className="px-3.5 py-3 hover:bg-hover">
              <p className="text-xs text-muted">{m.label}</p>
              <p className="mt-0.5 text-xl font-semibold num">{m.value}</p>
            </Link>
          ))}
        </Card>
        <Section title="Stage and delivery tracks">
          <Card className="p-4">
            <KeyValue items={[
              { label: "Stage", value: canEdit ? <Select aria-label="Stage" className="h-7 w-48" value={c.stage}
                  options={STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))} onChange={(e) => update.mutate({ stage: e.target.value as typeof c.stage })} /> : STAGE_LABEL[c.stage] },
              { label: "Health", value: canEdit ? <Select aria-label="Health" className="h-7 w-48" value={c.health}
                  options={options(HEALTH_LABEL)} onChange={(e) => update.mutate({ health: e.target.value as typeof c.health })} /> : HEALTH_LABEL[c.health] },
              track("design_status", "Design"), track("development_status", "Development"), track("qa_status", "QA"), track("uat_status", "UAT"),
            ]} />
            <p className="mt-3 text-xs text-muted">Set by a manager. AI reviews never move stages or approve work.</p>
          </Card>
        </Section>
        <Milestones campaign={c} />
        {(c.description || c.notes) && (
          <Section title="Notes">
            <Card className="space-y-2 p-4 text-sm text-text-2 whitespace-pre-wrap">{c.description}{c.description && c.notes ? "\n\n" : ""}{c.notes}</Card>
          </Section>
        )}
      </div>
      <TeamPanel campaign={c} />
    </div>
  );
}

function TeamPanel({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const { people } = usePeople();
  const { name } = useProfiles();
  const [user, setUser] = React.useState("");
  const [role, setRole] = React.useState<CampaignRole>("member");
  const invalidate = [qk.campaign(c.id), qk.campaigns];
  const add = useAction(() => campaignMembersService.add(c.id, user, role), { invalidate, success: "Added to the team", onSuccess: () => setUser("") });
  const remove = useAction((id: string) => campaignMembersService.remove(id), { invalidate, success: "Removed from the team" });
  return (
    <Section title="Team">
      <Card>
        <ul className="divide-y divide-line">
          {c.campaign_members.length === 0 && <li className="px-3 py-4 text-sm text-muted">Nobody assigned. Team members and viewers only see campaigns they’re assigned to.</li>}
          {c.campaign_members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-3 py-2">
              <Avatar name={name(m.user_id)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{name(m.user_id)}</p>
                <p className="text-xs text-muted">{CAMPAIGN_ROLE_LABEL[m.campaign_role]}</p>
              </div>
              {canEdit && <Button variant="ghost" size="icon" aria-label={`Remove ${name(m.user_id)}`} onClick={() => remove.mutate(m.id)}><X /></Button>}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="flex flex-col gap-2 border-t border-line p-3">
            <Select aria-label="Person" value={user} onChange={(e) => setUser(e.target.value)} placeholder="Choose a person"
              options={people.map((p) => ({ value: p.id, label: p.name }))} />
            <div className="flex gap-2">
              <Select aria-label="Role on campaign" value={role} onChange={(e) => setRole(e.target.value as CampaignRole)} options={options(CAMPAIGN_ROLE_LABEL)} />
              <Button disabled={!user} loading={add.isPending} onClick={() => add.mutate(undefined)}><Plus />Add</Button>
            </div>
          </div>
        )}
      </Card>
    </Section>
  );
}

function Milestones({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const key = qk.delivery("milestones", c.id);
  const { data } = useQuery({ queryKey: key, queryFn: () => deliveryService.milestones(c.id) });
  const [title, setTitle] = React.useState("");
  const [due, setDue] = React.useState("");
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const invalidate = [key, ["delivery", "milestones", "all"]];
  const add = useAction(() => deliveryService.saveMilestone({ campaign_id: c.id, title, due_date: due }), { invalidate, success: "Milestone added", onSuccess: () => { setTitle(""); setDue(""); } });
  const toggle = useAction((m: { id: string; done: boolean }) => deliveryService.saveMilestone({ id: m.id, campaign_id: c.id, title: data!.find((x) => x.id === m.id)!.title, due_date: data!.find((x) => x.id === m.id)!.due_date, done_at: m.done ? new Date().toISOString() : null }), { invalidate });
  const remove = useAction((id: string) => deliveryService.removeMilestone(id), { invalidate, success: "Milestone removed", onSuccess: () => setConfirm(null) });
  return (
    <Section title="Milestones">
      <Card>
        <ul className="divide-y divide-line">
          {(data ?? []).length === 0 && <li className="px-3 py-4 text-sm text-muted">No milestones yet. They appear on the Timeline.</li>}
          {(data ?? []).map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <button disabled={!canEdit} aria-label={m.done_at ? "Mark not done" : "Mark done"} onClick={() => toggle.mutate({ id: m.id, done: !m.done_at })}
                className={cn("flex size-4 items-center justify-center rounded border", m.done_at ? "border-st-green bg-st-green text-white" : "border-line-strong")}>
                {m.done_at && <Check className="size-3" />}
              </button>
              <span className={cn("flex-1", m.done_at && "text-muted line-through")}>{m.title}</span>
              <span className={cn("text-xs num", isOverdue(m.due_date, m.done_at ? "done" : "") ? "text-st-amber" : "text-muted")}>{formatDate(m.due_date)}</span>
              {canEdit && <Button variant="ghost" size="icon" aria-label="Delete milestone" onClick={() => setConfirm(m.id)}><Trash2 /></Button>}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); if (title && due) add.mutate(undefined); }}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Milestone, e.g. Design sign-off" aria-label="Milestone title" />
            <Input type="date" className="w-40" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
            <Button type="submit" disabled={!title || !due} loading={add.isPending}><Plus />Add</Button>
          </form>
        )}
      </Card>
      <ConfirmDialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)} title="Delete milestone?" body="This removes it from the campaign and the Timeline."
        confirmLabel="Delete milestone" danger loading={remove.isPending} onConfirm={() => confirm && remove.mutate(confirm)} />
    </Section>
  );
}
