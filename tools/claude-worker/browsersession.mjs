/**
 * The interactive browser: one real Chromium session on this PC that the dashboard shows and controls.
 *
 * How it works: Playwright launches Chromium (the same Browser class and network guard every review uses) and navigates to the URL. Chrome's own
 * screencast (CDP Page.startScreencast) pushes a JPEG every time the page changes; the connector streams those to the dashboard (Server-Sent
 * Events) and takes mouse, keyboard and scroll input back over plain HTTP POSTs, replaying it with Playwright. So what you see and click IS the
 * page, in a real browser, and the same page can then be driven by a test.
 *
 * Safety: only http(s); every navigation, redirect and sub-request goes through the NetGuard (allow-listed public hosts only, the site's own host
 * allowed automatically, private/loopback/link-local/metadata always refused). The connector listens on 127.0.0.1 only, accepts only the
 * dashboard's origins, and every command needs this session's random token. One session at a time; it is closed when idle for 10 minutes, after
 * an hour, or when you close it. A CAPTCHA is never bypassed: the page is flagged and you solve it yourself in the preview.
 */
import crypto from "node:crypto";
import { Browser } from "./browser.mjs";
import { NetGuard } from "./netguard.mjs";
import { PRESET_BY_ID, SESSION_PRESETS } from "./devices.mjs";
import { parseExtras } from "./login.mjs";

export class SessionError extends Error {
  constructor(message, code = "error") { super(message); this.code = code; }
}

const CAPTCHA = /recaptcha|hcaptcha|turnstile/i;
const MAX_LOG = 500;
const MAX_EVENTS = 400;
const MAX_SHOTS = 40;
const NAV_TIMEOUT_MS = 45_000;
const KEYS = new Set(["Enter", "Backspace", "Tab", "Escape", "Delete", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

/** A navigation failure in words a person understands. */
export function friendlyNavError(e) {
  const raw = String(e?.message ?? e).split("\n")[0];
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(raw)) return { code: "unreachable", text: "The site could not be found: its address does not resolve." };
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(raw)) return { code: "unreachable", text: "The site refused the connection. Is it running?" };
  if (/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|Timeout/i.test(raw)) return { code: "timeout", text: `The site took longer than ${NAV_TIMEOUT_MS / 1000} seconds to answer.` };
  if (/ERR_CERT|SSL|certificate/i.test(raw)) return { code: "unreachable", text: "The site's security certificate is not valid." };
  if (/ERR_UNSAFE_PORT/i.test(raw)) return { code: "blocked", text: "The browser refuses that port for safety. Use the site's normal port." };
  if (/ERR_BLOCKED_BY_CLIENT/i.test(raw)) return { code: "blocked", text: "That address is outside the allowed domains, so it was not opened." };
  if (/ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ERR_CONNECTION_CLOSED/i.test(raw)) return { code: "unreachable", text: "The site closed the connection without answering." };
  return { code: "error", text: raw.replace(/^page\.goto: /, "").slice(0, 200) };
}

/** Can this page be shown in an iframe? Reports it; the preview never depends on the answer, because it is a real browser either way. */
export async function checkEmbeddable(url, { guard, embedder = "", fetchImpl = fetch } = {}) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const { ok, why } = await guard.check(current);
    if (!ok) return { embeddable: null, reason: `Not checked: ${why}.` };
    let res;
    try { res = await fetchImpl(current, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (compatible; JourneyPreview)" } }); }
    catch (e) { return { embeddable: null, reason: `Not checked: ${String(e.message ?? e).split("\n")[0].slice(0, 120)}` }; }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
    const xfo = (res.headers.get("x-frame-options") ?? "").trim().toLowerCase();
    const csp = res.headers.get("content-security-policy") ?? "";
    const fa = /frame-ancestors\s+([^;]*)/i.exec(csp)?.[1]?.trim();
    if (/^(deny|sameorigin)$/.test(xfo) || /^allow-from/.test(xfo)) return { embeddable: false, reason: `The site blocks embedding (X-Frame-Options: ${xfo}).` };
    if (fa !== undefined) {
      const allowsUs = /(^|\s)\*(\s|$)/.test(fa) || (embedder && fa.split(/\s+/).includes(embedder));
      if (!allowsUs) return { embeddable: false, reason: `The site blocks embedding (CSP frame-ancestors ${fa || "'none'"}).` };
    }
    return { embeddable: true, reason: "The site allows embedding." };
  }
  return { embeddable: null, reason: "Not checked: too many redirects." };
}

