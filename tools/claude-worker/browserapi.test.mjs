import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright-core";
import { createConnector } from "./server.mjs";
import { createSessions } from "./browsersession.mjs";
import { createLiveTest } from "./livetest.mjs";
import { createLive } from "./live.mjs";
import { NetGuard } from "./netguard.mjs";

let probe = null;
try { probe = await chromium.launch({ headless: true }); await probe.close(); } catch { probe = null; }
const skip = probe ? false : "Chromium is not installed (npm run claude:browser)";

const posts = [];
const site = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const html = (b, h = {}) => { res.writeHead(200, { "Content-Type": "text/html", ...h }); res.end(`<!doctype html><html lang="en"><head><title>${url.pathname}</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;font-family:sans-serif">${b}</body></html>`); };
  if (req.method === "POST") { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => { posts.push(Object.fromEntries(new URLSearchParams(b))); html("<h1 id='done'>Thanks</h1>"); }); return; }
  if (url.pathname === "/") return html(`<h1>Home</h1><a id="next" href="/next" style="display:block;font-size:28px;padding:16px">Next page</a><form method="post" action="/f"><input id="who" name="who" style="font-size:24px"><button id="send" style="font-size:24px">Send</button></form><script>console.error("home boot error")</script>`);
  if (url.pathname === "/next") return html("<h1 id='n'>Next</h1>");
  if (url.pathname === "/frameblock") return html("<h1>x</h1>", { "X-Frame-Options": "DENY" });
  res.writeHead(404); res.end("no");
}).listen(0, "127.0.0.1");
await new Promise((r) => site.once("listening", r));
const base = `http://localhost:${site.address().port}`;

const guardFor = (a) => new NetGuard(a, { unsafeAllowPrivateForTests: true });
const sessions = createSessions({ makeGuard: guardFor, sweepMs: 100_000 });
const live = createLive();
const liveTest = createLiveTest({ live, sessions, makeGuard: guardFor });
const ORIGIN = "https://dash.example";
const connector = createConnector({ cfg: { port: 0, origins: [ORIGIN], pollMs: 3_600_000, name: "claude-code", model: "sonnet", jobTimeoutMs: 1000 }, db: { rpc: async () => null }, sessions, liveTest, live, log: () => {}, claude: { ok: true, version: "t" }, claimNext: async () => null });
await connector.start();
const port = connector.server.address().port;

const call = (method, path, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: "127.0.0.1", port, method, path, headers: { Origin: ORIGIN, ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
    const chunks = []; res.on("data", (d) => chunks.push(d));
    res.on("end", () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString()); } catch { /* an image */ } resolve({ status: res.statusCode, json, buf, headers: res.headers }); });
  });
  req.on("error", reject); if (data) req.write(data); req.end();
});
const until = async (fn, ms = 20_000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 60)); } };
const open = async (path = "/") => { const r = await call("POST", "/browser/open", { url: base + path, device: "desktop", campaign_id: "c1", campaign_name: "Gold Drop" }); assert.equal(r.status, 200, JSON.stringify(r.json)); const token = r.json.token; await until(async () => { const s = (await call("GET", `/browser/log?token=${token}`)).json.state; return s.status === "ready" && !s.loading; }); return token; };
const fractions = async (token, sel) => { const p = sessions.page(token); const b = await p.locator(sel).boundingBox(); const v = p.viewportSize(); return { fx: (b.x + b.width / 2) / v.width, fy: (b.y + b.height / 2) / v.height }; };

test("opening returns a token at once; the page, its title and the first picture follow", { skip }, async () => {
  const r = await call("POST", "/browser/open", { url: base + "/", device: "iphone", campaign_id: "c1", campaign_name: "Gold Drop" });
  assert.equal(r.status, 200);
  assert.equal(r.json.state.status, "launching");
  assert.match(r.json.token, /^[0-9a-f]{48}$/);
  const token = r.json.token;
  const st = await until(async () => { const s = (await call("GET", `/browser/log?token=${token}`)).json.state; return s.status === "ready" && !s.loading && s.title ? s : null; });
  assert.equal(st.title, "/");
  assert.deepEqual(st.viewport, { width: 390, height: 844 });
  assert.equal(st.campaignName, "Gold Drop");
  assert.equal((await call("POST", "/browser/command", { token, type: "close" })).status, 200);
});

