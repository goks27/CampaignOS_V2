import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright-core";
import { createSessions, SessionError, checkEmbeddable, friendlyNavError } from "./browsersession.mjs";
import { NetGuard } from "./netguard.mjs";
import { Browser } from "./browser.mjs";

let probe = null;
try { probe = await chromium.launch({ headless: true }); await probe.close(); } catch { probe = null; }
const skip = probe ? false : "Chromium is not installed (npm run claude:browser)";

// ---------------------------------------------------------------- a local test website with something to find on every page
const posts = [];
const site = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const html = (body, headers = {}) => { res.writeHead(200, { "Content-Type": "text/html", ...headers }); res.end(`<!doctype html><html lang="en"><head><title>${url.pathname}</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;font-family:sans-serif">${body}</body></html>`); };
  if (req.method === "POST") { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => { posts.push(Object.fromEntries(new URLSearchParams(b))); html("<h1 id='done'>Saved</h1>"); }); return; }
  switch (url.pathname) {
    case "/": return html(`<h1>Home</h1><a id="about" href="/about" style="display:block;padding:20px;font-size:24px">About us</a>
      <form method="post" action="/save"><input id="name" name="name" style="font-size:24px;width:300px"><button id="go" type="submit" style="font-size:24px">Save</button></form>
      <div id="wide" style="width:300px">x</div>`);
    case "/about": return html(`<h1>About</h1><a id="home" href="/">Back home</a>`);
    case "/errors": return html(`<h1>Errors</h1><img src="/missing.png" alt="x"><script>console.error("boot failed: config missing"); setTimeout(() => { throw new Error("uncaught in timer"); }, 50); fetch("/api/fail"); fetch("http://localhost:${closedPort}/refused").catch(() => {}); fetch("http://127.0.0.1:${closedPort}/outside").catch(() => {});</script>`);
    case "/api/fail": res.writeHead(500, { "Content-Type": "text/plain" }); return res.end("boom");
    case "/captcha": return html(`<div class="g-recaptcha"></div><script src="https://www.google.com/recaptcha/api.js"></script><h1>Check</h1>`);
    case "/embed-deny": return html("<h1>x</h1>", { "X-Frame-Options": "DENY" });
    case "/embed-csp": return html("<h1>x</h1>", { "Content-Security-Policy": "frame-ancestors 'none'" });
    case "/embed-ok": return html("<h1>x</h1>");
    case "/embed-self": return html("<h1>x</h1>", { "X-Frame-Options": "SAMEORIGIN" });
    default: res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("nope");
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => site.once("listening", r));
const base = `http://localhost:${site.address().port}`;
/** A port nothing is listening on (not port 1: Chromium refuses that one as unsafe before it even tries). */
const closedPort = await new Promise((r) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

const make = (o = {}) => createSessions({ makeGuard: (a) => new NetGuard(a, { unsafeAllowPrivateForTests: true }), sweepMs: 100_000, ...o });
const until = async (fn, ms = 20_000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 50)); } };
const ready = (m, token) => until(() => (m.state(token).status === "ready" && !m.state(token).loading ? m.state(token) : null));
/** Where an element is, as fractions of the page, the way the dashboard sends clicks. */
const at = async (m, token, sel) => { const p = m.page(token); const b = await p.locator(sel).boundingBox(); const vp = p.viewportSize(); return { fx: (b.x + b.width / 2) / vp.width, fy: (b.y + b.height / 2) / vp.height }; };
const open = async (m, path = "/", extra = {}) => { const r = await m.open({ url: base + path, ...extra }); await ready(m, r.token); return r.token; };

test("opens a valid URL in a real browser and streams what it shows", { skip }, async () => {
  const m = make();
  const r = await m.open({ url: base + "/", campaign: { id: "c1", name: "Gold Drop" } });
  assert.equal(r.state.status, "launching", "the dashboard gets its token at once and watches the browser start");
  const st = await ready(m, r.token);
  assert.equal(await until(() => m.state(r.token).title), "/"); // the title arrives a moment after the page is ready
  assert.equal(st.url, base + "/");
  assert.equal(st.campaignName, "Gold Drop");
  assert.deepEqual(st.viewport, { width: 393, height: 659 });
  const f = await until(() => m.frame(r.token));
  assert.ok(f[0] === 0xff && f[1] === 0xd8, "a JPEG frame of the page");
  const got = []; const off = m.subscribe(r.token, (kind) => got.push(kind));
  assert.ok(got.includes("state") && got.includes("frame"), "a new viewer is given the current state and picture straight away");
  off();
  await m.closeAll();
});

