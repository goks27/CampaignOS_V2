import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { Button, Card, Select } from "@/components/ui";
import { EmptyState, LoadingRows, Pill, Section, StageRing, Table, Td, Th, Tr } from "@/components/common";
import { HEALTH_LABEL, HEALTH_TONE } from "@/lib/labels";
import { downloadText, formatDate, toCsv } from "@/lib/utils";
import { progressService, type PortfolioRow } from "@/services/progress";
import { useCampaigns } from "@/hooks/queries";
import { CampaignReport } from "./CampaignReport";

export const portfolioCsv = (rows: PortfolioRow[]) => toCsv(rows.map((r) => ({
  campaign: r.name, client: r.client ?? "", stage: r.stage, status: r.status, health: r.health, launch: r.target_launch_date ?? "",
  accepted_requirements: r.requirements_accepted, total_requirements: r.requirements_total, open_findings: r.findings_open, critical_findings: r.critical_open, open_tasks: r.tasks_open,
})));

/** Every campaign in one table (one request), with CSV and print, and a full delivery report for the one you pick. */
export function PortfolioReport() {
  const rows = useQuery({ queryKey: ["portfolio"], queryFn: () => progressService.portfolio(), staleTime: 30_000 });
  const { data: campaigns } = useCampaigns();
  const [selected, setSelected] = React.useState("");
  const list = (rows.data ?? []).filter((r) => r.status !== "archived");
  const picked = (campaigns ?? []).find((c) => c.id === selected);

  return (
    <Section id="portfolio" title="Portfolio" actions={<span className="no-print flex gap-2">
      <Button size="sm" onClick={() => downloadText(`journey-portfolio-${new Date().toISOString().slice(0, 10)}.csv`, portfolioCsv(list))} disabled={!list.length}><Download />Export CSV</Button>
      <Button size="sm" onClick={() => window.print()}><Printer />Print</Button>
    </span>}>
      {rows.isLoading ? <LoadingRows rows={3} /> : !list.length ? <Card><EmptyState title="No campaigns yet" body="Create a campaign and it appears here with its health and what is open." /></Card> : (
        <Table>
          <thead><tr><Th>Campaign</Th><Th>Stage</Th><Th>Health</Th><Th>Launch</Th><Th>Requirements</Th><Th>Open findings</Th><Th>Critical</Th><Th>Open tasks</Th></tr></thead>
          <tbody>
            {list.map((r) => (
              <Tr key={r.id} onClick={() => setSelected(r.id)} selected={selected === r.id}>
                <Td className="font-medium">{r.name}</Td>
                <Td><StageRing stage={r.stage as never} /></Td>
                <Td><Pill tone={HEALTH_TONE[r.health as keyof typeof HEALTH_TONE]}>{HEALTH_LABEL[r.health as keyof typeof HEALTH_LABEL]}</Pill></Td>
                <Td className="num whitespace-nowrap">{formatDate(r.target_launch_date, true)}</Td>
                <Td className="num">{r.requirements_accepted}<span className="text-muted"> / {r.requirements_total}</span></Td>
                <Td className="num">{r.findings_open}</Td>
                <Td className="num">{r.critical_open ? <span className="text-st-red">{r.critical_open}</span> : 0}</Td>
                <Td className="num">{r.tasks_open}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {list.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="no-print flex items-center gap-2"><span className="text-sm text-text-2">Full report for</span>
            <Select aria-label="Campaign" className="w-64" value={selected} onChange={(e) => setSelected(e.target.value)} placeholder="Choose a campaign" options={list.map((r) => ({ value: r.id, label: r.name }))} />
          </div>
          {picked ? <CampaignReport campaign={picked} /> : null}
        </div>
      )}
    </Section>
  );
}
