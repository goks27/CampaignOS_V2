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
  { id: "iphone-15", label: "iPhone 15", width: 393, height: 659, touch: true },
  { id: "iphone-se", label: "iPhone SE (small screen)", width: 320, height: 568, touch: true },
  { id: "iphone-8", label: "iPhone 8", width: 375, height: 667, touch: true },
  { id: "iphone-13", label: "iPhone 13", width: 390, height: 664, touch: true },
  { id: "iphone-16-pro-max", label: "iPhone 16 Pro Max (large)", width: 440, height: 763, touch: true },
  { id: "pixel-7", label: "Pixel 7 (Android)", width: 412, height: 839, touch: true },
  { id: "pixel-5", label: "Pixel 5 (Android)", width: 393, height: 727, touch: true },
  { id: "pixel-8-pro", label: "Pixel 8 Pro (Android)", width: 448, height: 921, touch: true },
  { id: "galaxy-s9", label: "Galaxy S9+ (Android, narrow)", width: 320, height: 658, touch: true },
  { id: "galaxy-s8", label: "Galaxy S8 (Android)", width: 360, height: 740, touch: true },
  { id: "galaxy-a55", label: "Galaxy A55 (Android, wide)", width: 480, height: 1040, touch: true },
  { id: "ipad", label: "iPad", width: 810, height: 1080, touch: true },
  { id: "ipad-mini", label: "iPad Mini", width: 768, height: 1024, touch: true },
  { id: "ipad-pro-11", label: "iPad Pro 11", width: 834, height: 1194, touch: true },
  { id: "galaxy-tab-s9", label: "Galaxy Tab S9 (Android tablet)", width: 640, height: 1024, touch: true },
  { id: "galaxy-tab-s4", label: "Galaxy Tab S4 (Android tablet)", width: 712, height: 1138, touch: true },
];

/** Where the page itself is inside a box that shows it letterboxed (object-fit: contain), so clicks land on the page and not on the bars. */
export function contentRect(box: { left: number; top: number; width: number; height: number }, aspect: number) {
  if (!box.width || !box.height || !aspect) return box;
  if (box.width / box.height > aspect) { const w = box.height * aspect; return { left: box.left + (box.width - w) / 2, top: box.top, width: w, height: box.height }; }
  const h = box.width / aspect;
  return { left: box.left, top: box.top + (box.height - h) / 2, width: box.width, height: h };
}