test("clicks, scrolls, back, forward and reload all work in the page", { skip }, async () => {
  const m = make();
  const t = await open(m);
  assert.equal(m.state(t).canGoBack, false);
  await m.input(t, { type: "click", ...(await at(m, t, "#about")) });
  await until(() => m.state(t).url === base + "/about");
  const s = await ready(m, t);
  assert.equal(s.title, "/about");
  assert.equal(s.canGoBack, true);
  await m.back(t);
  await until(() => m.state(t).url === base + "/");
  assert.equal(m.state(t).canGoForward, true);
  await m.forward(t);
  await until(() => m.state(t).url === base + "/about");
  await m.page(t).evaluate("window.__marker = 1");
  await m.reload(t);
  await ready(m, t);
  assert.equal(await m.page(t).evaluate("window.__marker ?? 'gone'"), "gone", "reload really reloaded the page");
  await m.navigate(t, base + "/about");
  await m.page(t).setContent?.call; // the page is alive
  // scroll: a tall page moves
  await m.navigate(t, base + "/");
  await m.page(t).evaluate("document.body.style.height = '4000px'");
  await m.input(t, { type: "wheel", fx: 0.5, fy: 0.5, dx: 0, dy: 600 });
  await until(async () => (await m.page(t).evaluate("window.scrollY")) > 300);
  await m.closeAll();
});

test("typing and submitting a form reaches the website", { skip }, async () => {
  const m = make();
  const t = await open(m);
  await m.input(t, { type: "click", ...(await at(m, t, "#name")) });
  await m.input(t, { type: "text", text: "Ravi Kumar" });
  assert.equal(await m.page(t).inputValue("#name"), "Ravi Kumar");
  await m.input(t, { type: "key", key: "Backspace" });
  assert.equal(await m.page(t).inputValue("#name"), "Ravi Kuma");
  await m.input(t, { type: "text", text: "r" });
  await m.input(t, { type: "key", key: "Enter" });
  await until(() => posts.some((p) => p.name === "Ravi Kumar"));
  await until(async () => (await m.page(t).locator("#done").count()) === 1);
  await m.closeAll();
});

test("switching the size keeps the page: a resize for desktop sizes, the same page reopened for a phone", { skip }, async () => {
  const m = make();
  const t = await open(m, "/", { device: "desktop" });
  await m.page(t).evaluate("window.__marker = 42");
  await m.setDevice(t, "laptop");
  assert.deepEqual(m.state(t).viewport, { width: 1366, height: 768 });
  assert.equal(await m.page(t).evaluate("innerWidth"), 1366);
  assert.equal(await m.page(t).evaluate("window.__marker"), 42, "desktop to laptop does not reload the page");
  await m.setDevice(t, "iphone"); // an older id still opens the same device
  await until(() => m.state(t).device === "iphone-15" && m.state(t).status === "ready" && !m.state(t).loading);
  assert.equal(m.state(t).url, base + "/", "still on the same page");
  assert.equal(await m.page(t).evaluate("innerWidth"), 393);
  assert.match(await m.page(t).evaluate("navigator.userAgent"), /iPhone/);
  assert.equal(await m.page(t).evaluate("'ontouchstart' in window"), true, "touch is emulated");
  await m.setDevice(t, "galaxy-s9");
  await until(() => m.state(t).device === "galaxy-s9" && !m.state(t).loading);
  assert.equal(await m.page(t).evaluate("innerWidth"), 320, "the narrowest Android phone");
  assert.deepEqual(m.state(t).viewport, { width: 320, height: 658 });
  await m.setDevice(t, "ipad-mini");
  await until(() => m.state(t).device === "ipad-mini" && !m.state(t).loading);
  assert.equal(await m.page(t).evaluate("innerWidth"), 768);
  await assert.rejects(m.setDevice(t, "fridge"), /not one of the sizes/);
  // phone clicks still land where they are pointed
  await m.setDevice(t, "iphone-15");
  await until(() => m.state(t).device === "iphone-15" && !m.state(t).loading);
  await m.input(t, { type: "click", ...(await at(m, t, "#about")) });
  await until(() => m.state(t).url === base + "/about");
  await m.closeAll();
});

