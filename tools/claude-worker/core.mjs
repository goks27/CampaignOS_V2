/**
 * Shared core for the Claude Code worker (used by worker.mjs, the CLI, and server.mjs, the local connector).
 *
 * Identity: signs in as the dedicated `worker` Auth user, never the service-role key. Everything is outbound HTTPS.
 * It claims jobs and writes results only through the SECURITY DEFINER functions in the database.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// Scratch space lives OUTSIDE the repo so a headless Claude session never picks up the repo's CLAUDE.md or tooling.
export const WORK = path.join(os.tmpdir(), "campaignos-claude-worker");
export const MODEL_LABEL = "Claude Code";
const WORKER_NAME_DEFAULT = "claude-code";
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export class JobFailed extends Error {
  constructor(message, { retryable = false, detail = null } = {}) {
    super(message);
    this.retryable = retryable;
    this.detail = detail;
  }
}
export class ResultRejected extends Error {
  constructor(problems) {
    super(`Result rejected (${problems.length} problem${problems.length > 1 ? "s" : ""})`);
    this.problems = problems;
  }
}

// ---------------------------------------------------------------- config
export function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function config() {
  const w = readEnv(path.join(ROOT, "services", "local-ai-worker", ".env"));
  const web = readEnv(path.join(ROOT, "apps", "web", ".env.local"));
  const cfg = {
    url: (w.SUPABASE_URL || web.VITE_SUPABASE_URL || "").replace(/\/$/, ""),
    key: w.SUPABASE_PUBLISHABLE_KEY || web.VITE_SUPABASE_PUBLISHABLE_KEY || "",
    email: w.WORKER_EMAIL || "",
    password: w.WORKER_PASSWORD || "",
    name: w.WORKER_NAME || WORKER_NAME_DEFAULT,
    model: w.CLAUDE_MODEL || "sonnet",
    assistantModel: w.CLAUDE_ASSISTANT_MODEL || "",
    port: Number(w.CLAUDE_CONNECTOR_PORT || 4317),
    origins: (w.CLAUDE_CONNECTOR_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    pollMs: Number(w.CLAUDE_POLL_SECONDS || 30) * 1000,
    jobTimeoutMs: Number(w.CLAUDE_JOB_TIMEOUT_SECONDS || 900) * 1000,
  };
  const missing = [];
  if (!cfg.url) missing.push("SUPABASE_URL");
  if (!cfg.key) missing.push("SUPABASE_PUBLISHABLE_KEY");
  if (!cfg.email) missing.push("WORKER_EMAIL");
  if (!cfg.password) missing.push("WORKER_PASSWORD");
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}. Fill them in services/local-ai-worker/.env (the worker user's email and password).`);
  }
  return cfg;
}

// ---------------------------------------------------------------- supabase
async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!(e instanceof TypeError)) throw e; // only network failures ("fetch failed") are retried
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw new Error(`Could not reach Supabase: ${last?.cause?.code || last?.message}`);
}

export class Supabase {
  constructor(cfg) {
    this.cfg = cfg;
    this.token = null;
    this.expires = 0;
  }
  async signIn() {
    const r = await withRetry(() => fetch(`${this.cfg.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.cfg.key, "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.cfg.email, password: this.cfg.password }),
    }));
    if (!r.ok) throw new Error(`Worker sign-in failed (${r.status}). Check WORKER_EMAIL / WORKER_PASSWORD. ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    this.token = d.access_token;
    this.expires = Date.now() + (d.expires_in ?? 3600) * 1000;
  }
  async headers(extra = {}) {
    if (!this.token || Date.now() > this.expires - 120_000) await this.signIn();
    return { apikey: this.cfg.key, Authorization: `Bearer ${this.token}`, ...extra };
  }
  async rpc(fn, params = {}) {
    const r = await withRetry(async () => fetch(`${this.cfg.url}/rest/v1/rpc/${fn}`, {
      method: "POST", headers: await this.headers({ "Content-Type": "application/json" }), body: JSON.stringify(params),
    }));
    const text = await r.text();
    if (!r.ok) throw new Error(`${fn} failed (${r.status}): ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }
  async download(bucket, objectPath) {
    const url = `${this.cfg.url}/storage/v1/object/authenticated/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
    const r = await withRetry(async () => fetch(url, { headers: await this.headers() }));
    if (!r.ok) throw new Error(`Download of ${bucket}/${objectPath} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    if (Number(r.headers.get("content-length") || 0) > MAX_FILE_BYTES) throw new Error(`${bucket}/${objectPath} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
    return Buffer.from(await r.arrayBuffer());
  }
}

/** Uploads a capture. The worker may only write under the folder of the job it holds (enforced by storage policy). */
Supabase.prototype.upload = async function upload(bucket, objectPath, data, contentType) {
  const url = `${this.cfg.url}/storage/v1/object/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
  const r = await withRetry(async () => fetch(url, { method: "POST", headers: await this.headers({ "Content-Type": contentType, "x-upsert": "false" }), body: data }));
  if (!r.ok) throw new Error(`Upload to ${bucket}/${objectPath} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
};

/** Reports availability to the dashboard (worker_status). The accelerator column only allows gpu | cpu | unknown. */
export async function beat(db, cfg, { busy = false, jobId = null, message = "", model = MODEL_LABEL, ready = true } = {}) {
  await db.rpc("worker_heartbeat", {
    p_worker_name: cfg.name,
    p_model: model,
    p_model_ready: ready,
    p_model_message: message || (busy ? "Claude Code is analysing a job" : "Claude Code is available"),
    p_accelerator: "unknown",
    p_busy: busy,
    p_current_job: jobId,
    p_info: { runner: "tools/claude-worker" },
  });
}

