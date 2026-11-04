// Run with: node --test tools/claude-worker
// Offline tests for staging reviews: the network guard, the pixel diff, and real headless Chromium against a local test site.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";
import { NetGuard, hostAllowed, ipIsPublic } from "./netguard.mjs";
import { cropPair, downscale, pixelDiff } from "./images.mjs";
import { matchDesign, runStaging } from "./staging.mjs";
import { validate } from "./core.mjs";
import { claudeArgs } from "./runner.mjs";

// ---------------------------------------------------------------- network guard
test("ipIsPublic refuses private, loopback, link-local, CGNAT and metadata ranges", () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "192.168.1.5", "172.16.0.9", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:10.0.0.1"]) {
    assert.equal(ipIsPublic(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) assert.equal(ipIsPublic(ip), true, ip);
});

test("hostAllowed supports exact hosts and *. wildcards only", () => {
  assert.equal(hostAllowed("stg.example.com", ["stg.example.com"]), true);
  assert.equal(hostAllowed("a.stg.example.com", ["*.stg.example.com"]), true);
  assert.equal(hostAllowed("stg.example.com", ["*.stg.example.com"]), true);
  assert.equal(hostAllowed("evilstg.example.com", ["*.stg.example.com"]), false);
  assert.equal(hostAllowed("example.com", ["stg.example.com"]), false);
});

test("NetGuard allows allow-listed public hosts and refuses everything else", async () => {
  const resolver = async (h) => (h === "stg.example.com" ? ["93.184.216.34"] : h === "internal.example.com" ? ["10.0.0.5"] : []);
  const g = new NetGuard(["stg.example.com", "internal.example.com", "nope.example.com"], { resolver });
  assert.equal((await g.check("https://stg.example.com/home")).ok, true);
  assert.match((await g.check("https://other.example.com/")).why, /not on the allow-list/);
  assert.match((await g.check("https://internal.example.com/")).why, /private or reserved/);
  assert.match((await g.check("https://nope.example.com/")).why, /does not resolve/);
  assert.match((await g.check("http://169.254.169.254/latest")).why, /IP literals/);
  assert.match((await g.check("http://127.0.0.1:11434/")).why, /IP literals/); // Ollama must never be reachable
  assert.match((await g.check("file:///etc/passwd")).why, /scheme file/);
  assert.match((await g.check("http://metadata.google.internal/")).why, /metadata/);
  assert.equal((await g.check("data:text/plain,hi")).ok, true);
  assert.equal((await g.resolverRules()), "MAP stg.example.com 93.184.216.34");
});

// ---------------------------------------------------------------- images
const solid = (w, h, color) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
async function withBlock(w, h, box, color) {
  const patch = await sharp({ create: { width: box.w, height: box.h, channels: 3, background: color } }).png().toBuffer();
  return sharp(await solid(w, h, "#ffffff")).composite([{ input: patch, left: box.x, top: box.y }]).png().toBuffer();
}

test("pixelDiff: identical images have no differences", async () => {
  const d = await pixelDiff(await solid(400, 300, "#ffffff"), await solid(400, 300, "#ffffff"));
  assert.equal(d.ratio, 0);
  assert.deepEqual(d.regions, []);
});

test("pixelDiff finds the changed block, resizes staging to the design width, and flags a much longer page", async () => {
  const design = await solid(400, 300, "#ffffff");
  const staging = await withBlock(800, 600, { x: 400, y: 200, w: 200, h: 120 }, "#000000"); // 2x scale, block at (200,100) in design px
  const d = await pixelDiff(design, staging);
  assert.equal(d.width, 400);
  assert.ok(d.regions.length >= 1);
  const r = d.regions[0];
  assert.ok(r.x <= 200 && r.x + r.w >= 300 && r.y <= 100 && r.y + r.h >= 160, JSON.stringify(r));
  const longer = await pixelDiff(design, await solid(400, 600, "#ffffff"));
  assert.ok(longer.regions.some((x) => x.y === 300 && x.h === 300)); // the extra part of the page is flagged once
});

test("cropPair returns two PNG crops of the same area; downscale keeps proportions", async () => {
  const [a, b] = await cropPair(await solid(400, 300, "#ffffff"), await solid(400, 300, "#ff0000"), { x: 100, y: 100, w: 50, h: 50 });
  assert.equal((await sharp(a).metadata()).format, "png");
  assert.equal((await sharp(b).metadata()).width, (await sharp(a).metadata()).width);
  const small = await downscale(await solid(3000, 1500, "#ffffff"), 1600);
  assert.equal(small.width, 1600);
  assert.equal(small.height, 800);
  assert.equal(small.originalWidth, 3000);
});