test("console errors, uncaught exceptions, failed and error-status requests are captured, with evidence, without calling every 4xx a bug", { skip }, async () => {
  const m = make();
  const t = await open(m, "/errors");
  await until(() => m.log(t).events.some((e) => e.category === "page-error"));
  const log = m.log(t);
  const by = (c) => log.events.filter((e) => e.category === c);
  assert.ok(by("console-error").some((e) => /boot failed: config missing/.test(e.message)), "a console error");
  assert.ok(by("page-error").some((e) => /uncaught in timer/.test(e.message) && e.severity === "high"), "an uncaught exception");
  const http500 = by("http-error").find((e) => e.status === 500);
  assert.ok(http500 && http500.method === "GET" && /api\/fail/.test(http500.url), "the real status and the request that got it");
  assert.match(http500.evidence, /not always an application bug/);
  const http404 = by("http-error").find((e) => e.status === 404 && /missing\.png/.test(e.url));
  assert.ok(http404 && http404.severity === "low", "a 404 is a low note, not a confirmed bug");
  assert.ok(by("network-failed").some((e) => e.url.includes(`localhost:${closedPort}/refused`) && /REFUSED/i.test(e.evidence)), "a failed request");
  assert.ok(by("blocked").some((e) => e.url.includes(`127.0.0.1:${closedPort}`) && e.severity === "info"), "a request outside the allowed hosts is a note, not a bug");
  assert.ok(log.console.some((c) => c.type === "error" && /boot failed/.test(c.text)), "the console log keeps every message");
  assert.ok(log.network.some((n) => /api\/fail/.test(n.url) && n.status === 500 && n.method === "GET" && typeof n.ms === "number"), "the network log keeps every request");
  assert.ok(log.network.some((n) => n.failed && n.url.includes(`localhost:${closedPort}`)));
  // evidence: a screenshot of the page when it went wrong
  const withShot = await until(() => m.log(t).events.find((e) => e.hasShot && e.severity !== "info"));
  const jpeg = m.shot(t, withShot.shotRef);
  assert.ok(jpeg && jpeg[0] === 0xff && jpeg[1] === 0xd8, "evidence is a JPEG of the page");
  // a picture on demand
  const cap = await m.capture(t, "Looks wrong here");
  assert.equal(cap.category, "capture");
  assert.ok(m.shot(t, cap.shotRef).length > 500);
  assert.ok(m.log(t, cap.id - 1).events.some((e) => e.id === cap.id), "events can be fetched since an id, so the dashboard only asks for what is new");
  await m.closeAll();
});

test("a CAPTCHA is flagged for you to solve yourself, never bypassed", { skip }, async () => {
  const m = make();
  const t = await open(m, "/captcha");
  await until(() => m.state(t).captcha);
  assert.ok(m.log(t).events.some((e) => e.category === "captcha" && /never bypassed/.test(e.message)));
  assert.equal(m.state(t).status, "ready", "the page stays usable: you can solve it in the preview");
  await m.closeAll();
});

