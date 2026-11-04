import * as React from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutList, Columns3, Plus, Search, Trash2, Link2 } from "lucide-react";
import { Button, Card, Dialog, DialogContent, Drawer, Field, Input, Select, Textarea } from "@/components/ui";
import { Avatar, ConfirmDialog, EmptyState, ErrorState, KeyValue, LoadingRows, Mono, StatusDot, Table, Td, Th, Tr } from "@/components/common";
import { PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL, TASK_STATUS_TONE, options, type Priority, type TaskStatus } from "@/lib/labels";
import { cn, formatDate, formatDateTime, isOverdue, timeAgo } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { qk, useCampaigns, usePeople, useProfiles } from "@/hooks/queries";
import { useAction } from "@/hooks/useAction";
import { useListKeys } from "@/hooks/useListKeys";
import { tasksService, type Task } from "@/services/tasks";

type View = "list" | "board";

export function TaskList({ campaignId }: { campaignId?: string }) {
  const { me, canEdit } = useAuth();
  const { name } = useProfiles();
  const [params, setParams] = useSearchParams();
  const scope = campaignId ?? "all";
  const { data, isLoading, error, refetch } = useQuery({ queryKey: qk.tasks(scope), queryFn: () => tasksService.list({ campaignId }) });
  const [view, setView] = React.useState<View>("list");
  const [q, setQ] = React.useState("");
  const [assignee, setAssignee] = React.useState(params.get("mine") === "1" ? me?.id ?? "" : "");
  const [status, setStatus] = React.useState<TaskStatus | "" | "open">("open");
  const due = params.get("due");
  const openId = params.get("task");
  const creating = params.get("new") === "1";
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const list = React.useMemo(() => (data ?? []).filter((t) => {
    if (q && !`${t.title} ${t.ref} ${t.campaigns?.name ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (assignee === "none" ? t.assignee_id : assignee && t.assignee_id !== assignee) return false;
    if (view === "list" && status === "open" && t.status === "done") return false;
    if (view === "list" && status && status !== "open" && t.status !== status) return false;
    if (due === "overdue" && !isOverdue(t.due_date, t.status)) return false;
    return true;
  }), [data, q, assignee, status, due, view]);
  const { index } = useListKeys(view === "list" ? list : [], (t) => setParam("task", t.id));
  const update = useAction(({ id, status }: { id: string; status: TaskStatus }) => tasksService.update(id, { status }), { invalidate: [["tasks"], ["findings"]], error: "Could not update the task" });
  const { people } = usePeople();
  const open = (data ?? []).find((t) => t.id === openId) ?? null;
  const canChange = (t: Task) => canEdit || t.assignee_id === me?.id;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tasks" className="w-52 pl-7" aria-label="Filter tasks" />
        </div>
        <Select aria-label="Owner" className="w-44" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Anyone"
          options={[...(me ? [{ value: me.id, label: "Me" }] : []), { value: "none", label: "Unassigned" }, ...people.filter((p) => p.id !== me?.id).map((p) => ({ value: p.id, label: p.name }))]} />
        {view === "list" && <Select aria-label="Status" className="w-44" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} placeholder="Any status"
          options={[{ value: "open", label: "Not done" }, ...options(TASK_STATUS_LABEL)]} />}
        {due === "overdue" && <Button size="sm" variant="ghost" onClick={() => setParam("due", null)}>Overdue only ×</Button>}
        <div className="flex-1" />
        <div className="flex rounded-ctl border border-line p-0.5">
          <button aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("rounded px-2 py-1 text-xs", view === "list" ? "bg-active text-text" : "text-muted")}><LayoutList className="mr-1 inline size-3.5" />List</button>
          <button aria-pressed={view === "board"} onClick={() => setView("board")} className={cn("rounded px-2 py-1 text-xs", view === "board" ? "bg-active text-text" : "text-muted")}><Columns3 className="mr-1 inline size-3.5" />Board</button>
        </div>
        {canEdit && <Button variant="primary" onClick={() => setParam("new", "1")}><Plus />New task</Button>}
      </div>

      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <LoadingRows /> : !list.length ? (
        <Card><EmptyState title={data?.length ? "No tasks match" : "No tasks yet"} body={data?.length ? "Clear the filters to see more." : "Create tasks here, or assign them from findings and client feedback so they keep the link to the source."}
          action={canEdit && !data?.length && <Button variant="primary" onClick={() => setParam("new", "1")}><Plus />New task</Button>} /></Card>
      ) : view === "list" ? (
        <Table>
          <thead><tr><Th className="w-20">ID</Th><Th>Task</Th>{!campaignId && <Th>Campaign</Th>}<Th>Owner</Th><Th>Status</Th><Th>Priority</Th><Th>Due</Th></tr></thead>
          <tbody>
            {list.map((t, i) => (
              <Tr key={t.id} onClick={() => setParam("task", t.id)} selected={index === i}>
                <Td><Mono>{t.ref}</Mono></Td>
                <Td className="max-w-[380px]"><span className="truncate">{t.title}</span>{t.source_finding_id && <Link2 className="ml-1.5 inline size-3.5 text-muted" aria-label="From a finding" />}</Td>
                {!campaignId && <Td className="text-text-2">{t.campaigns?.name}</Td>}
                <Td className="whitespace-nowrap">{t.assignee_id ? <span className="inline-flex items-center gap-1.5"><Avatar name={name(t.assignee_id)} size={18} />{name(t.assignee_id)}</span> : <span className="text-muted">Unassigned</span>}</Td>
                <Td onClick={(e) => e.stopPropagation()}>
                  {canChange(t) ? (
                    <Select aria-label="Status" className="h-7 w-40" value={t.status} options={options(TASK_STATUS_LABEL)} onChange={(e) => update.mutate({ id: t.id, status: e.target.value as TaskStatus })} />
                  ) : <StatusDot tone={TASK_STATUS_TONE[t.status]} label={TASK_STATUS_LABEL[t.status]} />}
                </Td>
                <Td className="text-text-2">{PRIORITY_LABEL[t.priority]}</Td>
                <Td className={cn("whitespace-nowrap num", isOverdue(t.due_date, t.status) ? "text-st-amber" : "text-text-2")}>{formatDate(t.due_date, true)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Board tasks={list} canChange={canChange} onOpen={(t) => setParam("task", t.id)} onMove={(id, s) => update.mutate({ id, status: s })} showCampaign={!campaignId} />
      )}
      {open && <TaskDrawer task={open} onClose={() => setParam("task", null)} />}
      {creating && canEdit && <TaskDialog campaignId={campaignId} onClose={() => setParam("new", null)} />}
    </>
  );
}

function Board({ tasks, canChange, onOpen, onMove, showCampaign }: {
  tasks: Task[]; canChange: (t: Task) => boolean; onOpen: (t: Task) => void; onMove: (id: string, s: TaskStatus) => void; showCampaign: boolean;
}) {
  const { name } = useProfiles();
  const [over, setOver] = React.useState<TaskStatus | null>(null);
  return (
    <div className="grid gap-3 overflow-x-auto sm:grid-cols-5">
      {TASK_STATUSES.map((s) => {
        const col = tasks.filter((t) => t.status === s);
        return (
          <div key={s} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/task"); if (id) onMove(id, s); }}
            className={cn("min-h-[200px] min-w-[200px] rounded-box border border-line bg-side p-2", over === s && "border-accent")}>
            <div className="mb-2 flex items-center justify-between px-1">
              <StatusDot tone={TASK_STATUS_TONE[s]} label={<span className="font-medium text-text">{TASK_STATUS_LABEL[s]}</span>} />
              <span className="text-xs text-muted num">{col.length}</span>
            </div>
            <div className="space-y-1.5">
              {col.map((t) => (
                <button key={t.id} draggable={canChange(t)} onDragStart={(e) => e.dataTransfer.setData("text/task", t.id)} onClick={() => onOpen(t)}
                  className="block w-full rounded-item border border-line bg-surface p-2 text-left hover:border-line-strong">
                  <p className="text-sm">{t.title}</p>
                  {showCampaign && <p className="mt-0.5 truncate text-xs text-muted">{t.campaigns?.name}</p>}
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                    <Mono>{t.ref}</Mono>
                    {t.due_date && <span className={cn("num", isOverdue(t.due_date, t.status) && "text-st-amber")}>{formatDate(t.due_date, true)}</span>}
                    <span className="flex-1" />
                    {t.assignee_id && <Avatar name={name(t.assignee_id)} size={18} />}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type TaskFormValues = { title: string; description: string; campaign_id: string; journey_id: string; assignee_id: string; priority: Priority; due_date: string };

export function TaskDialog({ campaignId, onClose, task }: { campaignId?: string; onClose: () => void; task?: Task }) {
  const { data: campaigns } = useCampaigns();
  const { people } = usePeople();
  const [v, setV] = React.useState<TaskFormValues>({
    title: task?.title ?? "", description: task?.description ?? "", campaign_id: task?.campaign_id ?? campaignId ?? "",
    journey_id: task?.journey_id ?? "", assignee_id: task?.assignee_id ?? "", priority: task?.priority ?? "medium", due_date: task?.due_date ?? "",
  });
  const camp = campaigns?.find((c) => c.id === v.campaign_id);
  const save = useAction(() => {
    const payload = { title: v.title.trim(), description: v.description || null, campaign_id: v.campaign_id, journey_id: v.journey_id || null,
      assignee_id: v.assignee_id || null, priority: v.priority, due_date: v.due_date || null };
    return task ? tasksService.update(task.id, payload) : tasksService.create(payload);
  }, { invalidate: [["tasks"]], success: task ? "Task saved" : "Task created", onSuccess: onClose });
  const set = (p: Partial<TaskFormValues>) => setV((x) => ({ ...x, ...p }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={task ? "Edit task" : "New task"}
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!v.title.trim() || !v.campaign_id} loading={save.isPending} onClick={() => save.mutate(undefined)}>{task ? "Save" : "Create task"}</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Task" className="col-span-2"><Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Campaign"><Select value={v.campaign_id} onChange={(e) => set({ campaign_id: e.target.value, journey_id: "" })} placeholder="Choose a campaign" disabled={Boolean(campaignId) || Boolean(task)}
            options={(campaigns ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Journey"><Select value={v.journey_id} onChange={(e) => set({ journey_id: e.target.value })} placeholder="Whole campaign" options={(camp?.journeys ?? []).map((j) => ({ value: j.id, label: j.name }))} /></Field>
          <Field label="Owner"><Select value={v.assignee_id} onChange={(e) => set({ assignee_id: e.target.value })} placeholder="Unassigned" options={people.map((p) => ({ value: p.id, label: p.name }))} /></Field>
          <Field label="Due date"><Input type="date" value={v.due_date} onChange={(e) => set({ due_date: e.target.value })} /></Field>
          <Field label="Priority"><Select value={v.priority} onChange={(e) => set({ priority: e.target.value as Priority })} options={options(PRIORITY_LABEL)} /></Field>
          <Field label="Description" className="col-span-2"><Textarea rows={5} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TaskDrawer({ task: t, onClose }: { task: Task; onClose: () => void }) {
  const { me, canEdit } = useAuth();
  const { name } = useProfiles();
  const comments = useQuery({ queryKey: ["comments", t.id], queryFn: () => tasksService.comments(t.id) });
  const [body, setBody] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const canChange = canEdit || t.assignee_id === me?.id;
  const canComment = canEdit || me?.role === "team_member";
  const status = useAction((s: TaskStatus) => tasksService.update(t.id, { status: s }), { invalidate: [["tasks"], ["findings"]], success: "Status updated" });
  const comment = useAction(() => tasksService.addComment(t.id, t.campaign_id, body.trim()), { invalidate: [["comments", t.id]], onSuccess: () => setBody("") });
  const remove = useAction(() => tasksService.remove(t.id), { invalidate: [["tasks"]], success: "Task deleted", onSuccess: onClose });
  const ev = (t.evidence ?? null) as { finding_ref?: string; requirement_ref?: string; screen?: string } | null;
  return (
    <>
      <Drawer open onOpenChange={(o) => !o && onClose()} title={t.title} subtitle={<><Mono>{t.ref}</Mono> · {t.campaigns?.name}</>}
        actions={canEdit && <>
          <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
          <Button size="icon" variant="ghost" aria-label="Delete task" onClick={() => setConfirm(true)}><Trash2 /></Button>
        </>}>
        <div className="space-y-5 px-5 py-4">
          <KeyValue items={[
            { label: "Status", value: canChange ? <Select aria-label="Status" className="h-7 w-48" value={t.status} options={options(TASK_STATUS_LABEL)} onChange={(e) => status.mutate(e.target.value as TaskStatus)} />
              : <StatusDot tone={TASK_STATUS_TONE[t.status]} label={TASK_STATUS_LABEL[t.status]} /> },
            { label: "Owner", value: t.assignee_id ? name(t.assignee_id) : "Unassigned" },
            { label: "Priority", value: PRIORITY_LABEL[t.priority] },
            { label: "Due", value: <span className={cn(isOverdue(t.due_date, t.status) && "text-st-amber")}>{formatDate(t.due_date)}</span> },
            { label: "Journey", value: t.journeys?.name ?? "Whole campaign" },
            { label: "Created", value: `${name(t.created_by)} · ${formatDateTime(t.created_at)}` },
          ]} />
          {(t.source_finding_id || t.source_feedback_id) && (
            <div className="rounded-box border border-line bg-side px-3 py-2 text-sm">
              <p className="text-xs text-muted">Traceability</p>
              {t.source_finding_id && <p>From finding <Link to={`/reviews?finding=${t.source_finding_id}`} className="font-mono text-xs text-accent hover:underline">{ev?.finding_ref ?? "open"}</Link>
                {ev?.requirement_ref ? <> · requirement <Mono>{ev.requirement_ref}</Mono></> : " · Additional observation"}{ev?.screen ? ` · ${ev.screen}` : ""}</p>}
              {t.source_feedback_id && <p>From client feedback (<Link to={`/campaigns/${t.campaign_id}/approvals`} className="text-accent hover:underline">view</Link>)</p>}
              {t.source_finding_id && <p className="mt-1 text-xs text-muted">Marking this “Ready for review” moves the finding to “Ready for retest”. Only a new review or a manager can mark it Verified.</p>}
            </div>
          )}
          {t.description && <p className="whitespace-pre-wrap text-sm text-text-2">{t.description}</p>}
          <div>
            <p className="section-title mb-2">Comments</p>
            <ul className="space-y-3">
              {(comments.data ?? []).map((c) => (
                <li key={c.id} className="flex gap-2">
                  <Avatar name={name(c.created_by)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs"><span className="font-medium">{name(c.created_by)}</span> <span className="text-muted">{timeAgo(c.created_at)}</span></p>
                    <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                  </div>
                </li>
              ))}
              {comments.data?.length === 0 && <li className="text-sm text-muted">No comments yet.</li>}
            </ul>
            {canComment && (
              <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) comment.mutate(undefined); }}>
                <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment" aria-label="Comment" />
                <Button type="submit" size="sm" className="self-end" disabled={!body.trim()} loading={comment.isPending}>Comment</Button>
              </form>
            )}
          </div>
        </div>
      </Drawer>
      {editing && <TaskDialog task={t} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete task?" body="The deletion is recorded in the activity log." confirmLabel="Delete task" danger loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </>
  );
}
