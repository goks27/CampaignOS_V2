/**
 * Campaign navigation rules. A campaign has eight sections; the canvas is its home. The old tab addresses still work
 * (bookmarks, notification links, the assistant's links) and are sent to the section that now holds that content.
 */
export const SECTIONS = ["canvas", "requirements", "designs", "review", "development", "testing", "issues", "activity"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABEL: Record<Section, string> = {
  canvas: "Canvas", requirements: "Requirements", designs: "Designs", review: "Review", development: "Development", testing: "Testing", issues: "Issues", activity: "Activity",
};

/** Old tab -> the section that holds its content now. */
export const LEGACY_TAB: Record<string, Section> = {
  overview: "canvas", journeys: "canvas", approvals: "review", documents: "requirements", "ai-reviews": "review", tasks: "issues",
};

export function resolveSection(tab: string | undefined): { section: Section; redirect: boolean } {
  if (!tab) return { section: "canvas", redirect: false };
  if ((SECTIONS as readonly string[]).includes(tab)) return { section: tab as Section, redirect: false };
  if (tab in LEGACY_TAB) return { section: LEGACY_TAB[tab]!, redirect: true };
  return { section: "canvas", redirect: true }; // an unknown address lands on the canvas, never on an empty page
}

export const campaignPath = (id: string, section: Section = "canvas") => (section === "canvas" ? `/campaigns/${id}` : `/campaigns/${id}/${section}`);

/** The campaign id and section of an address, or null when it is not a campaign page. */
export function parseCampaignPath(pathname: string): { id: string; section: Section } | null {
  const m = pathname.match(/^\/campaigns\/([^/?#]+)(?:\/([^/?#]+))?/);
  if (!m) return null;
  return { id: m[1]!, section: resolveSection(m[2]).section };
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
