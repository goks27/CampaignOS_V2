/** Live test, as pure logic: the step editor, what the run needs before it can start, and how scenario steps map to and from it. */
import type { AutoTestRequest, LiveTestRequest, LiveTestState, LiveTestStep } from "@/services/connector";
import type { Step } from "@/services/development";

export type Action = Step["action"] | "ask";
export type EditStep = { id: string; action: Action; target: string; value: string; secret: boolean };

export type ActionMeta = { value: Action; label: string; target: string; targetHint: string; valueLabel?: string; valueHint?: string };
export const ACTIONS: ActionMeta[] = [
  { value: "goto", label: "Go to path", target: "Path", targetHint: "/register" },
  { value: "fill", label: "Fill field", target: "Field", targetHint: "Label, placeholder or CSS selector", valueLabel: "Value", valueHint: "Text, or {{name}} for a value you enter before starting" },
  { value: "click", label: "Click", target: "Button or link", targetHint: "Button text or CSS selector" },
  { value: "select", label: "Select option", target: "Field", targetHint: "Label or selector", valueLabel: "Option", valueHint: "Option text" },
  { value: "check", label: "Tick checkbox", target: "Checkbox", targetHint: "Label or selector" },
  { value: "ask", label: "Ask me to type", target: "What to ask", targetHint: "Enter the OTP sent to 98xxxxxx01", valueLabel: "Fill this field", valueHint: "OTP (label, placeholder or selector)" },
  { value: "expect_text", label: "Expect text visible", target: "Text", targetHint: "Welcome" },
  { value: "expect_visible", label: "Expect element visible", target: "Selector or text", targetHint: "#success" },
  { value: "expect_url", label: "Expect URL contains", target: "URL part", targetHint: "/success" },
  { value: "wait", label: "Wait (ms)", target: "Milliseconds", targetHint: "1000" },
];
export const META = new Map(ACTIONS.map((a) => [a.value, a]));
export const needsValue = (a: Action) => Boolean(META.get(a)?.valueLabel);

let n = 0;
export const newStep = (action: Action = "click"): EditStep => ({ id: `s${++n}`, action, target: "", value: "", secret: action === "ask" });

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]{1,40})\s*\}\}/g;
/** The {{names}} the steps use. Only a step that still takes a value counts, so changing a step's type drops its old value's name. */
export function placeholdersOf(steps: EditStep[]): string[] {
  const names = new Set<string>();
  for (const s of steps) for (const t of [s.target, needsValue(s.action) ? s.value : ""]) for (const m of t.matchAll(PLACEHOLDER)) names.add(m[1]!);
  return [...names];
}

export type Inputs = Record<string, { value: string; secret: boolean }>;

/** What is missing before Start, in words, or null when it can run. Mirrors the connector's own checks. */
export function problem(url: string, steps: EditStep[], inputs: Inputs): string | null {
  try { const u = new URL(url.trim()); if (!["http:", "https:"].includes(u.protocol)) throw new Error(); } catch { return "Enter the staging URL, starting with https://"; }
  if (steps.length > 60) return `That is ${steps.length} steps; the limit is 60.`;
  for (const [i, s] of steps.entries()) {
    if (!s.target.trim()) return `Step ${i + 1}: fill in the ${META.get(s.action)?.target.toLowerCase() ?? "target"}.`;
    if (s.action === "ask" && !s.value.trim()) return `Step ${i + 1}: say which field to fill with your answer.`;
  }
  const missing = placeholdersOf(steps).filter((p) => !inputs[p]?.value);
  return missing.length ? `Enter a value for ${missing.map((m) => `{{${m}}}`).join(", ")}.` : null;
}

export function toRequest(url: string, device: string, steps: EditStep[], inputs: Inputs, allowed: string[], campaign?: { id: string; name: string }): LiveTestRequest {
  const used = new Set(placeholdersOf(steps));
  return {
    url: url.trim(), device, allowed_domains: allowed, ...(campaign ? { campaign_id: campaign.id, campaign_name: campaign.name } : {}),
    steps: steps.map((s) => ({ action: s.action, target: s.target.trim(), ...(needsValue(s.action) ? { value: s.value } : {}), ...(s.secret ? { secret: true } : {}) })),
    inputs: Object.fromEntries(Object.entries(inputs).filter(([k]) => used.has(k))),
  };
}

/** A saved scenario's steps, ready to edit. */
export const fromScenario = (steps: Step[]): EditStep[] => steps.map((s) => ({ id: `s${++n}`, action: s.action, target: s.target ?? "", value: s.value ?? "", secret: false }));

/** Steps to save as a scenario. "Ask me" steps are left out: a scheduled review has nobody to ask. */
export function toScenario(steps: EditStep[]): { steps: Step[]; dropped: number } {
  const keep = steps.filter((s) => s.action !== "ask");
  return { steps: keep.map((s) => ({ action: s.action as Step["action"], target: s.target.trim(), ...(needsValue(s.action) && s.value ? { value: s.value } : {}) })), dropped: steps.length - keep.length };
}

type Run = Exclude<LiveTestState, { status: "idle" }>;
export const STATUS_LABEL: Record<Run["status"], string> = { running: "Running", asking: "Waiting for you", passed: "Passed", failed: "Failed", blocked: "Blocked by a CAPTCHA", stopped: "Stopped" };
export const STATUS_TONE: Record<Run["status"], "blue" | "amber" | "green" | "red" | "gray"> = { running: "blue", asking: "amber", passed: "green", failed: "red", blocked: "amber", stopped: "gray" };
export const isActive = (s: LiveTestState | null | undefined): s is Run => Boolean(s && s.status !== "idle" && !s.finishedAt);

