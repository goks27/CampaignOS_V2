import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright-core";
import { createLiveTest, parseSpec, placeholdersOf, BadRequest } from "./livetest.mjs";
import { createLive, live as sharedLive } from "./live.mjs";
import { NetGuard } from "./netguard.mjs";
import { Browser } from "./browser.mjs";
import { createConnector } from "./server.mjs";
import { DEVICES } from "./devices.mjs";

let probe = null;
try { probe = await chromium.launch({ headless: true }); await probe.close(); } catch { probe = null; }
const skip = probe ? false : "Chromium is not installed (npm run claude:browser)";

// A site with a register form that sends an OTP, like a real campaign.
const submitted = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, html) => { res.writeHead(code, { "Content-Type": "text/html" }); res.end(html); };
  if (req.method === "POST") { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => { submitted.push(b); send(200, "ok"); }); return; }
  if (url.pathname === "/") return send(200, `<!doctype html><title>Register</title><h1>Register</h1>
    <label>Mobile number <input id="mobile" name="mobile"></label><button id="send" onclick="document.getElementById('otpbox').style.display='block'">Send OTP</button>
    <div id="otpbox" style="display:none"><label>OTP <input id="otp" name="otp"></label><button onclick="document.getElementById('msg').textContent = document.getElementById('otp').value === '123456' ? 'Welcome aboard' : 'Wrong OTP'">Verify</button></div><p id="msg"></p>`);
  if (url.pathname === "/captcha") return send(200, `<!doctype html><title>c</title><div class="g-recaptcha"></div><script src="https://www.google.com/recaptcha/api.js"></script>`);
  send(404, "nope");
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://localhost:${server.address().port}/`;

const make = (extra = {}) => { const live = createLive(); return { live, lt: createLiveTest({ live, makeGuard: (a) => new NetGuard(a, { unsafeAllowPrivateForTests: true }), ...extra }) }; };
const until = async (fn, ms = 20_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error("timed out waiting"); };
const FLOW = [
  { action: "fill", target: "Mobile number", value: "{{mobile}}" },
  { action: "click", target: "Send OTP" },
  { action: "ask", target: "Enter the OTP sent to 98xxxxxx01", value: "OTP", secret: true },
  { action: "click", target: "Verify" },
  { action: "expect_text", target: "Welcome aboard" },
];
const body = (over = {}) => ({ url: base, steps: FLOW, inputs: { mobile: { value: "9876543210", secret: false } }, ...over });

test("parseSpec: refuses what it cannot run, and says what to fix", () => {
  assert.throws(() => parseSpec({ url: "nope", steps: [] }), /staging URL/);
  assert.throws(() => parseSpec({ url: "ftp://x.test", steps: [] }), /http/);
  assert.throws(() => parseSpec({ url: base, steps: [{ action: "explode", target: "x" }] }), /unknown action/);
  assert.throws(() => parseSpec({ url: base, steps: [{ action: "click" }] }), /needs a target/);
  assert.throws(() => parseSpec({ url: base, steps: [{ action: "ask", target: "OTP?" }] }), /which field to fill/);
  assert.throws(() => parseSpec(body({ inputs: {} })), /\{\{mobile\}\}/);
  assert.throws(() => parseSpec({ url: base, steps: Array.from({ length: 61 }, () => ({ action: "wait", target: "1" })) }), /limit is 60/);
  const ok = parseSpec(body({ allowed_domains: ["a.example"] }));
  assert.ok(ok.allowed.includes("a.example") && ok.allowed.includes("localhost"), "the site's own host is allowed automatically");
  assert.deepEqual(placeholdersOf(FLOW), ["mobile"]);
  assert.ok(BadRequest);
});

