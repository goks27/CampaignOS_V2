import * as React from "react";
import Papa from "papaparse";
import { Link, Navigate } from "react-router-dom";
import { FileSpreadsheet, Upload, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, Select } from "@/components/ui";
import { EmptyState, PageHeader, Section, StatusDot, Table, Td, Th, Tr } from "@/components/common";
import { STAGE_LABEL, CAMPAIGN_STATUS_LABEL, PRIORITY_LABEL } from "@/lib/labels";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/toast";
import { importService, type ImportResult, type ImportRow } from "@/services/settings";
import { qk } from "@/hooks/queries";
import { TARGET_FIELDS, autoMap, mapRow } from "./mapping";

export function ImportPage() {
  const { canEdit } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [fileName, setFileName] = React.useState("");
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [raw, setRaw] = React.useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [plan, setPlan] = React.useState<ImportResult | null>(null);
  const [done, setDone] = React.useState<ImportResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const rows: ImportRow[] = React.useMemo(() => raw.map((r) => mapRow(r, mapping)).filter((r) => r.name || Object.values(r).some(Boolean)), [raw, mapping]);
  React.useEffect(() => { setPlan(null); }, [mapping, raw]);
  if (!canEdit) return <Navigate to="/" replace />;

  const onFile = (f: File) => {
    if (!/\.csv$/i.test(f.name)) return toast.error("Choose a .csv file. In Notion: ••• → Export → Markdown & CSV, then unzip.");
    if (f.size > 5 * 1024 * 1024) return toast.error("That CSV is over 5 MB. Export a smaller view.");
    Papa.parse<Record<string, string>>(f, {
      header: true, skipEmptyLines: true,
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean);
        if (!hs.length) return toast.error("No header row found in that CSV.");
        setFileName(f.name); setHeaders(hs); setRaw(res.data); setMapping(autoMap(hs)); setDone(null);
      },
      error: (e) => toast.error(e.message, "Could not read the CSV"),
    });
  };

  const run = async (dry: boolean) => {
    setBusy(true);
    try {
      const r = await importService.run(rows, dry);
      if (dry) setPlan(r);
      else {
        setDone(r);
        setPlan(null);
        void qc.invalidateQueries({ queryKey: qk.campaigns });
        void qc.invalidateQueries({ queryKey: qk.summary });
        toast.success(`Imported: ${r.create} created, ${r.update} updated${r.error ? `, ${r.error} skipped` : ""}.`);
      }
    } catch (e) {
      toast.error(e, "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const missingName = !mapping.name;
  return (
    <>
      <PageHeader title="Import campaigns from Notion" description="Upload a Notion database export (CSV). Map the columns, check a dry run, then import. Existing campaigns with the same name and client are updated, not duplicated." />
      {done ? (
        <Card><EmptyState icon={CheckCircle2} title={`Import finished: ${done.create} created, ${done.update} updated`}
          body={done.error ? `${done.error} rows were skipped; see the list below.` : "Every row was imported."}
          action={<div className="flex gap-2"><Button asChild variant="primary"><Link to="/campaigns">View campaigns</Link></Button><Button onClick={() => { setDone(null); setRaw([]); setHeaders([]); }}>Import another file</Button></div>} />
          {done.error > 0 && <ResultTable result={done} />}
        </Card>
      ) : !headers.length ? (
        <Card>
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
            <EmptyState icon={FileSpreadsheet} title="Drop a CSV export here" body="In Notion, open the database, choose ••• → Export → Markdown & CSV, unzip it and upload the .csv file."
              action={<Button variant="primary" onClick={() => inputRef.current?.click()}><Upload />Choose CSV</Button>} />
          </div>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
        </Card>
      ) : (
        <>
          <Section title={`1. Map columns · ${fileName} · ${raw.length} rows`} actions={<Button size="sm" variant="ghost" onClick={() => { setHeaders([]); setRaw([]); }}>Choose another file</Button>}>
            <Card className="grid gap-x-6 gap-y-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {TARGET_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <span className="w-36 shrink-0 text-text-2">{f.label}{f.required && <span className="text-st-red"> *</span>}</span>
                  <Select aria-label={f.label} value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                    placeholder="— Not imported —" options={headers.map((h) => ({ value: h, label: h }))} />
                </label>
              ))}
            </Card>
            <p className="mt-2 text-xs text-muted">Stages, statuses, priorities and dates are converted automatically; unknown values fall back to defaults (Brief & Planning, Active, Medium). Journeys can be comma or semicolon separated.</p>
          </Section>
          <Section title="2. Preview">
            <Table>
              <thead><tr><Th>Name</Th><Th>Client</Th><Th>Stage</Th><Th>Status</Th><Th>Priority</Th><Th>Start</Th><Th>Launch</Th><Th>Journeys</Th></tr></thead>
              <tbody>
                {rows.slice(0, 10).map((r, i) => (
                  <Tr key={i}>
                    <Td className={r.name ? "font-medium" : "text-st-red"}>{r.name || "Missing name"}</Td>
                    <Td>{r.client || "—"}</Td>
                    <Td>{r.stage ? STAGE_LABEL[r.stage] : <span className="text-muted">default</span>}</Td>
                    <Td>{r.status ? CAMPAIGN_STATUS_LABEL[r.status] : <span className="text-muted">default</span>}</Td>
                    <Td>{r.priority ? PRIORITY_LABEL[r.priority] : <span className="text-muted">default</span>}</Td>
                    <Td className="num">{r.start_date || "—"}</Td>
                    <Td className="num">{r.target_launch_date || "—"}</Td>
                    <Td className="max-w-[220px] truncate text-text-2">{r.journeys || "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {rows.length > 10 && <p className="mt-1 text-xs text-muted">Showing 10 of {rows.length} rows.</p>}
          </Section>
          <Section title="3. Dry run, then import">
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={missingName || !rows.length} loading={busy && !plan} onClick={() => void run(true)}>Run dry run</Button>
              <Button variant="primary" disabled={!plan || plan.create + plan.update === 0} loading={busy && Boolean(plan)} onClick={() => void run(false)}>
                Import {plan ? `${plan.create + plan.update} campaigns` : ""}
              </Button>
              {missingName && <span className="text-xs text-st-red">Map a column to “Campaign name” first.</span>}
              {!plan && !missingName && <span className="text-xs text-muted">The dry run changes nothing; it shows exactly what would happen.</span>}
            </div>
            {plan && <Card className="mt-3"><ResultTable result={plan} /></Card>}
          </Section>
        </>
      )}
    </>
  );
}

function ResultTable({ result }: { result: ImportResult }) {
  return (
    <>
      <p className="border-b border-line px-3 py-2 text-sm">
        {result.dry_run ? "Dry run: " : ""}<span className="text-st-green">{result.create} to create</span> · <span className="text-st-blue">{result.update} to update</span>
        {result.error > 0 && <> · <span className="text-st-red">{result.error} with errors (skipped)</span></>}
      </p>
      <ul className="max-h-80 divide-y divide-line overflow-y-auto">
        {result.rows.map((r) => (
          <li key={r.row} className="flex items-center gap-3 px-3 py-1.5 text-sm">
            <span className="w-10 text-xs text-muted num">#{r.row}</span>
            <span className="flex-1 truncate">{r.name || "—"}</span>
            {r.action === "error" ? <span className="text-xs text-st-red">{r.message}</span>
              : <StatusDot tone={r.action === "create" ? "green" : "blue"} label={r.action === "create" ? "Create" : "Update"} />}
          </li>
        ))}
      </ul>
    </>
  );
}
