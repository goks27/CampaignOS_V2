#!/usr/bin/env node
/**
 * CampaignOS - Claude Code worker bridge.
 *
 * Lets Claude Code act as the AI worker. It does the same thing the Python worker does, with the same limits:
 * signs in as the dedicated `worker` Auth user (never the service-role key), claims jobs through
 * SECURITY DEFINER functions, reads only the files a claimed job points to, and writes results through
 * complete_review_job / fail_review_job. Everything is outbound HTTPS. Needs Node 18+ and no packages.
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
 * SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY fall back to apps/web/.env.local (the same public values).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK = path.join(ROOT, "tools", "claude-worker", "work"); // git-ignored scratch space
const WORKER_NAME_DEFAULT = "claude-code";
const MODEL = "Claude Code";
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------- config
function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function config() {
  const w = readEnv(path.join(ROOT, "services", "local-ai-worker", ".env"));
  const web = readEnv(path.join(ROOT, "apps", "web", ".env.local"));
  const cfg = {
    url: (w.SUPABASE_URL || web.VITE_SUPABASE_URL || "").replace(/\/$/, ""),
    key: w.SUPABASE_PUBLISHABLE_KEY || web.VITE_SUPABASE_PUBLISHABLE_KEY || "",
    email: w.WORKER_EMAIL || "",
    password: w.WORKER_PASSWORD || "",
    name: w.WORKER_NAME || WORKER_NAME_DEFAULT,
  };
  const missing = [];
  if (!cfg.url) missing.push("SUPABASE_URL");
  if (!cfg.key) missing.push("SUPABASE_PUBLISHABLE_KEY");
  if (!cfg.email) missing.push("WORKER_EMAIL");
  if (!cfg.password) missing.push("WORKER_PASSWORD");
  if (missing.length) {
    die(`Missing ${missing.join(", ")}. Create services/local-ai-worker/.env from .env.example and fill in the worker user's email and password.`);
  }
  return cfg;
}

function die(msg, code = 1) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

// ---------------------------------------------------------------- supabase
class Supabase {
  constructor(cfg) {
    this.cfg = cfg;
    this.token = null;
    this.expires = 0;
  }
  async signIn() {
    const r = await fetch(`${this.cfg.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.cfg.key, "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.cfg.email, password: this.cfg.password }),
    });
    if (!r.ok) die(`Worker sign-in failed (${r.status}). Check WORKER_EMAIL / WORKER_PASSWORD. ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    this.token = d.access_token;
    this.expires = Date.now() + (d.expires_in ?? 3600) * 1000;
  }
  async headers(extra = {}) {
    if (!this.token || Date.now() > this.expires - 120_000) await this.signIn();
    return { apikey: this.cfg.key, Authorization: `Bearer ${this.token}`, ...extra };
  }
  async rpc(fn, params = {}) {
    const r = await fetch(`${this.cfg.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: await this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(params),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${fn} failed (${r.status}): ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }
  async download(bucket, objectPath) {
    const url = `${this.cfg.url}/storage/v1/object/authenticated/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
    const r = await fetch(url, { headers: await this.headers() });
    if (!r.ok) throw new Error(`Download of ${bucket}/${objectPath} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_FILE_BYTES) throw new Error(`${bucket}/${objectPath} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
    return Buffer.from(await r.arrayBuffer());
  }
}

const sb = (cfg) => new Supabase(cfg);

async function beat(db, cfg, busy, jobId = null, message = "") {
  await db.rpc("worker_heartbeat", {
    p_worker_name: cfg.name,
    p_model: MODEL,
    p_model_ready: true,
    p_model_message: message || (busy ? "Claude Code is working on a job" : "Claude Code session is available"),
    p_accelerator: "unknown", // the column only allows gpu | cpu | unknown; this is not a local accelerator
    p_busy: busy,
    p_current_job: jobId,
    p_info: { runner: "tools/claude-worker" },
  });
}

// ---------------------------------------------------------------- files
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);

/** Files a job refers to: { bucket, path, label, kind }. Only what the job input names. */
function filesOf(job) {
  const i = job.input || {};
  const out = [];
  if (i.bucket && i.path) out.push({ bucket: i.bucket, path: i.path, label: i.file_name || "sow", kind: "sow" });
  for (const a of [...(i.assets || []), ...(i.design_assets || [])]) {
    if (a.path) out.push({ bucket: a.bucket || "designs", path: a.path, label: a.screen_name || a.id, kind: "design", id: a.id });
  }
  return out;
}