test("matchDesign prefers a screen whose name matches the page path, else falls back by position", () => {
  const assets = [{ id: "1", screen_name: "Home" }, { id: "2", screen_name: "Verify OTP" }];
  assert.equal(matchDesign("/verify-otp", 0, assets).id, "2");
  assert.equal(matchDesign("/zzz", 1, assets).id, "2"); // no word overlap: fall back to the page's position
  assert.equal(matchDesign("/zzz", 7, assets).id, "1"); // position out of range: first asset
  assert.equal(matchDesign("/x", 0, []), null);
});

// ---------------------------------------------------------------- validation of staging results
test("staging results are validated: captures stay in the job folder and ids must belong to the job", () => {
  const brief = { review_type: "functional_qa", input: { capture_prefix: "c/j/", requirements: [], test_cases: [{ id: "t1" }] } };
  const ok = { captures: [{ key: "c0", storage_path: "c/j/01-x.png" }], findings: [{ title: "Scenario failed: x", capture_key: "c0", evidence_note: "n" }], test_results: [{ test_case_id: "t1", result: "failed" }] };
  assert.deepEqual(validate(ok, brief), []);
  const bad = { captures: [{ key: "c0", storage_path: "other/x.png" }], findings: [{ title: "Bad finding", capture_key: "c9", evidence_note: "n" }], test_results: [{ test_case_id: "zzz", result: "verified" }] };
  assert.equal(validate(bad, brief).length, 3);
});

test("the review model gets Read access only, with no web or shell", () => {
  const args = claudeArgs({ model: "sonnet", schema: {} });
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "Read"]);
});

// ---------------------------------------------------------------- real Chromium against a local site
const PAGE = `<!doctype html><html><head><title>Verify</title></head><body style="margin:0;font-family:sans-serif">
<h1 style="background:#000;color:#fff;height:300px;margin:0">Welcome</h1>
<label for="m">Mobile number</label><input id="m" placeholder="Mobile number"><button id="go" onclick="document.getElementById('out').textContent='OTP sent'">Verify</button>
<p id="out"></p><img src="http://blocked.invalid:9/x.png"><script>console.error("boom from the page")</script></body></html>`;

async function site() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(PAGE); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, base: `http://localhost:${srv.address().port}` };
}

function briefFor(type, base, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-stg-"));
  return { id: "job-1", review_type: type, dir, timeout_seconds: 600, files: [], input: {
    staging_url: base, page_paths: ["/"], devices: ["desktop"], allowed_domains: ["localhost"], environment: null,
    design_assets: [], requirements: [], test_cases: [], capture_prefix: "camp/job-1/", limits: {}, ...extra } };
}
const fakeDb = () => { const uploads = []; return { uploads, upload: async (b, p, d, t) => { uploads.push({ b, p, size: d.length, t }); }, rpc: async () => null }; };
const guard = () => new NetGuard(["localhost"], { unsafeAllowPrivateForTests: true });

test("functional_qa: runs written scenarios in a real browser, reports failures with evidence, never bypasses the allow-list", async () => {
  const { srv, base } = await site();
  try {
    const db = fakeDb();
    const brief = briefFor("functional_qa", base, { test_cases: [
      { id: "t-pass", title: "OTP is sent", expected: "OTP sent", requirement_id: null, steps: [
        { action: "goto", target: "/" }, { action: "fill", target: "Mobile number", value: "9876543210" }, { action: "click", target: "Verify" }, { action: "expect_text", target: "OTP sent" }] },
      { id: "t-fail", title: "Shows thank you", expected: "Thank you", requirement_id: null, steps: [
        { action: "goto", target: "/" }, { action: "expect_text", target: "Thank you for entering" }] },
    ] });
    const { result, meta } = await runStaging(brief, { db, model: "sonnet", guard: guard(), timeoutMs: 1000 });
    const byId = Object.fromEntries(result.test_results.map((t) => [t.test_case_id, t]));
    assert.equal(byId["t-pass"].result, "verified");
    assert.equal(byId["t-fail"].result, "failed");
    assert.ok(byId["t-fail"].evidence.screenshot.startsWith("camp/job-1/"));
    assert.ok(byId["t-fail"].evidence.console.some((c) => /boom from the page/.test(c.text)));
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0].title, /Scenario failed: Shows thank you/);
    assert.deepEqual(result.test_summary.passed, 1);
    assert.ok(result.notes.blocked_requests >= 1, "the image on a non-allowed host must be blocked");
    assert.ok(db.uploads.every((u) => u.b === "captures" && u.p.startsWith("camp/job-1/")));
    assert.match(meta.prompt_version, /qa/);
    assert.deepEqual(validate(result, brief), []);
  } finally { srv.close(); }
});

