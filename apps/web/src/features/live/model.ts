import type { LiveState } from "@/services/connector";

type Where = Extract<LiveState, { active: true }>["where"];

/** "Desktop · page 2 of 10 · /offers" for the line under the live view's title. */
export function placeLabel(w: Where): string {
  if (!w) return "";
  const bits: string[] = [];
  if (w.device) bits.push(w.device === "mobile" ? "Phone" : w.device === "desktop" ? "Desktop" : w.device);
  if (w.pageNo) bits.push(w.pageTotal ? `page ${w.pageNo} of ${w.pageTotal}` : `page ${w.pageNo}`);
  if (w.url) { try { const u = new URL(w.url); bits.push(`${u.pathname === "/" ? u.hostname : u.pathname}`.slice(0, 48)); } catch { /* not a URL */ } }
  return bits.join(" · ");
}

/** The step as a sentence that starts with a capital letter. */
export const liveHeadline = (step: string) => (step ? step.charAt(0).toUpperCase() + step.slice(1) : "Starting");
