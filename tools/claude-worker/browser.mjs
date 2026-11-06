/**
 * Headless Chromium for staging reviews (Playwright). Port of services/local-ai-worker/app/browser.py.
 * One browser per job. Every request goes through the NetGuard; service workers are blocked; HTTPS errors are not ignored.
 */
import { chromium } from "playwright-core";
import { JobFailed } from "./core.mjs";
import { live } from "./live.mjs";
import { DEVICE_BY_ID } from "./devices.mjs";

export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
export const CAPTCHA_RE = /recaptcha|hcaptcha|turnstile|captcha/i;
const MAX_FULLPAGE_HEIGHT = 8000;

/** Runs inside the page. Read-only: it never clicks or types. */
const AUDIT = `() => {
  const abs = (h) => { try { const u = new URL(h, location.href); u.hash = ""; return u.toString(); } catch { return null; } };
  const imgs = [...document.images].map((i) => ({ src: i.currentSrc || i.src, alt: i.getAttribute("alt"), broken: i.complete && i.naturalWidth === 0 && !!(i.currentSrc || i.src), visible: !!(i.offsetWidth || i.offsetHeight) }));
  const links = [...document.querySelectorAll("a[href]")].map((a) => ({ href: abs(a.getAttribute("href")), raw: a.getAttribute("href") || "", text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 60), download: a.hasAttribute("download") })).filter((l) => l.href);
  const inputs = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), select, textarea")];
  return {
    title: (document.title || "").trim(), lang: document.documentElement.lang || "", viewportMeta: !!document.querySelector('meta[name="viewport"]'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, imgs, links,
    emptyLinks: [...document.querySelectorAll("a")].filter((a) => ["#", "", "javascript:void(0)", "javascript:;"].includes((a.getAttribute("href") ?? "").trim())).length,
    wide: [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.right > document.documentElement.clientWidth + 2 && cs.position !== "fixed" && cs.display !== "none" && cs.visibility !== "hidden"; })
      .slice(0, 5).map((e) => ({ tag: e.tagName.toLowerCase(), text: (e.innerText || e.getAttribute("alt") || "").trim().slice(0, 30), width: Math.round(e.getBoundingClientRect().width) })),
    smallTargets: [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button]")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 32 || r.height < 32) && getComputedStyle(e).visibility !== "hidden"; }).length,
    tinyText: [...document.querySelectorAll("p, li, span, a, td, label, h1, h2, h3, h4")].filter((e) => e.childElementCount === 0 && (e.innerText || "").trim().length > 3 && parseFloat(getComputedStyle(e).fontSize) < 11).length,
    unlabelledInputs: inputs.filter((i) => !(i.labels && i.labels.length) && !i.getAttribute("aria-label") && !i.getAttribute("aria-labelledby") && !i.getAttribute("placeholder")).length,
  };
}`;

/** Runs inside the page: is a loader or splash screen still covering it, and has the content stopped changing? Read-only. */
const LOOK = `() => {
  const t = (document.body ? document.body.innerText : "").trim();
  const covers = [...document.querySelectorAll("[class*=load i],[id*=load i],[class*=splash i],[id*=splash i],[class*=preload i],[class*=spinner i],[class*=intro i]")].some((e) => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.1 && r.width >= innerWidth * 0.8 && r.height >= innerHeight * 0.8 && r.bottom > 0 && r.top < innerHeight;
  });
  const bare = /\b(loading|please wait)\b/i.test(t.slice(0, 400)) && t.length < 600;
  return { len: t.length, loading: covers || bare, pending: [...document.images].filter((i) => !i.complete && (i.currentSrc || i.src)).length };
}`;

/**
 * Waits until the page has really finished: network quiet, no loader or splash screen covering it, no images still arriving
 * and the text no longer changing. Many sites run a timed preloader that network-idle cannot see, so a screenshot taken
 * on idle alone shows the loader. Returns whether it settled; after maxMs it gives up and says so.
 */
