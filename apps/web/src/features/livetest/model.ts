/** Live test, as pure logic: the step editor, what the run needs before it can start, and how scenario steps map to and from it. */
import type { LiveTestRequest, LiveTestState } from "@/services/connector";
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

export function toRequest(url: string, device: string, steps: EditStep[], inputs: Inputs, allowed: string[]): LiveTestRequest {
  const used = new Set(placeholdersOf(steps));
  return {
    url: url.trim(), device, allowed_domains: allowed,
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
  const lines = [`Live test · ${s.deviceLabel} · ${s.url}`, `${STATUS_LABEL[s.status]}${s.finishedAt ? ` · ${Math.round((s.finishedAt - s.startedAt) / 1000)}s` : ""}`, ""];
  for (const st of s.steps) lines.push(`${String(st.i).padStart(2, " ")}. [${st.status}] ${st.action} ${st.target}${st.action === "ask" || !st.value ? "" : ` = ${st.value}`}${st.note ? `  (${st.note})` : ""}`);
  if (s.console.length) { lines.push("", "Console:"); for (const c of s.console) lines.push(`  ${c.type}: ${c.text}`); }
  if (s.failed.length) { lines.push("", "Failed requests:"); for (const f of s.failed) lines.push(`  ${f.status ?? f.error ?? "failed"} ${f.url}`); }
  return lines.join("\n");
}
