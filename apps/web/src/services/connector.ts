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
    return await fetch(`${CONNECTOR_URL}${path}`, { ...init, signal: init?.signal ?? AbortSignal.timeout(2500) });
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

// ---------------------------------------------------------------- Live test (see tools/claude-worker/livetest.mjs)
export type LiveTestStep = { i: number; action: string; target: string; value: string; status: "pending" | "running" | "asking" | "passed" | "failed" | "skipped"; note: string; ms?: number; hasShot: boolean; secret: boolean };
export type LiveTestState = { status: "idle" } | {
  runId: string; status: "running" | "asking" | "passed" | "failed" | "blocked" | "stopped"; url: string; device: string; deviceLabel: string; startedAt: number; finishedAt: number | null;
  steps: LiveTestStep[]; console: { type: string; text: string }[]; failed: { url: string; status?: number; error?: string }[];
  prompt: { id: string; label: string; secret: boolean } | null; error: string | null;
};
export type LiveTestRequest = { url: string; device: string; steps: { action: string; target: string; value?: string; secret?: boolean }[]; inputs: Record<string, { value: string; secret: boolean }>; allowed_domains: string[] };

const asError = async (r: Response | null, fallback: string) => {
  if (!r) return new Error("The connector is not running on this PC. Run npm run claude in the project folder.");
  const j = (await r.json().catch(() => null)) as { error?: string } | null;
  return new Error(j?.error ?? `${fallback} (${r.status}).`);
};
const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(8000) });

export const liveTestService = {
  async state(): Promise<LiveTestState | null> {
    const r = await call("/livetest");
    if (!r?.ok) return null;
    try { return (await r.json()) as LiveTestState; } catch { return null; }
  },
  async start(req: LiveTestRequest) {
    const r = await post("/livetest/start", req);
    if (!r || r.status !== 202) throw await asError(r, "Could not start the test");
  },
  async answer(promptId: string, value: string) {
    const r = await post("/livetest/answer", { promptId, value });
    if (!r?.ok) throw await asError(r, "Could not send your answer");
  },
  async stop() { await post("/livetest/stop", {}); },
  /** The picture kept for one step, or null. */
  async shot(i: number): Promise<Blob | null> {
    const r = await call(`/livetest/shot/${i}`);
    if (!r || r.status !== 200) return null;
    try { return await r.blob(); } catch { return null; }
  },
};
