// Run with: node --test tools/claude-worker
// Offline tests for the analysis runner and the localhost connector. No Supabase, no real Claude.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { analyse, buildPrompt, claudeArgs, normaliseBox, toDesignResult } from "./runner.mjs";
import { ResultRejected } from "./core.mjs";
import { createConnector } from "./server.mjs";

const REQ1 = "11111111-1111-1111-1111-111111111111";
const REQ2 = "22222222-2222-2222-2222-222222222222";
const ASSET = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function designBrief(type = "sow_vs_design") {
  return {
    id: "job-1", review_type: type, dir: os.tmpdir(),
    input: { requirements: [{ id: REQ1, ref: "REQ-001", category: "validation", title: "OTP", description: "" }, { id: REQ2, ref: "REQ-002", category: "reward_logic", title: "Limit" }],
      assets: [{ id: ASSET, screen_name: "Home" }] },
    files: [{ kind: "design", id: ASSET, name: "01-Home.png", label: "Home" }],
  };
}

test("normaliseBox converts 0-1000 grid and fractions, and refuses what it cannot trust", () => {
  assert.deepEqual(normaliseBox([100, 200, 500, 400]), { x: 0.1, y: 0.2, w: 0.4, h: 0.2 });
  assert.deepEqual(normaliseBox([0.1, 0.2, 0.5, 0.4]), { x: 0.1, y: 0.2, w: 0.4, h: 0.2 });
  assert.deepEqual(normaliseBox([500, 400, 100, 200]), { x: 0.1, y: 0.2, w: 0.4, h: 0.2 }); // swapped corners
  assert.equal(normaliseBox([10, 10, 3000, 4000]), null); // absolute pixels: unknown size, so no guess
  assert.equal(normaliseBox([10, 10, 10, 10]), null);
  assert.equal(normaliseBox(null), null);
});

test("design mapping turns REQ refs and file names into ids, and never invents a requirement", () => {
  const out = toDesignResult(designBrief(), {
    findings: [
      { title: "OTP missing", severity: "high", confidence: "medium", evidence_note: "No OTP box", requirement_ref: "req-001", screen_file: "01-Home.png", box: [100, 100, 500, 300] },
      { title: "Odd spacing", severity: "low", confidence: "low", evidence_note: "Uneven", requirement_ref: "REQ-999", screen_file: "nope.png", box: [100, 100, 500, 300] },
      { title: "OTP missing", severity: "high", confidence: "medium", evidence_note: "dup", requirement_ref: "REQ-001", screen_file: "01-Home.png", box: null },
    ],
    checks: [{ requirement_ref: "REQ-002", result: "needs_verification", note: "backend" }, { requirement_ref: "REQ-001", result: "verified", note: "ok" }],
  });
  assert.equal(out.findings.length, 2); // duplicate removed
  assert.equal(out.findings[0].requirement_id, REQ1);
  assert.equal(out.findings[0].design_asset_id, ASSET);
  assert.match(out.findings[0].evidence_note, /region approximate/);
  assert.equal(out.findings[1].requirement_id, null); // unknown ref -> additional observation
  assert.equal(out.findings[1].design_asset_id, null);
  assert.equal(out.findings[1].region, null); // no screen, no region
  assert.equal(out.checks.find((c) => c.requirement_id === REQ1).method, "visually_observed");
  assert.equal(out.checks.find((c) => c.requirement_id === REQ2).method, null);
});

test("Claude is started with only the Read tool and no permission prompts", () => {
  const args = claudeArgs({ model: "sonnet", schema: { type: "object" } });
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "Read"]);
  assert.ok(args.includes("dontAsk") && args.includes("--no-session-persistence") && args.includes("--strict-mcp-config"));
  assert.ok(!args.includes("--dangerously-skip-permissions"));
});

test("the prompt treats files as untrusted and carries validation feedback on the retry", () => {
  const p = buildPrompt(designBrief(), ["findings[0].title is required"]);
  assert.match(p, /UNTRUSTED DATA/);
  assert.match(p, /REQ-001/);
  assert.match(p, /findings\[0\]\.title is required/);
});

function sowBrief() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-test-"));
  fs.writeFileSync(path.join(dir, "pages.json"), JSON.stringify([{ page_no: 1, method: "text", scanned: false, text: "Users must register using a valid 10 digit mobile number and verify with an OTP before entering." }]));
  return { id: "job-2", review_type: "sow_analysis", dir, input: {}, files: [{ kind: "sow", name: "sow.pdf" }] };
}
const goodReq = { title: "Register with mobile number", category: "validation", priority: "high", confidence: "high", source_pages: [1], source_text: "Users must register using a valid 10 digit mobile number and verify with an OTP" };
const reply = (answer) => ({ structured_output: answer, usage: { input_tokens: 10, output_tokens: 5 }, modelUsage: { "claude-sonnet-5-5": { outputTokens: 5 } } });

test("a rejected answer gets one retry with the problems, then succeeds", async () => {
  const prompts = [];
  const answers = [{ requirements: [{ ...goodReq, source_text: "Winners receive a holiday to Goa for two people next year" }] }, { requirements: [goodReq] }];
  const { result, meta } = await analyse(sowBrief(), { run: async ({ prompt }) => { prompts.push(prompt); return reply(answers[prompts.length - 1]); } });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /not found verbatim/);
  assert.equal(result.requirements.length, 1);
  assert.equal(result.pages[0].method, "text");
  assert.match(meta.model, /Claude Code \(claude-sonnet-5-5\)/);
  assert.equal(meta.tokens_in, 20);
});