test("a full run: fills, pauses to ask for the OTP, takes the answer, and passes", { skip }, async () => {
  const { lt, live } = make();
  lt.start(body());
  const asking = await until(() => (lt.state().status === "asking" ? lt.state() : null));
  assert.equal(asking.prompt.label, "Enter the OTP sent to 98xxxxxx01");
  assert.equal(asking.prompt.secret, true);
  assert.equal(asking.steps[1].status, "passed", "the steps before the question already ran");
  assert.equal(asking.steps[3].status, "asking");
  assert.ok(live.state().active, "the live view is running while it waits");
  lt.answer({ promptId: asking.prompt.id, value: "123456" });
  await until(() => !lt.active());
  const done = lt.state();
  assert.equal(done.status, "passed", JSON.stringify(done.steps.map((s) => [s.i, s.status, s.note])));
  assert.ok(done.steps.every((s) => s.status === "passed"));
  assert.ok(done.steps[1].hasShot && lt.shot(1)[0] === 0xff, "a picture is kept for each normal step");
  assert.equal(lt.shot(3), null, "no picture of the step where a secret was typed");
  const everything = JSON.stringify(done);
  assert.ok(!everything.includes("123456"), "the typed OTP is nowhere in the state or log");
  assert.ok(!everything.includes("9876543210") || done.steps[1].value === "{{mobile}}", "values are not printed: only the placeholder");
  assert.deepEqual(live.state(), { active: false });
});

test("a wrong answer fails the step and the run, and the rest are skipped", { skip }, async () => {
  const { lt } = make();
  lt.start(body());
  const asking = await until(() => (lt.state().status === "asking" ? lt.state() : null));
  lt.answer({ promptId: asking.prompt.id, value: "000000" });
  await until(() => !lt.active());
  const s = lt.state();
  assert.equal(s.status, "failed");
  assert.equal(s.steps.find((x) => x.status === "failed").action, "expect_text");
  assert.match(s.steps.find((x) => x.status === "failed").note, /Welcome aboard|waiting|Timeout/i);
  assert.ok(s.steps.some((x) => x.status === "passed"));
});

test("stop ends a run that is waiting for an answer", { skip }, async () => {
  const { lt } = make();
  lt.start(body());
  await until(() => lt.state().status === "asking");
  lt.stop();
  await until(() => !lt.active());
  assert.equal(lt.state().status, "stopped");
  assert.equal(lt.state().prompt, null);
});

test("only one run at a time, and answers are checked", { skip }, async () => {
  const { lt } = make();
  lt.start(body());
  assert.throws(() => lt.start(body()), /already running/);
  const asking = await until(() => (lt.state().status === "asking" ? lt.state() : null));
  assert.throws(() => lt.answer({ promptId: "wrong", value: "1" }), /Nothing is waiting/);
  lt.stop();
  await until(() => !lt.active());
  assert.ok(asking);
});

test("a CAPTCHA ends the run as blocked, never bypassed", { skip }, async () => {
  const { lt } = make();
  lt.start({ url: base + "captcha", steps: [{ action: "click", target: "Verify" }] });
  await until(() => !lt.active());
  const s = lt.state();
  assert.equal(s.status, "blocked");
  assert.match(s.steps[0].note, /CAPTCHA/);
  assert.equal(s.steps[1].status, "skipped");
});

test("pages outside the allowed hosts are refused", { skip }, async () => {
  const { lt } = make();
  lt.start({ url: base, steps: [{ action: "goto", target: "http://127.0.0.1:1/elsewhere" }] });
  await until(() => !lt.active());
  const s = lt.state();
  assert.equal(s.status, "failed");
  assert.match(s.steps[1].note, /Refusing to open|allow-list/);
});

test("a secret typed into a normal fill step is not shown or kept either", { skip }, async () => {
  const { lt } = make();
  lt.start({ url: base, steps: [{ action: "fill", target: "Mobile number", value: "{{pin}}" }], inputs: { pin: { value: "s3cretPIN", secret: true } } });
  await until(() => !lt.active());
  const s = lt.state();
  assert.equal(s.status, "passed");
  assert.equal(lt.shot(1), null, "no picture after a secret was typed");
  assert.ok(!JSON.stringify(s).includes("s3cretPIN"));
});

