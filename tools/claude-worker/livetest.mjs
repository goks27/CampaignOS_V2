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
import os from "node:os";
import { Browser, startFrames, settle } from "./browser.mjs";
import { JobFailed } from "./core.mjs";
import { siteCheck } from "./sitecheck.mjs";
import { sessions as sharedSessions } from "./browsersession.mjs";
import { signIn, parseExtras } from "./login.mjs";
import { NetGuard } from "./netguard.mjs";
import { locateTarget } from "./locate.mjs";
import { live as sharedLive } from "./live.mjs";
import { DEVICE_BY_ID } from "./devices.mjs";

export class BadRequest extends Error {}

export const MAX_STEPS = 60;
export const MAX_BODY_BYTES = 200_000;
export const HISTORY = 15; // finished runs kept in memory, newest first
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
/**
 * The automatic run: just a URL (and the login details if the site needs them). It opens every page on every device, signs in the same
 * way on each, and reports per device. The login details stay in memory for the run and are never shown or kept.
 */
function parseAuto(body) {
  let url;
  try { url = new URL(str(body?.url, 2000)); } catch { throw new BadRequest("Enter the staging URL, starting with https://"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new BadRequest("The URL must start with http:// or https://");
  const c = body?.credentials ?? {};
  const creds = { username: str(c.username, 300), password: str(c.password, 300), extra: str(c.extra, 2000) };
  if ((creds.username && !creds.password) || (!creds.username && creds.password)) throw new BadRequest("Enter both the username and the password, or neither.");
  const allowed = (Array.isArray(body?.allowed_domains) ? body.allowed_domains : []).map((d) => str(d, 200)).filter(Boolean).slice(0, 100);
  const maxPages = Math.max(1, Math.min(30, Number(body?.max_pages) || 10));
  // Every device by default. A list of device ids narrows it (used by tests and by anything that really wants fewer).
  const deviceIds = Array.isArray(body?.devices) ? body.devices.map(String).filter((id) => DEVICE_BY_ID.has(id)).slice(0, 10) : [];
  return { mode: "auto", deviceIds, url: url.toString(), device: "All devices", steps: [], inputs: {}, creds, maxPages, campaign: { id: str(body?.campaign_id, 60), name: str(body?.campaign_name, 120) },
    allowed: [...new Set([...allowed, url.hostname.toLowerCase()])] };
}

export function parseSpec(body) {
  if (body?.mode === "auto") return parseAuto(body);
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
  const campaign = { id: str(body?.campaign_id, 60), name: str(body?.campaign_name, 120) };
  return { url: url.toString(), device, steps, inputs, campaign, sessionToken: str(body?.session_token, 100), allowed: [...new Set([...allowed, url.hostname.toLowerCase()])] };
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

export function createLiveTest({ live = sharedLive, sessions = sharedSessions, openBrowser = (guard, httpCredentials) => new Browser(guard, httpCredentials).open(), makeGuard = (allowed) => new NetGuard(allowed), now = () => Date.now(), onEnd = () => {} } = {}) {
  let run = null; // the current or last run
  const history = []; // newest first; includes the current run. Held in memory only: it is gone when the connector restarts.
  let abort = null;
  const listeners = [];

  const blank = () => ({ status: "idle" });
  const pick = (id) => (id ? history.find((h) => h.id === id) ?? null : run);

  const publicStep = (s) => ({ i: s.i, action: s.action, target: s.secretTarget ? "(hidden)" : shown(s.target), value: s.action === "ask" ? s.value : s.secret ? "(hidden)" : shown(s.value), status: s.status, note: s.note, ms: s.ms, hasShot: Boolean(s.shot), secret: Boolean(s.secret) });

  const api = {
    /** True until the run has fully finished, browser closed and live view cleared, so a new one never overlaps it. */
    active: () => Boolean(run && !run.finishedAt),

    /** One run in full: the current one, or an earlier one by id. */
    state(id) {
      const r = pick(id);
      if (!r) return blank();
      return { mode: r.mode ?? "script", auto: r.auto ?? null, runId: r.id, status: r.status, url: r.url, device: r.device, deviceLabel: DEVICE_BY_ID.get(r.device)?.label ?? r.device, campaignId: r.campaign.id, campaignName: r.campaign.name, startedAt: r.startedAt, finishedAt: r.finishedAt ?? null,
        steps: r.steps.map(publicStep), console: r.console.slice(-100), failed: r.failed.slice(-100), prompt: r.prompt ? { id: r.prompt.id, label: r.prompt.label, secret: r.prompt.secret, skippable: Boolean(r.prompt.skippable) } : null, error: r.error ?? null };
    },

    /** The recent runs, newest first, without their steps. */
    runs() {
      return history.map((r) => ({ runId: r.id, status: r.status, url: r.url, deviceLabel: DEVICE_BY_ID.get(r.device)?.label ?? r.device, campaignId: r.campaign.id, campaignName: r.campaign.name, startedAt: r.startedAt, finishedAt: r.finishedAt ?? null,
        passed: r.steps.filter((s) => s.status === "passed").length, total: r.steps.length }));
    },

    shot: (i, id) => pick(id)?.steps[i]?.shot ?? null,

    start(body) {
      if (api.active()) throw new BadRequest("A live test is already running. Stop it first.");
      const spec = parseSpec(body);
      if (spec.mode !== "auto" && spec.sessionToken) {
        let st;
        try { st = sessions.state(spec.sessionToken); } catch { throw new BadRequest("The preview is no longer open. Open it again, then run the steps."); }
        if (st.locked) throw new BadRequest("A test is already running in that browser.");
        spec.device = `${sessions.presets().find((p) => p.id === st.device)?.label ?? st.device} (this browser)`;
      }
      const id = `lt-${now().toString(36)}`;
      run = { id, ...spec, status: "running", startedAt: now(), console: [], failed: [], prompt: null, error: null,
        steps: spec.mode === "auto" ? [] : [{ i: 0, action: "goto", target: spec.url, value: "", status: "pending", note: "Open the page" }, ...spec.steps.map((s, k) => ({ i: k + 1, ...s, status: "pending", note: "" }))],
        auto: spec.mode === "auto" ? { devices: [], findings: [], errors: [], pages: 0, login: null, summary: null } : null };
      history.unshift(run);
      for (let k = history.length - 1; k >= HISTORY && !(history[k].finishedAt == null); k--) history.splice(k, 1); // never drop a run that is still going
      abort = new AbortController();
      const mine = run;
      void execute(mine, abort.signal).catch((e) => { mine.status = "failed"; mine.error = String(e.message ?? e).split("\n")[0].slice(0, 300); }).finally(() => {
        mine.finishedAt = now(); live.end(); onEnd(); for (const f of listeners) f();
      });
      return { runId: id };
    },

    answer({ promptId, value, skip }) {
      if (!run?.prompt || run.prompt.id !== promptId) throw new BadRequest("Nothing is waiting for an answer.");
      if (skip && !run.prompt.skippable) throw new BadRequest("This question cannot be skipped.");
      const p = run.prompt; run.prompt = null;
      p.resolve(skip ? "" : str(value, 500));
    },

    stop() { if (api.active()) abort?.abort(); },

    /** Called when a run ends, so the queue of reviews can carry on. */
    onFinish(fn) { listeners.push(fn); },
  };


  /** Runs the steps on a page, marking each one, and sets the run's final status. `hooks` lets the open preview supply its own way to hide the picture. */
  async function runSteps(page, r, signal, { pause = (on) => live.pause(on), say = (t) => live.step(t), onStepFail = () => {} } = {}) {
    const deadline = now() + RUN_LIMIT_MS;
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
        if (secretStep && s.action !== "ask") pause(true); // an ask step keeps the picture while it waits for you, and pauses only while your answer is typed in
        say(`Step ${s.i}: ${s.action}${s.action === "ask" ? "" : ` ${shown(s.target).slice(0, 60)}`}`);
        try {
          const out = await doStep(page, s, r, signal);
          if (out === "blocked") { s.status = "failed"; s.note = "A CAPTCHA is in the way. It is never bypassed: solve it by hand, or turn it off on staging."; outcome = "blocked"; failedAt = s.i; }
          else { s.status = "passed"; }
        } catch (e) {
          if (signal.aborted) { s.status = "failed"; s.note = "Stopped."; outcome = "stopped"; }
          else { s.status = "failed"; s.note = friendlyError(s, e, r.inputs); }
          failedAt = s.i; onStepFail(s);
        }
        s.ms = now() - t0;
        if (!secretStep) {
          try { s.shot = await page.screenshot({ type: "jpeg", quality: 60, timeout: 3000 }); } catch { /* the page may be navigating */ }
        }
        if (secretStep) setTimeout(() => pause(false), 1200);
      }
    r.status = outcome ?? (failedAt >= 0 ? "failed" : "passed");
  }

  /** The same steps, in the browser the person has open: they watch it happen, and nobody else can type while it runs. */
  async function executeOnSession(r, signal) {
    const token = r.sessionToken;
    r.guard = makeGuard(r.allowed);
    sessions.lock(token, "a Live test is running");
    try {
      const page = sessions.page(token);
      page.setDefaultTimeout(STEP_TIMEOUT_MS);
      await runSteps(page, r, signal, { pause: (on) => sessions.pause(token, on), say: () => {}, onStepFail: (s) => sessions.addEvent(token, { category: "test", severity: "high", message: `Step ${s.i} failed: ${s.note}` }) });
    } finally {
      sessions.pause(token, false);
      sessions.unlock(token);
      if (r.prompt) { r.prompt.resolve(null); r.prompt = null; }
    }
  }

  async function execute(r, signal) {
    if (r.mode === "auto") return executeAuto(r, signal);
    if (r.sessionToken) return executeOnSession(r, signal);
    const guard = makeGuard(r.allowed);
    r.guard = guard;
    const browser = await openBrowser(guard);
    let stopFrames = () => {};
    try {
      const ctx = await browser.newContext(r.device);
      const page = await ctx.newPage();
      Browser.attachListeners(page, r.console, r.failed);
      page.setDefaultTimeout(STEP_TIMEOUT_MS);
      live.start({ jobId: r.id, type: "live_test" });
      live.where({ url: r.url, device: DEVICE_BY_ID.get(r.device)?.label ?? r.device });
      stopFrames = startFrames(page, { everyMs: 400 });
      await runSteps(page, r, signal);
    } finally {
      stopFrames();
      live.pause(false);
      await browser.close().catch(() => undefined);
      if (r.prompt) { r.prompt.resolve(null); r.prompt = null; }
    }
  }

  /** Runs the whole site check live: every device, every page found, signed in if there are details. */
  async function executeAuto(r, signal) {
    const guard = makeGuard(r.allowed);
    r.guard = guard;
    const browser = await openBrowser(guard, parseExtras(r.creds.extra).basic);
    const cancelled = () => new JobFailed("Cancelled.", { retryable: false, detail: { cancelled: true } });
    const progress = (text) => {
      if (signal.aborted) throw cancelled();
      const last = r.steps.at(-1);
      if (last && last.status === "running") last.status = "passed";
      r.steps.push({ i: r.steps.length, action: "progress", target: text, value: "", status: "running", note: "", secret: false });
      live.step(text);
    };
    try {
      live.start({ jobId: r.id, type: "live_test" });
      live.where({ url: r.url, device: "All devices" });

      // 1. Details the login asks for that were not given: ask once, here, and use the answer on every device.
      if (r.creds.username && r.creds.password) {
        for (let attempt = 0; attempt < 3; attempt++) {
          progress(attempt ? "Trying the sign-in again" : "Checking the sign-in");
          const ctx = await browser.newContext("desktop");
          let res;
          let stopFrames = () => {};
          try {
            const page = await ctx.newPage();
            stopFrames = startFrames(page, { everyMs: 500 }); // the page is on screen from the first moment
            await page.goto(r.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
            try { await page.waitForLoadState("networkidle", { timeout: 10_000 }); } catch { /* a busy page is still usable */ }
            res = await signIn(page, r.creds, { settle, pause: (on) => live.pause(on) });
          } finally { stopFrames(); await ctx.close().catch(() => undefined); }
          if (res.status !== "needs") break;
          for (const label of res.needs) {
            progress(`Waiting for you: the login asks for ${label}`);
            const step = r.steps.at(-1);
            step.secret = true;
            const typed = await ask(r, { i: step.i, target: `The login asks for: ${label}`, value: "", secret: true }, signal);
            if (typed == null) throw signal.aborted ? cancelled() : new JobFailed("Nobody answered in 5 minutes, so the test stopped.", { retryable: false });
            r.creds.extra = `${r.creds.extra ? r.creds.extra + "\n" : ""}${label} = ${typed}`;
            step.status = "passed"; step.note = "You typed a value (hidden).";
          }
        }
      }

      // 2. The check itself, the same one a queued Site check runs, on every device.
      let captureNo = 0;
      const run = {
        brief: { input: { staging_url: r.url, limits: { site_check_max_pages: r.maxPages, ...(r.deviceIds?.length ? { site_check_devices: r.deviceIds } : {}) } }, dir: os.tmpdir() }, base: r.url, paths: ["/"], creds: r.creds,
        findings: [], captures: [], noModel: true, step: progress, addCapture: async () => `c${captureNo++}`,
        // what a registration form asks for (a mobile number, an OTP): the run pauses and asks, the answer goes straight into the page
        ask: async (label, { secret = false } = {}) => {
          progress(`Waiting for you: ${label}`);
          const st = r.steps.at(-1);
          st.secret = secret;
          const typed = await ask(r, { i: st.i, target: `The page asks for: ${label}`, value: "", secret, skippable: true }, signal);
          if (typed == null && signal.aborted) throw cancelled();
          st.status = "passed"; st.note = typed === "" ? "You skipped this form." : secret ? "You typed a value (hidden)." : "You typed a value.";
          return typed;
        },
        onDevice: (devices) => { r.auto.devices = devices; },
        // errors as they are found, newest last; the same problem on the same device and page is listed once
        onPage: ({ device, url, issue }) => {
          let page = url; try { const u = new URL(url); page = u.pathname + (u.search ? "?…" : ""); } catch { /* keep the raw text */ }
          if (r.auto.errors.length >= 300 || r.auto.errors.some((x) => x.device === device && x.page === page && x.title === issue.title)) return;
          r.auto.errors.push({ device, page, severity: issue.severity, title: issue.title });
        },
      };
      await siteCheck(run, browser);
      const last = r.steps.at(-1); if (last) last.status = "passed";
      const notes = run.siteNotes ?? {};
      r.auto.devices = notes.devices ?? r.auto.devices;
      r.auto.pages = notes.pages_checked ?? 0;
      r.auto.login = notes.login ?? null;
      r.auto.findings = run.findings.map((f) => ({ title: f.title, severity: f.severity, description: f.description ?? f.observed ?? "", page: f.affected_page ?? "", seen: f.reproducibility ?? "", fix: f.suggested_correction ?? "" }));
      const real = r.auto.findings.filter((f) => ["critical", "high", "medium"].includes(f.severity));
      const withIssues = r.auto.devices.filter((d) => d.issues > 0).length;
      r.auto.summary = real.length
        ? { tone: "red", text: `${real.length} issue${real.length === 1 ? "" : "s"} found. ${withIssues} of ${r.auto.devices.length} devices affected.` }
        : r.auto.findings.length ? { tone: "amber", text: `No real problems. ${r.auto.findings.length} note${r.auto.findings.length === 1 ? "" : "s"} to read.` }
          : { tone: "green", text: `No issues on any of ${r.auto.devices.length} devices.` };
      const frame = live.frame();
      if (frame && r.steps[0]) r.steps[0].shot = frame; // one last picture to look at afterwards
      r.status = real.length ? "failed" : "passed";
    } catch (e) {
      const stopped = signal.aborted || (e instanceof JobFailed && e.detail?.cancelled);
      r.status = stopped ? "stopped" : "failed";
      if (!stopped) r.error = String(e.message ?? e).split("\n")[0].slice(0, 300);
      const last = r.steps.at(-1); if (last && last.status === "running") last.status = stopped ? "skipped" : "failed";
    } finally {
      live.pause(false);
      await browser.close().catch(() => undefined);
      if (r.prompt) { r.prompt.resolve(null); r.prompt = null; }
      r.creds = { username: "", password: "", extra: "" }; // the login details are forgotten the moment the run ends
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
      r.prompt = { id: `p${s.i}`, label: sub(s.target, r.inputs).slice(0, 300), secret: s.secret, skippable: Boolean(s.skippable), resolve: done };
      r.status = "asking"; s.status = "asking";
      live.step(`Waiting for you: ${r.prompt.label.slice(0, 80)}`);
    });
  }

  return api;
}

export const liveTest = createLiveTest();
