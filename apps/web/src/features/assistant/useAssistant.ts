import * as React from "react";
import { friendly } from "@/components/toast";
import { assistantService, ConnectorOffline, type Call, type Outcome, type Result, type TranscriptEntry } from "@/services/assistant";
import { TOOL_BY_NAME, TOOL_SPECS, type Applied, type Card, type Lookup } from "./tools";

export type ProposalStatus = "pending" | "applying" | "applied" | "skipped" | "failed";
export type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "lookup"; id: string; tool: string; status: "running" | "done" | "failed"; error?: string }
  | { kind: "proposal"; id: string; tool: string; card: Card; status: ProposalStatus; detail?: string; link?: string; error?: string }
  | { kind: "error"; id: string; text: string; offline?: boolean };

/** Most read-and-answer rounds Claude gets for one message. Stops a model that keeps looking things up. */
const MAX_STEPS = 6;
let seq = 0;
const nid = () => `i${++seq}`;

type Env = {
  lookup: Lookup;
  context: () => Record<string, unknown>;
  /** Called after a confirmed change so the dashboard refreshes. */
  onChanged: () => void;
};

type Pending = { call: Call; apply: () => Promise<Applied> };

export function useAssistant(env: Env) {
  const [items, setItems] = React.useState<Item[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [auditMissing, setAuditMissing] = React.useState(false);
  const transcript = React.useRef<TranscriptEntry[]>([]);
  const abort = React.useRef<AbortController | null>(null);
  const pending = React.useRef<Map<string, Pending>>(new Map()); // proposal id -> how to apply it
  const batch = React.useRef<{ open: Set<string>; outcomes: Outcome[] } | null>(null);
  const envRef = React.useRef(env);
  envRef.current = env;

  const add = (i: Item) => setItems((xs) => [...xs, i]);
  const patch = (id: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? ({ ...x, ...p } as Item) : x)));

  /** Records one proposal's outcome. When every proposal of the batch is settled, the model gets to know on its next turn. */
  const settle = (id: string, o: Outcome) => {
    pending.current.delete(id);
    const b = batch.current;
    if (!b) return;
    b.outcomes.push(o);
    b.open.delete(id);
    if (b.open.size === 0) {
      transcript.current.push({ type: "outcomes", outcomes: b.outcomes });
      batch.current = null;
    }
  };

  async function runLoop(signal: AbortSignal) {
    for (let step = 0; step < MAX_STEPS; step++) {
      const { reply, calls } = await assistantService.turn({ transcript: transcript.current, tools: TOOL_SPECS, context: envRef.current.context() }, signal);
      if (reply) {
        add({ kind: "assistant", id: nid(), text: reply });
        transcript.current.push({ type: "assistant", text: reply });
      }
      if (!calls.length) return;
      transcript.current.push({ type: "calls", calls });

      const reads = calls.filter((c) => TOOL_BY_NAME.get(c.tool)?.kind === "read");
      const writes = calls.filter((c) => TOOL_BY_NAME.get(c.tool)?.kind === "write");

      if (reads.length) {
        const ids = new Map(reads.map((c) => [c.id, nid()]));
        reads.forEach((c) => add({ kind: "lookup", id: ids.get(c.id)!, tool: c.tool, status: "running" }));
        const results: Result[] = await Promise.all(reads.map(async (c): Promise<Result> => {
          const tool = TOOL_BY_NAME.get(c.tool)!;
          try {
            const data = tool.kind === "read" ? await tool.run(c.args) : null;
            patch(ids.get(c.id)!, { status: "done" });
            return { id: c.id, tool: c.tool, ok: true, data };
          } catch (e) {
            const error = friendly(e);
            patch(ids.get(c.id)!, { status: "failed", error });
            return { id: c.id, tool: c.tool, ok: false, error };
          }
        }));
        // Reading and proposing happen in separate steps: the user must never be shown changes based on data Claude has not seen yet.
        for (const w of writes) results.push({ id: w.id, tool: w.tool, ok: false, error: "Not shown to the user. Read the data first, then propose changes in a separate step." });
        transcript.current.push({ type: "results", results });
        continue;
      }

      // Only writes: show Confirm cards and wait for the user.
      const open = new Set<string>();
      const outcomes: Outcome[] = [];
      for (const c of writes) {
        const tool = TOOL_BY_NAME.get(c.tool);
        if (!tool || tool.kind !== "write") { outcomes.push({ id: c.id, tool: c.tool, status: "failed", detail: "Unknown action." }); continue; }
        try {
          const { apply, ...card } = tool.propose(c.args, envRef.current.lookup);
          const id = nid();
          pending.current.set(id, { call: c, apply });
          open.add(id);
          add({ kind: "proposal", id, tool: c.tool, card, status: "pending" });
        } catch (e) {
          outcomes.push({ id: c.id, tool: c.tool, status: "failed", detail: friendly(e) });
        }
      }
      if (open.size) { batch.current = { open, outcomes }; return; }
      // Nothing valid to show: tell Claude what was wrong so it can correct itself.
      transcript.current.push({ type: "outcomes", outcomes });
    }
    add({ kind: "error", id: nid(), text: "Claude kept looking things up without answering. Try a narrower question." });
  }

  const skipPending = (why: string) => {
    for (const [id, p] of [...pending.current]) {
      patch(id, { status: "skipped" });
      settle(id, { id: p.call.id, tool: p.call.tool, status: "skipped", detail: why });
    }
  };

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    skipPending("The user moved on without confirming.");
    add({ kind: "user", id: nid(), text: t });
    transcript.current.push({ type: "user", text: t });
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    try {
      await runLoop(ac.signal);
    } catch (e) {
      if (!ac.signal.aborted) add({ kind: "error", id: nid(), text: e instanceof Error ? e.message : friendly(e), offline: e instanceof ConnectorOffline });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const confirm = async (id: string) => {
    const p = pending.current.get(id);
    if (!p) return;
    patch(id, { status: "applying" });
    try {
      const r = await p.apply();
      patch(id, { status: "applied", detail: r.summary, link: r.link });
      settle(id, { id: p.call.id, tool: p.call.tool, status: "applied", detail: r.summary });
      envRef.current.onChanged();
      const ok = await assistantService.audit(r.campaignId, p.call.tool, r.summary, p.call.args).catch(() => false);
      if (!ok) setAuditMissing(true);
    } catch (e) {
      const error = friendly(e);
      patch(id, { status: "failed", error });
      settle(id, { id: p.call.id, tool: p.call.tool, status: "failed", detail: error });
    }
  };

  const skip = (id: string) => {
    const p = pending.current.get(id);
    if (!p) return;
    patch(id, { status: "skipped" });
    settle(id, { id: p.call.id, tool: p.call.tool, status: "skipped", detail: "The user chose not to apply it." });
  };

  const stop = () => abort.current?.abort();
  const reset = () => {
    abort.current?.abort();
    transcript.current = []; pending.current.clear(); batch.current = null;
    setItems([]); setBusy(false);
  };

  return { items, busy, send, confirm, skip, stop, reset, auditMissing, turns: transcript.current.length };
}
