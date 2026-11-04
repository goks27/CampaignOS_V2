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
    try { await this.browser?.close(); } catch { /* already closed */ }
    this.browser = null;
  }

  async newContext(device) {
    const opts = { ...(VIEWPORTS[device] ?? VIEWPORTS.desktop), serviceWorkers: "block", ignoreHTTPSErrors: false };
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

  async capture(url, device) {
    const { ok, why } = await this.guard.check(url);
    if (!ok) throw new JobFailed(`Refusing to open ${url}: ${why}. Add the domain to the environment's allowed domains.`, { retryable: false });
    const ctx = await this.newContext(device);
    const consoleLog = [], failed = [];
    try {
      const page = await ctx.newPage();
      Browser.attachListeners(page, consoleLog, failed);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      } catch (e) {
        throw new JobFailed(`Could not open ${url}: ${String(e.message).split("\n")[0]}`, { retryable: true });
      }
      try { await page.waitForLoadState("networkidle", { timeout: 15_000 }); } catch { await page.waitForTimeout(2000); }
      const height = Math.min(MAX_FULLPAGE_HEIGHT, Number(await page.evaluate("document.documentElement.scrollHeight")) || 900);
      const vp = page.viewportSize() ?? { width: 1440, height: 900 };
      const png = await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: vp.width, height }, animations: "disabled" });
      const text = String(await page.evaluate("document.body ? document.body.innerText : ''")).slice(0, 20_000);
      const html = await page.content();
      return { url: page.url(), viewport: device, png, width: vp.width, height, text, console: consoleLog, failed, captcha: CAPTCHA_RE.test(html) };
    } finally {
      await ctx.close();
    }
  }
}
