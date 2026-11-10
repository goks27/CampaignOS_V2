// Run with: node --test tools/claude-worker
// The test browser must be Incognito with a throw-away profile, proven from the browser process itself, never just labelled.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { judge } from "./isolation.mjs";
import { Browser } from "./browser.mjs";
import { NetGuard } from "./netguard.mjs";

const skip = await chromium.launch().then((b) => b.close().then(() => false), () => "no browser installed");
const tmp = os.tmpdir();

test("judge: Incognito with a profile in the temp folder is accepted", () => {
  const dir = path.join(tmp, "playwright_chromiumdev_profile-abc");
  const j = judge(`"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --incognito --user-data-dir=${dir} --remote-debugging-pipe`, { tmp });
  assert.deepEqual([j.incognito, j.temporaryProfile, j.usesNormalProfile, j.verified], [true, true, false, true]);
});

test("judge: your own Chrome profile is refused, whatever else is set", () => {
  const j = judge(`chrome.exe --incognito --user-data-dir="C:\\Users\\Gokul\\AppData\\Local\\Google\\Chrome\\User Data" --remote-debugging-pipe`, { tmp });
  assert.equal(j.usesNormalProfile, true);
  assert.equal(j.temporaryProfile, false);
  assert.equal(j.verified, false);
});

test("judge: without --incognito, or with a profile outside the temp folder, it is not verified", () => {
  assert.equal(judge(`chrome.exe --user-data-dir=${path.join(tmp, "p")} --remote-debugging-pipe`, { tmp }).verified, false);
  assert.equal(judge(`chrome.exe --incognito --user-data-dir=D:\\profiles\\mine --remote-debugging-pipe`, { tmp }).verified, false);
  assert.equal(judge(`chrome.exe --incognito --remote-debugging-pipe`, { tmp }).verified, false);
});

test("a real browser is verified from its own process: Incognito, temporary profile, removed when it closes", { skip, timeout: 60_000 }, async () => {
  const b = await new Browser(new NetGuard([]), null, { verify: true }).open();
  try {
    const i = b.isolation;
    assert.ok(i, "isolation was checked");
    assert.match(i.engine, /Google Chrome|Chromium/);
    assert.equal(i.incognito, true, i.detail);
    assert.equal(i.temporaryProfile, true, i.detail);
    assert.equal(i.usesNormalProfile, false);
    assert.equal(i.verified, true, i.detail);
    assert.ok(i.profileDir && path.resolve(i.profileDir).toLowerCase().startsWith(path.resolve(tmp).toLowerCase()));
    // a page opened in it starts with nothing: no cookies and no storage from anywhere
    const ctx = await b.newContext("iphone-15");
    const page = await ctx.newPage();
    await page.goto("about:blank");
    assert.deepEqual(await ctx.cookies(), []);
  } finally { await b.close(); }
  assert.equal(b.isolation.profileRemoved, true, "the temporary profile is deleted with the browser");
});

test("two browsers never share a profile", { skip, timeout: 90_000 }, async () => {
  const a = await new Browser(new NetGuard([]), null, { verify: true }).open();
  const c = await new Browser(new NetGuard([]), null, { verify: true }).open();
  try {
    assert.notEqual(a.isolation.profileDir, c.isolation.profileDir);
    assert.ok(a.isolation.verified && c.isolation.verified);
  } finally { await a.close(); await c.close(); }
});
