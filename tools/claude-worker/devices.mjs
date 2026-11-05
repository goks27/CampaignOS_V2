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

/** family: how the report groups them. touch: tap-target rules apply. */
export const DEVICES = [
  { id: "desktop", label: "Desktop 1440", family: "Desktop", touch: false, opts: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  { id: "laptop", label: "Laptop 1280", family: "Desktop", touch: false, opts: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
  { id: "iphone-15", label: "iPhone 15", family: "iPhone", touch: true, opts: preset("iPhone 15") },
  { id: "iphone-se", label: "iPhone SE (small screen)", family: "iPhone", touch: true, opts: preset("iPhone SE") },
  { id: "pixel-7", label: "Pixel 7 (Android)", family: "Android", touch: true, opts: preset("Pixel 7") },
  { id: "galaxy-s9", label: "Galaxy S9+ (Android)", family: "Android", touch: true, opts: preset("Galaxy S9+") },
  { id: "ipad", label: "iPad", family: "iPad", touch: true, opts: preset("iPad (gen 7)") },
];

export const DEVICE_BY_ID = new Map(DEVICES.map((d) => [d.id, d]));

/** The first device finds the pages; the others open the same ones. */
export const PRIMARY_DEVICE = DEVICES[0];

/** Which devices to run: all of them, or a chosen subset by id (always keeping the primary one). */
export function pickDevices(ids) {
  if (!Array.isArray(ids) || !ids.length) return DEVICES;
  const want = new Set(ids.map(String));
  return DEVICES.filter((d) => d === PRIMARY_DEVICE || want.has(d.id));
}

/** Small screens: sideways scrolling and the viewport tag matter most here. */
export const isSmallScreen = (d) => (d.opts.viewport?.width ?? 1440) < 800;
