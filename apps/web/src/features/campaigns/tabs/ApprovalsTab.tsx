import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Rocket, MessageSquarePlus, ListPlus, CheckCircle2, Undo2 } from "lucide-react";
import { Button, Card, Dialog, DialogContent, Field, Input, Select, Textarea } from "@/components/ui";
import { EmptyState, Mono, Section, StatusDot, Table, Td, Th, Tr } from "@/components/common";
import {
  DECISION_LABEL, DECISION_TONE, DEPLOYMENT_STATUS_LABEL, DEPLOYMENT_STATUS_TONE, FEEDBACK_STATUS_LABEL, PRIORITY_LABEL, STAGES, STAGE_LABEL, options,
  type ApprovalDecision, type Priority,
} from "@/lib/labels";
import { formatDate, formatDateTime, todayISO } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { qk, usePeople, useProfiles } from "@/hooks/queries";
import { useAction } from "@/hooks/useAction";
import { deliveryService, type ClientFeedback, type Deployment } from "@/services/delivery";
import { campaignsService, type CampaignWithRelations } from "@/services/campaigns";

export function ApprovalsTab({ campaign: c }: { campaign: CampaignWithRelations }) {
  return (
    <>
      <ApprovalsLog campaign={c} />
      <FeedbackSection campaign={c} />
      <DeploymentsSection campaign={c} />
    </>
  );
}

