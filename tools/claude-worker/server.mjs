#!/usr/bin/env node
/**
 * CampaignOS Claude connector.
 *
 * A small local program that lets the dashboard use Claude Code on this PC. Start it with `npm run claude`.
 * - Binds to 127.0.0.1 only. It exposes GET /status, POST /wake (no data), the read-only live view (GET /live, GET /live/frame),
 *   and the assistant and playground endpoints.
 * - Only dashboard origins may call it (localhost dev server, plus CLAUDE_CONNECTOR_ORIGINS), and the Host header must be localhost.
 * - It does not trust the browser for anything. It signs in as the `worker` user, claims jobs from Supabase
 *   (so database permissions, history and the duplicate guard all still apply), runs Claude Code on them,
 *   and writes validated results back through complete_review_job.
 * - It also polls every 30 seconds, so a review is never missed even if /wake did not arrive.
 */
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Supabase, beat, claimJob, completeJob, config, failJob, JobFailed, ResultRejected } from "./core.mjs";
import { analyse, SUPPORTED } from "./runner.mjs";
import { assistantTurn, BadRequest, MAX_BODY_BYTES } from "./assistant.mjs";
import { MAX_PLAYGROUND_BYTES, playgroundCheck } from "./playground.mjs";
import { live as sharedLive } from "./live.mjs";
import { sessions as sharedSessions, SessionError } from "./browsersession.mjs";
import { runApiCheck, ApiCheckError } from "./apirunner.mjs";
import { NetGuard } from "./netguard.mjs";
import { liveTest as sharedLiveTest, BadRequest as LiveTestBadRequest, MAX_BODY_BYTES as LIVETEST_BYTES } from "./livetest.mjs";

const DEFAULT_ORIGINS = ["http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173", "http://127.0.0.1:5174"];
const HOST_OK = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;

