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
export type AutoFinding = { title: string; severity: string; description: string; page: string; seen: string; fix: string };
export type AutoResult = {
  devices: { id: string; label: string; family: string; engine: string; pages_tested: number; pages_failed: number; login: string; issues: number; top_issues: string[]; skipped?: string }[];
  findings: AutoFinding[]; errors?: { device: string; page: string; severity: string; title: string }[]; pages: number; login: { status: string; needs?: string[]; message?: string } | null; summary: { tone: "green" | "amber" | "red"; text: string } | null;
};
export type LiveTestState = { status: "idle" } | {
  mode: "auto" | "script"; auto: AutoResult | null;
  runId: string; status: "running" | "asking" | "passed" | "failed" | "blocked" | "stopped"; url: string; device: string; deviceLabel: string; campaignId: string; campaignName: string; startedAt: number; finishedAt: number | null;
  steps: LiveTestStep[]; console: { type: string; text: string }[]; failed: { url: string; status?: number; error?: string }[];
  prompt: { id: string; label: string; secret: boolean; skippable: boolean } | null; error: string | null;
};
export type LiveTestRunSummary = { runId: string; status: Exclude<LiveTestState, { status: "idle" }>["status"]; url: string; deviceLabel: string; campaignId: string; campaignName: string; startedAt: number; finishedAt: number | null; passed: number; total: number };
/** The automatic run: a URL, and the login details if the site needs them. Every device, every page. */
export type AutoTestRequest = { mode: "auto"; url: string; credentials?: { username: string; password: string; extra: string }; allowed_domains: string[]; campaign_id?: string; campaign_name?: string; max_pages?: number };
export type LiveTestRequest = { campaign_id?: string; campaign_name?: string; url: string; device: string; steps: { action: string; target: string; value?: string; secret?: boolean }[]; inputs: Record<string, { value: string; secret: boolean }>; allowed_domains: string[]; session_token?: string };

const asError = async (r: Response | null, fallback: string) => {
  if (!r) return new Error("The connector is not running on this PC. Run npm run claude in the project folder.");
  const j = (await r.json().catch(() => null)) as { error?: string } | null;
  return new Error(j?.error ?? `${fallback} (${r.status}).`);
};
const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(8000) });

export const liveTestService = {
  /** The current run, or an earlier one by id. */
  async state(runId?: string): Promise<LiveTestState | null> {
    const r = await call(runId ? `/livetest?run=${encodeURIComponent(runId)}` : "/livetest");
    if (!r?.ok) return null;
    try { return (await r.json()) as LiveTestState; } catch { return null; }
  },
  /** The recent runs, newest first (the connector keeps the last 15 until it restarts). */
  async runs(): Promise<LiveTestRunSummary[] | null> {
    const r = await call("/livetest/runs");
    if (!r?.ok) return null;
    try { return (await r.json()) as LiveTestRunSummary[]; } catch { return null; }
  },
  async start(req: LiveTestRequest | AutoTestRequest) {
    const r = await post("/livetest/start", req);
    if (!r || r.status !== 202) throw await asError(r, "Could not start the test");
  },
  /** Answers a question the run is waiting on, or skips it when it says it can be skipped. */
  async answer(promptId: string, value: string, skip = false) {
    const r = await post("/livetest/answer", { promptId, value, skip });
    if (!r?.ok) throw await asError(r, "Could not send your answer");
  },
  async stop() { await post("/livetest/stop", {}); },
  /** The picture kept for one step, or null. */
  async shot(i: number, runId?: string): Promise<Blob | null> {
    const r = await call(`/livetest/shot/${i}${runId ? `?run=${encodeURIComponent(runId)}` : ""}`);
    if (!r || r.status !== 200) return null;
    try { return await r.blob(); } catch { return null; }
  },
};