/** The log as plain text, for download. Values are never in it: only the {{names}} the steps used. */
export function logText(s: Run): string {
  if (s.mode === "auto") {
    const lines = [`Live test · All devices · ${s.url}`, s.auto?.summary?.text ?? s.status, ""];
    for (const d of s.auto?.devices ?? []) lines.push(`${d.label}: ${d.pages_tested} page${d.pages_tested === 1 ? "" : "s"}, ${d.issues} issue${d.issues === 1 ? "" : "s"}${d.top_issues.length ? ` (${d.top_issues.join("; ")})` : ""}`);
    lines.push("", "Findings:");
    for (const f of s.auto?.findings ?? []) lines.push(`  [${f.severity}] ${f.title} ${f.seen ? `· ${f.seen}` : ""}`);
    return lines.join("\n");
  }
  const lines = [`Live test · ${s.deviceLabel} · ${s.url}`, `${STATUS_LABEL[s.status]}${s.finishedAt ? ` · ${Math.round((s.finishedAt - s.startedAt) / 1000)}s` : ""}`, ""];
  for (const st of s.steps) lines.push(`${String(st.i).padStart(2, " ")}. [${st.status}] ${st.action} ${st.target}${st.action === "ask" || !st.value ? "" : ` = ${st.value}`}${st.note ? `  (${st.note})` : ""}`);
  if (s.console.length) { lines.push("", "Console:"); for (const c of s.console) lines.push(`  ${c.type}: ${c.text}`); }
  if (s.failed.length) { lines.push("", "Failed requests:"); for (const f of s.failed) lines.push(`  ${f.status ?? f.error ?? "failed"} ${f.url}`); }
  return lines.join("\n");
}

/** A step as a sentence, the way a tester would read it. Values you typed are never shown: only the {{name}}, or "a hidden value". */
export function stepSentence(s: LiveTestStep): string {
  const t = s.target, v = s.value;
  if (s.i === 0) return `Open ${t}`;
  switch (s.action) {
    case "goto": return `Go to ${t}`;
    case "fill": return s.secret ? `Type a hidden value into “${t}”` : `Type “${v}” into “${t}”`;
    case "click": return `Click “${t}”`;
    case "select": return `Select “${v}” in “${t}”`;
    case "check": return `Tick “${t}”`;
    case "ask": return `Ask you: ${t}`;
    case "expect_text": return `Expect “${t}” to be visible`;
    case "expect_visible": return `Expect “${t}” on the page`;
    case "expect_url": return `Expect the address to contain “${t}”`;
    case "wait": return `Wait ${t} ms`;
    case "progress": return t;
    default: return `${s.action} ${t}`;
  }
}

/** The one line that sums a run up, with its colour. The step that opens the page is not counted as one of your steps. */
export function resultLine(r: Run): { tone: "green" | "red" | "amber" | "blue" | "gray"; text: string } {
  if (r.mode === "auto") {
    if (r.status === "stopped") return { tone: "gray", text: "Stopped." };
    if (r.status === "asking") return { tone: "amber", text: "Waiting for your answer." };
    if (!r.finishedAt) return { tone: "blue", text: r.steps.at(-1)?.target ?? "Starting…" };
    if (r.error) return { tone: "red", text: r.error };
    return r.auto?.summary ?? { tone: "gray", text: "Finished." };
  }
  const mine = r.steps.length - 1;
  const failed = r.steps.find((s) => s.status === "failed");
  if (r.status === "passed") return { tone: "green", text: mine > 0 ? `All ${mine} step${mine === 1 ? "" : "s"} passed.` : "The page opened." };
  if (r.status === "failed") return { tone: "red", text: failed ? (failed.i === 0 ? `The page did not open: ${failed.note}` : `Step ${failed.i} failed: ${failed.note || "it did not work."}`) : (r.error ?? "The test failed.") };
  if (r.status === "blocked") return { tone: "amber", text: "Blocked by a CAPTCHA. It is never bypassed: solve it by hand, or turn it off on staging." };
  if (r.status === "stopped") return { tone: "gray", text: "Stopped." };
  if (r.status === "asking") return { tone: "amber", text: "Waiting for your answer." };
  const at = r.steps.find((s) => s.status === "running" || s.status === "asking")?.i ?? 0;
  return { tone: "blue", text: `Running step ${at} of ${mine}…` };
}

/** True for something that looks like a web address a person pasted. */
export function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  try { const u = new URL(t); return ["http:", "https:"].includes(u.protocol) && u.hostname.includes("."); } catch { return false; }
}

export type Credentials = { username: string; password: string; extra: string };
/** The automatic run's request. Details are sent only when there is something to send: a username with its password, and/or `Label = value` lines. */
export function autoRequest(url: string, creds: Credentials, allowed: string[], campaign?: { id: string; name: string }, includeDesktop = false): AutoTestRequest {
  const withDetails = (creds.username.trim() && creds.password) || creds.extra.trim();
  return { mode: "auto", url: url.trim(), allowed_domains: allowed, ...(withDetails ? { credentials: { username: creds.username.trim(), password: creds.password, extra: creds.extra } } : {}), ...(campaign ? { campaign_id: campaign.id, campaign_name: campaign.name } : {}), ...(includeDesktop ? { include_desktop: true } : {}) };
}
/** What stops a login from being sent, or null. */
export const loginProblem = (c: Credentials) => ((c.username.trim() && !c.password) || (!c.username.trim() && c.password) ? "Enter both the username and the password, or neither." : null);

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 };
/** Findings worst first. */
export const bySeverity = <T extends { severity: string }>(list: T[]): T[] => [...list].sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
