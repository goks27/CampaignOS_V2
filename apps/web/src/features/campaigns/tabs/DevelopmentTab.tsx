import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Plus, Server, Trash2, FlaskConical, ArrowDown, ArrowUp, Pencil } from "lucide-react";
import { Button, Card, Checkbox, Dialog, DialogContent, Field, Input, Select, Textarea } from "@/components/ui";
import { ConfirmDialog, EmptyState, Mono, Section, StatusDot, Table, Td, Th, Tr, KeyValue } from "@/components/common";
import { SUBMISSION_STATUS_LABEL, SUBMISSION_STATUS_TONE, VERIFICATION_LABEL, VERIFICATION_TONE } from "@/lib/labels";
import { formatDateTime } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { qk, usePeople, useProfiles } from "@/hooks/queries";
import { useAction } from "@/hooks/useAction";
import { developmentService, type DevSubmission, type Step, type TestCase, type TestEnvironment } from "@/services/development";
import { designsService } from "@/services/designs";
import { requirementsService } from "@/services/requirements";
import type { CampaignWithRelations } from "@/services/campaigns";
import { RunReviewButton } from "@/features/shared/RunReview";
import { AssetImage } from "@/features/shared/AssetImage";

export function DevelopmentTab({ campaign: c }: { campaign: CampaignWithRelations }) {
  return (
    <>
      <Environments campaign={c} />
      <Submissions campaign={c} />
      <Scenarios campaign={c} />
      <Runs campaign={c} />
    </>
  );
}

function domainOf(url: string) {
  try { return new URL(url).hostname; } catch { return ""; }
}