test("design_vs_development: pixel diff finds the difference, Claude judges only that region, finding carries an approximate region", async () => {
  const { srv, base } = await site();
  try {
    const db = fakeDb();
    const brief = briefFor("design_vs_development", base, { design_assets: [{ id: "asset-1", screen_name: "Home" }] });
    const designFile = path.join(brief.dir, "01-Home.png");
    fs.writeFileSync(designFile, await solid(1440, 900, "#ffffff")); // the design has no black banner
    brief.files = [{ kind: "design", id: "asset-1", local: designFile, name: "01-Home.png", label: "Home" }];
    let prompt = "";
    const run = async (o) => { prompt = o.prompt; return { structured_output: { differences: [{ region: 1, relevant: true, title: "Black banner not in the design", severity: "high", description: "d", expected: "White header", observed: "Black banner", suggested_correction: "Remove banner", confidence: "high" }, { region: 99, relevant: true, title: "ignored: no such region" }] }, usage: { input_tokens: 5, output_tokens: 5 }, modelUsage: { "claude-sonnet-5-5": { outputTokens: 5 } } }; };
    const { result } = await runStaging(brief, { db, model: "sonnet", guard: guard(), timeoutMs: 1000, run });
    assert.match(prompt, /UNTRUSTED DATA/);
    assert.match(prompt, /diff-0-desktop-1-design\.png/);
    assert.equal(result.captures.length, 1);
    assert.equal(result.captures[0].design_asset_id, "asset-1");
    assert.ok(result.captures[0].diff_ratio > 0);
    const f = result.findings.find((x) => x.title === "Black banner not in the design");
    assert.ok(f, "the model's finding is kept");
    assert.ok(!result.findings.some((x) => /ignored/.test(x.title)));
    assert.equal(f.capture_key, "c0");
    assert.equal(f.requirement_id, null);
    assert.ok(f.region.w > 0.5 && f.region.h > 0.1 && f.region.y < 0.05, JSON.stringify(f.region));
    assert.match(f.evidence_note, /approximate/);
    assert.ok(result.findings.some((x) => /console error/.test(x.title)), "console errors are reported without any model");
    assert.deepEqual(validate(result, brief), []);
  } finally { srv.close(); }
});

test("sow_vs_development: backend rules are never judged from a screenshot", async () => {
  const { srv, base } = await site();
  try {
    const reqs = [
      { id: "r-ui", ref: "REQ-001", title: "Mobile number field", description: "A field", category: "ui" },
      { id: "r-reward", ref: "REQ-002", title: "Reward in 7 days", description: "x", category: "reward_logic" },
      { id: "r-missing", ref: "REQ-003", title: "Terms link", description: "x", category: "legal" },
    ];
    const brief = briefFor("sow_vs_development", base, { requirements: reqs });
    let asked = "";
    const run = async (o) => { asked = o.prompt; return { structured_output: { checks: [
      { requirement_ref: "REQ-001", result: "verified", note: "Field visible" },
      { requirement_ref: "REQ-002", result: "verified", note: "model tries to verify a backend rule" },
      { requirement_ref: "REQ-003", result: "failed", note: "No terms link on the page" }] }, usage: {}, modelUsage: {} }; };
    const { result } = await runStaging(brief, { db: fakeDb(), model: "sonnet", guard: guard(), timeoutMs: 1000, run });
    assert.doesNotMatch(asked, /REQ-002/, "the backend rule is not even sent to the model");
    const check = (id) => result.checks.find((c) => c.requirement_id === id);
    assert.equal(check("r-ui").result, "verified");
    assert.equal(check("r-ui").method, "visually_observed");
    assert.equal(check("r-reward").result, "needs_verification");
    assert.equal(check("r-missing").result, "failed");
    assert.ok(result.findings.some((f) => f.requirement_id === "r-missing" && /Not implemented/.test(f.title)));
    assert.deepEqual(validate(result, brief), []);
  } finally { srv.close(); }
});

test("a staging URL outside the allow-list is refused before the browser opens it", async () => {
  const brief = briefFor("design_vs_development", "https://staging.other-company.example", { allowed_domains: ["stg.mine.example"] });
  await assert.rejects(runStaging(brief, { db: fakeDb(), model: "sonnet", timeoutMs: 1000, guard: new NetGuard(["stg.mine.example"], { resolver: async () => ["93.184.216.34"] }) }),
    /Refusing to open|not on the allow-list/);
  const none = briefFor("functional_qa", "https://x.example", { allowed_domains: [] });
  await assert.rejects(runStaging(none, { db: fakeDb(), model: "sonnet", timeoutMs: 1000 }), /No allowed domains/);
  await assert.rejects(runStaging(briefFor("functional_qa", ""), { db: fakeDb(), model: "sonnet", timeoutMs: 1000 }), /no staging URL/i);
});