export async function settle(page, { maxMs = 25_000, stableFor = 2 } = {}) {
  const start = Date.now();
  let last = -1, stable = 0, state = { loading: false };
  while (Date.now() - start < maxMs) {
    state = await page.evaluate(`(${LOOK})()`).catch(() => null);
    if (!state) return { settled: true, waitedMs: Date.now() - start };
    if (!state.loading && !state.pending && state.len === last) { if (++stable >= stableFor) return { settled: true, waitedMs: Date.now() - start }; } else stable = 0;
    last = state.len;
    await page.waitForTimeout(1000);
  }
  return { settled: !state?.loading, stillLoading: Boolean(state?.loading), waitedMs: Date.now() - start };
}

/**
 * Sends a small picture of the page to the live view about once a second while fn runs. Best effort: a missed
 * frame is fine, and it never slows or fails the job.
 */
export function startFrames(page, { everyMs = 900 } = {}) {
  let busy = false, stopped = false;
  const grab = async () => {
    if (busy || stopped || page.isClosed()) return;
    busy = true;
    try { live.setFrame(await page.screenshot({ type: "jpeg", quality: 50, timeout: 3000 })); } catch { /* the page is navigating or closing */ } finally { busy = false; }
  };
  const timer = setInterval(grab, everyMs);
  return () => { stopped = true; clearInterval(timer); };
}
export async function withFrames(page, fn, opts) {
  const stop = startFrames(page, opts);
  try { return await fn(); } finally { stop(); }
}

export class Browser {
  /** `headed` opens a visible window on this PC (the installed Google Chrome when there is one) instead of a hidden browser. */
  constructor(guard, httpCredentials = null, { headed = false } = {}) {
    this.headed = headed;
    this.guard = guard;
    this.httpCredentials = httpCredentials;
    this.browser = null;
  }

  async open() {
    const args = ["--disable-background-networking", "--no-first-run", "--disable-sync", "--disable-extensions"];
    const rules = await this.guard.resolverRules();
    if (rules) args.push(`--host-resolver-rules=${rules}`);
    try {
      if (this.headed) {
        try { this.browser = await chromium.launch({ headless: false, channel: "chrome", args }); } // the real Chrome app, when installed
        catch { this.browser = await chromium.launch({ headless: false, args }); } // otherwise the Chromium that came with the tools
      } else this.browser = await chromium.launch({ headless: true, args });
    } catch (e) {
      if (/Executable doesn't exist|browserType\.launch/i.test(String(e.message))) {
        throw new JobFailed("The browser for staging reviews is not installed on this PC. Run npm run claude:browser once, then run the review again.", { retryable: false });
      }
      throw new JobFailed(`Could not start the browser: ${String(e.message).split("\n")[0]}`, { retryable: true });
    }
    return this;
  }

  async close() {
    try { await this.linkCtx?.close(); await this.browser?.close(); } catch { /* already closed */ }
    this.browser = null;
  }

  /** `extra` can carry a saved session (`storageState`), so a device can start already registered or signed in. */
  async newContext(device, extra = {}) {
    const opts = { ...(DEVICE_BY_ID.get(device)?.opts ?? VIEWPORTS[device] ?? VIEWPORTS.desktop), serviceWorkers: "block", ignoreHTTPSErrors: false, acceptDownloads: false, ...extra };
    if (this.httpCredentials) opts.httpCredentials = this.httpCredentials;
    const ctx = await this.browser.newContext(opts);
    await ctx.route("**/*", async (route) => {
      const url = route.request().url();
      const { ok, why } = await this.guard.check(url);
      if (ok) return route.continue();
      this.guard.blocked.push(`${url} (${why})`);
      return route.abort("blockedbyclient");
    });
    return ctx;
  }