export function createSessions({ openBrowser = (guard, httpCredentials, opts) => new Browser(guard, httpCredentials, { ...opts, verify: true }).open(), makeGuard = (allowed) => new NetGuard(allowed), now = () => Date.now(), idleMs = 10 * 60_000, maxMs = 60 * 60_000, sweepMs = 15_000, log = () => {} } = {}) {
  let cur = null; // the one session
  const sweeper = setInterval(() => {
    if (!cur || cur.status === "closed") return;
    if (now() - cur.lastActivity > idleMs) void close(cur.token, `Closed after ${Math.round(idleMs / 60000)} minutes without use.`);
    else if (now() - cur.startedAt > maxMs) void close(cur.token, "Closed after an hour. Open it again to carry on.");
  }, sweepMs);
  sweeper.unref?.();

  const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const need = (token) => {
    if (!cur || cur.status === "closed" || !same(cur.token, token ?? "")) throw new SessionError("There is no open preview for that session. Open one first.", "no_session");
    return cur;
  };
  const iso = () => new Date(now()).toISOString();
  const emit = (s, kind, payload) => { for (const sub of s.subscribers) { try { sub(kind, payload); } catch { /* a dropped client */ } } };

  const publicState = (s) => ({
    id: s.id, status: s.status, error: s.error, errorCode: s.errorCode, url: s.nav.url, title: s.nav.title, loading: s.nav.loading, canGoBack: s.nav.canGoBack, canGoForward: s.nav.canGoForward,
    captcha: s.captcha, paused: Boolean(s.paused), headed: Boolean(s.headed), isolation: s.browser?.isolation ? { engine: s.browser.isolation.engine, version: s.browser.isolation.version, incognito: s.browser.isolation.incognito, temporaryProfile: s.browser.isolation.temporaryProfile, usesNormalProfile: s.browser.isolation.usesNormalProfile, verified: s.browser.isolation.verified, detail: s.browser.isolation.detail } : null, device: s.device, viewport: { width: s.viewport.width, height: s.viewport.height }, locked: s.locked, lockedBy: s.lockedBy, startedAt: s.startedAt,
    campaignId: s.campaign.id, campaignName: s.campaign.name, startUrl: s.startUrl, frameSeq: s.frameSeq, closedReason: s.closedReason ?? null,
    counts: { events: s.events.length, errors: s.events.filter((e) => e.severity !== "info").length, console: s.consoleLog.length, network: s.network.length },
  });
  const pushState = (s) => emit(s, "state", publicState(s));

  // ---------------------------------------------------------------- events the page raises
  function addEvent(s, ev) {
    const e = { id: s.nextId++, at: iso(), url: s.nav.url, page: s.nav.url, ...ev }; // `url` may be a request's; `page` is always the page the person was on
    s.events.push(e);
    if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
    if (e.severity !== "info" || e.category === "capture") attachEvidence(s, e);
    emit(s, "event", e);
    return e;
  }
  /** A picture of the page when something went wrong. Events within a moment of each other share one picture. */
  function attachEvidence(s, e) {
    const b = s.batch;
    if (b && now() - b.at < 1500) {
      b.events.push(e);
      if (b.done) { if (s.shots.has(b.id)) { e.shotRef = b.id; e.hasShot = true; } } // only when that picture was really taken
      return;
    }
    if (s.shots.size >= MAX_SHOTS || !s.page || s.page.isClosed()) return;
    const batch = { id: e.id, at: now(), events: [e], done: false };
    s.batch = batch;
    void s.page.screenshot({ type: "jpeg", quality: 55, timeout: 3000 }).then((buf) => {
      s.shots.set(batch.id, buf);
      batch.done = true;
      for (const ev of batch.events) { ev.shotRef = batch.id; ev.hasShot = true; }
      emit(s, "evidence", { ids: batch.events.map((x) => x.id), shot: batch.id });
    }).catch(() => { batch.done = true; });
  }
  const addConsole = (s, c) => { s.consoleLog.push({ id: s.nextId++, at: iso(), ...c }); if (s.consoleLog.length > MAX_LOG) s.consoleLog.shift(); };

  function attachListeners(s, page) {
    page.on("console", (m) => {
      const type = m.type();
      const text = m.text().slice(0, 600);
      const loc = m.location();
      const location = loc?.url ? `${loc.url}:${loc.lineNumber ?? 0}` : undefined;
      addConsole(s, { type, text, location });
      // "Failed to load resource" is reported once, properly, as a network event
      if (type === "error" && !/Failed to load resource/i.test(text)) addEvent(s, { category: "console-error", severity: "medium", message: text, location, evidence: location ? `Logged at ${location}` : undefined });
      else if (type === "warning") addEvent(s, { category: "console-warning", severity: "low", message: text, location });
    });
    page.on("pageerror", (e) => addEvent(s, { category: "page-error", severity: "high", message: String(e?.message ?? e).slice(0, 600), evidence: String(e?.stack ?? "").split("\n").slice(1, 4).join("\n").slice(0, 500) || undefined }));
    page.on("request", (r) => {
      const item = { id: s.nextId++, at: iso(), t0: now(), method: r.method(), url: r.url().slice(0, 400), type: r.resourceType(), status: null, failed: false };
      s.reqs.set(r, item);
      s.network.push(item);
      if (s.network.length > MAX_LOG) s.network.shift();
    });
    page.on("response", (r) => {
      const item = s.reqs.get(r.request());
      const status = r.status();
      if (item) { item.status = status; item.ms = now() - item.t0; }
      if (status >= 400) {
        const req = r.request();
        const fav = /favicon\.ico/i.test(r.url());
        addEvent(s, { category: "http-error", severity: fav ? "info" : status >= 500 ? "medium" : "low", message: `HTTP ${status} for ${req.method()} ${r.url().slice(0, 200)}`, url: r.url(), status, method: req.method(), resourceType: req.resourceType(),
          evidence: "A 4xx or 5xx answer is not always an application bug (an expected 401, a missing favicon). Look at what the page was asking for.", note: true });
      }
    });
    page.on("requestfailed", (r) => {
      const item = s.reqs.get(r);
      const error = r.failure()?.errorText ?? "failed";
      if (item) { item.failed = true; item.error = error; item.ms = now() - item.t0; }
      if (/BLOCKED_BY_CLIENT/i.test(error)) return addEvent(s, { category: "blocked", severity: "info", message: `Not loaded: ${r.url().slice(0, 160)} is outside the allowed domains`, url: r.url(), method: r.method(), resourceType: r.resourceType() });
      if (/ERR_ABORTED/i.test(error)) return; // the page cancelled it itself (a navigation, a stopped video)
      addEvent(s, { category: "network-failed", severity: "medium", message: `Request failed: ${r.method()} ${r.url().slice(0, 200)} (${error})`, url: r.url(), method: r.method(), resourceType: r.resourceType(), evidence: error });
    });
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) { s.nav.loading = true; void refreshNav(s); } });
    page.on("load", () => { s.nav.loading = false; void refreshNav(s); void checkCaptcha(s); });
    page.on("domcontentloaded", () => { void refreshNav(s); });
    page.on("crash", () => { s.status = "disconnected"; s.error = "The browser tab crashed."; addEvent(s, { category: "crash", severity: "high", message: "The browser tab crashed." }); pushState(s); });
    page.on("close", () => { if (s.status !== "closed" && s.status !== "launching" && !s.switching) { s.status = "disconnected"; s.error = "The browser was closed."; pushState(s); } });
  }

  async function refreshNav(s) {
    try {
      const h = await s.cdp.send("Page.getNavigationHistory");
      const here = h.entries[h.currentIndex];
      s.nav.url = here?.url ?? s.nav.url;
      // the empty page a tab starts on is not somewhere you can go back to
      s.nav.canGoBack = h.entries.slice(0, h.currentIndex).some((e) => e.url !== "about:blank");
      s.nav.canGoForward = h.currentIndex < h.entries.length - 1;
      s.nav.title = (await s.page.title().catch(() => "")) || s.nav.title;
    } catch { /* the page is changing */ }
    pushState(s);
  }
  async function checkCaptcha(s) {
    try {
      const html = await s.page.content();
      const has = CAPTCHA.test(html);
      if (has && !s.captcha) addEvent(s, { category: "captcha", severity: "info", message: "A CAPTCHA is on this page. It is never bypassed: solve it yourself in the preview." });
      s.captcha = has;
    } catch { /* the page is changing */ }
    pushState(s);
  }

  // ---------------------------------------------------------------- the screen
  async function startScreencast(s) {
    s.cdp = await s.ctx.newCDPSession(s.page);
    s.cdp.on("Page.screencastFrame", (f) => {
      s.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
      if (s.paused) return; // a secret is being typed: no picture of it leaves the browser
      s.frame = Buffer.from(f.data, "base64");
      s.frameSeq++;
      emit(s, "frame", s.frame);
    });
    const dsf = s.preset.opts.deviceScaleFactor ?? 1;
    await s.cdp.send("Page.startScreencast", { format: "jpeg", quality: 62, maxWidth: Math.min(1600, Math.round(s.viewport.width * Math.min(dsf, 2))), maxHeight: Math.min(2400, Math.round(s.viewport.height * Math.min(dsf, 2))), everyNthFrame: 1 });
  }

  async function makeContext(s, storageState) {
    const extra = { ...s.preset.opts, ...(storageState ? { storageState } : {}) };
    s.ctx = await s.browser.newContext("desktop", extra); // the preset's own viewport, touch and user agent win over the base
    s.page = await s.ctx.newPage();
    s.page.setDefaultTimeout(15_000);
    s.reqs = new WeakMap();
    attachListeners(s, s.page);
    await startScreencast(s);
  }

  async function go(s, url) {
    const { ok, why } = await s.guard.check(url);
    if (!ok) throw new SessionError(`That address was not opened: ${why}. Add its domain in Settings if it is yours.`, "blocked");
    s.nav.loading = true; s.status = "loading"; s.error = null; s.errorCode = null; pushState(s);
    try {
      await s.page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      s.status = "ready";
    } catch (e) {
      const f = friendlyNavError(e);
      s.status = "error"; s.error = f.text; s.errorCode = f.code;
      addEvent(s, { category: "navigation", severity: "high", message: f.text, url, evidence: String(e?.message ?? e).split("\n")[0].slice(0, 300) });
    } finally {
      s.nav.loading = false;
      await refreshNav(s);
      s.lastActivity = now();
    }
  }

  // ---------------------------------------------------------------- public API
  async function open({ url, device = "iphone-15", allowed = [], campaign = {}, credentials = null, window: headed = false } = {}) {
    let u;
    try { u = new URL(String(url ?? "").trim()); } catch { throw new SessionError("Enter a web address starting with https://", "bad_url"); }
    if (!["http:", "https:"].includes(u.protocol)) throw new SessionError("Only http:// and https:// addresses can be opened.", "bad_url");
    const preset = PRESET_BY_ID.get(device) ?? PRESET_BY_ID.get("iphone-15");
    const guard = makeGuard([...new Set([...(allowed ?? []).map(String).filter(Boolean), u.hostname.toLowerCase()])]);
    const first = await guard.check(u.toString());
    if (!first.ok) throw new SessionError(`That address was not opened: ${first.why}.`, "blocked");

    if (cur && cur.status !== "closed") await close(cur.token, "Replaced by a new preview.");
    const s = {
      id: crypto.randomUUID(), token: crypto.randomBytes(24).toString("hex"), status: "launching", error: null, errorCode: null, startedAt: now(), lastActivity: now(), startUrl: u.toString(),
      headed: headed === true, device: preset.id, preset, viewport: { width: preset.width, height: preset.height }, guard, campaign: { id: String(campaign?.id ?? "").slice(0, 60), name: String(campaign?.name ?? "").slice(0, 120) },
      nav: { url: u.toString(), title: "", loading: true, canGoBack: false, canGoForward: false }, captcha: false, locked: false, lockedBy: null,
      events: [], consoleLog: [], network: [], nextId: 1, shots: new Map(), batch: null, subscribers: new Set(), frame: null, frameSeq: 0, switching: false,
    };
    cur = s;
    // launching happens in the background: the dashboard gets the token at once and watches the state change
    void (async () => {
      try {
        const basic = credentials?.extra ? parseExtras(credentials.extra).basic : null;
        s.browser = await openBrowser(guard, basic, { headed: s.headed });
        s.browser.browser?.on?.("disconnected", () => { if (s.status !== "closed") { s.status = "disconnected"; s.error = "The browser was closed or crashed."; pushState(s); } });
        await makeContext(s);
        pushState(s);
        await go(s, u.toString());
      } catch (e) {
        if (s.status === "closed") return;
        s.status = "error"; s.errorCode = e?.code ?? "launch_failed";
        s.error = e instanceof SessionError || e?.name === "JobFailed" ? e.message : `The browser could not start: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}`;
        pushState(s);
        log(`preview launch failed: ${s.error}`);
      }
    })();
    return { token: s.token, state: publicState(s) };
  }

  async function close(token, reason = "Closed.") {
    const s = need(token);
    s.status = "closed"; s.closedReason = reason;
    emit(s, "closed", { reason });
    pushState(s);
    try { await s.cdp?.send("Page.stopScreencast").catch(() => undefined); } catch { /* already gone */ }
    await s.ctx?.close().catch(() => undefined);
    await s.browser?.close().catch(() => undefined);
    s.subscribers.clear();
    s.frame = null;
    return true;
  }

  const touch = (s) => { s.lastActivity = now(); };
  const gate = (s, mutating = true) => { if (mutating && s.locked) throw new SessionError(`A test is running in this browser${s.lockedBy ? ` (${s.lockedBy})` : ""}. Wait for it to finish, or stop it.`, "locked"); if (!s.page || s.page.isClosed()) throw new SessionError(s.error || "The browser is not available.", "unavailable"); };

  return {
    open, close,
    active: () => Boolean(cur && cur.status !== "closed"),
    state: (token) => publicState(need(token)),
    /** What is new since an id. The network list can be asked for in full, because a request's status arrives after it first appears. */
    log(token, since = 0, { netAll = false } = {}) {
      const s = need(token);
      return { state: publicState(s), events: s.events.filter((e) => e.id > since), console: s.consoleLog.filter((c) => c.id > since), network: (netAll ? s.network : s.network.filter((n) => n.id > since)).map(({ t0, ...n }) => n) };
    },
    frame: (token) => need(token).frame,
    shot: (token, id) => need(token).shots.get(Number(id)) ?? null,
    subscribe(token, fn) {
      const s = need(token);
      s.subscribers.add(fn);
      fn("state", publicState(s));
      if (s.frame) fn("frame", s.frame);
      return () => s.subscribers.delete(fn);
    },

    async navigate(token, url) {
      const s = need(token); gate(s); touch(s);
      let u; try { u = new URL(String(url ?? "").trim() || ""); } catch { try { u = new URL(`https://${String(url).trim()}`); } catch { throw new SessionError("Enter a web address starting with https://", "bad_url"); } }
      if (!["http:", "https:"].includes(u.protocol)) throw new SessionError("Only http:// and https:// addresses can be opened.", "bad_url");
      await go(s, u.toString());
      return publicState(s);
    },
    async reload(token) { const s = need(token); gate(s); touch(s); s.nav.loading = true; pushState(s); try { await s.page.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }); s.status = "ready"; s.error = null; } catch (e) { const f = friendlyNavError(e); s.status = "error"; s.error = f.text; s.errorCode = f.code; addEvent(s, { category: "navigation", severity: "high", message: f.text }); } s.nav.loading = false; await refreshNav(s); return publicState(s); },
    async back(token) { const s = need(token); gate(s); touch(s); await s.page.goBack({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null); await refreshNav(s); return publicState(s); },
    async forward(token) { const s = need(token); gate(s); touch(s); await s.page.goForward({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => null); await refreshNav(s); return publicState(s); },

    /**
     * Changes the size. Between two desktop-class presets (or two phone-class ones) the page is only resized, so nothing is lost. Changing between a
     * desktop and a phone needs a new emulation (touch, user agent), so the same page is reopened with the same cookies.
     */
    async setDevice(token, presetId) {
      const s = need(token); gate(s); touch(s);
      const preset = PRESET_BY_ID.get(presetId);
      if (!preset) throw new SessionError("That is not one of the sizes offered.", "bad_request");
      if (preset.id === s.device) return publicState(s);
      if (preset.touch === s.preset.touch) {
        s.preset = preset; s.device = preset.id; s.viewport = { width: preset.width, height: preset.height };
        await s.page.setViewportSize(s.viewport);
        await s.cdp.send("Page.stopScreencast").catch(() => undefined);
        await s.cdp.send("Page.startScreencast", { format: "jpeg", quality: 62, maxWidth: Math.min(1600, Math.round(preset.width * Math.min(preset.opts.deviceScaleFactor ?? 1, 2))), maxHeight: Math.min(2400, Math.round(preset.height * Math.min(preset.opts.deviceScaleFactor ?? 1, 2))), everyNthFrame: 1 });
      } else {
        const url = s.nav.url, state = await s.ctx.storageState().catch(() => null);
        s.switching = true;
        try {
          await s.cdp.send("Page.stopScreencast").catch(() => undefined);
          await s.ctx.close().catch(() => undefined);
          s.preset = preset; s.device = preset.id; s.viewport = { width: preset.width, height: preset.height };
          await makeContext(s, state);
        } finally { s.switching = false; }
        await go(s, url);
      }
      pushState(s);
      return publicState(s);
    },

    /** Mouse, keyboard and scroll, replayed in the real page. Positions arrive as fractions (0 to 1) of the picture, so zoom and scaling do not matter. */
    async input(token, msg = {}) {
      const s = need(token); gate(s); touch(s);
      const clamp = (n) => Math.max(0, Math.min(1, Number(n) || 0));
      const x = clamp(msg.fx) * s.viewport.width, y = clamp(msg.fy) * s.viewport.height;
      switch (msg.type) {
        case "click": await s.page.mouse.click(x, y, { button: ["left", "right", "middle"].includes(msg.button) ? msg.button : "left", clickCount: Math.min(3, Math.max(1, Number(msg.count) || 1)) }); break;
        case "move": await s.page.mouse.move(x, y); break;
        case "wheel": await s.page.mouse.move(x, y); await s.page.mouse.wheel(Math.max(-2000, Math.min(2000, Number(msg.dx) || 0)), Math.max(-2000, Math.min(2000, Number(msg.dy) || 0))); break;
        case "key": { const k = String(msg.key ?? ""); if (!KEYS.has(k) && !/^[A-Za-z0-9]$/.test(k) && !/^(Control|Meta)\+[acvxzACVXZ]$/.test(k)) throw new SessionError("That key is not supported.", "bad_request"); await s.page.keyboard.press(k === "Space" ? " " : k); break; }
        case "text": await s.page.keyboard.type(String(msg.text ?? "").slice(0, 500)); break;
        // Pasted text from the dashboard's own clipboard: inserted in one go (newlines kept), not key by key.
        case "paste": await s.page.keyboard.insertText(String(msg.text ?? "").slice(0, 10000)); break;
        default: throw new SessionError("Unknown input.", "bad_request");
      }
      return true;
    },

    /** The text the person has selected in the page (or in a field), so the dashboard can put it on their own clipboard. Read-only; only on an explicit copy. */
    async selection(token) {
      const s = need(token); gate(s, false); touch(s);
      const text = await s.page.evaluate(() => {
        const a = document.activeElement;
        if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && typeof a.selectionStart === "number" && a.selectionEnd > a.selectionStart && a.type !== "password") return a.value.slice(a.selectionStart, a.selectionEnd);
        return String(getSelection() ?? "");
      });
      return { text: String(text).slice(0, 10000) };
    },

    /** A picture of the page as it is now, kept as evidence with an event. */
    async capture(token, note = "Screenshot captured") {
      const s = need(token); gate(s, false); touch(s);
      const buf = await s.page.screenshot({ type: "jpeg", quality: 70, timeout: 5000 });
      const e = { id: s.nextId++, at: iso(), url: s.nav.url, category: "capture", severity: "info", message: note, hasShot: true };
      e.shotRef = e.id; s.shots.set(e.id, buf); s.events.push(e); emit(s, "event", e);
      return e;
    },

    /** A test takes the browser: nobody else may type or navigate until it lets go. */
    /** Stops the picture while a secret (an OTP, a password) is typed, and clears the last one. */
    pause(token, on) { const s = need(token); s.paused = Boolean(on); if (on) s.frame = null; pushState(s); },
    lock(token, by) { const s = need(token); if (s.locked) throw new SessionError("A test is already running in this browser.", "locked"); s.locked = true; s.lockedBy = by; pushState(s); },
    unlock(token) { try { const s = need(token); s.locked = false; s.lockedBy = null; touch(s); pushState(s); } catch { /* the session went away */ } },
    page: (token) => { const s = need(token); gate(s, false); return s.page; },
    addEvent: (token, ev) => addEvent(need(token), ev),
    presets: () => SESSION_PRESETS.map((p) => ({ id: p.id, label: p.label, width: p.width, height: p.height, touch: p.touch })),
    async closeAll() { if (cur && cur.status !== "closed") await close(cur.token, "The connector stopped."); clearInterval(sweeper); },
    checkEmbeddable: (url, allowed = [], embedder = "") => { let h = ""; try { h = new URL(url).hostname.toLowerCase(); } catch { /* checked below */ } return checkEmbeddable(url, { guard: makeGuard([...new Set([...allowed, h].filter(Boolean))]), embedder }); },
  };
}

export const sessions = createSessions();
