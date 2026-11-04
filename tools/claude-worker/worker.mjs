#!/usr/bin/env node
/**
 * CampaignOS - Claude Code worker CLI (manual control; the dashboard normally uses the connector, `npm run claude`).
 *
 * Usage:
 *   node tools/claude-worker/worker.mjs status
 *   node tools/claude-worker/worker.mjs claim            claim the next job, download its files, print a brief
 *   node tools/claude-worker/worker.mjs heartbeat <jobId>
 *   node tools/claude-worker/worker.mjs complete <jobId> <result.json> [meta.json]
 *   node tools/claude-worker/worker.mjs fail <jobId> "<message>" [--no-retry]
 *   node tools/claude-worker/worker.mjs idle              tell the dashboard the worker is idle
 *
 * Config: services/local-ai-worker/.env (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, WORKER_EMAIL, WORKER_PASSWORD).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Supabase, WORK, beat, claimJob, completeJob, config, failJob, ResultRejected } from "./core.mjs";

const die = (msg, code = 1) => { console.error(`ERROR: ${msg}`); process.exit(code); };
const ctx = () => { const cfg = config(); return { cfg, db: new Supabase(cfg) }; };

async function status() {
  const { cfg, db } = ctx();
  await db.signIn();
  await beat(db, cfg);
  console.log(`Signed in as ${cfg.email}. Worker "${cfg.name}" reported to the dashboard as available.`);
}

async function claim() {
  const { cfg, db } = ctx();
  const job = await claimJob(db, cfg);
  if (!job) { await beat(db, cfg); console.log("No queued jobs."); return; }
  await beat(db, cfg, { busy: true, jobId: job.id });
  console.log(`Claimed job ${job.id}`);
  console.log(`  type:        ${job.review_type}`);
  console.log(`  campaign:    ${job.campaign_id}`);
  console.log(`  attempt:     ${job.attempts}/${job.max_attempts}`);
  console.log(`  timeout:     ${job.timeout_seconds}s (send a heartbeat for long jobs)`);
  console.log(`  brief:       ${path.join(job.dir, "job.json")}`);
  for (const f of job.files) {
    console.log(`  file:        ${f.local}  (${f.kind}, ${f.bytes} bytes)`);
    if (f.pages) console.log(`  pages:       ${f.pages}; text per page in ${path.join(job.dir, "pages.json")}${f.scanned_pages.length ? `; SCANNED (read visually): ${f.scanned_pages.join(", ")}` : ""}`);
  }
}

async function heartbeat(jobId) {
  if (!jobId) die("heartbeat needs a job id");
  const { cfg, db } = ctx();
  const r = await db.rpc("heartbeat_job", { p_job: jobId });
  await beat(db, cfg, { busy: true, jobId });
  console.log(r?.cancel_requested ? "CANCEL REQUESTED: stop and call complete/fail." : "OK, job still held.");
}

async function complete(jobId, resultFile, metaFile) {
  if (!jobId || !resultFile) die("complete needs <jobId> <result.json> [meta.json]");
  const { cfg, db } = ctx();
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  const briefFile = path.join(WORK, jobId, "job.json");
  const brief = fs.existsSync(briefFile) ? JSON.parse(fs.readFileSync(briefFile, "utf8")) : null;
  const meta = metaFile ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : {};
  try {
    const summary = await completeJob(db, cfg, brief ?? { id: jobId }, result, meta);
    console.log("Job completed:", JSON.stringify(summary));
  } catch (e) {
    if (e instanceof ResultRejected) {
      console.error(`Result rejected, nothing was written (${e.problems.length} problem${e.problems.length > 1 ? "s" : ""}):`);
      for (const p of e.problems.slice(0, 40)) console.error(`  - ${p}`);
      process.exit(2);
    }
    throw e;
  }
  await beat(db, cfg);
}

async function fail(jobId, message, flags) {
  if (!jobId || !message) die('fail needs <jobId> "<message>"');
  const { cfg, db } = ctx();
  const r = await failJob(db, cfg, jobId, message, { retryable: !flags.includes("--no-retry") });
  await beat(db, cfg);
  console.log("Job reported as failed:", JSON.stringify(r));
}

async function idle() {
  const { cfg, db } = ctx();
  await beat(db, cfg, { message: "Claude Code session ended", ready: false });
  console.log("Reported idle.");
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const run = {
    status: () => status(), claim: () => claim(), heartbeat: () => heartbeat(rest[0]),
    complete: () => complete(rest[0], rest[1], rest[2]), fail: () => fail(rest[0], rest[1], rest.slice(2)), idle: () => idle(),
  }[cmd];
  if (!run) {
    const doc = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("/**")[1].split("*/")[0];
    console.log(doc.replace(/^ ?\* ?/gm, "").trim());
    process.exit(cmd ? 1 : 0);
  }
  run().catch((e) => die(e.message));
}
