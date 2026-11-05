/** Names for the devices a site check runs on. The ids are what the connector stores on each capture (tools/claude-worker/devices.mjs). */
export const DEVICE_LABEL: Record<string, string> = {
  desktop: "Desktop 1440", laptop: "Laptop 1280", "iphone-15": "iPhone 15", "iphone-se": "iPhone SE (small screen)",
  "pixel-7": "Pixel 7 (Android)", "galaxy-s9": "Galaxy S9+ (Android)", ipad: "iPad", mobile: "Phone",
};
export const deviceLabel = (id: string | null | undefined) => (id ? DEVICE_LABEL[id] ?? id : "");

/** What a finished site check recorded about each device (result_summary.notes). Read defensively: older checks have none of it. */
export type DeviceRow = { id: string; label: string; family: string; engine: string; pages_tested: number; pages_failed: number; login: string; issues: number; top_issues: string[]; skipped?: string };
export type SiteNotes = {
  pages_checked?: number; devices_tested?: number; devices?: DeviceRow[]; stopped_early?: string;
  login?: { status: "none" | "ok" | "failed" | "needs" | "blocked"; needs?: string[]; message?: string };
};
export function siteNotes(summary: unknown): SiteNotes | null {
  const n = (summary as { notes?: unknown } | null)?.notes;
  if (!n || typeof n !== "object") return null;
  const d = (n as SiteNotes).devices;
  return Array.isArray(d) && d.length ? (n as SiteNotes) : null;
}