// ---- over HTTP, as the dashboard uses it
function call(port, method, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers: { ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      const chunks = []; res.on("data", (d) => chunks.push(d));
      res.on("end", () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString()); } catch { /* an image */ } resolve({ status: res.statusCode, json, buf, headers: res.headers }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}

test("connector: start, watch, answer and stop over HTTP, with the usual origin guards", { skip }, async () => {
  const { lt } = make();
  const c = createConnector({ cfg: { port: 0, origins: ["https://dash.example"], pollMs: 3_600_000, name: "claude-code", model: "sonnet", jobTimeoutMs: 1000 }, db: { rpc: async () => null },
    liveTest: lt, live: createLive(), log: () => {}, claude: { ok: true, version: "t" }, claimNext: async () => null });
  await c.start();
  const port = c.server.address().port;
  try {
    assert.equal((await call(port, "POST", "/livetest/start", body(), { Origin: "https://evil.example" })).status, 403);
    assert.equal((await call(port, "POST", "/livetest/start", body(), { Host: "evil.example" })).status, 403);
    assert.equal((await call(port, "POST", "/livetest/start", { url: "nope" })).status, 400);
    const r = await call(port, "POST", "/livetest/start", body(), { Origin: "https://dash.example" });
    assert.equal(r.status, 202);
    assert.ok(r.json.runId);
    assert.equal((await call(port, "POST", "/livetest/start", body())).status, 400, "a second start is refused while one runs");
    const asking = await until(async () => null).catch(() => null) ?? await (async () => { for (let i = 0; i < 400; i++) { const s = (await call(port, "GET", "/livetest")).json; if (s.status === "asking") return s; await new Promise((x) => setTimeout(x, 50)); } throw new Error("never asked"); })();
    assert.equal((await call(port, "POST", "/livetest/answer", { promptId: asking.prompt.id, value: "123456" })).status, 200);
    for (let i = 0; i < 400 && (await call(port, "GET", "/livetest")).json.status !== "passed"; i++) await new Promise((x) => setTimeout(x, 50));
    const done = (await call(port, "GET", "/livetest")).json;
    assert.equal(done.status, "passed");
    const shot = await call(port, "GET", "/livetest/shot/1");
    assert.equal(shot.status, 200); assert.equal(shot.headers["content-type"], "image/jpeg");
    assert.equal((await call(port, "GET", "/livetest/shot/3")).status, 204);
    assert.equal((await call(port, "POST", "/livetest/start", body(), { "Content-Type": "text/plain" })).status, 415);
  } finally { await c.stop(); }
});

test.after(async () => { server.close(); });

test("the picture keeps running while it waits for you, and pauses only while your answer is typed", { skip }, async () => {
  // frames always go to the shared live store (the same one the connector serves), so this test uses it too
  const live = sharedLive;
  const lt = createLiveTest({ makeGuard: (a) => new NetGuard(a, { unsafeAllowPrivateForTests: true }) });
  lt.start(body());
  const asking = await until(() => (lt.state().status === "asking" ? lt.state() : null));
  await until(() => live.state().hasFrame, 10_000);
  assert.equal(live.state().paused, false, "you can see the page while the test waits for the OTP");
  lt.answer({ promptId: asking.prompt.id, value: "123456" });
  await until(() => !lt.active());
});

test("a failed step says what was missing, in plain words", async () => {
  const { friendlyError } = await import("./livetest.mjs");
  const timeout = new Error("locator.waitFor: Timeout 15000ms exceeded.\nCall log: ...");
  assert.equal(friendlyError({ action: "expect_text", target: "Welcome aboard" }, timeout), '"Welcome aboard" did not appear within 15 seconds.');
  assert.equal(friendlyError({ action: "click", target: "Verify" }, timeout), 'Could not find "Verify" on the page within 15 seconds.');
  assert.equal(friendlyError({ action: "ask", target: "OTP?", value: "OTP" }, timeout), 'Could not find "OTP" on the page within 15 seconds.');
  assert.equal(friendlyError({ action: "expect_url", target: "/success" }, timeout), 'The address did not contain "/success" within 15 seconds.');
  assert.equal(friendlyError({ action: "fill", target: "x" }, new Error("Something else\nmore")), "Something else");
  assert.equal(friendlyError({ action: "expect_text", target: "{{name}}" }, timeout, { name: { value: "Ravi" } }), '"Ravi" did not appear within 15 seconds.');
});

test("recent runs are kept (newest first), can be opened again with their pictures, and carry the campaign", { skip }, async () => {
  const { lt } = make();
  const campaign = { campaign_id: "c1", campaign_name: "Gold Drop" };
  lt.start({ ...body(), ...campaign });
  const a = await until(() => (lt.state().status === "asking" ? lt.state() : null));
  lt.answer({ promptId: a.prompt.id, value: "123456" });
  await until(() => !lt.active());
  const first = lt.state().runId;
  lt.start({ ...campaign, url: base, steps: [{ action: "expect_text", target: "Never on the page" }] });
  await until(() => !lt.active(), 30_000);
  const list = lt.runs();
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((r) => r.status), ["failed", "passed"], "newest first");
  assert.equal(list[1].runId, first);
  assert.equal(list[1].campaignName, "Gold Drop");
  assert.equal(list[1].passed, 6); assert.equal(list[1].total, 6);
  // an earlier run opens in full, with its own pictures, while the current one is something else
  assert.equal(lt.state(first).status, "passed");
  assert.equal(lt.state(first).steps.length, 6);
  assert.ok(lt.shot(1, first)?.length > 100, "a picture of an earlier run's step");
  assert.equal(lt.state().steps.length, 2, "the current state is still the latest run");
  assert.equal(lt.state("nope").status, "idle");
  assert.ok(!JSON.stringify(lt.state(first)).includes("123456"), "an earlier run never holds the typed answer");
});

