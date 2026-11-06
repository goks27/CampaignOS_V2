import type { BrowserEvent, BrowserInput, BrowserPreset, BrowserState } from "@/services/connector";

/** Where a pointer is on the picture, as fractions (0 to 1) of its width and height. The connector scales them to the page. */
export function toFraction(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number) {
  const c = (n: number) => Math.max(0, Math.min(1, n));
  return { fx: rect.width ? c((clientX - rect.left) / rect.width) : 0, fy: rect.height ? c((clientY - rect.top) / rect.height) : 0 };
}

const SPECIAL = new Set(["Enter", "Backspace", "Tab", "Escape", "Delete", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
/** What a key press means for the page, or null when it should be ignored (shortcuts, modifiers, function keys). */
export function keyInput(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): BrowserInput | null {
  if (SPECIAL.has(e.key)) return { type: "key", key: e.key };
  if ((e.ctrlKey || e.metaKey) && /^[acvxz]$/i.test(e.key)) return { type: "key", key: `${e.metaKey ? "Meta" : "Control"}+${e.key.toLowerCase()}` };
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key.length === 1) return { type: "text", text: e.key };
  return null;
}

/** The address bar text turned into something the connector will accept. A bare host gets https://. */
export function normalizeAddress(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.toString();
  } catch { return null; }
}

export type Category = "all" | "javascript" | "network" | "http" | "navigation" | "test" | "other";
export const CATEGORY_LABEL: Record<Category, string> = { all: "All", javascript: "JavaScript", network: "Network", http: "HTTP errors", navigation: "Navigation", test: "Test", other: "Other" };
/** Groups the connector's event categories into the few a person filters by. */
export function categoryOf(e: Pick<BrowserEvent, "category">): Exclude<Category, "all"> {
  switch (e.category) {
    case "page-error": case "console-error": case "console-warning": return "javascript";
    case "network-failed": case "blocked": return "network";
    case "http-error": return "http";
    case "navigation": case "crash": case "captcha": return "navigation";
    case "test": return "test";
    default: return "other";
  }
}
/** Problems only: captures and plain notes are not errors. */
export const isProblem = (e: BrowserEvent) => e.category !== "capture" && e.severity !== "info";

export function filterEvents(events: BrowserEvent[], category: Category, showInfo: boolean, reviewed: Set<number>, hideReviewed: boolean) {
  return events.filter((e) => e.category !== "capture" && (showInfo || e.severity !== "info") && (category === "all" || categoryOf(e) === category) && !(hideReviewed && reviewed.has(e.id)));
}

export type Message = { tone: "gray" | "blue" | "amber" | "red"; title: string; detail: string };
/** What the centre panel says when there is no picture to show. Null when there is one. */
export function stateMessage(s: BrowserState | null, opened: boolean, offline: boolean): Message | null {
  if (offline) return { tone: "amber", title: "The connector is not running", detail: "Run npm run claude in the project folder on this PC, then open the preview again." };
  if (!opened) return { tone: "gray", title: "Enter a staging URL", detail: "Paste an address on the left and press Enter. The real site opens here and you can use it." };
  if (!s) return { tone: "blue", title: "Starting the browser…", detail: "A real browser is starting on this PC." };
  switch (s.status) {
    case "launching": return { tone: "blue", title: "Starting the browser…", detail: "A real browser is starting on this PC." };
    case "closed": return { tone: "gray", title: "The preview was closed", detail: s.closedReason ?? "Open it again to carry on." };
    case "disconnected": return { tone: "red", title: "The browser disconnected", detail: `${s.error ?? "The browser was closed or crashed."} Open the preview again.` };
    case "error": {
      const code = s.errorCode;
      const title = code === "timeout" ? "The page took too long" : code === "unreachable" ? "The site could not be reached" : code === "blocked" ? "That address is not allowed" : "The page could not be opened";
      return { tone: "red", title, detail: s.error ?? "Try again, or check the address." };
    }
    default: return null;
  }
}

export const timeOnly = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); };

/** The title and description of a Journey task made from a problem found in the preview. */
export function taskFromEvent(e: BrowserEvent, build: { device: string }) {
  const lines = [e.message, "", `Page: ${e.page || e.url}`];
  if (e.url && e.url !== e.page) lines.push(`Request: ${e.url}`);
  if (e.status) lines.push(`Status: ${e.status}`);
  lines.push(`Device: ${build.device} (emulated in Chromium, not a physical device)`, `Seen at: ${e.at}`);
  if (e.evidence) lines.push(`Evidence: ${e.evidence}`);
  lines.push("", "Found in the Live test preview. Check before fixing: not every error is a bug.");
  return { title: e.message.replace(/\s+/g, " ").slice(0, 110), description: lines.join("\n") };
}

/** Used when the connector cannot be asked. The same sizes as tools/claude-worker/devices.mjs. */
export const PRESET_FALLBACK: BrowserPreset[] = [
  { id: "desktop", label: "Desktop", width: 1440, height: 900, touch: false },
  { id: "laptop", label: "Laptop", width: 1366, height: 768, touch: false },
  { id: "tablet", label: "iPad", width: 768, height: 1024, touch: true },
  { id: "iphone", label: "iPhone", width: 390, height: 844, touch: true },
  { id: "android", label: "Android", width: 360, height: 800, touch: true },
];
