/**
 * Live test: you give a staging URL and a list of steps in the dashboard, the connector runs them in a real browser on this PC,
 * and you watch (see live.mjs). A step can ASK you to type something mid-run (an OTP, a code): the run pauses until you answer.
 *
 * Everything stays on this PC. The state, the typed answers, the per-step pictures and the log are held in memory until the next
 * run starts; nothing is written to Supabase or to disk by the connector. Saving a scenario is a separate action done by the
 * browser with the user's own session.
 *
 * Rules, all the same as the staging reviews: every request goes through the network guard (allow-listed public hosts only, the
 * submitted site's own host allowed automatically), a CAPTCHA ends the run as "blocked" and is never bypassed, and anything you type
 * as a secret (an OTP, a password) is never put in the log, a picture or the live view.
 */
import { Browser, startFrames } from "./browser.mjs";
import { NetGuard } from "./netguard.mjs";
import { locateTarget } from "./locate.mjs";
import { live as sharedLive } from "./live.mjs";
import { DEVICE_BY_ID } from "./devices.mjs";

export class BadRequest extends Error {}

export const MAX_STEPS = 60;
export const MAX_BODY_BYTES = 200_000;
const RUN_LIMIT_MS = 20 * 60_000;
const ASK_LIMIT_MS = 5 * 60_000;
const STEP_TIMEOUT_MS = 15_000;
const ACTIONS = new Set(["fill", "click", "select", "check", "goto", "expect_text", "expect_visible", "expect_url", "wait", "ask"]);
const CAPTCHA = /recaptcha|hcaptcha|turnstile/i;

const str = (v, max) => String(v ?? "").slice(0, max);
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]{1,40})\s*\}\}/g;

/** The names of the {{placeholders}} used by a list of steps. */
export function placeholdersOf(steps) {
  const names = new Set();
  for (const s of steps) for (const t of [s.target, s.value]) for (const m of String(t ?? "").matchAll(PLACEHOLDER)) names.add(m[1]);
  return [...names];
}

