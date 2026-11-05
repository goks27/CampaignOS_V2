import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createLive } from "./live.mjs";
import { createConnector } from "./server.mjs";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

test("live: steps, where, frame and end", () => {
  let t = 1000;
  const l = createLive({ now: () => t++, maxSteps: 3 });
  assert.deepEqual(l.state(), { active: false });
  l.step("ignored before start"); l.setFrame(JPEG);
  assert.equal(l.frame(), null);

  l.start({ jobId: "j1", type: "site_check" });
  l.step("one"); l.step("one"); l.step("two"); l.step("three"); l.step("four");
  assert.deepEqual(l.state().steps.map((s) => s.text), ["two", "three", "four"]); // a repeat is shown once; only the newest are kept
  l.where({ url: "https://x.test/", device: "desktop" }); l.where({ pageNo: 2, pageTotal: 10 });
  assert.deepEqual(l.state().where, { url: "https://x.test/", device: "desktop", pageNo: 2, pageTotal: 10 });

  assert.equal(l.state().hasFrame, false);
  l.setFrame(JPEG);
  assert.equal(l.state().hasFrame, true); assert.equal(l.state().seq, 1);
  assert.equal(l.frame(), JPEG);

  l.end();
  assert.deepEqual(l.state(), { active: false });
  assert.equal(l.frame(), null);
});

test("live: pausing clears the picture and nothing new is kept while paused (logins are never shown)", () => {
  const l = createLive();
  l.start({ jobId: "j", type: "functional_qa" });
  l.setFrame(JPEG);
  l.pause(true);
  assert.equal(l.frame(), null);
  l.setFrame(JPEG);
  assert.equal(l.frame(), null);
  assert.equal(l.state().paused, true);
  l.pause(false); l.setFrame(JPEG);
  assert.equal(l.frame(), JPEG);
});

function get(port, pathname, headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers }, (res) => {
      const chunks = []; res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject); req.end();
  });
}

test("connector: the live view follows a running job and is gone when it ends", async () => {
  const live = createLive();
  let release;
  const gate = new Promise((r) => { release = r; });
  const queue = [{ id: "job-live-1", review_type: "site_check" }];
  const c = createConnector({
    cfg: { port: 0, origins: [], pollMs: 3_600_000, name: "claude-code", model: "sonnet", jobTimeoutMs: 1000 },
    db: { rpc: async () => null }, live, log: () => {}, claude: { ok: true, version: "t" },
    claimNext: async () => queue.shift() ?? null,
    analyseJob: async (_b, { onStep }) => { onStep("Opening the site"); live.setFrame(JPEG); await gate; return { result: { findings: [], checks: [] }, meta: {} }; },
  });
  await c.start();
  const port = c.server.address().port;
  try {
    for (let i = 0; i < 100 && !live.state().active; i++) await new Promise((r) => setTimeout(r, 20));
    const s = JSON.parse((await get(port, "/live")).body.toString());
    assert.equal(s.active, true);
    assert.equal(s.type, "site_check");
    assert.ok(s.steps.some((x) => x.text === "Opening the site"));
    assert.equal(s.hasFrame, true);

    const f = await get(port, "/live/frame");
    assert.equal(f.status, 200);
    assert.equal(f.headers["content-type"], "image/jpeg");
    assert.match(String(f.headers["cache-control"]), /no-store/);
    assert.deepEqual(f.body, JPEG);

    // Same guards as the rest of the connector, and nothing can be sent to the browser through it.
    assert.equal((await get(port, "/live/frame", { Origin: "https://evil.example" })).status, 403);
    assert.equal((await get(port, "/live", { Host: "evil.example" })).status, 403);
    assert.equal((await get(port, "/live", {}, "POST")).status, 404);
    assert.equal((await get(port, "/live/frame", {}, "DELETE")).status, 404);
  } finally {
    release();
    for (let i = 0; i < 100 && live.state().active; i++) await new Promise((r) => setTimeout(r, 20));
  }
  try {
    assert.deepEqual(JSON.parse((await get(port, "/live")).body.toString()), { active: false });
    assert.equal((await get(port, "/live/frame")).status, 204); // nothing is kept after the job
  } finally { await c.stop(); }
});
