/**
 * The Claude connector: a small program that runs on this PC (`npm run claude`, see tools/claude-worker/).
 * It lets the dashboard hand reviews to Claude Code right away. It is optional: when it is not running,
 * reviews simply wait in the queue. The browser only ever tells it to "wake"; it carries no data or credentials.
 * (The address is fixed on purpose: frontend env vars are limited to the two Supabase values.)
 */
export const CONNECTOR_URL = "http://127.0.0.1:4317";

export type ConnectorStatus = {
  connector: "claude-code";
  claude: { ok: boolean; version: string };
  model: string;
  supports: string[];
  busy: boolean;
  job: { id: string; type: string; startedAt: string; step: string } | null;
  last: { id: string; type: string; status: "completed" | "failed" | "cancelled"; at: string; error?: string } | null;
  startedAt: string;
};

/** What the connector is doing right now, for the live view. Held in memory on the PC; nothing is stored. */
export type LiveState = { active: false } | {
  active: true; jobId: string; type: string; startedAt: number; paused: boolean; seq: number; hasFrame: boolean;
  steps: { at: number; text: string }[];
  where: { url?: string; device?: string; pageNo?: number; pageTotal?: number } | null;
};

async function call(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${CONNECTOR_URL}${path}`, { ...init, signal: AbortSignal.timeout(2500) });
  } catch {
    return null; // not running, blocked by the browser, or not reachable from this device
  }
}

export const connectorService = {
  /** Null when the connector is not reachable. */
  async status(): Promise<ConnectorStatus | null> {
    const r = await call("/status");
    if (!r?.ok) return null;
    try { return (await r.json()) as ConnectorStatus; } catch { return null; }
  },
  /** Null when the connector is not reachable. */
  async live(): Promise<LiveState | null> {
    const r = await call("/live");
    if (!r?.ok) return null;
    try { return (await r.json()) as LiveState; } catch { return null; }
  },
  /** The latest picture of the test browser, or null when there is none. */
  async liveFrame(): Promise<Blob | null> {
    const r = await call("/live/frame");
    if (!r || r.status !== 200) return null;
    try { return await r.blob(); } catch { return null; }
  },
  /** Tells the connector to look for work now. Returns whether it was reached. */
  async wake(): Promise<boolean> {
    const r = await call("/wake", { method: "POST" });
    return Boolean(r && r.status === 202);
  },
};
