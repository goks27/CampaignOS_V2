import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright-core";
import { createLiveTest, parseSpec, placeholdersOf, BadRequest } from "./livetest.mjs";
import { createLive, live as sharedLive } from "./live.mjs";
import { NetGuard } from "./netguard.mjs";
import { Browser } from "./browser.mjs";
import { createConnector } from "./server.mjs";

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
