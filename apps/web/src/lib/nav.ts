/**
 * Campaign navigation rules. A campaign follows five steps: Brief, Requirements, Design, Build & test, Launch. Tasks and Activity are a
 * side panel, not steps. The old addresses (the eight sections and the ten tabs before them) still work: bookmarks, notification links
 * and the assistant's links are sent to the step that holds that content now.
 */
export const STEPS = ["brief", "requirements", "design", "build", "launch"] as const;
export type Step = (typeof STEPS)[number];
export const STEP_LABEL: Record<Step, string> = { brief: "Brief", requirements: "Requirements", design: "Design", build: "Build & test", launch: "Launch" };

export type Panel = "tasks" | "activity";

/** Old address -> where it lands now. A tab that became the side panel keeps its name in the panel. */
const LEGACY: Record<string, { step: Step; panel?: Panel }> = {
  canvas: { step: "brief" }, overview: { step: "brief" }, journeys: { step: "brief" },
  documents: { step: "requirements" },
  designs: { step: "design" },
  development: { step: "build" }, testing: { step: "build" }, live: { step: "build" },
  review: { step: "launch" }, approvals: { step: "launch" }, "ai-reviews": { step: "build" },
  issues: { step: "brief", panel: "tasks" }, tasks: { step: "brief", panel: "tasks" }, activity: { step: "brief", panel: "activity" },
};

export function resolveStep(tab: string | undefined): { step: Step; panel?: Panel; redirect: boolean } {
  if (!tab) return { step: "brief", redirect: false };
  if ((STEPS as readonly string[]).includes(tab)) return { step: tab as Step, redirect: false };
  const old = LEGACY[tab];
  if (old) return { ...old, redirect: true };
  return { step: "brief", redirect: true }; // an unknown address lands on the brief, never on an empty page
}

export const campaignPath = (id: string, step: Step = "brief") => (step === "brief" ? `/campaigns/${id}` : `/campaigns/${id}/${step}`);

/** The campaign id and step of an address, or null when it is not a campaign page. */
export function parseCampaignPath(pathname: string): { id: string; step: Step } | null {
  const m = pathname.match(/^\/campaigns\/([^/?#]+)(?:\/([^/?#]+))?/);
  if (!m) return null;
  return { id: m[1]!, step: resolveStep(m[2]).step };
}

// ---------------------------------------------------------------- recently opened campaigns (per browser, never shared)
const RECENT_KEY = "campaignos-recent";
export const MAX_RECENT = 8;

export function pushRecent(list: string[], id: string, max = MAX_RECENT): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}
export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENT) : [];
  } catch { return []; }
}
export function writeRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))); } catch { /* a convenience only */ }
}
