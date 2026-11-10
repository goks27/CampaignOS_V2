import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Smartphone } from "lucide-react";
import { Card } from "@/components/ui";
import { Section, StatusDot, Table, Td, Th, Tr } from "@/components/common";
import { cn, formatDateTime } from "@/lib/utils";
import { siteNotes, type DeviceRow, type SiteNotes } from "@/lib/devices";
import { jobsService } from "@/services/jobs";
import type { CampaignWithRelations } from "@/services/campaigns";

const LOGIN: Record<string, { tone: "green" | "gray" | "red" | "amber"; label: string }> = {
  ok: { tone: "green", label: "Signed in" }, registered: { tone: "green", label: "Registered" }, none: { tone: "gray", label: "No login used" }, failed: { tone: "red", label: "Sign-in failed" },
  needs: { tone: "amber", label: "Needs details" }, blocked: { tone: "amber", label: "CAPTCHA" },
};

/** What the sign-in did, in words, with what to do about it. Nothing when there was no login or it simply worked. */
function LoginNote({ login }: { login: NonNullable<SiteNotes["login"]> }) {
  if (!login || ["none", "ok"].includes(login.status)) return null;
  return (
    <p className={cn("rounded-box border px-3 py-2 text-sm", login.status === "failed" ? "border-st-red/40 bg-st-red/5" : "border-st-amber/40 bg-st-amber/5")} data-testid="login-note">
      <span className="font-medium">{LOGIN[login.status]?.label}. </span>{login.message}
      {login.status === "needs" && login.needs?.length ? <> Open the test environment, choose <span className="font-medium">Credentials</span> and add {login.needs.map((n) => `“${n} = value”`).join(" and ")} under Extra, then run the check again.</> : null}
    </p>
  );
}

function Row({ d, open, onToggle }: { d: DeviceRow; open: boolean; onToggle: () => void }) {
  const ran = d.pages_tested > 0;
  return (
    <>
      <Tr onClick={d.top_issues.length ? onToggle : undefined} data-testid={`device-${d.id}`}>
        <Td><span className="flex items-center gap-2">{d.top_issues.length ? <ChevronRight className={cn("size-4 text-muted transition-transform", open && "rotate-90")} /> : <span className="size-4" />}<span><span className="font-medium">{d.label}</span><span className="block text-xs text-muted">{d.family}</span></span></span></Td>
        <Td className="num">{ran ? `${d.pages_tested}${d.pages_failed ? ` (${d.pages_failed} failed)` : ""}` : "—"}</Td>
        <Td>{d.skipped ? <StatusDot tone="gray" label="Not tested" /> : !ran ? <StatusDot tone="gray" label="Not tested" /> : d.issues ? <StatusDot tone={d.pages_failed ? "red" : "amber"} label={`${d.issues} issue${d.issues === 1 ? "" : "s"}`} /> : <StatusDot tone="green" label="No issues" />}</Td>
        <Td><StatusDot tone={LOGIN[d.login]?.tone ?? "gray"} label={LOGIN[d.login]?.label ?? d.login} /></Td>
      </Tr>
      {open && (
        <tr><td colSpan={4} className="border-b border-line bg-side px-4 py-2">
          <ul className="list-disc space-y-0.5 pl-5 text-sm" data-testid={`device-${d.id}-issues`}>{d.top_issues.map((t) => <li key={t}>{t}</li>)}</ul>
          {d.skipped && <p className="mt-1 text-xs text-muted">{d.skipped}</p>}
        </td></tr>
      )}
    </>
  );
}

/** The latest site check, device by device: pages opened, problems seen on each, and whether the login worked. */
export function DeviceReport({ campaign: c }: { campaign: CampaignWithRelations }) {
  const jobs = useQuery({ queryKey: ["jobs", "device-report", c.id], queryFn: () => jobsService.list({ campaignId: c.id, limit: 40 }), refetchInterval: 20_000 });
  const [openId, setOpenId] = React.useState<string | null>(null);
  const job = (jobs.data ?? []).find((j) => j.review_type === "site_check" && j.status === "completed" && siteNotes(j.result_summary));
  const notes = job ? siteNotes(job.result_summary) : null;
  if (!job || !notes?.devices) return null;
  const devices = notes.devices;
  const withIssues = devices.filter((d) => d.issues > 0).length;
  return (
    <Section title="Latest site check, device by device">
      <Card className="space-y-3 p-3" data-testid="device-report">
        <p className="text-sm text-text-2">
          {job.finished_at ? `${formatDateTime(job.finished_at)} · ` : ""}{notes.pages_checked ?? 0} page{notes.pages_checked === 1 ? "" : "s"} on {notes.devices_tested ?? devices.length} devices
          {" · "}{withIssues ? `${withIssues} of ${devices.length} devices have issues` : "no issues on any device"}.
          {" "}<Link className="text-accent hover:underline" to={`/inbox?type=findings&campaign=${c.id}`}>Open the findings</Link>
        </p>
        {notes.login && <LoginNote login={notes.login} />}
        {notes.stopped_early && <p className="text-sm text-text-2">The check stopped early: it {notes.stopped_early}.</p>}
        <Table>
          <thead><tr><Th>Device</Th><Th>Pages opened</Th><Th>Result</Th><Th>Sign-in</Th></tr></thead>
          <tbody>{devices.map((d) => <Row key={d.id} d={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} />)}</tbody>
        </Table>
        <p className="flex items-start gap-1.5 text-xs text-muted"><Smartphone className="mt-px size-3.5 shrink-0" />These are emulated devices: a real browser engine (Chromium) at each device’s screen size, pixel density, touch and user agent. They catch layout, loading and script problems. They are not physical phones, so Safari-only rendering and real hardware behaviour (notch, on-screen keyboard, slow processors) are not covered. Click a device to see what was found on it.</p>
      </Card>
    </Section>
  );
}