test("only the newest runs are kept", { skip }, async () => {
  const { HISTORY } = await import("./livetest.mjs");
  const { lt } = make({ openBrowser: async () => ({ newContext: async () => ({ newPage: async () => ({ on() {}, setDefaultTimeout() {}, goto: async () => {}, waitForLoadState: async () => {}, content: async () => "", screenshot: async () => Buffer.from([0xff, 0xd8]), isClosed: () => true }) }), close: async () => {} }) });
  for (let i = 0; i < HISTORY + 3; i++) { lt.start({ url: base, steps: [] }); await until(() => !lt.active(), 10_000); }
  assert.equal(lt.runs().length, HISTORY);
});

// ---------------------------------------------------------------- the automatic run: a URL, every device, no steps to write
const authedSite = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const authed = /s=1/.test(req.headers.cookie ?? "");
  const send = (code, html, h = {}) => { res.writeHead(code, { "Content-Type": "text/html", ...h }); res.end(html); };
  const doc = (b) => `<!doctype html><html lang="en"><head><title>T</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">${b}</body></html>`;
  if (req.method === "POST") {
    let b = ""; req.on("data", (d) => { b += d; });
    req.on("end", () => { const p = new URLSearchParams(b); const needOtp = url.pathname === "/otp-login";
      const good = p.get("user") === "tester" && p.get("pw") === "secret" && (!needOtp || p.get("otp") === "424242");
      return good ? send(302, "", { Location: "/", "Set-Cookie": "s=1; Path=/" }) : send(200, doc("<p role=alert>Invalid username or password</p>")); });
    return;
  }
  const form = (action, extra = "") => doc(`<form method="post" action="${action}"><label>Mobile number <input name="user" type="text"></label><label>Password <input name="pw" type="password"></label>${extra}<button type="submit">Log in</button></form>`);
  if (url.pathname === "/") return send(200, doc(`<h1>Home</h1>${authed ? '<a href="/members">Members</a>' : '<a href="/login">Log in</a> <a href="/otp-login">OTP log in</a>'}<div style="width:500px;height:10px;background:#ddd">wide</div>`));
  if (url.pathname === "/login") return send(200, form("/login"));
  if (url.pathname === "/otp-login") return send(200, form("/otp-login", '<label>OTP <input name="otp" type="text" required></label>'));
  if (url.pathname === "/members") return authed ? send(200, doc('<h1>Members</h1><img src="/secret-banner.png" alt="banner">')) : send(302, "", { Location: "/login" });
  send(404, "nope");
}).listen(0, "127.0.0.1");
await new Promise((r) => authedSite.once("listening", r));
const authedBase = `http://localhost:${authedSite.address().port}/`;
test.after(() => { authedSite.close(); });