/** Text of each PDF page. Pages with almost no text are flagged as scanned: read those visually and transcribe. */
export async function pdfPages(buf, maxPages) {
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    const zip = buf[0] === 0x50 && buf[1] === 0x4b;
    throw new Error(
      `This SOW was stored as ${zip ? "a Word/Excel/PowerPoint file" : "a file that is not a PDF"}, so it can't be analysed as pages. ` +
      "Upload it again from the updated app (it converts to PDF on upload), or upload a PDF.");
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  if (doc.numPages > maxPages) {
    throw new Error(`Limit reached: this PDF has ${doc.numPages} pages; the maximum per submission is ${maxPages}. Split the document or raise the limit in Settings.`);
  }
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    let text = "";
    for (const it of content.items) text += it.str + (it.hasEOL ? "\n" : " ");
    text = text.replace(/[ \t]+\n/g, "\n").trim();
    pages.push({ page_no: n, method: text.length < 30 ? "ocr" : "text", scanned: text.length < 30, text });
  }
  await doc.destroy();
  return pages;
}

// ---------------------------------------------------------------- validation (mirrors the worker's Pydantic models)
const CATEGORIES = ["user_journey", "screen", "ui", "functional", "validation", "business_rule", "reward_logic", "api_integration", "legal", "performance", "security", "analytics", "deployment"];
const PRIORITY = ["low", "medium", "high", "critical"];
const CONFIDENCE = ["high", "medium", "low", "needs_manual_verification"];
const SEVERITY = ["critical", "high", "medium", "low", "informational"];
const CHECK = ["verified", "failed", "needs_verification", "not_tested", "blocked"];
const METHOD = ["visually_observed", "functionally_tested", "backend_verified", "manual"];
const BACKEND = new Set(["business_rule", "reward_logic", "api_integration", "security", "performance", "analytics", "deployment"]);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function quoteFound(quote, text) {
  const q = norm(quote), body = norm(text);
  if (!q) return false;
  if (body.includes(q)) return true;
  const t = q.split(" ");
  if (t.length < 6) return false;
  const sh = [];
  for (let i = 0; i + 6 <= t.length; i++) sh.push(t.slice(i, i + 6).join(" "));
  return sh.filter((s) => body.includes(s)).length / sh.length >= 0.8;
}