export function createConnector({ cfg, db, analyseJob = analyse, claimNext = claimJob, assistant = assistantTurn, playground = playgroundCheck, claude = { ok: true, version: "" }, live = sharedLive, liveTest = sharedLiveTest, sessions = sharedSessions, apiGuard = (hosts) => new NetGuard(hosts), log = console.log }) {
  const origins = new Set([...DEFAULT_ORIGINS, ...cfg.origins]);
  const state = { busy: false, job: null, last: null, startedAt: new Date().toISOString() };
  let draining = false, again = false, timer = null, hb = null, assistantBusy = false, playgroundBusy = false;

  const note = (s) => { if (state.job) state.job.step = s; live.step(s); };

  async function runOne(brief) {
    state.busy = true;
    state.job = { id: brief.id, type: brief.review_type, startedAt: new Date().toISOString(), step: "Starting" };
    live.start({ jobId: brief.id, type: brief.review_type });
    live.step("Starting");
    log(`[job ${brief.id.slice(0, 8)}] ${brief.review_type} started`);
    const ac = new AbortController();
    hb = setInterval(async () => {
      try {
        const r = await db.rpc("heartbeat_job", { p_job: brief.id });
        await beat(db, cfg, { busy: true, jobId: brief.id });
        if (r?.cancel_requested) ac.abort();
      } catch (e) { log(`heartbeat failed: ${e.message}`); }
    }, 30_000);
    try {
      await beat(db, cfg, { busy: true, jobId: brief.id });
      const { result, meta } = await analyseJob(brief, { model: cfg.model, timeoutMs: cfg.jobTimeoutMs, signal: ac.signal, onStep: note, db });
      note("Saving results");
      const summary = await completeJob(db, cfg, brief, result, meta);
      state.last = { id: brief.id, type: brief.review_type, status: summary?.status === "cancelled" ? "cancelled" : "completed", at: new Date().toISOString(), summary };
      log(`[job ${brief.id.slice(0, 8)}] done ${JSON.stringify(summary)}`);
    } catch (e) {
      const cancelled = e instanceof JobFailed && e.detail?.cancelled;
      const message = e instanceof ResultRejected ? `Claude's answer failed validation twice: ${e.problems.slice(0, 5).join("; ")}` : e.message;
      try {
        await failJob(db, cfg, brief.id, message, {
          retryable: e instanceof JobFailed ? e.retryable : false,
          detail: e instanceof ResultRejected ? { problems: e.problems.slice(0, 40) } : e.detail,
        });
      } catch (e2) { log(`could not report failure: ${e2.message}`); }
      state.last = { id: brief.id, type: brief.review_type, status: cancelled ? "cancelled" : "failed", at: new Date().toISOString(), error: message };
      log(`[job ${brief.id.slice(0, 8)}] ${cancelled ? "cancelled" : "failed"}: ${message}`);
    } finally {
      clearInterval(hb);
      live.end(); // the picture and the steps are forgotten with the job
      state.busy = false;
      state.job = null;
      try { await beat(db, cfg, { busy: false }); } catch { /* next poll retries */ }
    }
  }

  /** Claims and runs jobs one at a time until the queue is empty. Safe to call at any moment. */
  async function drain() {
    if (draining) { again = true; return; }
    draining = true;
    try {
      do {
        again = false;
        for (;;) {
          if (liveTest.active()) break; // a live test owns the browser; the queue resumes when it ends
          let brief;
          try { brief = await claimNext(db, cfg); } catch (e) {
            if (e instanceof JobFailed) {
              // The job was claimed but could not be prepared (bad file, limit). It is already reported as failed: carry on with the next one.
              state.last = { id: e.jobId || "", type: "", status: "failed", at: new Date().toISOString(), error: e.message };
              log(`job could not be prepared: ${e.message}`);
              continue;
            }
            log(`claim failed: ${e.message}`);
            break;
          }
          if (!brief) break;
          await runOne(brief);
        }
      } while (again);
    } finally { draining = false; }
  }

  liveTest.onFinish?.(() => void drain());

  function handle(req, res) {
    const origin = req.headers.origin;
    const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json", ...cors }); res.end(JSON.stringify(body)); };
    const cors = {};
    if (!HOST_OK.test(req.headers.host || "")) { res.writeHead(403); return res.end(); } // blocks DNS-rebinding
    if (origin) {
      if (!origins.has(origin)) { res.writeHead(403); return res.end(); }
      Object.assign(cors, {
        "Access-Control-Allow-Origin": origin, Vary: "Origin",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "600",
      });
    }
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/status") {
      return json(200, { connector: "claude-code", claude, model: cfg.model, supports: SUPPORTED, assistant: true, playground: true, busy: state.busy, job: state.job, last: state.last, startedAt: state.startedAt });
    }
    // Live view of the running job: read-only, in memory, cleared when the job ends.
    if (req.method === "GET" && url.pathname === "/live") return json(200, live.state());
    if (req.method === "GET" && url.pathname === "/live/frame") {
      const f = live.frame();
      if (!f) { res.writeHead(204, { ...cors, "Cache-Control": "no-store" }); return res.end(); }
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": f.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors });
      return res.end(f);
    }
    // The interactive browser: a real Chromium page, streamed to the dashboard, with mouse and keyboard relayed back. Every call but /presets needs the
    // session's own token, on top of the origin and Host checks above. See browsersession.mjs.
    if (url.pathname.startsWith("/browser/")) {
      const fail = (e) => {
        if (e instanceof SessionError || e instanceof BadRequest) return json({ no_session: 404, locked: 409, unavailable: 409 }[e.code] ?? 400, { error: e.message, code: e.code ?? "bad_request" });
        log(`browser request failed: ${e.message}`);
        return json(500, { error: "The preview failed. Check the connector window." });
      };
      const token = url.searchParams.get("token") ?? "";
      const sub = url.pathname.slice("/browser/".length);
      try {
        if (req.method === "GET" && sub === "presets") return json(200, sessions.presets());
        if (req.method === "GET" && sub === "embeddable") {
          sessions.checkEmbeddable(url.searchParams.get("url") ?? "", (url.searchParams.get("allowed") ?? "").split(",").filter(Boolean), origin ?? "").then((r) => json(200, r)).catch(fail);
          return;
        }
        if (req.method === "GET" && sub === "stream") {
          sessions.state(token); // 404 for a wrong token, before any stream starts
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", ...cors });
          res.write("retry: 3000\n\n");
          let lastFrame = 0, timer = null, pending = null;
          const sendFrame = (buf) => { lastFrame = Date.now(); res.write(`event: frame\ndata: ${buf.toString("base64")}\n\n`); };
          const unsub = sessions.subscribe(token, (kind, payload) => {
            if (kind === "frame") { // at most about 14 pictures a second; the newest one always wins
              const wait = 70 - (Date.now() - lastFrame);
              if (wait <= 0) { pending = null; sendFrame(payload); } else { pending = payload; timer ??= setTimeout(() => { timer = null; if (pending) { const p = pending; pending = null; sendFrame(p); } }, wait); }
              return;
            }
            res.write(`event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`);
          });
          const keep = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
          req.on("close", () => { unsub(); clearInterval(keep); clearTimeout(timer); });
          return;
        }
        if (req.method === "GET" && sub === "log") return json(200, sessions.log(token, Number(url.searchParams.get("since")) || 0, { netAll: url.searchParams.get("net") === "all" }));
        if (req.method === "GET" && sub === "shot") {
          const buf = sessions.shot(token, url.searchParams.get("id"));
          if (!buf) { res.writeHead(404, { ...cors, "Cache-Control": "no-store" }); return res.end(); }
          res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": buf.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors });
          return res.end(buf);
        }
        if (req.method === "POST" && ["open", "command", "input"].includes(sub)) {
          if (Number(req.headers["content-length"] || 0) > 60_000) { res.setHeader("Connection", "close"); return json(413, { error: "Request is too large." }); }
          if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(415, { error: "Send JSON." });
          readBody(req, 60_000).then(async (body) => {
            if (sub === "open") return json(200, await sessions.open({ ...(body ?? {}), allowed: Array.isArray(body?.allowed) ? body.allowed : Array.isArray(body?.allowed_domains) ? body.allowed_domains : [], campaign: body?.campaign ?? { id: body?.campaign_id, name: body?.campaign_name }, credentials: body?.credentials ?? null }));
            const tk = String(body?.token ?? "");
            if (sub === "input") { await sessions.input(tk, body); return json(200, { ok: true }); }
            switch (body?.type) {
              case "navigate": return json(200, await sessions.navigate(tk, body.url));
              case "selection": return json(200, await sessions.selection(tk));
              case "reload": return json(200, await sessions.reload(tk));
              case "back": return json(200, await sessions.back(tk));
              case "forward": return json(200, await sessions.forward(tk));
              case "device": return json(200, await sessions.setDevice(tk, String(body.device ?? "")));
              case "capture": return json(200, await sessions.capture(tk, typeof body.note === "string" ? body.note.slice(0, 200) : undefined));
              case "close": await sessions.close(tk, "You closed the preview."); return json(200, { ok: true });
              default: throw new BadRequest("Unknown command.");
            }
          }).catch(fail);
          return;
        }
      } catch (e) { return fail(e); }
      return json(404, { error: "Not found" });
    }
    // API checks: one request to a staging endpoint, asserted without a browser or a model. Same network rules as every test.
    if (req.method === "POST" && url.pathname === "/apitest/run") {
      if (Number(req.headers["content-length"] || 0) > 150_000) { res.setHeader("Connection", "close"); return json(413, { error: "Request is too large." }); }
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(415, { error: "Send JSON." });
      readBody(req, 150_000).then(async (body) => {
        const request = body?.request ?? body;
        let host = ""; try { host = new URL(String(request?.url ?? "")).hostname.toLowerCase(); } catch { /* parseRequest explains it */ }
        const allowed = [...new Set([...(Array.isArray(body?.allowed_domains) ? body.allowed_domains.map(String) : []), host].filter(Boolean))];
        return json(200, await runApiCheck(request, { guard: apiGuard(allowed) }));
      }).catch((e) => (e instanceof ApiCheckError || e instanceof BadRequest) ? json(400, { error: e.message, code: e.code ?? "bad_request" }) : (log(`api check failed: ${e.message}`), json(500, { error: "The API check failed. Check the connector window." })));
      return;
    }
    // Live test: a run you start and watch from the dashboard. One at a time, and never while a queued job is running.
    if (req.method === "GET" && url.pathname === "/livetest") return json(200, liveTest.state(url.searchParams.get("run") || undefined));
    if (req.method === "GET" && url.pathname === "/livetest/runs") return json(200, liveTest.runs());
    if (req.method === "GET" && url.pathname.startsWith("/livetest/shot/")) {
      const f = liveTest.shot(Number(url.pathname.split("/").pop()), url.searchParams.get("run") || undefined);
      if (!f) { res.writeHead(204, { ...cors, "Cache-Control": "no-store" }); return res.end(); }
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": f.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors });
      return res.end(f);
    }
    if (req.method === "POST" && ["/livetest/start", "/livetest/answer", "/livetest/stop"].includes(url.pathname)) {
      if (Number(req.headers["content-length"] || 0) > LIVETEST_BYTES) { res.setHeader("Connection", "close"); return json(413, { error: "Request is too large." }); }
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(415, { error: "Send JSON." });
      readBody(req, LIVETEST_BYTES).then((body) => {
        if (url.pathname === "/livetest/stop") { liveTest.stop(); return json(200, { ok: true }); }
        if (url.pathname === "/livetest/answer") { liveTest.answer(body ?? {}); return json(200, { ok: true }); }
        if (state.busy) return json(409, { error: "A review is running on this PC right now. Try again when it finishes." });
        return json(202, liveTest.start(body ?? {}));
      }).catch((e) => {
        if (e instanceof LiveTestBadRequest || e instanceof BadRequest) return json(400, { error: e.message });
        log(`live test request failed: ${e.message}`);
        json(500, { error: "The live test could not start. Check the connector window." });
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/assistant") {
      // One assistant turn at a time. Review jobs run separately, so a long review never blocks a quick question.
      if (Number(req.headers["content-length"] || 0) > MAX_BODY_BYTES) { res.setHeader("Connection", "close"); return json(413, { error: "Request is too large." }); }
      if (assistantBusy) return json(429, { error: "Claude is still answering the previous message." });
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(415, { error: "Send JSON." });
      assistantBusy = true;
      const ac = new AbortController();
      res.on("close", () => { if (!res.writableEnded) ac.abort(); }); // browser went away: stop the model call
      readBody(req, MAX_BODY_BYTES).then((body) => assistant(body, { model: cfg.assistantModel || cfg.model, signal: ac.signal }))
        .then((out) => json(200, out))
        .catch((e) => {
          if (e instanceof BadRequest) return json(400, { error: e.message });
          log(`assistant failed: ${e.message}`);
          json(e instanceof JobFailed ? 502 : 500, { error: e instanceof JobFailed ? e.message : "The assistant failed. Check the connector window." });
        })
        .finally(() => { assistantBusy = false; });
      return;
    }
    if (req.method === "POST" && url.pathname === "/playground") {
      // Files and URLs the user dropped on the Playground. Nothing is stored; one check at a time.
      if (Number(req.headers["content-length"] || 0) > MAX_PLAYGROUND_BYTES) { res.setHeader("Connection", "close"); return json(413, { error: "That is too much to check at once (limit about 45 MB). Remove some files." }); }
      if (playgroundBusy) return json(429, { error: "Claude is still working on the previous playground check." });
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(415, { error: "Send JSON." });
      playgroundBusy = true;
      const ac = new AbortController();
      res.on("close", () => { if (!res.writableEnded) ac.abort(); });
      readBody(req, MAX_PLAYGROUND_BYTES).then((body) => playground(body, { model: cfg.assistantModel || cfg.model, signal: ac.signal }))
        .then((out) => json(200, out))
        .catch((e) => {
          if (e instanceof BadRequest) return json(400, { error: e.message });
          log(`playground failed: ${e.message}`);
          json(e instanceof JobFailed ? 502 : 500, { error: e instanceof JobFailed ? e.message : "The playground check failed. Check the connector window." });
        })
        .finally(() => { playgroundBusy = false; });
      return;
    }
    if (req.method === "POST" && url.pathname === "/wake") {
      void drain();
      return json(202, { accepted: true, busy: state.busy });
    }
    return json(404, { error: "Not found" });
  }

  const server = http.createServer(handle);
  return {
    server, state, drain,
    async start() {
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(cfg.port, "127.0.0.1", resolve); });
      timer = setInterval(async () => {
        if (!state.busy) { try { await beat(db, cfg, { busy: false }); } catch (e) { log(`heartbeat failed: ${e.message}`); } }
        void drain();
      }, cfg.pollMs);
      void drain();
    },
    async stop() { clearInterval(timer); clearInterval(hb); await sessions.closeAll().catch(() => undefined); await new Promise((r) => server.close(r)); },
  };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new BadRequest("Request is too large.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new BadRequest("Invalid JSON.")); } });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------- main
function claudeInfo() {
  const r = spawnSync("claude", ["--version"], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? { ok: true, version: r.stdout.trim() } : { ok: false, version: "" };
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const log = (m) => console.log(`${new Date().toLocaleTimeString()}  ${m}`);
  let cfg;
  try { cfg = config(); } catch (e) { console.error(`ERROR: ${e.message}`); process.exit(1); }
  const claude = claudeInfo();
  if (!claude.ok) { console.error("ERROR: the `claude` command was not found. Install Claude Code and sign in, then try again."); process.exit(1); }
  const db = new Supabase(cfg);
  try { await db.signIn(); await beat(db, cfg, { busy: false }); } catch (e) { console.error(`ERROR: ${e.message}`); process.exit(1); }
  const c = createConnector({ cfg, db, claude, log });
  try { await c.start(); } catch (e) {
    console.error(e.code === "EADDRINUSE" ? `ERROR: port ${cfg.port} is already in use. Is the connector already running?` : `ERROR: ${e.message}`);
    process.exit(1);
  }
  log(`Claude connector running on http://127.0.0.1:${cfg.port}  (${claude.version}, model: ${cfg.model})`);
  log(`Signed in as ${cfg.email}. Reviews started in the dashboard are analysed by Claude Code on this PC. Press Ctrl+C to stop.`);
  const bye = async () => { try { await beat(db, cfg, { busy: false, message: "Claude connector stopped", ready: false }); } catch { /* offline */ } process.exit(0); };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
}
