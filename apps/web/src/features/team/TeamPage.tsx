import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { Button, Card, Input, Select } from "@/components/ui";
import { Avatar, ConfirmDialog, ErrorState, LoadingRows, PageHeader, StatusDot, Table, Td, Th, Tr, Section } from "@/components/common";
import { CAMPAIGN_ROLE_LABEL, ROLE_LABEL, TASK_STATUS_LABEL, options, type Role } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { qk, useCampaigns } from "@/hooks/queries";
import { useAction } from "@/hooks/useAction";
import { teamService, type Member } from "@/services/team";
import { tasksService } from "@/services/tasks";

export function TeamPage() {
  const { isAdmin, me } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: qk.members, queryFn: teamService.members });
  const { data: campaigns } = useCampaigns();
  const tasks = useQuery({ queryKey: qk.tasks("all"), queryFn: () => tasksService.list() });
  const [confirm, setConfirm] = React.useState<{ m: Member; active: boolean } | null>(null);
  const invalidate = [qk.members, qk.profiles];
  const setRole = useAction(({ id, role }: { id: string; role: Role }) => teamService.setRole(id, role), { invalidate, success: "Role updated" });
  const setActive = useAction(({ id, active }: { id: string; active: boolean }) => teamService.setActive(id, active), { invalidate, success: "Member updated", onSuccess: () => setConfirm(null) });

  const load = (uid: string) => {
    const t = (tasks.data ?? []).filter((x) => x.assignee_id === uid && x.status !== "done");
    const c = (campaigns ?? []).filter((x) => x.campaign_members.some((m) => m.user_id === uid));
    return { open: t.length, overdue: t.filter((x) => x.due_date && x.due_date < new Date().toISOString().slice(0, 10)).length, campaigns: c };
  };

  return (
    <>
      <PageHeader title="Team" description="Everyone in the workspace, their role and current workload." />
      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <LoadingRows /> : (
        <Table>
          <thead><tr><Th>Person</Th><Th>Role</Th><Th>Campaigns</Th><Th>Open tasks</Th><Th>Joined</Th><Th>Status</Th>{isAdmin && <Th />}</tr></thead>
          <tbody>
            {(data ?? []).map((m) => {
              const l = load(m.user_id);
              const self = m.user_id === me?.id;
              return (
                <Tr key={m.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Avatar name={m.profiles?.full_name || m.profiles?.email} size={24} />
                      <div className="min-w-0"><p className="truncate">{m.profiles?.full_name || "—"}{self && <span className="ml-1 text-xs text-muted">(you)</span>}</p><p className="truncate text-xs text-muted">{m.profiles?.email}</p></div>
                    </div>
                  </Td>
                  <Td>
                    {isAdmin && !self ? (
                      <Select aria-label="Role" className="h-7 w-52" value={m.role} options={options(ROLE_LABEL)} onChange={(e) => setRole.mutate({ id: m.user_id, role: e.target.value as Role })} />
                    ) : ROLE_LABEL[m.role]}
                  </Td>
                  <Td className="max-w-[260px] text-text-2">
                    {m.role === "worker" ? "—" : l.campaigns.length ? (
                      <span className="line-clamp-2" title={l.campaigns.map((c) => c.name).join(", ")}>
                        {l.campaigns.map((c) => `${c.name} (${CAMPAIGN_ROLE_LABEL[c.campaign_members.find((x) => x.user_id === m.user_id)!.campaign_role]})`).join(", ")}
                      </span>
                    ) : (m.role === "admin" || m.role === "manager") ? "All (manager access)" : "None assigned"}
                  </Td>
                  <Td className="num">{m.role === "worker" ? "—" : <>{l.open}{l.overdue > 0 && <span className="ml-1.5 text-xs text-st-amber">{l.overdue} overdue</span>}</>}</Td>
                  <Td className="text-xs text-muted">{formatDate(m.created_at)}</Td>
                  <Td>{m.deactivated_at ? <StatusDot tone="gray" label="Deactivated" /> : <StatusDot tone="green" label="Active" />}</Td>
                  {isAdmin && <Td className="text-right">
                    {!self && <Button size="sm" variant="ghost" onClick={() => setConfirm({ m, active: Boolean(m.deactivated_at) })}>{m.deactivated_at ? "Reactivate" : "Deactivate"}</Button>}
                  </Td>}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Section title="Inviting people" className="mt-6">
        <Card className="space-y-2 p-4 text-sm text-text-2">
          <p className="flex items-center gap-2 text-text"><Mail className="size-4 text-muted" />Accounts are invite-only.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>In the Supabase dashboard, open <span className="font-medium text-text">Authentication → Users → Invite user</span> and enter their email.</li>
            <li>They follow the link, choose a password, and appear here as a <span className="font-medium text-text">Viewer</span>.</li>
            <li>{isAdmin ? "Change their role above" : "An Admin changes their role"}, then add them to campaigns from each campaign’s Overview.</li>
          </ol>
          <p className="text-xs">The AI worker uses its own account: invite e.g. worker@yourdomain, then set its role to “AI worker (service account)”. It can’t sign in to this app.</p>
        </Card>
      </Section>
      <MyWork />
      <ConfirmDialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.active ? "Reactivate member?" : "Deactivate member?"}
        body={confirm?.active ? "They regain access with their previous role." : "They lose access immediately. Their history, tasks and comments are kept."}
        confirmLabel={confirm?.active ? "Reactivate" : "Deactivate"} danger={!confirm?.active} loading={setActive.isPending}
        onConfirm={() => confirm && setActive.mutate({ id: confirm.m.user_id, active: confirm.active })} />
    </>
  );
}

function MyWork() {
  const { me } = useAuth();
  const [name, setName] = React.useState(me?.fullName ?? "");
  const save = useAction(() => teamService.updateMyName(me!.id, name.trim()), { invalidate: [["me"], qk.profiles, qk.members], success: "Name updated" });
  const tasks = useQuery({ queryKey: qk.tasks("all"), queryFn: () => tasksService.list() });
  const mine = (tasks.data ?? []).filter((t) => t.assignee_id === me?.id && t.status !== "done");
  return (
    <Section title="Your profile and work">
      <Card className="p-4">
        <form className="flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(undefined); }}>
          <Input aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" loading={save.isPending}>Save name</Button>
        </form>
        <p className="mt-4 text-sm text-text-2">{mine.length ? `You have ${mine.length} open task${mine.length > 1 ? "s" : ""}: ` : "No open tasks assigned to you."}
          {mine.slice(0, 5).map((t, i) => <span key={t.id}>{i > 0 && ", "}<a className="text-accent hover:underline" href={`/tasks?task=${t.id}`}>{t.title}</a> ({TASK_STATUS_LABEL[t.status]})</span>)}
        </p>
      </Card>
    </Section>
  );
}