test("the picture streams over Server-Sent Events, and a click sent back is replayed in the page", { skip }, async () => {
  const token = await open("/");
  const events = [];
  const stream = http.get({ host: "127.0.0.1", port, path: `/browser/stream?token=${token}`, headers: { Origin: ORIGIN, Accept: "text/event-stream" } });
  const res = await new Promise((r) => stream.once("response", r));
  assert.equal(res.headers["content-type"], "text/event-stream");
  assert.equal(res.headers["access-control-allow-origin"], ORIGIN);
  let buf = "";
  res.on("data", (d) => { buf += d; for (let i; (i = buf.indexOf("\n\n")) >= 0;) { const raw = buf.slice(0, i); buf = buf.slice(i + 2); const m = /^event: (\w+)\ndata: (.*)$/s.exec(raw); if (m) events.push({ kind: m[1], data: m[2] }); } });
  await until(() => events.some((e) => e.kind === "state") && events.some((e) => e.kind === "frame"));
  const frame = Buffer.from(events.find((e) => e.kind === "frame").data, "base64");
  assert.ok(frame[0] === 0xff && frame[1] === 0xd8, "a JPEG frame arrives");
  assert.equal(JSON.parse(events.find((e) => e.kind === "state").data).url, base + "/");

  // click the link by sending fractions of the picture, exactly as the dashboard does
  const r = await call("POST", "/browser/input", { token, type: "click", ...(await fractions(token, "#next")) });
  assert.equal(r.status, 200);
  await until(() => events.some((e) => e.kind === "state" && JSON.parse(e.data).url === base + "/next"));
  await until(() => events.filter((e) => e.kind === "frame").length > 1, 10_000);
  stream.destroy();
  await call("POST", "/browser/command", { token, type: "close" });
});

test("commands: navigate, back, forward, reload, size, capture, close", { skip }, async () => {
  const token = await open("/");
  const cmd = (type, extra = {}) => call("POST", "/browser/command", { token, type, ...extra });
  let r = await cmd("navigate", { url: base + "/next" });
  assert.equal(r.json.url, base + "/next");
  assert.equal(r.json.canGoBack, true);
  r = await cmd("back"); assert.equal(r.json.url, base + "/");
  r = await cmd("forward"); assert.equal(r.json.url, base + "/next");
  r = await cmd("reload"); assert.equal(r.json.status, "ready");
  r = await cmd("device", { device: "android" });
  assert.deepEqual(r.json.viewport, { width: 360, height: 800 });
  assert.equal((await cmd("device", { device: "fridge" })).status, 400);
  const cap = await cmd("capture", { note: "Looks off" });
  assert.equal(cap.json.category, "capture");
  const shot = await call("GET", `/browser/shot?token=${token}&id=${cap.json.shotRef}`);
  assert.equal(shot.status, 200); assert.equal(shot.headers["content-type"], "image/jpeg");
  assert.equal((await call("GET", `/browser/shot?token=${token}&id=99999`)).status, 404);
  assert.equal((await cmd("explode")).status, 400);
  assert.equal((await cmd("navigate", { url: "ftp://x" })).status, 400);
  assert.equal((await cmd("navigate", { url: "http://example.org/" })).json.code, "blocked");
  assert.equal((await cmd("close")).status, 200);
  assert.equal((await call("GET", `/browser/log?token=${token}`)).status, 404, "the session is gone");
});

test("the event log and the evidence come through, and only what is new when asked", { skip }, async () => {
  const token = await open("/");
  const log = await until(async () => { const l = (await call("GET", `/browser/log?token=${token}`)).json; return l.events.some((e) => e.category === "console-error") ? l : null; });
  const err = log.events.find((e) => e.category === "console-error");
  assert.match(err.message, /home boot error/);
  assert.ok(log.console.some((c) => c.type === "error"));
  assert.ok(log.network.some((n) => n.url === base + "/" && n.status === 200));
  const withShot = await until(async () => (await call("GET", `/browser/log?token=${token}`)).json.events.find((e) => e.hasShot));
  assert.equal((await call("GET", `/browser/shot?token=${token}&id=${withShot.shotRef}`)).status, 200);
  const next = (await call("GET", `/browser/log?token=${token}&since=${log.events.at(-1).id}`)).json;
  assert.ok(next.events.every((e) => e.id > log.events.at(-1).id));
  await call("POST", "/browser/command", { token, type: "close" });
});

