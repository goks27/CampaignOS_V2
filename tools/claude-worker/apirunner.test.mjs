// Run with: node --test tools/claude-worker
// API checks against a local staging-like server: assertions, expected negative answers, timeouts, redirects, and the network rules.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runApiCheck, assertAll, parseRequest, pick, ApiCheckError } from "./apirunner.mjs";
import { createConnector } from "./server.mjs";
import { NetGuard } from "./netguard.mjs";

const seen = [];
const api = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let body = ""; req.on("data", (d) => { body += d; });
  req.on("end", () => {
    seen.push({ method: req.method, path: url.pathname, auth: req.headers["x-api-key"], body });
    const send = (code, obj, h = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...h }); res.end(JSON.stringify(obj)); };
    if (url.pathname === "/winners") return send(200, { winners: [{ id: "p1", reward: "gold" }, { id: "p3", reward: "voucher" }], total: 2, ok: true });
    if (url.pathname === "/redeem") return JSON.parse(body || "{}").code === "USED" ? send(409, { error: "already redeemed" }) : send(200, { redeemed: true });
    if (url.pathname === "/boom") return send(500, { error: "server error" });
    if (url.pathname === "/slow") return setTimeout(() => send(200, {}), 1500);
    if (url.pathname === "/go") return send(302, {}, { Location: "/winners" });
    if (url.pathname === "/loop") return send(302, {}, { Location: "/loop" });
    if (url.pathname === "/to-private") return send(302, {}, { Location: "http://169.254.169.254/latest/meta-data/" });
    if (url.pathname === "/html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<h1>hi</h1>"); }
    send(404, { error: "no" });
  });
}).listen(0, "127.0.0.1");
await new Promise((r) => api.once("listening", r));
const base = `http://localhost:${api.address().port}`;
test.after(() => api.close());
const guard = () => new NetGuard(["localhost"], { unsafeAllowPrivateForTests: true });
const run = (req) => runApiCheck({ url: base + req.path, ...req }, { guard: guard() });

test("pick reads dotted paths and array indexes", () => {
  const o = { a: { b: [{ c: 1 }, { c: 2 }] } };
  assert.equal(pick(o, "a.b[1].c"), 2);
  assert.equal(pick(o, "a.x.y"), undefined);
  assert.equal(pick(null, "a"), undefined);
});

test("a correct answer passes every assertion: status, time, values, types and shape", async () => {
  const r = await run({ path: "/winners", expect: { status: 200, maxMs: 5000, json: [{ path: "total", equals: 2 }, { path: "winners", type: "array" }, { path: "winners[0].reward", equals: "gold" }, { path: "ok" }], schema: { required: ["winners", "total"], properties: { total: "number", ok: "boolean" } } } });
  assert.equal(r.result, "passed", JSON.stringify(r.assertions.filter((a) => !a.ok)));
  assert.equal(r.status, 200);
  assert.ok(r.json.winners.length === 2);
});

test("a wrong value fails, and says what was expected and what came back", async () => {
  const r = await run({ path: "/winners", expect: { json: [{ path: "total", equals: 3 }, { path: "missing.field" }] } });
  assert.equal(r.result, "failed");
  const bad = r.assertions.filter((a) => !a.ok);
  assert.deepEqual(bad.map((a) => [a.name, a.expected, a.actual]), [["total equals", "3", "2"], ["missing.field exists", "present", "missing"]]);
});

test("a rejection that was expected is a pass: a duplicate code answered with 409 is the behaviour being tested", async () => {
  const r = await run({ path: "/redeem", method: "POST", body: { code: "USED" }, expect: { status: 409, json: [{ path: "error", equals: "already redeemed" }] } });
  assert.equal(r.result, "passed");
  assert.equal(r.status, 409);
});

test("an unexpected server error fails, and without an expectation any status of 400 or more fails", async () => {
  assert.equal((await run({ path: "/boom" })).result, "failed");
  assert.equal((await run({ path: "/boom", expect: { status: 500 } })).result, "passed");
  assert.equal((await run({ path: "/winners", expect: { status: [200, 201] } })).result, "passed");
});

test("a slow answer fails the time limit, and no answer in time is a timeout, not a hang", async () => {
  const slow = await run({ path: "/slow", expect: { maxMs: 100 } });
  assert.equal(slow.result, "failed");
  const t = await run({ path: "/slow", timeout_ms: 1000 });
  assert.equal(t.result, "failed");
  assert.equal(t.timeout, true);
  assert.match(t.error, /No answer within 1 seconds/);
});

