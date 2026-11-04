import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Cpu, HardDrive, ShieldCheck, Zap } from "lucide-react";
import { Button, Card, Checkbox, Field, Input } from "@/components/ui";
import { KeyValue, PageHeader, Section, StatusDot, LoadingRows } from "@/components/common";
import { REVIEW_TYPE_LABEL, type ReviewType } from "@/lib/labels";
import { formatBytes, timeAgo } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { qk, useConnectorStatus, useSettings, useWorkerState } from "@/hooks/queries";
import { useAction } from "@/hooks/useAction";
import { settingsService } from "@/services/settings";
import { useTheme } from "@/app/theme";

const FREE_DB = 500 * 1024 * 1024;
const FREE_STORAGE = 1024 * 1024 * 1024;

type Limits = { max_screens_per_review: number; max_pdf_pages: number; image_long_edge: number; max_inference_seconds: number; max_retries: number; job_timeout_seconds: number };
const LIMIT_FIELDS: { key: keyof Limits; label: string; hint: string; min: number; max: number }[] = [
  { key: "max_screens_per_review", label: "Max screens per review", hint: "Default 12", min: 1, max: 40 },
  { key: "max_pdf_pages", label: "Max PDF pages per submission", hint: "Default 30", min: 1, max: 200 },
  { key: "image_long_edge", label: "Image long edge (px)", hint: "Default 1600. Larger = slower, more VRAM", min: 640, max: 3000 },
  { key: "max_inference_seconds", label: "Max inference time per call (s)", hint: "Default 180", min: 30, max: 900 },
  { key: "max_retries", label: "Max retries per job", hint: "Default 2", min: 0, max: 5 },
  { key: "job_timeout_seconds", label: "Job timeout (s)", hint: "No heartbeat for this long → retried or failed", min: 300, max: 7200 },
];

export function SettingsPage() {
  const { isAdmin, isManager, me } = useAuth();
  const { data: s, isLoading } = useSettings();
  const { theme, toggle } = useTheme();
  if (isLoading) return <LoadingRows />;
  return (
    <>
      <PageHeader title="Settings" description={isAdmin ? "Workspace configuration. Changes apply to everyone." : "Only Admins can change workspace settings."} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <WorkspaceName />
          <WorkerSection />
          {s && <AutomationSection />}
          {s && <DomainsSection />}
        </div>
        <div>
          {s && <LimitsSection />}
          {isManager && <StorageSection />}
          <Section title="Appearance">
            <Card className="flex items-center justify-between p-4 text-sm">
              <span>Theme: {theme === "dark" ? "Dark" : "Light"} <span className="text-xs text-muted">(saved in this browser)</span></span>
              <Button size="sm" onClick={toggle}>Switch to {theme === "dark" ? "light" : "dark"}</Button>
            </Card>
          </Section>
          <p className="text-xs text-muted">Signed in as {me?.email}.</p>
        </div>
      </div>
    </>
  );
}

function WorkspaceName() {
  const { me, isAdmin } = useAuth();
  const [name, setName] = React.useState(me?.workspaceName ?? "");
  const save = useAction(() => settingsService.renameWorkspace(me!.workspaceId!, name.trim()), { invalidate: [["me"]], success: "Workspace renamed" });
  return (
    <Section title="Workspace">
      <Card className="p-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(undefined); }}>
          <Input aria-label="Workspace name" value={name} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} />
          {isAdmin && <Button type="submit" loading={save.isPending}>Save</Button>}
        </form>
      </Card>
    </Section>
  );
}

function WorkerSection() {
  const { data } = useWorkerState();
  const connector = useConnectorStatus().data;
  const w = data?.worker;
  return (
    <Section title="Local AI worker">
      <Card className="p-4">
        <div className="mb-3 rounded-box border border-line bg-side px-3 py-2 text-sm text-text-2">
          <span className="font-medium text-text">Claude connector: </span>
          {connector ? `running on this PC (${connector.claude.version}, model ${connector.model}). Reviews you start here are analysed right away.` : <>not running. Start it with <span className="font-mono text-xs">npm run claude</span> in the project folder to let the dashboard use Claude Code on this PC.</>}
        </div>
        <div className="mb-3 flex items-center gap-2">
          <Cpu className="size-4 text-muted" />
          <StatusDot tone={data?.state === "online" ? "green" : data?.state === "busy" ? "blue" : "gray"}
            label={data?.state === "not_set_up" ? "Not set up" : data?.state === "offline" ? "Offline — jobs will wait" : data?.state === "busy" ? "Busy" : "Online"} />
        </div>
        {w ? (
          <KeyValue items={[
            { label: "Worker", value: w.worker_name },
            { label: "Last heartbeat", value: timeAgo(w.last_seen_at) },
            { label: "Model", value: <span className="font-mono text-xs">{w.model}</span> },
            { label: "Model status", value: w.model_ready ? "Ready" : w.model_message ?? "Not ready" },
            { label: "Accelerator", value: w.accelerator.toUpperCase() },
            { label: "Queue", value: `${data?.queued ?? 0} waiting` },
          ]} />
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-text-2">
            <li>Install Ollama on the AI PC and run <span className="font-mono text-xs">ollama pull qwen3-vl:8b</span>.</li>
            <li>Invite a worker account and give it the “AI worker” role on the Team page.</li>
            <li>Follow <span className="font-mono text-xs">services/local-ai-worker/README.md</span> and run <span className="font-mono text-xs">start-worker.ps1</span>.</li>
          </ol>
        )}
        <p className="mt-3 text-xs text-muted">All AI runs on that PC. Nothing is sent to a cloud AI service, and there is no automatic fallback. The PC only makes outgoing connections to Supabase.</p>
      </Card>
    </Section>
  );
}