// ---------------------------------------------------------------- files
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);

/** Files a job refers to: only what the job input names. */
export function filesOf(job) {
  const i = job.input || {};
  const out = [];
  if (i.bucket && i.path) out.push({ bucket: i.bucket, path: i.path, label: i.file_name || "sow", kind: "sow" });
  for (const a of [...(i.assets || []), ...(i.design_assets || [])]) {
    if (a.path) out.push({ bucket: a.bucket || "designs", path: a.path, label: a.screen_name || a.id, kind: "design", id: a.id, screen_type: a.screen_type });
  }
  return out;
}

/** Text of each PDF page. Pages with almost no text are flagged as scanned. */
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

// ---------------------------------------------------------------- validation (mirrors the Python worker's Pydantic models)
export const CATEGORIES = ["user_journey", "screen", "ui", "functional", "validation", "business_rule", "reward_logic", "api_integration", "legal", "performance", "security", "analytics", "deployment"];
export const PRIORITY = ["low", "medium", "high", "critical"];
export const CONFIDENCE = ["high", "medium", "low", "needs_manual_verification"];
export const SEVERITY = ["critical", "high", "medium", "low", "informational"];
export const CHECK = ["verified", "failed", "needs_verification", "not_tested", "blocked"];
const METHOD = ["visually_observed", "functionally_tested", "backend_verified", "manual"];
const BACKEND = new Set(["business_rule", "reward_logic", "api_integration", "security", "performance", "analytics", "deployment"]);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function quoteFound(quote, text) {
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

  const STAGING = ["design_vs_development", "functional_qa", "regression", "sow_vs_development"];
  if (STAGING.includes(type)) {
    const prefix = brief?.input?.capture_prefix || "";
    const keys = new Set((result.captures || []).map((x) => x.key));
    (result.captures || []).forEach((x, i) => { if (x.storage_path && !String(x.storage_path).startsWith(prefix)) errs.push(`captures[${i}].storage_path is outside this job's folder`); });
    (result.findings || []).forEach((f, i) => { if (f.capture_key && !keys.has(f.capture_key)) errs.push(`findings[${i}].capture_key does not match a capture`); });
    const caseIds = new Set((brief?.input?.test_cases || []).map((t) => String(t.id)));
    (result.test_results || []).forEach((t, i) => { if (!caseIds.has(String(t.test_case_id))) errs.push(`test_results[${i}].test_case_id is not a scenario of this job`); else oneOf(t.result, CHECK, `test_results[${i}].result`); });
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

// ---------------------------------------------------------------- job lifecycle
/** Claims the next job and downloads its files into a scratch folder. Returns the brief, or null when the queue is empty. */
export async function claimJob(db, cfg) {
  const job = await db.rpc("claim_review_job", { p_worker_name: cfg.name });
  if (!job) return null;
  const dir = path.join(WORK, job.id);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const maxScreens = job.input?.limits?.max_screens_per_review ?? 12;
    const screens = filesOf(job).filter((f) => f.kind === "design");
    if (screens.length > maxScreens) {
      throw new JobFailed(`Limit reached: ${screens.length} screens; the maximum per review is ${maxScreens}. Split the submission or raise the limit in Settings.`);
    }
    const files = [];
    for (const [n, f] of filesOf(job).entries()) {
      const buf = await db.download(f.bucket, f.path);
      const ext = path.extname(f.path) || "";
      const base = safe(f.label);
      const local = path.join(dir, `${String(n + 1).padStart(2, "0")}-${base}${base.endsWith(ext) ? "" : ext}`);
      fs.writeFileSync(local, buf);
      const entry = { ...f, local, name: path.basename(local), bytes: buf.length };
      if (f.kind === "sow") {
        try {
          const pages = await pdfPages(buf, job.input?.limits?.max_pdf_pages ?? 30);
          fs.writeFileSync(path.join(dir, "pages.json"), JSON.stringify(pages, null, 2));
          entry.pages = pages.length;
          entry.scanned_pages = pages.filter((p) => p.scanned).map((p) => p.page_no);
        } catch (e) {
          throw new JobFailed(e.message, { detail: { step: "extract text" } });
        }
      }
      files.push(entry);
    }
    const brief = { ...job, files, dir, claimed_at: new Date().toISOString(), worker_name: cfg.name };
    fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(brief, null, 2));
    return brief;
  } catch (e) {
    // Never leave a claimed job hanging: report it so the dashboard shows why.
    const jf = e instanceof JobFailed ? e : new JobFailed(`Could not prepare the job: ${e.message}`, { retryable: true });
    await failJob(db, cfg, job.id, jf.message, { retryable: jf.retryable, detail: jf.detail });
    throw jf;
  }
}

export async function completeJob(db, cfg, brief, result, meta = {}) {
  const problems = validate(result, brief);
  if (problems.length) throw new ResultRejected(problems);
  const started = brief?.claimed_at ? Date.parse(brief.claimed_at) : Date.now();
  const summary = await db.rpc("complete_review_job", {
    p_job: brief.id,
    p_result: result,
    p_meta: {
      prompt_version: meta.prompt_version || "claude-code-v1",
      model: meta.model || MODEL_LABEL,
      context_size: meta.context_size ?? null,
      duration_ms: meta.duration_ms ?? Date.now() - started,
      tokens_in: meta.tokens_in ?? null,
      tokens_out: meta.tokens_out ?? null,
    },
  });
  return summary;
}

export async function failJob(db, cfg, jobId, message, { retryable = true, detail = null } = {}) {
  return db.rpc("fail_review_job", { p_job: jobId, p_error: String(message).slice(0, 1900), p_detail: { runner: "claude-code", ...(detail || {}) }, p_retryable: retryable });
}
