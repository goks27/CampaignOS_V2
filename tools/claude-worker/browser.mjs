/**
 * Headless Chromium for staging reviews (Playwright). Port of services/local-ai-worker/app/browser.py.
 * One browser per job. Every request goes through the NetGuard; service workers are blocked; HTTPS errors are not ignored.
 */
import { chromium } from "playwright-core";
import { JobFailed } from "./core.mjs";

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
    unlabelledInputs: inputs.filter((i) => !(i.labels && i.labels.length) && !i.getAttribute("aria-label") && !i.getAttribute("aria-labelledby") && !i.getAttribute("placeholder")).length,
  };
}`;

export class Browser {
  constructor(guard, httpCredentials = null) {
    this.guard = guard;
    this.httpCredentials = httpCredentials;
    this.browser = null;
  }

  async open() {
    const args = ["--disable-background-networking", "--no-first-run", "--disable-sync", "--disable-extensions"];
    const rules = await this.guard.resolverRules();
    if (rules) args.push(`--host-resolver-rules=${rules}`);
    try {
      this.browser = await chromium.launch({ headless: true, args });
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

  async newContext(device) {
    const opts = { ...(VIEWPORTS[device] ?? VIEWPORTS.desktop), serviceWorkers: "block", ignoreHTTPSErrors: false, acceptDownloads: false };
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

  async capture(url, device, { inspect = false } = {}) {
    const { ok, why } = await this.guard.check(url);
    if (!ok) throw new JobFailed(`Refusing to open ${url}: ${why}. Add the domain to the environment's allowed domains.`, { retryable: false });
    const ctx = await this.newContext(device);
    const consoleLog = [], failed = [], mixed = [];
    try {
      const page = await ctx.newPage();
      Browser.attachListeners(page, consoleLog, failed);
      if (inspect) page.on("request", (r) => { if (/^https:/.test(page.url()) && /^http:/.test(r.url())) mixed.push(r.url().slice(0, 200)); });
      let status = 0, contentType = "";
      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        status = resp?.status() ?? 0;
        contentType = resp?.headers()["content-type"] ?? "";
      } catch (e) {
        throw new JobFailed(`Could not open ${url}: ${String(e.message).split("\n")[0]}`, { retryable: true });
      }
      try { await page.waitForLoadState("networkidle", { timeout: 15_000 }); } catch { await page.waitForTimeout(2000); }
      const height = Math.min(MAX_FULLPAGE_HEIGHT, Number(await page.evaluate("document.documentElement.scrollHeight")) || 900);
      const vp = page.viewportSize() ?? { width: 1440, height: 900 };
      const png = await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: vp.width, height }, animations: "disabled" });
      const text = String(await page.evaluate("document.body ? document.body.innerText : ''")).slice(0, 20_000);
      const html = await page.content();
      const cap = { url: page.url(), viewport: device, png, width: vp.width, height, text, console: consoleLog, failed, captcha: CAPTCHA_RE.test(html) };
      if (!inspect) return cap;
      const facts = await page.evaluate(`(${AUDIT})()`);
      const loadMs = Number(await page.evaluate("Math.round(performance.getEntriesByType('navigation')[0]?.loadEventEnd || 0)")) || 0;
      return { ...cap, status, contentType, facts, loadMs, mixed };
    } finally {
      await ctx.close();
    }
  }
}
