import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { Card, Select } from "@/components/ui";
import { EmptyState, PageHeader, Section, StageRing, Table, Td, Th, Tr } from "@/components/common";
import { STAGE_LABEL, TONE_HEX, HEALTH_TONE } from "@/lib/labels";
import { cn, formatDate, isOverdue } from "@/lib/utils";
import { useCampaigns } from "@/hooks/queries";
import { deliveryService } from "@/services/delivery";

const DAY = 86_400_000;
const toDate = (s: string) => new Date(`${s}T00:00:00`);

export function TimelinePage() {
  const { data: campaigns } = useCampaigns();
  const milestones = useQuery({ queryKey: ["delivery", "milestones", "all"], queryFn: () => deliveryService.milestones() });
  const [months, setMonths] = React.useState("3");

  const rows = (campaigns ?? []).filter((c) => (c.status === "active" || c.status === "on_hold") && (c.start_date || c.target_launch_date));
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0); start.setMonth(start.getMonth() - 1);
  const end = new Date(start); end.setMonth(end.getMonth() + Number(months) + 1);
  const span = end.getTime() - start.getTime();
  const pct = (d: Date) => Math.max(0, Math.min(100, ((d.getTime() - start.getTime()) / span) * 100));
  const monthsList: Date[] = [];
  for (let d = new Date(start); d < end; d.setMonth(d.getMonth() + 1)) monthsList.push(new Date(d));
  const today = pct(new Date());
  const upcoming = (milestones.data ?? []).filter((m) => !m.done_at).slice(0, 30);

  return (
    <>
      <PageHeader title="Timeline" description="Campaign windows, milestones and launch dates."
        actions={<Select aria-label="Range" className="w-36" value={months} onChange={(e) => setMonths(e.target.value)}
          options={[{ value: "2", label: "Next 2 months" }, { value: "3", label: "Next 3 months" }, { value: "6", label: "Next 6 months" }, { value: "12", label: "Next 12 months" }]} />} />
      {!rows.length ? (
        <Card><EmptyState icon={CalendarRange} title="Nothing to plot yet" body="Give active campaigns a start date and a target launch date, and add milestones on each campaign’s Overview." /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[220px_1fr] border-b border-line">
              <div className="px-3 py-2 text-xs text-muted">Campaign</div>
              <div className="relative h-8">
                {monthsList.map((m) => (
                  <span key={m.toISOString()} className="absolute top-2 border-l border-line pl-1.5 text-xs text-muted" style={{ left: `${pct(m)}%` }}>
                    {m.toLocaleDateString("en-IN", { month: "short", year: m.getMonth() === 0 ? "numeric" : undefined })}
                  </span>
                ))}
              </div>
            </div>
            {rows.map((c) => {
              const s = c.start_date ? toDate(c.start_date) : new Date(toDate(c.target_launch_date!).getTime() - 30 * DAY);
              const e = c.target_launch_date ? toDate(c.target_launch_date) : new Date(s.getTime() + 30 * DAY);
              const left = pct(s);
              const width = Math.max(0.8, pct(e) - left);
              const ms = (milestones.data ?? []).filter((m) => m.campaign_id === c.id);
              return (
                <div key={c.id} className="grid grid-cols-[220px_1fr] border-b border-line last:border-0 hover:bg-hover/60">
                  <Link to={`/campaigns/${c.id}`} className="min-w-0 px-3 py-2.5">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate text-xs text-muted">{STAGE_LABEL[c.stage]}</p>
                  </Link>
                  <div className="relative">
                    {monthsList.map((m) => <span key={m.toISOString()} className="absolute inset-y-0 border-l border-line/60" style={{ left: `${pct(m)}%` }} />)}
                    <span className="absolute inset-y-0 w-px bg-accent" style={{ left: `${today}%` }} title="Today" />
                    <div className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full opacity-80" style={{ left: `${left}%`, width: `${width}%`, background: TONE_HEX[HEALTH_TONE[c.health]] }}
                      title={`${formatDate(c.start_date)} → ${formatDate(c.target_launch_date)}`} />
                    {ms.map((m) => (
                      <span key={m.id} title={`${m.title} · ${formatDate(m.due_date)}`}
                        className={cn("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-surface", m.done_at ? "bg-st-green" : isOverdue(m.due_date) ? "bg-st-amber" : "bg-text-2")}
                        style={{ left: `${pct(toDate(m.due_date))}%` }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-4 border-t border-line px-3 py-2 text-xs text-muted">
            <span>Bar colour = health</span><span>◆ milestone (green done, amber overdue)</span><span className="text-accent">| today</span>
          </div>
        </Card>
      )}
      <Section title="Upcoming milestones" className="mt-6">
        {!upcoming.length ? <Card><EmptyState title="No open milestones" /></Card> : (
          <Table>
            <thead><tr><Th>Due</Th><Th>Milestone</Th><Th>Campaign</Th><Th>Stage</Th></tr></thead>
            <tbody>
              {upcoming.map((m) => (
                <Tr key={m.id}>
                  <Td className={cn("whitespace-nowrap num", isOverdue(m.due_date) && "text-st-amber")}>{formatDate(m.due_date)}</Td>
                  <Td>{m.title}</Td>
                  <Td><Link to={`/campaigns/${m.campaign_id}`} className="text-text-2 hover:text-text">{m.campaigns?.name}</Link></Td>
                  <Td>{m.stage ? <StageRing stage={m.stage} /> : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