test("auto: a URL alone runs every device and reports per device, no steps and no device to pick", { skip, timeout: 300_000 }, async () => {
  const { lt } = make();
  lt.start({ mode: "auto", url: authedBase });
  await until(() => !lt.active(), 180_000);
  const s = lt.state();
  assert.equal(s.mode, "auto");
  assert.equal(s.deviceLabel, "All devices");
  assert.equal(s.auto.devices.length, DEVICES.length, "every phone and tablet ran");
  assert.ok(!s.auto.devices.some((d) => /desktop|laptop/i.test(d.id)), "phones and tablets only");
  assert.ok(s.auto.devices.every((d) => d.pages_tested >= 1), JSON.stringify(s.auto.devices.map((d) => [d.id, d.pages_tested])));
  const phone = s.auto.devices.find((d) => d.id === "iphone-15");
  assert.ok(phone.top_issues.some((t) => /scrolls sideways/.test(t)), "the wide block is a problem on a phone: " + phone.top_issues.join(" | "));
    assert.ok(s.auto.findings.some((f) => /scrolls sideways/.test(f.title) && /iPhone 15/.test(f.title)), "the finding says which devices");
  assert.equal(s.status, "failed", "a real issue makes the run fail");
  assert.match(s.auto.summary.text, /issue/);
  assert.ok(s.steps.length > 7 && s.steps.every((x) => x.action === "progress"), "progress is listed as it happens");
  assert.equal(s.prompt, null);
});

test("auto: signs in on every device with the details given up front", { skip }, async () => {
  const { lt } = make();
  lt.start({ mode: "auto", url: authedBase, devices: ["iphone-15", "pixel-7"], credentials: { username: "tester", password: "secret" } });
  await until(() => !lt.active(), 120_000);
  const s = lt.state();
  assert.deepEqual(s.auto.devices.map((d) => [d.id, d.login]), [["iphone-15", "ok"], ["pixel-7", "ok"]]);
  assert.ok(s.auto.findings.some((f) => /Broken image: secret-banner\.png/.test(f.title)), "the page behind the login was checked: " + s.auto.findings.map((f) => f.title).join(" | "));
  const text = JSON.stringify(s);
  for (const needle of [":\"secret\"", "\"tester\"", "tester"]) { const i = text.indexOf(needle); assert.ok(i < 0, `the login details are nowhere in the state, but found ${needle} near: ${text.slice(Math.max(0, i - 80), i + 60)}`); }
});

test("auto: when the login asks for something that was not given, it stops and asks once, then carries on", { skip }, async () => {
  const { lt } = make();
  lt.start({ mode: "auto", url: authedBase + "otp-login", devices: ["iphone-15", "pixel-7"], credentials: { username: "tester", password: "secret" } });
  const asking = await until(() => (lt.state().status === "asking" ? lt.state() : null), 60_000);
  assert.match(asking.prompt.label, /OTP/);
  assert.equal(asking.prompt.secret, true);
  lt.answer({ promptId: asking.prompt.id, value: "424242" });
  await until(() => !lt.active(), 120_000);
  const s = lt.state();
  assert.deepEqual(s.auto.devices.map((d) => d.login), ["ok", "ok"], "the answer was used on every device, without asking again");
  assert.ok(!JSON.stringify(s).includes("424242"), "the typed OTP is nowhere in the state");
});

test("auto: validates the URL, asks for both login fields or neither, and can be stopped", { skip }, async () => {
  const { lt } = make();
  assert.throws(() => lt.start({ mode: "auto", url: "nope" }), /staging URL/);
  assert.throws(() => lt.start({ mode: "auto", url: authedBase, credentials: { username: "a" } }), /both the username and the password/);
  lt.start({ mode: "auto", url: authedBase });
  await until(() => lt.state().steps.length > 2, 30_000);
  lt.stop();
  await until(() => !lt.active(), 60_000);
  assert.equal(lt.state().status, "stopped");
});

