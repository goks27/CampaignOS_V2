/** Names for the devices a site check runs on. The ids are what the connector stores on each capture (tools/claude-worker/devices.mjs). */
export const DEVICE_LABEL: Record<string, string> = {
  "iphone-15": "iPhone 15", "iphone-se": "iPhone SE (small screen)", "iphone-8": "iPhone 8", "iphone-13": "iPhone 13", "iphone-16-pro-max": "iPhone 16 Pro Max (large)",
  "pixel-7": "Pixel 7 (Android)", "pixel-5": "Pixel 5 (Android)", "pixel-8-pro": "Pixel 8 Pro (Android)", "galaxy-s9": "Galaxy S9+ (Android, narrow)", "galaxy-s8": "Galaxy S8 (Android)", "galaxy-a55": "Galaxy A55 (Android, wide)",
  ipad: "iPad", "ipad-mini": "iPad Mini", "ipad-pro-11": "iPad Pro 11", "galaxy-tab-s9": "Galaxy Tab S9 (Android tablet)", "galaxy-tab-s4": "Galaxy Tab S4 (Android tablet)",
  // older records
  desktop: "Desktop 1440", laptop: "Laptop 1280", mobile: "Phone",
};
/** The devices you can pick for a test of your own steps: phones and tablets. */
export const PICKABLE_DEVICES = Object.entries(DEVICE_LABEL).filter(([id]) => !["desktop", "laptop", "mobile"].includes(id));
export const deviceLabel = (id: string | null | undefined) => (id ? DEVICE_LABEL[id] ?? id : "");

/** What a finished site check recorded about each device (result_summary.notes). Read defensively: older checks have none of it. */
export type DeviceRow = { id: string; label: string; family: string; engine: string; pages_tested: number; pages_failed: number; login: string; issues: number; top_issues: string[]; skipped?: string };
export type SiteNotes = {
  pages_checked?: number; devices_tested?: number; devices?: DeviceRow[]; stopped_early?: string;
  login?: { status: "none" | "ok" | "registered" | "failed" | "needs" | "blocked"; needs?: string[]; message?: string };
};
export function siteNotes(summary: unknown): SiteNotes | null {
  const n = (summary as { notes?: unknown } | null)?.notes;
  if (!n || typeof n !== "object") return null;
  const d = (n as SiteNotes).devices;
  return Array.isArray(d) && d.length ? (n as SiteNotes) : null;
}