test("an unreachable site, a timeout and a blocked address are explained, not left blank", { skip }, async () => {
  const m = make();
  const r = await m.open({ url: `http://localhost:${closedPort}/` });
  const st = await until(() => (m.state(r.token).status === "error" ? m.state(r.token) : null));
  assert.equal(st.errorCode, "unreachable");
  assert.match(st.error, /refused the connection/);
  assert.ok(m.log(r.token).events.some((e) => e.category === "navigation" && e.severity === "high"));
  await m.closeAll();
  assert.deepEqual(friendlyNavError(new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at http://x.invalid/")), { code: "unreachable", text: "The site could not be found: its address does not resolve." });
  assert.equal(friendlyNavError(new Error("page.goto: Timeout 45000ms exceeded.")).code, "timeout");
  assert.equal(friendlyNavError(new Error("net::ERR_CERT_AUTHORITY_INVALID")).code, "unreachable");
  assert.equal(friendlyNavError(new Error("net::ERR_UNSAFE_PORT")).code, "blocked");
  const m2 = make();
  const t = await open(m2);
  await assert.rejects(m2.navigate(t, "http://example.org/"), (e) => e instanceof SessionError && e.code === "blocked" && /allowed|allow-list/.test(e.message));
  assert.equal(m2.state(t).url, base + "/", "the page stayed where it was");
  await m2.closeAll();
});

test("only http(s), and never a private, loopback or metadata address in real use", { skip }, async () => {
  const real = createSessions(); // the real guard, as the connector runs it
  for (const [url, code] of [["ftp://x.test/", "bad_url"], ["javascript:alert(1)", "bad_url"], ["not a url", "bad_url"], [`http://127.0.0.1:${site.address().port}/`, "blocked"], ["http://169.254.169.254/latest/meta-data/", "blocked"], ["http://10.0.0.5/", "blocked"], ["http://[::1]/", "blocked"], [`${base}/`, "blocked"]]) {
    await assert.rejects(real.open({ url }), (e) => e instanceof SessionError && e.code === code, `${url} should be ${code}`);
  }
  assert.equal(real.active(), false, "nothing was launched for any of them");
  await real.closeAll();
});

test("it reports whether a site allows embedding, and the preview works either way", { skip }, async () => {
  const guard = new NetGuard(["localhost"], { unsafeAllowPrivateForTests: true });
  assert.equal((await checkEmbeddable(`${base}/embed-deny`, { guard })).embeddable, false);
  assert.match((await checkEmbeddable(`${base}/embed-deny`, { guard })).reason, /X-Frame-Options: deny/);
  assert.equal((await checkEmbeddable(`${base}/embed-self`, { guard })).embeddable, false);
  assert.equal((await checkEmbeddable(`${base}/embed-csp`, { guard })).embeddable, false);
  assert.match((await checkEmbeddable(`${base}/embed-csp`, { guard })).reason, /frame-ancestors/);
  assert.equal((await checkEmbeddable(`${base}/embed-ok`, { guard })).embeddable, true);
  assert.equal((await checkEmbeddable(`${base}/embed-ok`, { guard: new NetGuard(["localhost"]) })).embeddable, null, "a private address is not even fetched");
  assert.equal((await checkEmbeddable(`http://localhost:${closedPort}/`, { guard })).embeddable, null);
  // a blocked site still previews: the real browser is the preview
  const m = make();
  const t = await open(m, "/embed-deny");
  assert.equal(m.state(t).status, "ready");
  assert.equal((await m.checkEmbeddable(`${base}/embed-deny`, [])).embeddable, false);
  await m.closeAll();
});

test("every command needs the session's own token, and one session at a time", { skip }, async () => {
  const m = make();
  const a = await m.open({ url: base + "/" }); await ready(m, a.token);
  for (const call of [() => m.state("nope"), () => m.input("nope", { type: "move" }), () => m.navigate("nope", base), () => m.frame(""), () => m.close("x")]) {
    await assert.rejects(Promise.resolve().then(call), (e) => e instanceof SessionError && e.code === "no_session");
  }
  const b = await m.open({ url: base + "/about" }); await ready(m, b.token);
  assert.notEqual(a.token, b.token);
  assert.throws(() => m.state(a.token), /no open preview/, "opening another replaced the first");
  assert.equal(m.state(b.token).url, base + "/about");
  await m.closeAll();
});

test("a test locks the browser, so a person and a test cannot fight over it", { skip }, async () => {
  const m = make();
  const t = await open(m);
  m.lock(t, "Test running");
  assert.equal(m.state(t).locked, true);
  assert.throws(() => m.lock(t, "again"), /already running/);
  await assert.rejects(m.input(t, { type: "key", key: "Enter" }), (e) => e.code === "locked");
  await assert.rejects(m.navigate(t, base + "/about"), (e) => e.code === "locked");
  await m.capture(t); // looking is still allowed
  m.unlock(t);
  await m.input(t, { type: "move", fx: 0.5, fy: 0.5 });
  await m.closeAll();
});

test("stopping closes the browser and cleans up; an idle preview closes itself", { skip }, async () => {
  const m = make();
  const t = await open(m);
  const page = m.page(t);
  const seen = []; m.subscribe(t, (k, p) => seen.push([k, p]));
  await m.close(t, "You closed it.");
  assert.ok(seen.some(([k, p]) => k === "closed" && p.reason === "You closed it."));
  assert.equal(m.active(), false);
  assert.throws(() => m.state(t), /no open preview/);
  await until(() => page.isClosed());

  const idle = make({ idleMs: 400, sweepMs: 80 });
  const r = await idle.open({ url: base + "/" }); await ready(idle, r.token);
  await until(() => !idle.active(), 5000);
  await idle.closeAll();
});

test("input is validated", { skip }, async () => {
  const m = make();
  const t = await open(m);
  await assert.rejects(m.input(t, { type: "explode" }), /Unknown input/);
  await assert.rejects(m.input(t, { type: "key", key: "F12" }), /not supported/);
  await m.input(t, { type: "click", fx: 99, fy: -5 }); // clamped to the page, never outside it
  await m.closeAll();
});

test.after(async () => { site.close(); });

test("a visible Chrome window is only opened when asked for, and the state says so", { skip }, async () => {
  const seen = [];
  const m = make({ openBrowser: (g, c, o) => { seen.push(o); return new Browser(g, c).open(); } }); // the test still runs hidden
  const a = await m.open({ url: base + "/" });
  assert.equal(a.state.headed, false);
  await ready(m, a.token);
  const b = await m.open({ url: base + "/", window: true });
  assert.equal(b.state.headed, true);
  await ready(m, b.token);
  assert.deepEqual(seen, [{ headed: false }, { headed: true }]);
  assert.equal(m.state(b.token).headed, true);
  await m.closeAll();
});