// ---------------------------------------------------------------- a campaign with no password: register once, every device then runs by itself
const campaignPosts = [];
const campaignSite = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const authed = /s=1/.test(req.headers.cookie ?? "");
  const doc = (b) => `<!doctype html><html lang="en"><head><title>Cremica</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;font-family:sans-serif">${b}</body></html>`;
  const send = (code, html, h = {}) => { res.writeHead(code, { "Content-Type": "text/html", ...h }); res.end(html); };
  if (req.method === "POST") {
    let b = ""; req.on("data", (d) => { b += d; });
    req.on("end", () => { const p = Object.fromEntries(new URLSearchParams(b)); campaignPosts.push({ path: url.pathname, ...p });
      if (url.pathname === "/otp") return send(200, doc(`<form method="post" action="/verify"><label>Enter OTP <input name="otp" type="text" required></label><button type="submit">Verify</button></form>`));
      if (url.pathname === "/verify") return p.otp === "424242" ? send(302, "", { Location: "/", "Set-Cookie": "s=1; Path=/" }) : send(200, doc("<p role=alert>Wrong OTP</p>"));
      send(200, doc("ok")); });
    return;
  }
  const REG = `<form method="post" action="/otp"><label>Mobile number <input name="mobile" type="tel" required></label><label>Your name <input name="name" type="text"></label><button type="submit">Get OTP</button></form>`;
  if (url.pathname === "/") return send(200, authed ? doc('<h1>Welcome back</h1><a href="/game">Play the game</a>') : doc(`<h1>Win a console</h1><button onclick="document.getElementById('r').style.display='block'">REGISTER &amp; PLAY NOW</button><div id="r" style="display:none">${REG}</div>`));
  if (url.pathname === "/game") return authed ? send(200, doc('<h1>Game</h1><img src="/missing-level.png" alt="level">')) : send(302, "", { Location: "/" });
  send(404, "nope");
}).listen(0, "127.0.0.1");
await new Promise((r) => campaignSite.once("listening", r));
const campaignBase = `http://localhost:${campaignSite.address().port}/`;
test.after(() => { campaignSite.close(); });