  static attachListeners(page, consoleLog, failed) {
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) consoleLog.push({ type: m.type(), text: m.text().slice(0, 500) }); });
    page.on("pageerror", (e) => consoleLog.push({ type: "pageerror", text: String(e).slice(0, 500) }));
    page.on("requestfailed", (r) => failed.push({ url: r.url().slice(0, 300), error: (r.failure()?.errorText ?? "").slice(0, 200) }));
    page.on("response", (r) => { if (r.status() >= 400) failed.push({ url: r.url().slice(0, 300), status: r.status() }); });
  }

  /**
   * Status of a link without opening it in the page. Redirects are followed by hand so EVERY hop goes through the network guard
   * (the request API does not use the page's route guard). Returns { status, error?, final }.
   */
  async linkStatus(url) {
    this.linkCtx ??= await this.browser.newContext({ serviceWorkers: "block" });
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const { ok, why } = await this.guard.check(current);
      if (!ok) return { status: 0, error: `not checked: ${why}`, final: current, skipped: true };
      let r;
      try {
        r = await this.linkCtx.request.fetch(current, { method: "HEAD", maxRedirects: 0, failOnStatusCode: false, timeout: 10_000 });
        if (r.status() >= 400 || r.status() === 0) r = await this.linkCtx.request.fetch(current, { method: "GET", maxRedirects: 0, failOnStatusCode: false, timeout: 10_000 });
      } catch (e) {
        return { status: 0, error: String(e.message).split("\n")[0].slice(0, 160), final: current };
      }
      const status = r.status();
      const loc = r.headers().location;
      await r.dispose();
      if (status >= 300 && status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
      return { status, final: current };
    }
    return { status: 0, error: "too many redirects", final: current };
  }

  /** Pass `ctx` to reuse a context (for example one that is already signed in); it is then left open for the caller to close. */
  async capture(url, device, { inspect = false, ctx: shared = null } = {}) {
    const { ok, why } = await this.guard.check(url);
    if (!ok) throw new JobFailed(`Refusing to open ${url}: ${why}. Add the domain to the environment's allowed domains.`, { retryable: false });
    const ctx = shared ?? await this.newContext(device);
    const consoleLog = [], failed = [], mixed = [];
    const blockedFrom = this.guard.blocked.length;
    let page;
    try {
      page = await ctx.newPage();
      Browser.attachListeners(page, consoleLog, failed);
      if (inspect) page.on("request", (r) => { if (/^https:/.test(page.url()) && /^http:/.test(r.url())) mixed.push(r.url().slice(0, 200)); });
      let status = 0, contentType = "", loaded;
      // Everything up to the screenshot is shown live: the page as it loads, the loader, then the real page.
      await withFrames(page, async () => {
        const label = DEVICE_BY_ID.get(device)?.label ?? device;
        live.where({ url, device: label });
        live.step(`Opening ${url.replace(/^https?:\/\//, "").slice(0, 80)} on ${label}`);
        try {
          const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
          status = resp?.status() ?? 0;
          contentType = resp?.headers()["content-type"] ?? "";
        } catch (e) {
          throw new JobFailed(`Could not open ${url}: ${String(e.message).split("\n")[0]}`, { retryable: true });
        }
        live.step("Waiting for the page to load");
        try { await page.waitForLoadState("networkidle", { timeout: 15_000 }); } catch { await page.waitForTimeout(2000); }
        live.step("Waiting for any loading screen to finish");
        loaded = await settle(page);
        live.step(loaded.stillLoading ? "The loading screen did not finish" : loaded.waitedMs > 2500 ? `Page ready after ${Math.round(loaded.waitedMs / 1000)}s of loading` : "Page ready");
      });
      live.step("Taking the screenshot and checking the page");
      const height = Math.min(MAX_FULLPAGE_HEIGHT, Number(await page.evaluate("document.documentElement.scrollHeight")) || 900);
      const vp = page.viewportSize() ?? { width: 1440, height: 900 };
      const png = await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: vp.width, height }, animations: "disabled", scale: "css" });
      const text = String(await page.evaluate("document.body ? document.body.innerText : ''")).slice(0, 20_000);
      const html = await page.content();
      // Requests the connector's own network guard refused (hosts outside the allow-list), so they are never mistaken for the site's own bugs.
      const blocked = this.guard.blocked.slice(blockedFrom).map((x) => String(x).split(" (")[0]);
      const cap = { blocked, url: page.url(), viewport: device, png, width: vp.width, height, text, console: consoleLog, failed, captcha: CAPTCHA_RE.test(html), stillLoading: Boolean(loaded.stillLoading), settleMs: loaded.waitedMs };
      if (!inspect) return cap;
      const facts = await page.evaluate(`(${AUDIT})()`);
      const loadMs = Number(await page.evaluate("Math.round(performance.getEntriesByType('navigation')[0]?.loadEventEnd || 0)")) || 0;
      return { ...cap, status, contentType, facts, loadMs, mixed };
    } finally {
      if (shared) await page?.close().catch(() => undefined);
      else await ctx.close();
    }
  }
}