/** Returns a list of problems. Nothing is written to Supabase while this list is non-empty. */
export function validate(result, brief) {
  const errs = [];
  const oneOf = (v, set, where) => { if (!set.includes(v)) errs.push(`${where}: "${v}" is not one of ${set.join(", ")}`); };
  const type = brief?.review_type;
  const reqs = brief?.input?.requirements || [];
  const reqIds = new Set(reqs.map((r) => String(r.id)));
  const reqById = new Map(reqs.map((r) => [String(r.id), r]));
  const assetIds = new Set([...(brief?.input?.assets || []), ...(brief?.input?.design_assets || [])].map((a) => String(a.id)));

  if (type === "sow_analysis") {
    const pages = result.pages || [];
    const textOf = (n) => pages.find((p) => p.page_no === n)?.text || "";
    if (!pages.length) errs.push("pages: include the text of every page (use pages.json from the claim step)");
    for (const p of pages) if (!["text", "ocr", "skipped"].includes(p.method)) errs.push(`pages[${p.page_no}].method must be text, ocr or skipped`);
    (result.requirements || []).forEach((r, i) => {
      const w = `requirements[${i}]`;
      if (!r.title || r.title.length < 3 || r.title.length > 300) errs.push(`${w}.title must be 3-300 characters`);
      oneOf(r.category ?? "functional", CATEGORIES, `${w}.category`);
      oneOf(r.priority ?? "medium", PRIORITY, `${w}.priority`);
      oneOf(r.confidence ?? "medium", CONFIDENCE, `${w}.confidence`);
      if (!r.source_text) errs.push(`${w}.source_text is required (verbatim quote)`);
      if (!Array.isArray(r.source_pages) || !r.source_pages.length || r.source_pages.some((p) => !Number.isInteger(p) || p < 1)) errs.push(`${w}.source_pages must be page numbers >= 1`);
      else if (r.source_text && r.confidence !== "needs_manual_verification" && !quoteFound(r.source_text, r.source_pages.map(textOf).join("\n"))) {
        errs.push(`${w}.source_text was not found verbatim on page(s) ${r.source_pages.join(",")}. Quote the document exactly, or set confidence to needs_manual_verification.`);
      }
    });
    return errs;
  }

  if (!Array.isArray(result.findings)) errs.push("findings must be an array (it can be empty)");
  (result.findings || []).forEach((f, i) => {
    const w = `findings[${i}]`;
    if (!f.title || f.title.length < 3) errs.push(`${w}.title is required`);
    oneOf(f.severity ?? "medium", SEVERITY, `${w}.severity`);
    oneOf(f.confidence ?? "medium", CONFIDENCE, `${w}.confidence`);
    if (f.requirement_id && !reqIds.has(String(f.requirement_id))) errs.push(`${w}.requirement_id is not an accepted requirement of this job. Use null for an "Additional observation".`);
    if (f.design_asset_id && !assetIds.has(String(f.design_asset_id))) errs.push(`${w}.design_asset_id is not a screen of this job`);
    if (f.region) {
      const r = f.region;
      const ok = ["x", "y", "w", "h"].every((k) => typeof r[k] === "number" && r[k] >= 0 && r[k] <= 1) && r.x + r.w <= 1.001 && r.y + r.h <= 1.001 && r.w > 0 && r.h > 0;
      if (!ok) errs.push(`${w}.region must be {x,y,w,h} as fractions 0-1 of the image`);
    }
    if (!f.requirement_id && !f.evidence_note) errs.push(`${w}: an additional observation needs an evidence_note saying what was seen`);
  });
  (result.checks || []).forEach((c, i) => {
    const w = `checks[${i}]`;
    if (!reqIds.has(String(c.requirement_id))) errs.push(`${w}.requirement_id is not an accepted requirement of this job`);
    oneOf(c.result, CHECK, `${w}.result`);
    if (c.method) oneOf(c.method, METHOD, `${w}.method`);
    const req = reqById.get(String(c.requirement_id));
    if (c.result === "verified" && req && BACKEND.has(req.category)) errs.push(`${w}: a backend rule (${req.category}) can never be "verified" from a screenshot. Use needs_verification.`);
  });
  return errs;
}

// ---------------------------------------------------------------- commands
async function status() {
  const cfg = config();
  const db = sb(cfg);
  await db.signIn();
  await beat(db, cfg, false);
  console.log(`Signed in as ${cfg.email}. Worker "${cfg.name}" reported to the dashboard as available.`);
}

async function claim() {
  const cfg = config();
  const db = sb(cfg);
  const job = await db.rpc("claim_review_job", { p_worker_name: cfg.name });
  if (!job) {
    await beat(db, cfg, false);
    console.log("No queued jobs.");
    return;
  }
  await beat(db, cfg, true, job.id);
  const dir = path.join(WORK, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const [n, f] of filesOf(job).entries()) {
    const buf = await db.download(f.bucket, f.path);
    const ext = path.extname(f.path) || "";
    const local = path.join(dir, `${String(n + 1).padStart(2, "0")}-${safe(f.label)}${safe(f.label).endsWith(ext) ? "" : ext}`);
    fs.writeFileSync(local, buf);
    files.push({ ...f, local, bytes: buf.length });
    if (f.kind === "sow") {
      try {
        const limit = job.input?.limits?.max_pdf_pages ?? 30;
        const pages = await pdfPages(buf, limit);
        fs.writeFileSync(path.join(dir, "pages.json"), JSON.stringify(pages, null, 2));
        files[files.length - 1].pages = pages.length;
        files[files.length - 1].scanned_pages = pages.filter((p) => p.scanned).map((p) => p.page_no);
      } catch (e) {
        await db.rpc("fail_review_job", { p_job: job.id, p_error: e.message, p_detail: { runner: "claude-code", step: "extract text" }, p_retryable: false });
        await beat(db, cfg, false);
        die(e.message);
      }
    }
  }
  const brief = { ...job, files, claimed_at: new Date().toISOString(), worker_name: cfg.name };
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(brief, null, 2));
  console.log(`Claimed job ${job.id}`);
  console.log(`  type:        ${job.review_type}`);
  console.log(`  campaign:    ${job.campaign_id}`);
  console.log(`  attempt:     ${job.attempts}/${job.max_attempts}`);
  console.log(`  timeout:     ${job.timeout_seconds}s (send a heartbeat for long jobs)`);
  console.log(`  brief:       ${path.join(dir, "job.json")}`);
  for (const f of files) {
    console.log(`  file:        ${f.local}  (${f.kind}, ${f.bytes} bytes)`);
    if (f.pages) console.log(`  pages:       ${f.pages}; text per page in ${path.join(dir, "pages.json")}${f.scanned_pages.length ? `; SCANNED (read visually and transcribe): ${f.scanned_pages.join(", ")}` : ""}`);
  }
}