test("two bad answers in a row fail the job instead of writing anything", async () => {
  const bad = { requirements: [{ ...goodReq, category: "marketing" }] };
  await assert.rejects(analyse(sowBrief(), { run: async () => reply(bad) }), (e) => e instanceof ResultRejected && e.problems.some((p) => /category/.test(p)));
});

test("an unknown review type is refused clearly", async () => {
  await assert.rejects(analyse({ ...designBrief("made_up_review") }, { run: async () => reply({}) }), /does not support "made_up_review"/);
});

// ---------------------------------------------------------------- connector
function request(port, { method = "GET", pathname = "/status", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers }, (res) => {
      let body = ""; res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: body ? JSON.parse(body) : null }));
    });
    req.on("error", reject); req.end();
  });
}

async function makeConnector({ jobs = [], analyseJob } = {}) {
  const calls = [];
  const db = { rpc: async (fn, p) => { calls.push([fn, p]); return fn === "complete_review_job" ? { status: "completed", findings: 1 } : null; } };
  const queue = [...jobs];
  const c = createConnector({
    cfg: { port: 0, origins: ["https://campaignos.example.pages.dev"], pollMs: 3_600_000, name: "claude-code", model: "sonnet", jobTimeoutMs: 1000 },
    db, claude: { ok: true, version: "test" }, log: () => {},
    claimNext: async () => queue.shift() ?? null,
    analyseJob: analyseJob ?? (async () => ({ result: { findings: [], checks: [] }, meta: { model: "Claude Code (test)" } })),
  });
  await c.start();
  return { c, calls, port: c.server.address().port };
}

test("connector: only the dashboard origins and localhost hosts get through", async () => {
  const { c, port } = await makeConnector();
  try {
    assert.equal((await request(port, { headers: { Origin: "https://evil.example" } })).status, 403);
    assert.equal((await request(port, { headers: { Host: "evil.example" } })).status, 403); // DNS rebinding
    const ok = await request(port, { headers: { Origin: "http://localhost:5174" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers["access-control-allow-origin"], "http://localhost:5174");
    assert.equal(ok.body.connector, "claude-code");
    assert.equal((await request(port, { headers: { Origin: "https://campaignos.example.pages.dev" } })).status, 200); // configured origin
    const pre = await request(port, { method: "OPTIONS", headers: { Origin: "http://localhost:5174" } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers["access-control-allow-private-network"], "true");
    assert.equal((await request(port, { pathname: "/secrets" })).status, 404);
  } finally { await c.stop(); }
});

test("connector: /wake runs the job, saves the result and reports status", async () => {
  const brief = { id: "abcdef12-0000-0000-0000-000000000000", review_type: "sow_vs_design", input: {}, files: [] };
  const { c, calls, port } = await makeConnector({ jobs: [brief] });
  try {
    assert.equal((await request(port, { method: "POST", pathname: "/wake" })).status, 202);
    for (let i = 0; i < 50 && !calls.some(([f]) => f === "complete_review_job"); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(calls.some(([f, p]) => f === "complete_review_job" && p.p_job === brief.id));
    await new Promise((r) => setTimeout(r, 30));
    const s = await request(port);
    assert.equal(s.body.busy, false);
    assert.equal(s.body.last.status, "completed");
  } finally { await c.stop(); }
});

test("connector: a failed analysis is reported to the database, not swallowed", async () => {
  const brief = { id: "fedcba98-0000-0000-0000-000000000000", review_type: "sow_vs_design", input: {}, files: [] };
  const { c, calls, port } = await makeConnector({ jobs: [brief], analyseJob: async () => { throw new ResultRejected(["findings[0].title is required"]); } });
  try {
    await request(port, { method: "POST", pathname: "/wake" });
    for (let i = 0; i < 50 && !calls.some(([f]) => f === "fail_review_job"); i++) await new Promise((r) => setTimeout(r, 20));
    const fail = calls.find(([f]) => f === "fail_review_job");
    assert.ok(fail);
    assert.match(fail[1].p_error, /failed validation twice/);
    assert.equal(fail[1].p_retryable, false);
  } finally { await c.stop(); }
});

test("connector: a job that cannot be prepared does not block the jobs behind it", async () => {
  const { JobFailed } = await import("./core.mjs");
  const good = { id: "01234567-0000-0000-0000-000000000000", review_type: "sow_vs_design", input: {}, files: [] };
  const seq = [new JobFailed("This SOW was stored as a Word file"), good];
  const calls = [];
  const db = { rpc: async (fn, p) => { calls.push([fn, p]); return fn === "complete_review_job" ? { status: "completed" } : null; } };
  const c = createConnector({
    cfg: { port: 0, origins: [], pollMs: 3_600_000, name: "claude-code", model: "sonnet", jobTimeoutMs: 1000 },
    db, log: () => {},
    claimNext: async () => { const n = seq.shift(); if (n instanceof Error) throw n; return n ?? null; },
    analyseJob: async () => ({ result: { findings: [], checks: [] }, meta: {} }),
  });
  await c.start();
  try {
    for (let i = 0; i < 50 && !calls.some(([f]) => f === "complete_review_job"); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(calls.some(([f, p]) => f === "complete_review_job" && p.p_job === good.id));
  } finally { await c.stop(); }
});