// ---------------------------------------------------------------- Interactive browser (see tools/claude-worker/browsersession.mjs)
export type BrowserPreset = { id: string; label: string; width: number; height: number; touch: boolean };
export type BrowserStatus = "launching" | "loading" | "ready" | "error" | "disconnected" | "closed";
export type BrowserState = {
  id: string; status: BrowserStatus; error: string | null; errorCode: string | null; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean;
  captcha: boolean; paused: boolean; headed?: boolean; device: string; viewport: { width: number; height: number }; locked: boolean; lockedBy: string | null; startedAt: number;
  campaignId: string; campaignName: string; startUrl: string; frameSeq: number; closedReason: string | null;
  counts: { events: number; errors: number; console: number; network: number };
};
export type BrowserEvent = {
  id: number; at: string; url: string; page: string; category: string; severity: "high" | "medium" | "low" | "info"; message: string;
  status?: number; method?: string; resourceType?: string; location?: string; evidence?: string; hasShot?: boolean; shotRef?: number; reviewed?: boolean;
};
export type BrowserConsole = { id: number; at: string; type: string; text: string; location?: string };
export type BrowserRequest = { id: number; at: string; method: string; url: string; type?: string; status: number | null; ms?: number; failed: boolean | string };
export type BrowserLog = { state: BrowserState; events: BrowserEvent[]; console: BrowserConsole[]; network: BrowserRequest[] };
export type BrowserOpenRequest = { url: string; device: string; allowed: string[]; campaign?: { id: string; name: string }; credentials?: { extra: string }; window?: boolean };
export type EmbedCheck = { embeddable: boolean | null; reason?: string };
export type BrowserInput =
  | { type: "click"; fx: number; fy: number; button?: "left" | "right" | "middle"; count?: number }
  | { type: "wheel"; fx: number; fy: number; dx: number; dy: number }
  | { type: "key"; key: string }
  | { type: "text"; text: string };
export type BrowserCommand = { type: "navigate"; url: string } | { type: "reload" } | { type: "back" } | { type: "forward" } | { type: "device"; device: string } | { type: "capture"; note?: string } | { type: "close" };

export const browserService = {
  async presets(): Promise<BrowserPreset[] | null> {
    const r = await call("/browser/presets");
    if (!r?.ok) return null;
    try { return (await r.json()) as BrowserPreset[]; } catch { return null; }
  },
  /** Opens (or replaces) the one preview. Returns at once: the browser launches in the background and the stream reports how it goes. */
  async open(req: BrowserOpenRequest): Promise<{ token: string; state: BrowserState }> {
    const r = await call("/browser/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal: AbortSignal.timeout(8000) });
    if (!r?.ok) throw await asError(r, "Could not open the preview");
    return (await r.json()) as { token: string; state: BrowserState };
  },
  async command(token: string, cmd: BrowserCommand): Promise<BrowserState | { ok: true } | BrowserEvent> {
    const r = await call("/browser/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...cmd }), signal: AbortSignal.timeout(40_000) });
    if (!r?.ok) throw await asError(r, "That did not work");
    return (await r.json()) as BrowserState;
  },
  /** Mouse and keyboard, as fractions of the picture. Failures are ignored on purpose: a dropped click is not worth an error. */
  async input(token: string, msg: BrowserInput): Promise<boolean> {
    const r = await call("/browser/input", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...msg }), signal: AbortSignal.timeout(8000) });
    return Boolean(r?.ok);
  },
  async log(token: string, since = 0): Promise<BrowserLog | null> {
    const r = await call(`/browser/log?token=${encodeURIComponent(token)}&since=${since}&net=all`);
    if (!r?.ok) return null;
    try { return (await r.json()) as BrowserLog; } catch { return null; }
  },
  async shot(token: string, id: number): Promise<Blob | null> {
    const r = await call(`/browser/shot?token=${encodeURIComponent(token)}&id=${id}`);
    if (!r || r.status !== 200) return null;
    try { return await r.blob(); } catch { return null; }
  },
  /** Whether the site would let itself be shown inside a frame. Only used to explain why the picture (not a frame) is what Journey shows. */
  async embeddable(url: string, allowed: string[]): Promise<EmbedCheck | null> {
    const r = await call(`/browser/embeddable?url=${encodeURIComponent(url)}&allowed=${encodeURIComponent(allowed.join(","))}`, { signal: AbortSignal.timeout(12_000) });
    if (!r?.ok) return null;
    try { return (await r.json()) as EmbedCheck; } catch { return null; }
  },
  streamUrl: (token: string) => `${CONNECTOR_URL}/browser/stream?token=${encodeURIComponent(token)}`,
};