async function heartbeat(jobId) {
  if (!jobId) die("heartbeat needs a job id");
  const cfg = config();
  const db = sb(cfg);
  const r = await db.rpc("heartbeat_job", { p_job: jobId });
  await beat(db, cfg, true, jobId);
  console.log(r?.cancel_requested ? "CANCEL REQUESTED: stop and call complete/fail." : "OK, job still held.");
}

async function complete(jobId, resultFile, metaFile) {
  if (!jobId || !resultFile) die("complete needs <jobId> <result.json> [meta.json]");
  const cfg = config();
  const db = sb(cfg);
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  const briefFile = path.join(WORK, jobId, "job.json");
  const brief = fs.existsSync(briefFile) ? JSON.parse(fs.readFileSync(briefFile, "utf8")) : null;
  const problems = validate(result, brief);
  if (problems.length) {
    console.error(`Result rejected, nothing was written (${problems.length} problem${problems.length > 1 ? "s" : ""}):`);
    for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
    process.exit(2);
  }
  const meta = metaFile ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : {};
  const started = brief?.claimed_at ? Date.parse(brief.claimed_at) : Date.now();
  const filled = {
    prompt_version: meta.prompt_version || "claude-code-v1",
    model: meta.model || MODEL,
    context_size: meta.context_size ?? null,
    duration_ms: meta.duration_ms ?? Date.now() - started,
    tokens_in: meta.tokens_in ?? null,
    tokens_out: meta.tokens_out ?? null,
  };
  const summary = await db.rpc("complete_review_job", { p_job: jobId, p_result: result, p_meta: filled });
  await beat(db, cfg, false);
  console.log("Job completed:", JSON.stringify(summary));
}

async function fail(jobId, message, flags) {
  if (!jobId || !message) die('fail needs <jobId> "<message>"');
  const cfg = config();
  const db = sb(cfg);
  const r = await db.rpc("fail_review_job", { p_job: jobId, p_error: message, p_detail: { runner: "claude-code" }, p_retryable: !flags.includes("--no-retry") });
  await beat(db, cfg, false);
  console.log("Job reported as failed:", JSON.stringify(r));
}

async function idle() {
  const cfg = config();
  const db = sb(cfg);
  await beat(db, cfg, false, null, "Claude Code session ended");
  console.log("Reported idle.");
}

// ---------------------------------------------------------------- main
const [cmd, ...rest] = process.argv.slice(2);
const run = {
  status: () => status(),
  claim: () => claim(),
  heartbeat: () => heartbeat(rest[0]),
  complete: () => complete(rest[0], rest[1], rest[2]),
  fail: () => fail(rest[0], rest[1], rest.slice(2)),
  idle: () => idle(),
}[cmd];

if (path.resolve(process.argv[1] || "") !== fileURLToPath(import.meta.url)) {
  // imported (tests): do nothing
} else if (!run) {
  const doc = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("/**")[1].split("*/")[0];
  console.log(doc.replace(/^ ?\* ?/gm, "").trim());
  process.exit(cmd ? 1 : 0);
}
else run().catch((e) => die(e.message));