test("security: tokens, origins, hosts, addresses and request shapes", { skip }, async () => {
  const token = await open("/");
  assert.equal((await call("GET", "/browser/log?token=wrong")).status, 404);
  assert.equal((await call("POST", "/browser/input", { token: "wrong", type: "move" })).status, 404);
  assert.equal((await call("GET", `/browser/stream?token=wrong`)).status, 404);
  assert.equal((await call("GET", `/browser/log?token=${token}`, null, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await call("POST", "/browser/input", { token, type: "move" }, { Host: "evil.example" })).status, 403);
  assert.equal((await call("POST", "/browser/command", { token, type: "reload" }, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await call("POST", "/browser/open", { url: "ftp://x.test/" })).status, 400);
  await call("POST", "/browser/command", { token, type: "close" });
  // with the real guard, as the connector runs it, a private or loopback address never even launches a browser
  const strict = createConnector({ cfg: { port: 0, origins: [ORIGIN], pollMs: 3_600_000, name: "c", model: "s", jobTimeoutMs: 1000 }, db: { rpc: async () => null }, sessions: createSessions(), liveTest, live, log: () => {}, claude: { ok: true, version: "t" }, claimNext: async () => null });
  await strict.start();
  const sp = strict.server.address().port;
  for (const url of [base + "/", `http://127.0.0.1:${site.address().port}/`, "http://169.254.169.254/", "http://10.1.2.3/"]) {
    const r = await new Promise((resolve) => { const data = JSON.stringify({ url }); const q = http.request({ host: "127.0.0.1", port: sp, method: "POST", path: "/browser/open", headers: { Origin: ORIGIN, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => { let b = ""; res.on("data", (d) => { b += d; }); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(b) })); }); q.write(data); q.end(); });
    assert.equal(r.status, 400, url); assert.equal(r.json.code, "blocked", url);
  }
  await strict.stop();
});

test("a site that blocks embedding is reported as such, and previews anyway", { skip }, async () => {
  const r = await call("GET", `/browser/embeddable?url=${encodeURIComponent(base + "/frameblock")}`);
  assert.equal(r.json.embeddable, false);
  assert.match(r.json.reason, /X-Frame-Options/);
  assert.equal((await call("GET", `/browser/embeddable?url=${encodeURIComponent(base + "/")}`)).json.embeddable, true);
  const token = await open("/frameblock");
  assert.equal((await call("GET", `/browser/log?token=${token}`)).json.state.status, "ready");
  await call("POST", "/browser/command", { token, type: "close" });
  assert.equal((await call("GET", "/browser/presets")).json.length, 5);
});

test("a scripted test runs in the SAME browser, locks it while it runs, and a failure shows up as an event", { skip }, async () => {
  const token = await open("/");
  const steps = [{ action: "fill", target: "#who", value: "Asha" }, { action: "click", target: "#send" }, { action: "expect_text", target: "Thanks" }, { action: "expect_text", target: "Text that is not there" }];
  const start = await call("POST", "/livetest/start", { url: base + "/", steps, session_token: token });
  assert.equal(start.status, 202, JSON.stringify(start.json));
  // while it runs, a person cannot type or navigate in that browser
  await until(async () => (await call("GET", `/browser/log?token=${token}`)).json.state.locked);
  const blocked = await call("POST", "/browser/input", { token, type: "key", key: "Enter" });
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error, /test is running/);
  assert.equal((await call("POST", "/livetest/start", { url: base + "/", steps, session_token: token })).status, 400, "two tests cannot share one browser");
  await until(() => !liveTest.active(), 60_000);
  const run = liveTest.state();
  assert.deepEqual(run.steps.map((s) => s.status), ["passed", "passed", "passed", "passed", "failed"]);
  assert.match(run.deviceLabel, /Desktop \(this browser\)/);
  assert.ok(posts.some((p) => p.who === "Asha"), "the form was really submitted in the page the person was watching");
  const after = (await call("GET", `/browser/log?token=${token}`)).json;
  assert.equal(after.state.locked, false, "the browser is the person's again");
  assert.ok(after.events.some((e) => e.category === "test" && /Step 4 failed/.test(e.message)), "the failed step is an event with evidence");
  await call("POST", "/browser/command", { token, type: "close" });
  assert.equal((await call("POST", "/livetest/start", { url: base + "/", steps, session_token: token })).status, 400, "the preview is gone, so the steps cannot run in it");
});

test("a secret typed by a test is not in the picture stream", { skip }, async () => {
  const token = await open("/");
  const frames = [];
  const unsub = sessions.subscribe(token, (k, p) => { if (k === "frame") frames.push(p); });
  sessions.pause(token, true);
  assert.equal(sessions.frame(token), null, "the last picture is dropped");
  const n = frames.length;
  await sessions.page(token).evaluate("document.body.style.background='red'");
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(frames.length, n, "no new picture while paused");
  sessions.pause(token, false);
  await sessions.page(token).evaluate("document.body.style.background='blue'");
  await until(() => frames.length > n, 5000);
  unsub();
  await call("POST", "/browser/command", { token, type: "close" });
});

test.after(async () => { await connector.stop(); site.close(); });