function AutomationSection() {
  const { isAdmin, me } = useAuth();
  const { data: s } = useSettings();
  const triggers = (s?.auto_triggers ?? {}) as Record<ReviewType, boolean>;
  const save = useAction((patch: Record<string, boolean>) => settingsService.update(me!.workspaceId!, { auto_triggers: { ...triggers, ...patch } }), { invalidate: [qk.settings], success: "Automation updated" });
  const when: Record<ReviewType, string> = {
    sow_analysis: "when a new SOW version is uploaded", sow_vs_design: "when designs are submitted", design_consistency: "when designs are submitted",
    design_vs_development: "when a staging build is submitted", sow_vs_development: "when a staging build is submitted",
    functional_qa: "when a staging build is submitted", regression: "when a staging build is submitted",
  };
  return (
    <Section title="Automatic analysis">
      <Card className="space-y-2.5 p-4">
        <p className="flex items-center gap-2 text-sm text-text-2"><Zap className="size-4 text-muted" />Queue a review automatically. It only creates a pending job: findings still need a manager, and identical content is never re-analysed.</p>
        {(Object.keys(REVIEW_TYPE_LABEL) as ReviewType[]).map((t) => (
          <Checkbox key={t} disabled={!isAdmin || save.isPending} checked={Boolean(triggers[t])} onChange={(e) => save.mutate({ [t]: e.target.checked })}
            label={<span>{REVIEW_TYPE_LABEL[t]} <span className="text-muted">{when[t]}</span></span>} />
        ))}
      </Card>
    </Section>
  );
}

function LimitsSection() {
  const { isAdmin, me } = useAuth();
  const { data: s } = useSettings();
  const [v, setV] = React.useState<Limits>(s!.limits as unknown as Limits);
  const [figma, setFigma] = React.useState(Boolean(s?.figma_enabled));
  const save = useAction(() => settingsService.update(me!.workspaceId!, { limits: v, figma_enabled: figma }), { invalidate: [qk.settings], success: "Limits saved" });
  return (
    <Section title="Resource limits">
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3">
          {LIMIT_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <Input type="number" min={f.min} max={f.max} disabled={!isAdmin} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: Math.max(f.min, Math.min(f.max, Number(e.target.value))) })} />
            </Field>
          ))}
        </div>
        <div className="mt-4 border-t border-line pt-3">
          <Checkbox disabled={!isAdmin} checked={figma} onChange={(e) => setFigma(e.target.checked)} label="Enable the Figma adapter (needs a Figma token in the worker’s local config)" />
        </div>
        {isAdmin && <Button className="mt-4" variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save limits</Button>}
      </Card>
    </Section>
  );
}

function DomainsSection() {
  const { isAdmin, me } = useAuth();
  const { data: s } = useSettings();
  const [text, setText] = React.useState((s?.allowed_domains ?? []).join(", "));
  const save = useAction(() => settingsService.update(me!.workspaceId!, {
    allowed_domains: text.split(/[,\s]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean),
  }), { invalidate: [qk.settings], success: "Allowed domains saved" });
  return (
    <Section title="Browser testing allow-list">
      <Card className="p-4">
        <p className="mb-2 flex items-center gap-2 text-sm text-text-2"><ShieldCheck className="size-4 text-muted" />The browser worker visits only these domains (plus each test environment’s own list). Private, loopback, link-local and cloud-metadata addresses are always blocked, after every redirect.</p>
        <Field label="Domains" hint="Comma separated, e.g. staging.bigcity-golddrop.com, *.vercel.app">
          <Input disabled={!isAdmin} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {isAdmin && <Button className="mt-3" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save domains</Button>}
      </Card>
    </Section>
  );
}

function StorageSection() {
  const { data, error } = useQuery({ queryKey: ["storage-usage"], queryFn: settingsService.storageUsage });
  const files = Object.values(data?.buckets ?? {}).reduce((a, b) => a + b, 0);
  const Bar = ({ used, total }: { used: number; total: number }) => (
    <div className="h-1.5 overflow-hidden rounded-full bg-hover"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (used / total) * 100)}%` }} /></div>
  );
  return (
    <Section title="Storage and backups">
      <Card className="space-y-3 p-4 text-sm">
        {error ? <p className="text-muted">Could not read usage.</p> : (
          <>
            <div><div className="mb-1 flex justify-between"><span className="flex items-center gap-1.5"><HardDrive className="size-4 text-muted" />File storage</span><span className="num text-text-2">{formatBytes(files)} of 1 GB (free tier)</span></div><Bar used={files} total={FREE_STORAGE} /></div>
            <div><div className="mb-1 flex justify-between"><span>Database</span><span className="num text-text-2">{formatBytes(data?.database_bytes)} of 500 MB (free tier)</span></div><Bar used={data?.database_bytes ?? 0} total={FREE_DB} /></div>
            <p className="text-xs text-muted">{Object.entries(data?.buckets ?? {}).map(([b, n]) => `${b}: ${formatBytes(n)}`).join(" · ") || "No files yet."}</p>
          </>
        )}
        <div className="border-t border-line pt-3 text-xs text-text-2">
          <p className="mb-1 font-medium text-text">Free-tier notes</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Supabase pauses free projects after a period of inactivity (about a week); restore it from the Supabase dashboard. Don’t rely on the worker’s heartbeat to prevent this.</li>
            <li>Free projects have no automatic daily backups. Run the backup script in docs/SETUP.md weekly.</li>
            <li>Images are downscaled before upload to save space. Limits change with Supabase’s plans; check their pricing page.</li>
          </ul>
        </div>
      </Card>
    </Section>
  );
}