// ---------------------------------------------------------------- environments
function Environments({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const key = qk.dev(c.id);
  const { data } = useQuery({ queryKey: [...key, "env"], queryFn: () => developmentService.environments(c.id) });
  const [editing, setEditing] = React.useState<TestEnvironment | "new" | null>(null);
  const [creds, setCreds] = React.useState<TestEnvironment | null>(null);
  return (
    <Section title="Test environments" actions={canEdit && <Button size="sm" onClick={() => setEditing("new")}><Plus />Add environment</Button>}>
      {!data?.length ? (
        <Card><EmptyState icon={Server} title="No test environments" body="Add the staging site the browser worker may test. Only the listed domains are visited; private and internal network addresses are always blocked." /></Card>
      ) : (
        <Table>
          <thead><tr><Th>Name</Th><Th>Base URL</Th><Th>Allowed domains</Th><Th>Credentials</Th>{canEdit && <Th />}</tr></thead>
          <tbody>
            {data.map((e) => (
              <Tr key={e.id}>
                <Td className="font-medium">{e.name}</Td>
                <Td><Mono>{e.base_url}</Mono></Td>
                <Td><Mono>{e.allowed_domains.join(", ") || "—"}</Mono></Td>
                <Td>{e.has_credentials ? <StatusDot tone="green" label="Stored in Vault" /> : <StatusDot tone="gray" label="None" />}</Td>
                {canEdit && <Td className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setCreds(e)}><KeyRound />Credentials</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(e)}><Pencil />Edit</Button>
                </Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <EnvironmentDialog campaign={c} env={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {creds && <CredentialsDialog campaign={c} env={creds} onClose={() => setCreds(null)} />}
    </Section>
  );
}

function EnvironmentDialog({ campaign: c, env, onClose }: { campaign: CampaignWithRelations; env: TestEnvironment | null; onClose: () => void }) {
  const [name, setName] = React.useState(env?.name ?? "Staging");
  const [base, setBase] = React.useState(env?.base_url ?? c.staging_url ?? "");
  const [domains, setDomains] = React.useState(env?.allowed_domains.join(", ") ?? "");
  const [notes, setNotes] = React.useState(env?.access_notes ?? "");
  const validBase = /^https?:\/\/[^\s/]+/.test(base);
  const list = (domains || domainOf(base)).split(/[,\s]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  const save = useAction(() => developmentService.saveEnvironment({ id: env?.id, campaign_id: c.id, name, base_url: base, allowed_domains: list, access_notes: notes || null }),
    { invalidate: [qk.dev(c.id)], success: "Environment saved", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={env ? "Edit environment" : "Add test environment"}
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name || !validBase} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
        <div className="grid gap-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Base URL" error={base && !validBase ? "Enter a full URL starting with https://" : undefined}><Input value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://staging.example.com" /></Field>
          <Field label="Allowed domains" hint={`Comma separated. The browser worker refuses every other host. Defaults to ${domainOf(base) || "the base URL host"}.`}>
            <Input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder={domainOf(base)} />
          </Field>
          <Field label="Access instructions" hint="Plain-text notes for testers. Do not put passwords here; use Credentials."><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CredentialsDialog({ campaign: c, env, onClose }: { campaign: CampaignWithRelations; env: TestEnvironment; onClose: () => void }) {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [extra, setExtra] = React.useState("");
  const save = useAction(() => developmentService.setCredentials(env.id, username, password, extra), { invalidate: [qk.dev(c.id)], success: "Credentials stored in Vault", onSuccess: onClose });
  const clear = useAction(() => developmentService.clearCredentials(env.id), { invalidate: [qk.dev(c.id)], success: "Credentials removed", onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Test credentials · ${env.name}`} description="Encrypted in Supabase Vault. Nobody can read them back in the app; only the AI worker receives them while running a job for this environment."
        footer={<>
          {env.has_credentials && <Button variant="danger" className="mr-auto" loading={clear.isPending} onClick={() => clear.mutate(undefined)}>Remove stored credentials</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!username || !password} loading={save.isPending} onClick={() => save.mutate(undefined)}>{env.has_credentials ? "Replace credentials" : "Store credentials"}</Button>
        </>}>
        <form className="grid gap-3" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
          <Field label="Username or test mobile number"><Input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
          <Field label="Password or test OTP"><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Extra (optional)" hint="e.g. HTTP basic-auth user:pass for the staging server"><Input autoComplete="off" value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- submissions
function Submissions({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit, me } = useAuth();
  const canSubmit = canEdit || (me?.role === "team_member" && c.campaign_members.some((m) => m.user_id === me.id));
  const { name } = useProfiles();
  const { data } = useQuery({ queryKey: [...qk.dev(c.id), "subs"], queryFn: () => developmentService.submissions(c.id) });
  const [creating, setCreating] = React.useState(false);
  const [open, setOpen] = React.useState<DevSubmission | null>(null);
  return (
    <Section title="Development submissions" actions={canSubmit && <Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus />Submit staging build</Button>}>
      {!data?.length ? (
        <Card><EmptyState title="No staging builds submitted" body="Submit a staging URL with its version. Then run Design vs Development, SOW vs Development and functional QA on it." /></Card>
      ) : (
        <Table>
          <thead><tr><Th>Version</Th><Th>Journey</Th><Th>Staging URL</Th><Th>Developer</Th><Th>Status</Th><Th>Submitted</Th>{canEdit && <Th>Run</Th>}</tr></thead>
          <tbody>
            {data.map((s) => (
              <Tr key={s.id} onClick={() => setOpen(s)}>
                <Td><Mono>{s.version_label}</Mono></Td>
                <Td className="text-text-2">{c.journeys.find((j) => j.id === s.journey_id)?.name ?? "All"}</Td>
                <Td className="max-w-[240px] truncate"><Mono>{s.staging_url}</Mono></Td>
                <Td className="text-text-2">{name(s.developer_id)}</Td>
                <Td><StatusDot tone={SUBMISSION_STATUS_TONE[s.status]} label={SUBMISSION_STATUS_LABEL[s.status]} /></Td>
                <Td className="text-xs text-muted">{formatDateTime(s.created_at)}</Td>
                {canEdit && <Td onClick={(e) => e.stopPropagation()} className="whitespace-nowrap">
                  <div className="flex gap-1">
                    <RunReviewButton size="sm" variant="primary" campaignId={c.id} reviewType="design_vs_development" source={{ development_submission_id: s.id }} label="Visual" />
                    <RunReviewButton size="sm" campaignId={c.id} reviewType="functional_qa" source={{ development_submission_id: s.id }} label="Functional" />
                    <RunReviewButton size="sm" campaignId={c.id} reviewType="sow_vs_development" source={{ development_submission_id: s.id }} label="SOW" />
                    <RunReviewButton size="sm" variant="ghost" campaignId={c.id} reviewType="regression" source={{ development_submission_id: s.id }} label="Regression" />
                  </div>
                </Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {creating && <SubmissionDialog campaign={c} onClose={() => setCreating(false)} />}
      {open && <SubmissionDetail campaign={c} sub={open} onClose={() => setOpen(null)} />}
    </Section>
  );
}

export function SubmissionDialog({ campaign: c, onClose }: { campaign: CampaignWithRelations; onClose: () => void }) {
  const { me } = useAuth();
  const { people } = usePeople();
  const envs = useQuery({ queryKey: [...qk.dev(c.id), "env"], queryFn: () => developmentService.environments(c.id) });
  const designs = useQuery({ queryKey: qk.designs(c.id), queryFn: () => designsService.list(c.id) });
  const [journey, setJourney] = React.useState(c.journeys[0]?.id ?? "");
  const [env, setEnv] = React.useState("");
  const [version, setVersion] = React.useState("");
  const [url, setUrl] = React.useState(c.staging_url ?? "");
  const [paths, setPaths] = React.useState("/");
  const [design, setDesign] = React.useState("");
  const [developer, setDeveloper] = React.useState(me?.id ?? "");
  const [devices, setDevices] = React.useState({ desktop: true, mobile: true });
  const [notes, setNotes] = React.useState("");
  React.useEffect(() => { if (!env && envs.data?.[0]) setEnv(envs.data[0].id); }, [envs.data, env]);
  const approved = (designs.data ?? []).filter((d) => d.status === "approved" || d.status === "in_review");
  const validUrl = /^https?:\/\/[^\s/]+/.test(url);
  const save = useAction(() => developmentService.createSubmission({
    campaign_id: c.id, journey_id: journey || null, environment_id: env || null, design_submission_id: design || null,
    version_label: version, staging_url: url, developer_id: developer || null,
    devices: Object.entries(devices).filter(([, v]) => v).map(([k]) => k), page_paths: paths.split(/[\n,]+/).map((p) => p.trim()).filter(Boolean),
    notes: notes || null,
  }), { invalidate: [qk.dev(c.id)], success: (r) => `Build ${r.submission.version_label} submitted${r.autoQueued ? `; ${r.autoQueued} review(s) queued` : ""}.`, onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Submit staging build" className="max-w-2xl"
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!version || !validUrl} loading={save.isPending} onClick={() => save.mutate(undefined)}>Submit build</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Version"><Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. build 14 / v0.3.1" /></Field>
          <Field label="Journey"><Select value={journey} onChange={(e) => setJourney(e.target.value)} placeholder="All journeys" options={c.journeys.map((j) => ({ value: j.id, label: j.name }))} /></Field>
          <Field label="Staging URL" className="col-span-2" error={url && !validUrl ? "Enter a full URL" : undefined}><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
          <Field label="Pages to capture" hint="Paths relative to the staging URL, one per line." className="col-span-2"><Textarea rows={2} value={paths} onChange={(e) => setPaths(e.target.value)} /></Field>
          <Field label="Test environment" hint={!envs.data?.length ? "Add an environment above first, so the worker knows which domains it may visit." : undefined}>
            <Select value={env} onChange={(e) => setEnv(e.target.value)} placeholder="None" options={(envs.data ?? []).map((e) => ({ value: e.id, label: e.name }))} />
          </Field>
          <Field label="Compare with design"><Select value={design} onChange={(e) => setDesign(e.target.value)} placeholder="No design comparison"
            options={approved.map((d) => ({ value: d.id, label: `${d.title} v${d.version_no}${d.status === "approved" ? " (approved)" : ""}` }))} /></Field>
          <Field label="Developer"><Select value={developer} onChange={(e) => setDeveloper(e.target.value)} placeholder="—" options={people.map((p) => ({ value: p.id, label: p.name }))} /></Field>
          <Field label="Devices">
            <div className="flex h-8 items-center gap-4">
              <Checkbox label="Desktop (1440px)" checked={devices.desktop} onChange={(e) => setDevices({ ...devices, desktop: e.target.checked })} />
              <Checkbox label="Mobile (390px)" checked={devices.mobile} onChange={(e) => setDevices({ ...devices, mobile: e.target.checked })} />
            </div>
          </Field>
          <Field label="Notes" className="col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SubmissionDetail({ campaign: c, sub, onClose }: { campaign: CampaignWithRelations; sub: DevSubmission; onClose: () => void }) {
  const caps = useQuery({ queryKey: ["captures", sub.id], queryFn: () => developmentService.captures(sub.id) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Build ${sub.version_label}`} description={sub.staging_url} className="max-w-4xl">
        <KeyValue items={[
          { label: "Journey", value: c.journeys.find((j) => j.id === sub.journey_id)?.name ?? "All journeys" },
          { label: "Pages", value: <Mono>{sub.page_paths.join(", ")}</Mono> },
          { label: "Devices", value: sub.devices.join(", ") },
          { label: "Notes", value: sub.notes },
        ]} />
        <p className="section-title mb-2 mt-5">Captures</p>
        {!caps.data?.length ? <p className="text-sm text-muted">No captures yet. Run a visual or functional review.</p> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {caps.data.map((cap) => (
              <div key={cap.id} className="rounded-item border border-line">
                <AssetImage bucket="captures" path={cap.storage_path} alt={cap.url} className="aspect-[3/4] rounded-t-item" />
                <div className="p-2 text-xs">
                  <p className="truncate font-mono">{cap.url}</p>
                  <p className="text-muted">{cap.viewport}{cap.diff_ratio != null ? ` · ${(Number(cap.diff_ratio) * 100).toFixed(1)}% differs from design` : ""}</p>
                  {(cap.console_messages as unknown[]).length > 0 && <p className="text-st-amber">{(cap.console_messages as unknown[]).length} console errors</p>}
                  {(cap.failed_requests as unknown[]).length > 0 && <p className="text-st-amber">{(cap.failed_requests as unknown[]).length} failed requests</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- scenarios
const ACTIONS: { value: Step["action"]; label: string; target: string; value_?: string }[] = [
  { value: "goto", label: "Go to path", target: "/register" },
  { value: "fill", label: "Fill field", target: "Label, placeholder or CSS selector", value_: "Value ({{username}} / {{password}} use stored credentials)" },
  { value: "click", label: "Click", target: "Button text or CSS selector" },
  { value: "select", label: "Select option", target: "Field", value_: "Option" },
  { value: "check", label: "Tick checkbox", target: "Label or selector" },
  { value: "expect_text", label: "Expect text visible", target: "Text" },
  { value: "expect_visible", label: "Expect element visible", target: "Selector or text" },
  { value: "expect_url", label: "Expect URL contains", target: "/success" },
  { value: "wait", label: "Wait (ms)", target: "1000" },
];

function Scenarios({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { canEdit } = useAuth();
  const { data } = useQuery({ queryKey: [...qk.dev(c.id), "cases"], queryFn: () => developmentService.testCases(c.id) });
  const reqs = useQuery({ queryKey: qk.requirements(c.id), queryFn: () => requirementsService.list(c.id) });
  const [editing, setEditing] = React.useState<TestCase | "new" | null>(null);
  const [confirm, setConfirm] = React.useState<TestCase | null>(null);
  const remove = useAction((id: string) => developmentService.removeTestCase(id), { invalidate: [qk.dev(c.id)], success: "Scenario deleted", onSuccess: () => setConfirm(null) });
  const reqRef = (id: string | null) => reqs.data?.find((r) => r.id === id)?.ref;
  return (
    <Section title="Functional test scenarios" actions={canEdit && <Button size="sm" onClick={() => setEditing("new")}><Plus />Add scenario</Button>}>
      {!data?.length ? (
        <Card><EmptyState icon={FlaskConical} title="No test scenarios" body="Write scenarios from accepted requirements (for example: register with a valid mobile number, OTP is required). The browser worker runs them on staging. It never bypasses CAPTCHAs or security controls." /></Card>
      ) : (
        <Table>
          <thead><tr><Th>Scenario</Th><Th>Requirement</Th><Th>Steps</Th><Th>Journey</Th><Th>Enabled</Th>{canEdit && <Th />}</tr></thead>
          <tbody>
            {data.map((t) => (
              <Tr key={t.id}>
                <Td className="font-medium">{t.title}</Td>
                <Td>{reqRef(t.requirement_id) ? <Mono>{reqRef(t.requirement_id)}</Mono> : <span className="text-xs text-muted">—</span>}</Td>
                <Td className="text-text-2 num">{(t.steps as Step[]).length}</Td>
                <Td className="text-text-2">{c.journeys.find((j) => j.id === t.journey_id)?.name ?? "All"}</Td>
                <Td>{t.enabled ? "Yes" : "No"}</Td>
                {canEdit && <Td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}><Pencil />Edit</Button>
                  <Button size="icon" variant="ghost" aria-label="Delete scenario" onClick={() => setConfirm(t)}><Trash2 /></Button>
                </Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <ScenarioDialog campaign={c} tc={editing === "new" ? null : editing} requirements={(reqs.data ?? []).filter((r) => r.status === "accepted")} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)} title="Delete scenario?" body="Past results stay in run history."
        confirmLabel="Delete scenario" danger loading={remove.isPending} onConfirm={() => confirm && remove.mutate(confirm.id)} />
    </Section>
  );
}

function ScenarioDialog({ campaign: c, tc, requirements, onClose }: { campaign: CampaignWithRelations; tc: TestCase | null; requirements: { id: string; ref: string; title: string }[]; onClose: () => void }) {
  const [title, setTitle] = React.useState(tc?.title ?? "");
  const [req, setReq] = React.useState(tc?.requirement_id ?? "");
  const [journey, setJourney] = React.useState(tc?.journey_id ?? "");
  const [expected, setExpected] = React.useState(tc?.expected ?? "");
  const [enabled, setEnabled] = React.useState(tc?.enabled ?? true);
  const [steps, setSteps] = React.useState<Step[]>((tc?.steps as Step[] | undefined) ?? [{ action: "goto", target: "/" }]);
  const save = useAction(() => developmentService.saveTestCase({
    id: tc?.id, campaign_id: c.id, title, requirement_id: req || null, journey_id: journey || null, expected, enabled, steps,
  }), { invalidate: [qk.dev(c.id)], success: "Scenario saved", onSuccess: onClose });
  const set = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) => setSteps((s) => { const n = [...s]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); return n; });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={tc ? "Edit scenario" : "Add test scenario"} className="max-w-3xl"
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title || !steps.length} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save scenario</Button></>}>
        <div className="grid gap-3">
          <Field label="Scenario"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Registration rejects a 9-digit mobile number" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Requirement"><Select value={req} onChange={(e) => setReq(e.target.value)} placeholder="Not linked" options={requirements.map((r) => ({ value: r.id, label: `${r.ref} · ${r.title}` }))} /></Field>
            <Field label="Journey"><Select value={journey} onChange={(e) => setJourney(e.target.value)} placeholder="All journeys" options={c.journeys.map((j) => ({ value: j.id, label: j.name }))} /></Field>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-text-2">Steps</p>
            <ol className="space-y-1.5">
              {steps.map((s, i) => {
                const meta = ACTIONS.find((a) => a.value === s.action)!;
                return (
                  <li key={i} className="flex items-center gap-1.5">
                    <span className="w-5 text-right text-xs text-muted num">{i + 1}</span>
                    <Select aria-label="Action" className="w-48" value={s.action} options={ACTIONS.map((a) => ({ value: a.value, label: a.label }))} onChange={(e) => set(i, { action: e.target.value as Step["action"] })} />
                    <Input aria-label="Target" value={s.target} placeholder={meta.target} onChange={(e) => set(i, { target: e.target.value })} />
                    {meta.value_ && <Input aria-label="Value" value={s.value ?? ""} placeholder={meta.value_} onChange={(e) => set(i, { value: e.target.value })} />}
                    <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                    <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                    <Button variant="ghost" size="icon" aria-label="Remove step" onClick={() => setSteps((x) => x.filter((_, k) => k !== i))}><Trash2 /></Button>
                  </li>
                );
              })}
            </ol>
            <Button size="sm" variant="ghost" className="mt-1.5" onClick={() => setSteps((s) => [...s, { action: "click", target: "" }])}><Plus />Add step</Button>
          </div>
          <Field label="Expected result"><Textarea rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
          <Checkbox label="Enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Runs({ campaign: c }: { campaign: CampaignWithRelations }) {
  const { data } = useQuery({ queryKey: [...qk.dev(c.id), "runs"], queryFn: () => developmentService.runs(c.id) });
  const cases = useQuery({ queryKey: [...qk.dev(c.id), "cases"], queryFn: () => developmentService.testCases(c.id) });
  if (!data?.length) return null;
  const title = (id: string | null) => cases.data?.find((t) => t.id === id)?.title ?? "Deleted scenario";
  return (
    <Section title="Recent test runs">
      <div className="space-y-3">
        {data.slice(0, 5).map((r) => (
          <Card key={r.id}>
            <p className="border-b border-line px-3 py-2 text-xs text-muted">{formatDateTime(r.created_at)} · {r.qa_test_results.length} scenarios</p>
            <ul className="divide-y divide-line">
              {r.qa_test_results.map((x) => (
                <li key={x.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <StatusDot tone={VERIFICATION_TONE[x.result]} label={VERIFICATION_LABEL[x.result]} className="w-36" />
                  <div className="min-w-0 flex-1">
                    <p>{title(x.test_case_id)}</p>
                    {(x.actual || x.error) && <p className="text-xs text-text-2">{x.error ?? x.actual}</p>}
                  </div>
                  {x.duration_ms != null && <span className="text-xs text-muted num">{(x.duration_ms / 1000).toFixed(1)}s</span>}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </Section>
  );
}
