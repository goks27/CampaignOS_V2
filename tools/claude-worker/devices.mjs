/**
 * The devices a site check runs on. Every one is EMULATED in Chromium: a real browser engine with the device's screen size,
 * pixel density, touch, mobile mode and user agent. That catches layout, loading, scripting and responsive problems. It is not a
 * physical phone, and iPhone and iPad runs use Chromium rather than Safari's engine, so Safari-only rendering differences and
 * real hardware behaviour (notch, on-screen keyboard, slow CPUs) are NOT covered. Reports say "emulated" for that reason.
 * (WebKit is not used on purpose: it cannot pin DNS, and the network guard must.)
 */
import { devices } from "playwright-core";

const strip = ({ defaultBrowserType, ...rest }) => rest; // the preset names a browser; we always use Chromium

const preset = (name) => {
  const d = devices[name];
  if (!d) throw new Error(`Unknown device preset: ${name}`);
  return strip(d);
};

/**
 * Campaigns are played on phones and tablets, so these are the devices: the iPhone and Android sizes people actually carry (from the
 * narrowest, 320px, to the widest, 480px) and the common tablets. There is no desktop here on purpose. family: how the report groups
 * them. The first one finds the pages and signs in or registers; the others open the same pages.
 */
const phone = (id, label, family, name) => ({ id, label, family, touch: true, opts: preset(name) });
export const DEVICES = [
  phone("iphone-15", "iPhone 15", "iPhone", "iPhone 15"),
  phone("iphone-se", "iPhone SE (small screen)", "iPhone", "iPhone SE"),
  phone("iphone-8", "iPhone 8", "iPhone", "iPhone 8"),
  phone("iphone-13", "iPhone 13", "iPhone", "iPhone 13"),
  phone("iphone-16-pro-max", "iPhone 16 Pro Max (large)", "iPhone", "iPhone 16 Pro Max"),
  phone("pixel-7", "Pixel 7 (Android)", "Android", "Pixel 7"),
  phone("pixel-5", "Pixel 5 (Android)", "Android", "Pixel 5"),
  phone("pixel-8-pro", "Pixel 8 Pro (Android)", "Android", "Pixel 8 Pro"),
  phone("galaxy-s9", "Galaxy S9+ (Android, narrow)", "Android", "Galaxy S9+"),
  phone("galaxy-s8", "Galaxy S8 (Android)", "Android", "Galaxy S8"),
  phone("galaxy-a55", "Galaxy A55 (Android, wide)", "Android", "Galaxy A55"),
  phone("ipad", "iPad", "iPad", "iPad (gen 7)"),
  phone("ipad-mini", "iPad Mini", "iPad", "iPad Mini"),
  phone("ipad-pro-11", "iPad Pro 11", "iPad", "iPad Pro 11"),
  phone("galaxy-tab-s9", "Galaxy Tab S9 (Android tablet)", "Android tablet", "Galaxy Tab S9"),
  phone("galaxy-tab-s4", "Galaxy Tab S4 (Android tablet)", "Android tablet", "Galaxy Tab S4"),
];

/** Desktop is an extra, switched on per run. Campaigns are played on phones and tablets, so it is never part of the default. */
export const OPTIONAL_DEVICES = [
  { id: "desktop", label: "Desktop 1440", family: "Desktop", touch: false, opts: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  { id: "laptop", label: "Laptop 1366", family: "Desktop", touch: false, opts: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 } },
];
export const DEVICE_BY_ID = new Map([...DEVICES, ...OPTIONAL_DEVICES].map((d) => [d.id, d]));

/** The first device finds the pages; the others open the same ones. */
export const PRIMARY_DEVICE = DEVICES[0];

/** Which devices to run: all of them, or a chosen subset by id (always keeping the primary one). */
export function pickDevices(ids, { desktop = false } = {}) {
  const extra = desktop ? OPTIONAL_DEVICES : [];
  if (!Array.isArray(ids) || !ids.length) return [...DEVICES, ...extra];
  const want = new Set(ids.map(String));
  return [...DEVICES.filter((d) => d === PRIMARY_DEVICE || want.has(d.id)), ...extra];
}

/** Small screens: sideways scrolling and the viewport tag matter most here. */
export const isSmallScreen = (d) => (d.opts.viewport?.width ?? 1440) < 800;

/**
 * The sizes offered in the interactive preview: the same phones and tablets as the all-device test, emulated in Chromium (screen size,
 * pixel density, touch and user agent), not physical devices. Older sessions used other ids (and a desktop), so those still resolve.
 */
export const SESSION_PRESETS = DEVICES.map((x) => ({ id: x.id, label: x.label, width: x.opts.viewport.width, height: x.opts.viewport.height, touch: true, family: x.family, opts: x.opts }));
const LEGACY = [
  { id: "desktop", label: "Desktop", width: 1440, height: 900, touch: false, opts: { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  { id: "laptop", label: "Laptop", width: 1366, height: 768, touch: false, opts: { viewport: { width: 1366, height: 768 }, screen: { width: 1366, height: 768 }, deviceScaleFactor: 1 } },
];
const ALIAS = { iphone: "iphone-15", android: "pixel-7", pixel: "pixel-7", galaxy: "galaxy-s8", tablet: "ipad" };
export const PRESET_BY_ID = new Map([...SESSION_PRESETS, ...LEGACY].map((p) => [p.id, p]));
for (const [from, to] of Object.entries(ALIAS)) PRESET_BY_ID.set(from, PRESET_BY_ID.get(to));