test("a connection that cannot be made is a failed result, not a crash", async () => {
  const dead = http.createServer().listen(0, "127.0.0.1"); await new Promise((r) => dead.once("listening", r));
  const port = dead.address().port; await new Promise((r) => dead.close(r));
  const r = await runApiCheck({ url: `http://localhost:${port}/x` }, { guard: guard() });
  assert.equal(r.result, "failed");
  assert.match(r.error, /request failed/);
});

test("redirects are followed by hand, a loop is stopped, and a redirect to a private address is refused", async () => {
  assert.equal((await run({ path: "/go", expect: { status: 200 } })).result, "passed");
  const loop = await run({ path: "/loop" });
  assert.equal(loop.result, "failed");
  assert.match(loop.error, /Too many redirects/);
  const priv = await runApiCheck({ url: base + "/to-private" }, { guard: new NetGuard(["localhost"], { unsafeAllowPrivateForTests: false, resolver: async (h) => (h === "localhost" ? ["93.184.216.34"] : [h]) }) });
  assert.equal(priv.result, "blocked");
  assert.match(priv.error, /not called/);
});

test("with the real guard, a private, loopback or metadata address is blocked before any request is sent", async () => {
  const before = seen.length;
  for (const url of ["http://127.0.0.1:9/x", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/api", "http://[::1]/x"]) {
    const r = await runApiCheck({ url });
    assert.equal(r.result, "blocked", url);
  }
  assert.equal(seen.length, before, "nothing reached the local server");
});

test("a secret header is sent but never appears in the result", async () => {
  const r = await run({ path: "/winners", headers: { "X-Api-Key": "s3cr3t-key" }, secret_headers: ["X-Api-Key"] });
  assert.equal(seen.at(-1).auth, "s3cr3t-key", "the key was sent");
  assert.ok(!JSON.stringify(r).includes("s3cr3t-key"), "and is nowhere in the result");
});

test("the request is validated: method, scheme, headers and size", () => {
  assert.throws(() => parseRequest({ url: "https://x.example", method: "TRACE" }), /not allowed/);
  assert.throws(() => parseRequest({ url: "ftp://x.example" }), /Only http/);
  assert.throws(() => parseRequest({ url: "not a url" }), /full address/);
  assert.throws(() => parseRequest({ url: "https://x.example", headers: { Host: "evil" } }), /cannot be set/);
  assert.throws(() => parseRequest({ url: "https://x.example", method: "POST", body: "x".repeat(100_001) }), /too large/);
  assert.equal(parseRequest({ url: "https://x.example", method: "POST", body: { a: 1 } }).headers["Content-Type"], "application/json");
  assert.throws(() => parseRequest(null), ApiCheckError);
});

test("an answer that is not JSON is returned as text and JSON assertions fail on it", async () => {
  const r = await run({ path: "/html", expect: { json: [{ path: "x" }] } });
  assert.equal(r.result, "failed");
  assert.match(r.text, /<h1>hi<\/h1>/);
});

test("assertAll alone: the status defaults to any success", () => {
  assert.equal(assertAll({}, { status: 200, ms: 1 })[0].ok, true);
  assert.equal(assertAll({}, { status: 404, ms: 1 })[0].ok, false);
});

// ---------------------------------------------------------------- the connector route
const ORIGIN = "https://dash.example";
const connector = createConnector({ cfg: { port: 0, origins: [ORIGIN], pollMs: 3_600_000, name: "claude-code", model: "sonnet", jobTimeoutMs: 1000 }, db: { rpc: async () => null }, apiGuard: guard, log: () => undefined });
await connector.start();
const port = connector.server.address().port;
test.after(() => connector.stop());
const call = (path, body, headers = {}) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const req = http.request({ host: "127.0.0.1", port, method: "POST", path, headers: { Origin: ORIGIN, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers } }, (res) => {
    const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(c).toString() || "null") }));
  });
  req.on("error", reject); req.write(data); req.end();
});

test("the connector route runs a check for the dashboard and refuses what it should", async () => {
  const ok = await call("/apitest/run", { request: { url: base + "/winners", expect: { status: 200, json: [{ path: "total", equals: 2 }] } } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.result, "passed");
  assert.equal((await call("/apitest/run", { request: { url: base + "/winners", method: "TRACE" } })).status, 400);
  assert.equal((await call("/apitest/run", { request: { url: base + "/winners" } }, { Origin: "https://evil.example" })).status, 403);
  const refused = await call("/apitest/run", { request: { url: base + "/winners" } }, { Host: "attacker.example" });
  assert.ok([400, 403].includes(refused.status), "a wrong Host header is refused");
});
