import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { settle, withFrames } from "./browser.mjs";
import { live } from "./live.mjs";

let browser = null;
try { browser = await chromium.launch({ headless: true }); } catch { /* no browser installed: these tests are skipped */ }
const skip = browser ? false : "Chromium is not installed (npm run claude:browser)";

const page = async (html) => { const p = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await p.setContent(html); return p; };
const LOADER = (ms) => `<style>#preloader{position:fixed;inset:0;background:#306;color:#fff}</style><div id="preloader">LOADING...</div>
  <main>${"Welcome to the campaign. ".repeat(40)}REGISTER &amp; PLAY NOW</main>
  <script>setTimeout(()=>{document.getElementById("preloader").style.display="none"},${ms})</script>`;

test("waits for a timed preloader that network-idle cannot see", { skip }, async () => {
  const p = await page(LOADER(2500));
  const r = await settle(p, { maxMs: 12_000 });
  assert.equal(r.settled, true);
  assert.ok(r.waitedMs >= 2000, `returned after ${r.waitedMs}ms, while the loader was still up`);
  assert.equal(await p.evaluate(`getComputedStyle(document.getElementById("preloader")).display`), "none");
  await p.close();
});

test("a normal page settles quickly", { skip }, async () => {
  const p = await page("<main>" + "Hello world. ".repeat(60) + "</main>");
  const r = await settle(p, { maxMs: 12_000 });
  assert.equal(r.settled, true);
  assert.ok(r.waitedMs < 5000);
  await p.close();
});

test("a loader that never ends is reported, not waited on forever", { skip }, async () => {
  const p = await page(LOADER(10 * 60_000));
  const r = await settle(p, { maxMs: 3500 });
  assert.equal(r.stillLoading, true);
  assert.equal(r.settled, false);
  assert.ok(r.waitedMs < 8000);
  await p.close();
});

test("live view: a picture of the page reaches the live store while it loads, and nothing is kept after the job", { skip }, async () => {
  live.start({ jobId: "t", type: "site_check" });
  const p = await page(LOADER(2000));
  await withFrames(p, () => settle(p, { maxMs: 8000 }), { everyMs: 300 });
  const f = live.frame();
  assert.ok(f && f[0] === 0xff && f[1] === 0xd8, "a JPEG frame was captured");
  assert.ok(live.state().seq >= 2, "frames keep coming while the page loads");
  live.end();
  assert.equal(live.frame(), null);
  await p.close();
});

test.after(async () => { await browser?.close(); });
