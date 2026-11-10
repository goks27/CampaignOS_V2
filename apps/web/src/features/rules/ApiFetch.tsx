import * as React from "react";
import { Globe } from "lucide-react";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { StatusDot } from "@/components/common";
import { apiCheckService, type ApiCheckResult } from "@/services/connector";
import type { Winner } from "./engine";

/** Dotted path into a JSON answer: winners, data.winners, a.b[0]. */
export function pickPath(obj: unknown, p: string): unknown {
  let cur = obj;
  for (const part of p.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) { if (cur == null || typeof cur !== "object") return undefined; cur = (cur as Record<string, unknown>)[part]; }
  return cur;
}

/** Turns what an API answered into winners. Accepts participantId, participant_id, userId or id; keeps day, reward, tier, code and disbursement id when present. */
export function toWinners(list: unknown): Winner[] | string {
  if (!Array.isArray(list)) return "The answer at that path is not a list.";
  const out: Winner[] = [];
  for (const [i, x] of list.entries()) {
    const o = (typeof x === "string" ? { id: x } : x) as Record<string, unknown> | null;
    const id = o && (o.participantId ?? o.participant_id ?? o.userId ?? o.user_id ?? o.id);
    if (id == null) return `Item ${i + 1} has no participant id (looked for participantId, participant_id, userId, user_id, id).`;
    const s = (v: unknown) => (v == null ? undefined : String(v));
    out.push({ participantId: String(id), day: s(o!.day ?? o!.date), reward: s(o!.reward), tier: s(o!.tier), code: s(o!.code), disbursementId: s(o!.disbursementId ?? o!.disbursement_id) });
  }
  return out;
}

/** Calls a STAGING endpoint through the connector and hands the winners it returned to the scenario. Nothing here is decided by AI. */
export function ApiFetch({ allowed, onWinners }: { allowed: string[]; onWinners: (w: Winner[]) => void }) {
  const [url, setUrl] = React.useState("");
  const [method, setMethod] = React.useState("GET");
  const [headers, setHeaders] = React.useState("");
  const [body, setBody] = React.useState("");
  const [path, setPath] = React.useState("winners");
  const [staging, setStaging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [res, setRes] = React.useState<ApiCheckResult | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);

  const go = async () => {
    setBusy(true); setProblem(null); setRes(null);
    try {
      const hs: Record<string, string> = {}; const secret: string[] = [];
      for (const line of headers.split("\n").map((l) => l.trim()).filter(Boolean)) {
        const i = line.indexOf(":"); if (i < 1) throw new Error(`Header lines look like Name: value. Not understood: ${line}`);
        const k = line.slice(0, i).trim(); hs[k] = line.slice(i + 1).trim(); if (/key|token|secret|auth|pass/i.test(k)) secret.push(k);
      }
      let parsed: unknown = undefined;
      if (body.trim()) { try { parsed = JSON.parse(body); } catch { throw new Error("The body is not valid JSON."); } }
      const r = await apiCheckService.run({ method, url, headers: hs, secret_headers: secret, body: parsed }, allowed);
      setRes(r);
      if (r.result === "blocked" || r.error) { setProblem(r.error ?? "Not called."); return; }
      const w = toWinners(pickPath(r.json, path));
      if (typeof w === "string") { setProblem(w); return; }
      onWinners(w);
    } catch (e) { setProblem(e instanceof Error ? e.message : "The call failed."); } finally { setBusy(false); }
  };

  return (
    <details className="group rounded-box border border-line" data-testid="api-fetch">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm"><Globe className="size-4 text-muted" />Get the actual winners from a staging API<span className="text-xs text-muted">(optional)</span></summary>
      <div className="space-y-2 border-t border-line p-3">
        <div className="grid gap-2 sm:grid-cols-[110px_1fr]">
          <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)} options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m }))} /></Field>
          <Field label="Staging URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://staging.example.com/api/winners" /></Field>
        </div>
        <Field label="Headers" hint="One per line, like X-Api-Key: value. Sent, never shown or saved."><Textarea rows={2} autoComplete="off" value={headers} onChange={(e) => setHeaders(e.target.value)} /></Field>
        {method !== "GET" && <Field label="Body (JSON)"><Textarea rows={3} spellCheck={false} className="font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} /></Field>}
        <Field label="Where the winners are in the answer" hint="A path like winners or data.winners. Each item needs a participant id."><Input value={path} onChange={(e) => setPath(e.target.value)} /></Field>
        <Checkbox checked={staging} onChange={(e) => setStaging(e.target.checked)} label="This is a staging address, not production. It may change data." />
        <Button size="sm" variant="primary" disabled={!staging || !url.trim()} loading={busy} onClick={() => void go()} data-testid="api-call">Call and use the winners</Button>
        {problem && <p className="text-sm text-st-red" role="alert" data-testid="api-problem">{problem}</p>}
        {res && !problem && <p className="flex items-center gap-2 text-sm text-text-2" data-testid="api-ok"><StatusDot tone="green" />HTTP {res.status} in {res.ms} ms. The winners are in the scenario below; run the checks.</p>}
      </div>
    </details>
  );
}