/** Checks and cleans what the dashboard sent. Throws BadRequest with a message a person can act on. */
export function parseSpec(body) {
  let url;
  try { url = new URL(str(body?.url, 2000)); } catch { throw new BadRequest("Enter the staging URL, starting with https://"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new BadRequest("The URL must start with http:// or https://");
  const device = DEVICE_BY_ID.has(body?.device) ? body.device : "desktop";
  const raw = Array.isArray(body?.steps) ? body.steps : [];
  if (raw.length > MAX_STEPS) throw new BadRequest(`That is ${raw.length} steps; the limit is ${MAX_STEPS}.`);
  const steps = raw.map((s, i) => {
    const action = String(s?.action ?? "");
    if (!ACTIONS.has(action)) throw new BadRequest(`Step ${i + 1}: unknown action "${action.slice(0, 30)}".`);
    const step = { action, target: str(s.target, 500), value: s.value == null ? "" : str(s.value, 1000), secret: Boolean(s.secret) };
    if (action === "ask" && (!step.target.trim() || !step.value.trim())) throw new BadRequest(`Step ${i + 1}: "Ask me to type" needs what to ask and which field to fill.`);
    if (["fill", "click", "select", "check", "expect_text", "expect_visible", "expect_url", "goto"].includes(action) && !step.target.trim()) throw new BadRequest(`Step ${i + 1}: ${action} needs a target.`);
    return step;
  });
  const inputs = {};
  for (const [k, v] of Object.entries(body?.inputs && typeof body.inputs === "object" ? body.inputs : {}).slice(0, 30)) {
    inputs[str(k, 40)] = { value: str(v?.value, 500), secret: Boolean(v?.secret) };
  }
  const missing = placeholdersOf(steps).filter((n) => !(n in inputs) || inputs[n].value === "");
  if (missing.length) throw new BadRequest(`Enter a value for ${missing.map((m) => `{{${m}}}`).join(", ")} before starting.`);
  const allowed = (Array.isArray(body?.allowed_domains) ? body.allowed_domains : []).map((d) => str(d, 200)).filter(Boolean).slice(0, 100);
  return { url: url.toString(), device, steps, inputs, allowed: [...new Set([...allowed, url.hostname.toLowerCase()])] };
}

const sub = (text, inputs) => String(text ?? "").replace(PLACEHOLDER, (_, n) => inputs[n]?.value ?? "");
/** What the log shows for a step: placeholders stay as {{name}}, so a typed value is never printed. */
const shown = (text) => String(text ?? "");

/** A failed step in words a tester would use, not Playwright's. */
export function friendlyError(step, e, inputs = {}) {
  const raw = String(e?.message ?? e).split("\n")[0].replace(/\u001b\[[0-9;]*m/g, "");
  const t = sub(step.target, inputs).slice(0, 80);
  const secs = Math.round(STEP_TIMEOUT_MS / 1000);
  if (/Timeout|exceeded/i.test(raw)) {
    if (step.action === "expect_text" || step.action === "expect_visible") return `"${t}" did not appear within ${secs} seconds.`;
    if (step.action === "expect_url") return `The address did not contain "${t}" within ${secs} seconds.`;
    if (["fill", "click", "select", "check", "ask"].includes(step.action)) return `Could not find "${step.action === "ask" ? sub(step.value, inputs).slice(0, 80) : t}" on the page within ${secs} seconds.`;
  }
  return raw.slice(0, 300);
}

export function createLiveTest({ live = sharedLive, openBrowser = (guard) => new Browser(guard).open(), makeGuard = (allowed) => new NetGuard(allowed), now = () => Date.now(), onEnd = () => {} } = {}) {
  let run = null; // the current or last run
  let abort = null;
  const listeners = [];

  const blank = () => ({ status: "idle" });

  const publicStep = (s) => ({ i: s.i, action: s.action, target: s.secretTarget ? "(hidden)" : shown(s.target), value: s.action === "ask" ? s.value : s.secret ? "(hidden)" : shown(s.value), status: s.status, note: s.note, ms: s.ms, hasShot: Boolean(s.shot), secret: Boolean(s.secret) });

  const api = {
    /** True until the run has fully finished, browser closed and live view cleared, so a new one never overlaps it. */
    active: () => Boolean(run && !run.finishedAt),

    state() {
      if (!run) return blank();
      return { runId: run.id, status: run.status, url: run.url, device: run.device, deviceLabel: DEVICE_BY_ID.get(run.device)?.label ?? run.device, startedAt: run.startedAt, finishedAt: run.finishedAt ?? null,
        steps: run.steps.map(publicStep), console: run.console.slice(-100), failed: run.failed.slice(-100), prompt: run.prompt ? { id: run.prompt.id, label: run.prompt.label, secret: run.prompt.secret } : null, error: run.error ?? null };
    },

    shot: (i) => run?.steps[i]?.shot ?? null,

    start(body) {
      if (api.active()) throw new BadRequest("A live test is already running. Stop it first.");
      const spec = parseSpec(body);
      const id = `lt-${now().toString(36)}`;
      run = { id, ...spec, status: "running", startedAt: now(), console: [], failed: [], prompt: null, error: null,
        steps: [{ i: 0, action: "goto", target: spec.url, value: "", status: "pending", note: "Open the page" }, ...spec.steps.map((s, k) => ({ i: k + 1, ...s, status: "pending", note: "" }))] };
      abort = new AbortController();
      const mine = run;
      void execute(mine, abort.signal).catch((e) => { mine.status = "failed"; mine.error = String(e.message ?? e).split("\n")[0].slice(0, 300); }).finally(() => {
        mine.finishedAt = now(); live.end(); onEnd(); for (const f of listeners) f();
      });
      return { runId: id };
    },

    answer({ promptId, value }) {
      if (!run?.prompt || run.prompt.id !== promptId) throw new BadRequest("Nothing is waiting for an answer.");
      const p = run.prompt; run.prompt = null;
      p.resolve(str(value, 500));
    },

    stop() { if (api.active()) abort?.abort(); },

    /** Called when a run ends, so the queue of reviews can carry on. */
    onFinish(fn) { listeners.push(fn); },
  };

  async function execute(r, signal) {
    const guard = makeGuard(r.allowed);
    r.guard = guard;
    const browser = await openBrowser(guard);
    let stopFrames = () => {};
    const deadline = now() + RUN_LIMIT_MS;
    try {
      const ctx = await browser.newContext(r.device);
      const page = await ctx.newPage();
      Browser.attachListeners(page, r.console, r.failed);
      page.setDefaultTimeout(STEP_TIMEOUT_MS);
      live.start({ jobId: r.id, type: "live_test" });
      live.where({ url: r.url, device: DEVICE_BY_ID.get(r.device)?.label ?? r.device });
      stopFrames = startFrames(page, { everyMs: 400 });
      let failedAt = -1;
      let outcome = null; // the run only reports its final status once every step has been marked

      for (const s of r.steps) {
        if (failedAt >= 0) { s.status = "skipped"; continue; }
        if (signal.aborted) { s.status = "skipped"; failedAt = s.i; outcome = "stopped"; continue; }
        if (now() > deadline) { s.status = "failed"; s.note = "The 20 minute limit for one live test was reached."; failedAt = s.i; outcome = "failed"; continue; }
        s.status = "running";
        const t0 = now();
        // A secret value is never shown: the picture is paused and no step picture is kept while it is typed.
        const secretStep = s.action === "ask" ? s.secret : s.action === "fill" && (s.secret || [...String(s.value).matchAll(PLACEHOLDER)].some((m) => r.inputs[m[1]]?.secret));
        if (secretStep && s.action !== "ask") live.pause(true); // an ask step keeps the picture while it waits for you, and pauses only while your answer is typed in
        live.step(`Step ${s.i}: ${s.action}${s.action === "ask" ? "" : ` ${shown(s.target).slice(0, 60)}`}`);
        try {
          const out = await doStep(page, s, r, signal);
          if (out === "blocked") { s.status = "failed"; s.note = "A CAPTCHA is in the way. It is never bypassed: solve it by hand, or turn it off on staging."; outcome = "blocked"; failedAt = s.i; }
          else { s.status = "passed"; }
        } catch (e) {
          if (signal.aborted) { s.status = "failed"; s.note = "Stopped."; outcome = "stopped"; }
          else { s.status = "failed"; s.note = friendlyError(s, e, r.inputs); }
          failedAt = s.i;
        }
        s.ms = now() - t0;
        if (!secretStep) {
          try { s.shot = await page.screenshot({ type: "jpeg", quality: 60, timeout: 3000 }); } catch { /* the page may be navigating */ }
        }
        if (secretStep) setTimeout(() => live.pause(false), 1200);
      }
      r.status = outcome ?? (failedAt >= 0 ? "failed" : "passed");
    } finally {
      stopFrames();
      live.pause(false);
      await browser.close().catch(() => undefined);
      if (r.prompt) { r.prompt.resolve(null); r.prompt = null; }
    }
  }

  async function doStep(page, s, r, signal) {
    const target = sub(s.target, r.inputs);
    const a = s.action;
    if (s.i === 0 || a === "goto") {
      const url = s.i === 0 ? r.url : new URL(target.replace(/^\//, ""), r.url).toString();
      const { ok, why } = await makeGuardCheck(r, url);
      if (!ok) throw new Error(`Refusing to open ${url}: ${why}`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      try { await page.waitForLoadState("networkidle", { timeout: 8000 }); } catch { /* a busy page is still usable */ }
      return CAPTCHA.test(await page.content()) ? "blocked" : "ok";
    }
    if (a === "fill") { await (await locateTarget(page, target, "fill")).fill(sub(s.value, r.inputs)); return "ok"; }
    if (a === "click") { await (await locateTarget(page, target, "click")).click(); return "ok"; }
    if (a === "select") { await (await locateTarget(page, target, "fill")).selectOption({ label: sub(s.value, r.inputs) }); return "ok"; }
    if (a === "check") { await (await locateTarget(page, target, "check")).check(); return "ok"; }
    if (a === "expect_text") { await page.getByText(target, { exact: false }).first().waitFor({ state: "visible" }); return "ok"; }
    if (a === "expect_visible") { await (await locateTarget(page, target, "visible")).waitFor({ state: "visible" }); return "ok"; }
    if (a === "expect_url") { await page.waitForURL((u) => u.toString().includes(target)); return "ok"; }
    if (a === "wait") { await page.waitForTimeout(Math.min(10_000, Number(target || 1000))); return "ok"; }
    if (a === "ask") {
      const typed = await ask(r, s, signal);
      if (typed == null) throw new Error(signal.aborted ? "Stopped." : "Nobody answered in 5 minutes, so the test stopped.");
      if (s.secret) live.pause(true);
      await (await locateTarget(page, sub(s.value, r.inputs), "fill")).fill(typed);
      s.note = s.secret ? "You typed a value (hidden)." : "You typed a value.";
      return "ok";
    }
    throw new Error(`Unknown action ${a}`);
  }

  const makeGuardCheck = (r, url) => r.guard.check(url);

  function ask(r, s, signal) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { r.prompt = null; resolve(null); }, ASK_LIMIT_MS);
      const done = (v) => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); if (r.status === "asking") r.status = "running"; if (s.status === "asking") s.status = "running"; resolve(v); };
      const onAbort = () => { r.prompt = null; done(null); };
      signal.addEventListener("abort", onAbort);
      r.prompt = { id: `p${s.i}`, label: sub(s.target, r.inputs).slice(0, 300), secret: s.secret, resolve: done };
      r.status = "asking"; s.status = "asking";
      live.step(`Waiting for you: ${r.prompt.label.slice(0, 80)}`);
    });
  }

  return api;
}

export const liveTest = createLiveTest();