async function answerAsked(lt, answers, ms = 150_000) {
  const asked = [];
  const t0 = Date.now();
  while (lt.active() && Date.now() - t0 < ms) {
    const s = lt.state();
    if (s.status === "asking" && s.prompt) {
      asked.push({ label: s.prompt.label, secret: s.prompt.secret, skippable: s.prompt.skippable });
      const key = Object.keys(answers).find((k) => s.prompt.label.toLowerCase().includes(k));
      lt.answer({ promptId: s.prompt.id, value: answers[key] ?? "1" });
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  return asked;
}

test("auto: a campaign with no password: it finds the form, asks for the mobile number, name and OTP once, then every device runs by itself", { skip }, async () => {
  const { lt } = make();
  lt.start({ mode: "auto", url: campaignBase, devices: ["iphone-15", "pixel-7", "ipad"] });
  const asked = await answerAsked(lt, { mobile: "9876543210", name: "Test Tester", otp: "424242" });
  const s = lt.state();
  assert.deepEqual(asked.map((a) => a.label.replace(/^The page asks for: /, "").toLowerCase()), ["mobile number", "your name", "enter otp"], "asked once each, in the order the page shows them");
  assert.equal(asked.find((a) => /otp/i.test(a.label)).secret, true);
  assert.ok(asked.every((a) => a.skippable), "every question can be skipped");
  assert.deepEqual(s.auto.devices.map((d) => d.login), ["registered", "registered", "registered"], "every device started from the registered session");
  assert.ok(s.auto.devices.every((d) => d.pages_tested >= 2), "the page behind the registration was opened on every device: " + JSON.stringify(s.auto.devices.map((d) => [d.id, d.pages_tested])));
  assert.ok(s.auto.findings.some((f) => /Broken image: missing-level\.png/.test(f.title)), "the game page was checked: " + s.auto.findings.map((f) => f.title).join(" | "));
  assert.equal(campaignPosts.filter((p) => p.path === "/otp").length, 1, "the form was filled in only once");
  assert.ok(!JSON.stringify(s).includes("424242"), "the OTP is nowhere in the state");
});

test("auto: skipping the form runs the public pages on every device instead", { skip }, async () => {
  const { lt } = make();
  lt.start({ mode: "auto", url: campaignBase, devices: ["iphone-15", "pixel-7"] });
  const t0 = Date.now();
  while (lt.active() && Date.now() - t0 < 120_000) {
    const s = lt.state();
    if (s.status === "asking" && s.prompt) lt.answer({ promptId: s.prompt.id, skip: true });
    await new Promise((r) => setTimeout(r, 60));
  }
  const s = lt.state();
  assert.deepEqual(s.auto.devices.map((d) => d.login), ["none", "none"]);
  assert.ok(s.auto.devices.every((d) => d.pages_tested >= 1));
  assert.ok(!s.auto.findings.some((f) => /missing-level/.test(f.title)), "the page behind the form was not reached");
});

test("auto: a question can only be skipped when it says it can", { skip }, async () => {
  const { lt } = make();
  lt.start({ mode: "script", url: base, steps: [{ action: "ask", target: "Enter the OTP", value: "OTP", secret: true }] });
  const a = await until(() => (lt.state().status === "asking" ? lt.state() : null), 30_000);
  assert.throws(() => lt.answer({ promptId: a.prompt.id, skip: true }), /cannot be skipped/);
  lt.stop();
  await until(() => !lt.active(), 30_000);
});

test("auto: the page is on screen from the first moment, including while the registration form waits for you", { skip }, async () => {
  // frames always go to the shared live store (the one the connector serves), so this test uses it too
  const live = sharedLive;
  const lt = createLiveTest({ makeGuard: (a) => new NetGuard(a, { unsafeAllowPrivateForTests: true }) });
  lt.start({ mode: "auto", url: campaignBase, devices: ["iphone-15"] });
  const asking = await until(() => (lt.state().status === "asking" ? lt.state() : null), 60_000);
  assert.ok(live.state().hasFrame, "there is a picture while it waits for the mobile number");
  assert.equal(live.state().where?.url, campaignBase, "it says which page it is on");
  assert.ok(live.state().where?.device, "and which device");
  assert.equal(live.state().paused, false, "a mobile number is not a secret, so the picture keeps going");
  lt.stop();
  await until(() => !lt.active(), 60_000);
  assert.ok(asking);
});

test("auto: errors are listed as they are found, with the device and page, before the run ends", { skip }, async () => {
  const bad = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end('<!doctype html><html lang="en"><head><title>T</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Home</h1><img src="/gone.png" alt="x"><div style="width:500px;height:10px;background:#ddd">wide</div></body></html>'); }).listen(0, "127.0.0.1");
  await new Promise((r) => bad.once("listening", r));
  try {
    const { lt } = make();
    lt.start({ mode: "auto", url: `http://localhost:${bad.address().port}/`, devices: ["iphone-15", "ipad", "pixel-7"] });
    // the broken image is on every device, so the first device's errors must already be listed while the others are still being tested
    const midRun = await until(() => { const s = lt.state(); return s.auto?.errors?.length && !s.finishedAt ? s : null; }, 120_000);
    assert.ok(midRun.auto.errors.every((e) => e.device && e.page && e.title && e.severity));
    assert.ok(midRun.auto.errors.some((e) => /Broken image: gone.png/.test(e.title) && e.device.startsWith("iPhone 15")), "the first device's error is there first");
    await until(() => !lt.active(), 120_000);
    const s = lt.state();
    assert.ok(s.auto.errors.some((e) => e.device.startsWith("iPhone 15") && /scrolls sideways/.test(e.title) && e.page === "/"), JSON.stringify(s.auto.errors.slice(0, 8)));
    const seen = new Set();
    for (const e of s.auto.errors) { const k = `${e.device}|${e.page}|${e.title}`; assert.ok(!seen.has(k), "listed once: " + k); seen.add(k); }
  } finally { bad.close(); }
});
