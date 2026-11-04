/**
 * Talks to the Claude connector's /assistant endpoint (see tools/claude-worker/). The connector only runs the model:
 * it has no database access here. Reading and changing data always happens in this browser, under the user's own session.
 */
import { supabase } from "./db";
import { CONNECTOR_URL } from "./connector";

export type ToolSpec = { name: string; kind: "read" | "write"; description: string; params: string };
export type Call = { id: string; tool: string; args: Record<string, unknown> };
export type Result = { id: string; tool: string; ok: boolean; data?: unknown; error?: string };
export type Outcome = { id: string; tool: string; status: "applied" | "skipped" | "failed"; detail?: string };
export type TranscriptEntry =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "calls"; calls: Call[] }
  | { type: "results"; results: Result[] }
  | { type: "outcomes"; outcomes: Outcome[] };

export class ConnectorOffline extends Error {
  constructor() {
    super("The Claude connector is not running on this PC. Start it with npm run claude in the project folder, then try again.");
  }
}

export const assistantService = {
  async turn(payload: { transcript: TranscriptEntry[]; tools: ToolSpec[]; context: Record<string, unknown> }, signal?: AbortSignal): Promise<{ reply: string; calls: Call[] }> {
    let res: Response;
    try {
      res = await fetch(`${CONNECTOR_URL}/assistant`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(170_000)]) : AbortSignal.timeout(170_000),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (e instanceof DOMException && e.name === "TimeoutError") throw new Error("Claude took too long to answer. Try a smaller question.");
      throw new ConnectorOffline();
    }
    const body = (await res.json().catch(() => null)) as { reply?: string; calls?: Call[]; error?: string } | null;
    if (!res.ok || !body) throw new Error(body?.error ?? `The connector returned an error (${res.status}).`);
    return { reply: body.reply ?? "", calls: body.calls ?? [] };
  },

  /** Records "via the Claude assistant" next to the normal change log. Best effort: the change itself has already happened. */
  async audit(campaignId: string | null, tool: string, summary: string, detail: Record<string, unknown>): Promise<boolean> {
    const { error } = await supabase.rpc("record_assistant_action", { p_campaign: campaignId, p_tool: tool, p_summary: summary, p_detail: detail as never });
    return !error;
  },
};