function ApprovalsLog({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const { name } = useProfiles();
  const { data } = useQuery({ queryKey: qk.delivery("approvals", c.id), queryFn: () => deliveryService.approvals(c.id) });
  const [recording, setRecording] = React.useState(false);
  return (
    <Section title="Approvals" actions={canEdit && <Button size="sm" onClick={() => setRecording(true)}><Plus />Record decision</Button>}>
      {!data?.length ? (
        <Card><EmptyState title="No decisions recorded" body="Internal sign-offs and client approvals are recorded here, append-only. Clients don’t have accounts, so record their decision with who confirmed it and how." /></Card>
      ) : (
        <Table>
          <thead><tr><Th>Subject</Th><Th>Decision</Th><Th>By</Th><Th>Note</Th><Th>Date</Th><Th>Recorded by</Th></tr></thead>
          <tbody>
            {data.map((a) => (
              <Tr key={a.id}>
                <Td className="font-medium">{a.subject_label}</Td>
                <Td><StatusDot tone={DECISION_TONE[a.decision]} label={DECISION_LABEL[a.decision]} /></Td>
                <Td className="text-text-2">{a.approver === "client" ? `Client${a.client_contact ? ` · ${a.client_contact}` : ""}` : "Internal"}</Td>
                <Td className="max-w-[280px] truncate text-text-2">{a.note ?? "—"}</Td>
                <Td className="text-xs text-muted num">{formatDate(a.decided_on)}</Td>
                <Td className="text-text-2">{name(a.created_by)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {recording && <RecordDecision campaign={c} onClose={() => setRecording(false)} />}
    </Section>
  );
}

function RecordDecision({ campaign: c, onClose }: { campaign: CampaignWithRelations; onClose: () => void }) {
  const [subject, setSubject] = React.useState<"stage" | "requirements_baseline" | "deployment">("stage");
  const [stage, setStage] = React.useState(c.stage);
  const [journey, setJourney] = React.useState("");
  const [approver, setApprover] = React.useState<"internal" | "client">("internal");
  const [contact, setContact] = React.useState("");
  const [decision, setDecision] = React.useState<ApprovalDecision>("approved");
  const [note, setNote] = React.useState("");
  const [date, setDate] = React.useState(todayISO());
  const label = subject === "stage" ? `${STAGE_LABEL[stage]} sign-off` : subject === "requirements_baseline" ? "Requirements baseline" : "Production deployment";
  const save = useAction(() => deliveryService.recordApproval({
    campaign_id: c.id, journey_id: journey || null, subject_type: subject, subject_label: label + (journey ? ` · ${c.journeys.find((j) => j.id === journey)?.name}` : ""),
    approver, client_contact: contact || null, decision, note: note || null, decided_on: date,
  }), { invalidate: [qk.delivery("approvals", c.id)], success: "Decision recorded", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Record a decision" description="Decisions can’t be edited later. To correct one, record a new decision."
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Record decision</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Subject"><Select value={subject} onChange={(e) => setSubject(e.target.value as typeof subject)}
            options={[{ value: "stage", label: "Stage sign-off" }, { value: "requirements_baseline", label: "Requirements baseline" }, { value: "deployment", label: "Production deployment" }]} /></Field>
          {subject === "stage" ? <Field label="Stage"><Select value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} options={STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))} /></Field> : <div />}
          <Field label="Journey"><Select value={journey} onChange={(e) => setJourney(e.target.value)} placeholder="Whole campaign" options={c.journeys.map((j) => ({ value: j.id, label: j.name }))} /></Field>
          <Field label="Decision"><Select value={decision} onChange={(e) => setDecision(e.target.value as ApprovalDecision)} options={options(DECISION_LABEL)} /></Field>
          <Field label="Decided by"><Select value={approver} onChange={(e) => setApprover(e.target.value as "internal" | "client")} options={[{ value: "internal", label: "Internal" }, { value: "client", label: "Client" }]} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {approver === "client" && <Field label="Client contact" className="col-span-2"><Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Name and how they confirmed" /></Field>}
          <Field label="Note" className="col-span-2"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FeedbackSection({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const key = qk.delivery("feedback", c.id);
  const { data } = useQuery({ queryKey: key, queryFn: () => deliveryService.feedback(c.id) });
  const [adding, setAdding] = React.useState(false);
  const [converting, setConverting] = React.useState<ClientFeedback | null>(null);
  const close = useAction((fb: ClientFeedback) => deliveryService.saveFeedback({ ...fb, status: "closed" }), { invalidate: [key], success: "Feedback closed" });
  return (
    <Section title="Client feedback (UAT and reviews)" actions={canEdit && <Button size="sm" onClick={() => setAdding(true)}><MessageSquarePlus />Record feedback</Button>}>
      {!data?.length ? (
        <Card><EmptyState title="No client feedback recorded" body="Record feedback from emails, calls or meetings, then turn it into correction tasks." /></Card>
      ) : (
        <Table>
          <thead><tr><Th>Received</Th><Th>Feedback</Th><Th>Journey</Th><Th>From</Th><Th>Status</Th>{canEdit && <Th />}</tr></thead>
          <tbody>
            {data.map((f) => (
              <Tr key={f.id}>
                <Td className="text-xs text-muted num whitespace-nowrap">{formatDate(f.received_on)}</Td>
                <Td className="max-w-[380px]"><p className="truncate">{f.summary}</p>{f.details && <p className="truncate text-xs text-muted">{f.details}</p>}</Td>
                <Td className="text-text-2">{c.journeys.find((j) => j.id === f.journey_id)?.name ?? "—"}</Td>
                <Td className="text-text-2">{f.client_contact ?? "Client"} · {f.channel}</Td>
                <Td><StatusDot tone={f.status === "open" ? "violet" : f.status === "converted" ? "blue" : "gray"} label={FEEDBACK_STATUS_LABEL[f.status]} /></Td>
                {canEdit && <Td className="whitespace-nowrap text-right">
                  {f.status === "open" && <>
                    <Button size="sm" variant="ghost" onClick={() => setConverting(f)}><ListPlus />Create task</Button>
                    <Button size="sm" variant="ghost" onClick={() => close.mutate(f)}>Close</Button>
                  </>}
                </Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding && <FeedbackDialog campaign={c} onClose={() => setAdding(false)} />}
      {converting && <FeedbackTaskDialog campaign={c} fb={converting} onClose={() => setConverting(null)} />}
    </Section>
  );
}

function FeedbackDialog({ campaign: c, onClose }: { campaign: CampaignWithRelations; onClose: () => void }) {
  const [summary, setSummary] = React.useState("");
  const [details, setDetails] = React.useState("");
  const [channel, setChannel] = React.useState<ClientFeedback["channel"]>("email");
  const [contact, setContact] = React.useState("");
  const [journey, setJourney] = React.useState("");
  const [date, setDate] = React.useState(todayISO());
  const save = useAction(() => deliveryService.saveFeedback({ campaign_id: c.id, summary, details: details || null, channel, client_contact: contact || null, journey_id: journey || null, received_on: date }),
    { invalidate: [qk.delivery("feedback", c.id)], success: "Feedback recorded", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Record client feedback"
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!summary} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Summary" className="col-span-2"><Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Change CTA to “Claim your gold”" /></Field>
          <Field label="Details" className="col-span-2"><Textarea rows={4} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
          <Field label="Channel"><Select value={channel} onChange={(e) => setChannel(e.target.value as ClientFeedback["channel"])} options={["email", "call", "meeting", "chat", "other"].map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))} /></Field>
          <Field label="Received"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Client contact"><Input value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
          <Field label="Journey"><Select value={journey} onChange={(e) => setJourney(e.target.value)} placeholder="Whole campaign" options={c.journeys.map((j) => ({ value: j.id, label: j.name }))} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FeedbackTaskDialog({ campaign: c, fb, onClose }: { campaign: CampaignWithRelations; fb: ClientFeedback; onClose: () => void }) {
  const { people } = usePeople();
  const [title, setTitle] = React.useState(fb.summary);
  const [assignee, setAssignee] = React.useState("");
  const [due, setDue] = React.useState("");
  const [priority, setPriority] = React.useState<Priority>("medium");
  const save = useAction(() => deliveryService.feedbackToTask(fb, { title, assigneeId: assignee || null, dueDate: due || null, priority }),
    { invalidate: [qk.delivery("feedback", c.id), ["tasks"]], success: "Correction task created", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Create correction task" description="The task keeps a link to this feedback."
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title} loading={save.isPending} onClick={() => save.mutate(undefined)}>Create task</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Task" className="col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Owner"><Select value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Unassigned" options={people.map((p) => ({ value: p.id, label: p.name }))} /></Field>
          <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} options={options(PRIORITY_LABEL)} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeploymentsSection({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const key = qk.delivery("deployments", c.id);
  const { data } = useQuery({ queryKey: key, queryFn: () => deliveryService.deployments(c.id) });
  const [adding, setAdding] = React.useState(false);
  const setStatus = useAction(async ({ d, status }: { d: Deployment; status: Deployment["status"] }) => {
    await deliveryService.updateDeployment(d.id, { status, deployed_at: status === "deployed" ? new Date().toISOString() : d.deployed_at });
    if (status === "deployed" && d.environment === "production") await campaignsService.update(c.id, { production_url: d.url });
  }, { invalidate: [key, qk.campaign(c.id), qk.campaigns], success: "Deployment updated" });
  return (
    <Section title="Deployments" actions={canEdit && <Button size="sm" onClick={() => setAdding(true)}><Rocket />Plan deployment</Button>}>
      {!data?.length ? (
        <Card><EmptyState icon={Rocket} title="No deployments tracked" body="Plan the production release, record when it goes live and the live URL, then verify the production pages." /></Card>
      ) : (
        <Table>
          <thead><tr><Th>Environment</Th><Th>URL</Th><Th>Version</Th><Th>Status</Th><Th>Planned</Th><Th>Deployed</Th>{canEdit && <Th />}</tr></thead>
          <tbody>
            {data.map((d) => (
              <Tr key={d.id}>
                <Td className="capitalize">{d.environment}</Td>
                <Td className="max-w-[240px] truncate"><a href={d.url} target="_blank" rel="noreferrer" className="hover:text-accent"><Mono>{d.url}</Mono></a></Td>
                <Td><Mono>{d.version_label ?? "—"}</Mono></Td>
                <Td><StatusDot tone={DEPLOYMENT_STATUS_TONE[d.status]} label={DEPLOYMENT_STATUS_LABEL[d.status]} /></Td>
                <Td className="text-xs text-muted num">{formatDate(d.planned_for)}</Td>
                <Td className="text-xs text-muted">{formatDateTime(d.deployed_at)}</Td>
                {canEdit && <Td className="whitespace-nowrap text-right">
                  {d.status === "planned" && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ d, status: "deployed" })}><Rocket />Mark deployed</Button>}
                  {d.status === "deployed" && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ d, status: "verified" })}><CheckCircle2 />Mark verified</Button>}
                  {(d.status === "deployed" || d.status === "verified") && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ d, status: "rolled_back" })}><Undo2 />Rolled back</Button>}
                </Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding && <DeploymentDialog campaign={c} onClose={() => setAdding(false)} />}
    </Section>
  );
}

function DeploymentDialog({ campaign: c, onClose }: { campaign: CampaignWithRelations; onClose: () => void }) {
  const [env, setEnv] = React.useState<"production" | "staging">("production");
  const [url, setUrl] = React.useState(c.production_url ?? "");
  const [version, setVersion] = React.useState("");
  const [planned, setPlanned] = React.useState(c.target_launch_date ?? "");
  const [notes, setNotes] = React.useState("");
  const valid = /^https?:\/\/[^\s/]+/.test(url);
  const save = useAction(() => deliveryService.saveDeployment({ campaign_id: c.id, environment: env, url, version_label: version || null, planned_for: planned || null, notes: notes || null }),
    { invalidate: [qk.delivery("deployments", c.id)], success: "Deployment planned", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Plan deployment"
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Environment"><Select value={env} onChange={(e) => setEnv(e.target.value as "production" | "staging")} options={[{ value: "production", label: "Production" }, { value: "staging", label: "Staging" }]} /></Field>
          <Field label="Planned for"><Input type="date" value={planned} onChange={(e) => setPlanned(e.target.value)} /></Field>
          <Field label="URL" className="col-span-2" error={url && !valid ? "Enter a full URL" : undefined}><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
          <Field label="Version"><Input value={version} onChange={(e) => setVersion(e.target.value)} /></Field>
          <Field label="Notes" className="col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
