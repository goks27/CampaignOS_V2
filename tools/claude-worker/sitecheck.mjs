/**
 * Site check: give it a URL and it looks through the site for problems. No design, requirements or scenarios needed.
 *
 * - Opens the start page(s) and follows same-site links (never more than `max_pages`), on desktop; the first pages also on mobile.
 * - It only OPENS pages and reads them. It never clicks, types, submits or follows links that look like log out, delete, pay or unsubscribe.
 * - Deterministic checks first (no model): HTTP errors, console errors, failed requests, broken images and links, missing alt text,
 *   sideways scrolling on mobile, mixed content, slow loads, placeholder text. Then Claude looks at the screenshots for what a person
 *   would notice (error messages, typos, cut-off or broken layout).
 * Everything goes through the NetGuard: allow-listed public hosts only.
 */
import fs from "node:fs";
import path from "node:path";
import { JobFailed, SEVERITY, CONFIDENCE } from "./core.mjs";
import { tileForModel } from "./images.mjs";
import { normaliseBox } from "./runner.mjs";
import { PREAMBLE } from "./staging.mjs";
import { live } from "./live.mjs";
import { settle, startFrames } from "./browser.mjs";
import { pickDevices, isSmallScreen } from "./devices.mjs";
import { signIn, parseExtras } from "./login.mjs";
import { completeForms } from "./flow.mjs";

const DEFAULT_MAX_PAGES = 10;
const MAX_LINK_CHECKS = 40;
const MODEL_PAGES = 12;
const MAX_FINDINGS = 60;
const SEV_ORDER = ["critical", "high", "medium", "low", "informational"];

/** Links the crawler must never open: they can change things on a server even with a GET. */
export const RISKY = /(log-?out|sign-?out|sign-?off|delete|remove|unsubscribe|checkout|payment|\/pay\b|add-to-cart|cart\/add|destroy|cancel-|confirm-order|\/buy\b)/i;
const FILE = /\.(pdf|zip|rar|7z|docx?|xlsx?|pptx?|csv|exe|dmg|apk|mp[34]|mov|avi|png|jpe?g|gif|webp|svg|ico|xml|json|txt)(\?|$)/i;
const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$)/i;

/** One key per page: query strings and fragments collapse, so ?page=1..999 does not become a crawl. */
export function pageKey(url) {
  try {
    const u = new URL(url);
    let p = u.pathname.replace(/\/+$/, "") || "/";
    p = p.toLowerCase();
    return `${u.protocol}//${u.host.toLowerCase()}${p}`;
  } catch { return url; }
}

export function sameSite(a, b) {
  try {
    const h = (u) => new URL(u).hostname.toLowerCase().replace(/^www\./, "");
    return h(a) === h(b);
  } catch { return false; }
}

/** Links worth opening, in page order. */
export function pickCrawlLinks(links, startUrl, seen) {
  const out = [];
  for (const l of links ?? []) {
    let u;
    try { u = new URL(l.href); } catch { continue; }
    if (!["http:", "https:"].includes(u.protocol) || l.download) continue;
    if (!sameSite(u.toString(), startUrl)) continue;
    if (FILE.test(u.pathname) || RISKY.test(u.pathname) || RISKY.test(l.text ?? "")) continue;
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    const key = pageKey(u.toString());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u.toString());
  }
  return out;
}

const sev = (s) => (SEVERITY.includes(s) ? s : "low");

/**
 * Problems found without any model, from what the browser recorded for one page load.
 * Returns [{ key, severity, title, observed, expected, fix, kind, console?, network? }].
 */
export function pageIssues(cap, { device = "desktop", isStart = false, touch = device === "mobile", primary = false } = {}) {
  const out = [];
  const f = cap.facts ?? {};
  const add = (i) => out.push({ confidence: "high", ...i });
  const where = (() => { try { return new URL(cap.url).pathname || "/"; } catch { return cap.url; } })();

  if (cap.status === 401 || cap.status === 403) {
    add({ kind: "auth", key: `auth:${where}`, severity: "informational", title: `Page needs a login: ${where}`, observed: `The server answered ${cap.status}, so the page is behind a login and was not checked.`,
      expected: "", fix: "Add test credentials to the environment if this page should be checked.", confidence: "high" });
  } else if (cap.status >= 400) {
    add({ kind: "http", key: `http:${where}:${cap.status}`, severity: isStart || cap.status >= 500 ? "high" : "medium", title: `Page returns HTTP ${cap.status}: ${where}`,
      observed: `The server answered ${cap.status} for ${cap.url}.`, expected: "A normal page (HTTP 200).", fix: cap.status === 404 ? "Fix the link or restore the page." : "Check the server logs for this page." });
  }
  const errs = (cap.console ?? []).filter((c) => c.type === "error" || c.type === "pageerror");
  const seenText = new Set();
  for (const e of errs) {
    const t = String(e.text).replace(/\s+/g, " ").slice(0, 160);
    if (/Failed to load resource/i.test(t)) continue; // already reported once, with the file, as a failed request
    if (seenText.has(t)) continue;
    seenText.add(t);
    add({ kind: "console", key: `console:${t}`, severity: e.type === "pageerror" ? "medium" : "low", title: e.type === "pageerror" ? `JavaScript error: ${t.slice(0, 90)}` : `Console error: ${t.slice(0, 90)}`,
      observed: t, expected: "No errors in the browser console.", fix: "Open the browser console on this page and fix the error.", console: [e] });
  }
  const seenReq = new Set();
  for (const r of cap.failed ?? []) {
    const base = String(r.url).split("?")[0];
    // The page itself is reported separately, favicons are noise, and requests the connector's own network guard blocked are not site bugs.
    if (seenReq.has(base) || /favicon\.ico$/i.test(base) || base === String(cap.url).split("?")[0] || /BLOCKED_BY_CLIENT|blockedbyclient/i.test(r.error ?? "")) continue;
    seenReq.add(base);
    const status = r.status ?? 0;
    const internal = sameSite(base, cap.url);
    const severity = status >= 500 || (!status && r.error && internal) ? "medium" : status === 404 && internal ? "medium" : "low";
    add({ kind: "request", key: `req:${base}:${status}`, severity, title: `${status ? `HTTP ${status}` : "Failed"} request: ${base.replace(/^https?:\/\//, "").slice(0, 80)}`,
      observed: status ? `${base} answered ${status}.` : `${base} failed (${r.error || "network error"}).`, expected: "Every file the page asks for loads.", fix: "Fix the path, restore the file or remove the reference.", network: [r] });
  }
  // An image the connector's own network guard refused to load is not a broken image: it is reported once, as not loaded.
  const refused = new Set(cap.blocked ?? []);
  for (const i of (f.imgs ?? []).filter((x) => x.broken && !refused.has(String(x.src)))) {
    add({ kind: "image", key: `img:${String(i.src).split("?")[0]}`, severity: "medium", title: `Broken image: ${String(i.src).split("/").pop()?.slice(0, 60) || "image"}`,
      observed: `The image ${i.src} did not load.`, expected: "The image appears.", fix: "Check the image path and that the file is uploaded." });
  }
  const noAlt = (f.imgs ?? []).filter((x) => x.visible && x.alt === null && !x.broken);
  if (noAlt.length) {
    add({ kind: "alt", key: `alt:${where}`, severity: "low", title: `${noAlt.length} image${noAlt.length === 1 ? "" : "s"} without alt text on ${where}`,
      observed: `${noAlt.length} visible image(s) have no alt attribute, so screen readers cannot describe them.`, expected: "Every meaningful image has alt text (empty alt for decoration).", fix: "Add alt text to the images." });
  }
  if (device === "mobile" && f.overflow > 8) {
    add({ kind: "overflow", key: `overflow:${where}`, severity: "medium", title: `Page scrolls sideways on small screens: ${where}`,
      observed: `The page is ${f.overflow}px wider than the ${cap.width || 390}px screen.${(f.wide ?? []).length ? ` Too wide: ${f.wide.slice(0, 3).map((w) => `${w.tag}${w.text ? ` "${w.text}"` : ""} (${w.width}px)`).join(", ")}.` : ""}`,
      expected: "Nothing is wider than the screen.", fix: "Find the element that is too wide (fixed widths, wide images or tables) and make it fit." });
  }
  if (touch && f.smallTargets > 5) {
    add({ kind: "targets", key: `targets:${where}`, severity: "low", confidence: "medium", title: `Small tap targets: ${where}`,
      observed: `${f.smallTargets} buttons, links or fields are smaller than about 32px, which is hard to tap.`, expected: "Tap targets of about 44px (iOS) or 48px (Android).", fix: "Make the buttons, links and fields taller or add padding around them." });
  }
  if (touch && f.tinyText > 5) {
    add({ kind: "tiny", key: `tiny:${where}`, severity: "low", confidence: "medium", title: `Very small text: ${where}`,
      observed: `${f.tinyText} pieces of text are smaller than 11px.`, expected: "Body text of about 14px or more on a phone.", fix: "Increase the font size for small screens." });
  }
  if ((device === "desktop" || primary) && f.title === "" && cap.status < 400) {
    add({ kind: "title", key: `title:${where}`, severity: "low", title: `Page has no title: ${where}`, observed: "The page <title> is empty.", expected: "Every page has a clear title.", fix: "Add a <title>." });
  }
  if (isStart && device === "mobile" && f.viewportMeta === false) {
    add({ kind: "viewport", key: "viewport", severity: "medium", title: "No mobile viewport setting", observed: "The page has no <meta name=\"viewport\">, so phones show it zoomed out.", expected: "A viewport meta tag.", fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' });
  }
  if ((cap.mixed ?? []).length) {
    add({ kind: "mixed", key: `mixed:${where}`, severity: "medium", title: `Insecure content on a secure page: ${where}`,
      observed: `${cap.mixed.length} request(s) use http://, for example ${cap.mixed[0]}.`, expected: "Everything on an https page loads over https.", fix: "Change those URLs to https." });
  }
  if (refused.size && isStart) {
    const hosts = [...new Set([...refused].map((u) => { try { return new URL(u).hostname; } catch { return u; } }))];
    add({ kind: "not-loaded", key: "not-loaded", severity: "informational", confidence: "high", title: `${refused.size} request${refused.size === 1 ? "" : "s"} to other hosts were not loaded`,
      observed: `The check only loads the hosts on the environment's allowed list. It did not load requests to: ${hosts.slice(0, 6).join(", ")}${hosts.length > 6 ? ", …" : ""}. Images, fonts or scripts from there are missing in this check, so the page may look or behave differently from a real browser.`,
      expected: "", fix: `Add ${hosts.slice(0, 3).map((h) => "*." + h.split(".").slice(-2).join(".")).join(", ")} to the test environment's allowed domains and run the check again.` });
  }
  if (cap.stillLoading) {
    add({ kind: "stuck-loader", key: `loader:${where}`, severity: "medium", title: `Page still shows its loading screen after ${Math.round((cap.settleMs ?? 25000) / 1000)}s: ${where}`,
      observed: "A loader or splash screen was still covering the page when the check gave up waiting.", expected: "The loader finishes and the page content appears within a few seconds.",
      fix: refused.size ? `The check did not load requests to ${[...new Set([...refused].map((u) => { try { return new URL(u).hostname; } catch { return u; } }))].slice(0, 3).join(", ")} because they are outside the environment's allowed domains, and the loader may be waiting for them. Add them to the allowed domains and run the check again.` : "Check what the loader waits for (a script, a video or a slow request). If it works in your browser, it may depend on something this check cannot do, so verify by hand.", confidence: "medium" });
  }
  if (cap.loadMs > 6000) {
    add({ kind: "slow", key: `slow:${where}`, severity: cap.loadMs > 12000 ? "medium" : "low", title: `Slow page: ${where} took ${(cap.loadMs / 1000).toFixed(1)}s to load`,
      observed: `The load event fired after ${(cap.loadMs / 1000).toFixed(1)} seconds.`, expected: "Under about 3 seconds.", fix: "Check image sizes, scripts and server response time.", confidence: "medium" });
  }
  const text = cap.text ?? "";
  if (/lorem ipsum/i.test(text)) add({ kind: "text", key: `lorem:${where}`, severity: "medium", title: `Placeholder text on ${where}`, observed: "The page contains “Lorem ipsum”.", expected: "Final copy.", fix: "Replace the placeholder text." });
  if (/\[object Object\]|\bundefined\b|\bNaN\b/.test(text)) {
    const m = text.match(/\[object Object\]|\bundefined\b|\bNaN\b/)[0];
    add({ kind: "text", key: `broken-text:${where}`, severity: "medium", title: `Broken text on ${where}: “${m}”`, observed: `The visible text contains “${m}”, which usually means a value did not load.`, expected: "Real content.", fix: "Check the code that fills this text.", confidence: "medium" });
  }
  if (f.unlabelledInputs > 0) {
    add({ kind: "label", key: `label:${where}`, severity: "low", title: `${f.unlabelledInputs} form field${f.unlabelledInputs === 1 ? "" : "s"} without a label on ${where}`,
      observed: "Fields have no label, aria-label or placeholder.", expected: "Every field says what it is for.", fix: "Add a label to each field." });
  }
  return out.map((i) => ({ ...i, severity: sev(i.severity) }));
}

/** Which devices a problem was seen on, in words: "every device", or the names (a few, then "+ n more"). */
export function deviceList(labels, all) {
  const l = [...new Set(labels)];
  if (all && all.length > 1 && all.every((a) => l.includes(a))) return "every device tested";
  return l.length > 3 ? `${l.slice(0, 3).join(", ")} + ${l.length - 3} more` : l.join(", ");
}

/**
 * Same problem on several pages or devices becomes one finding that lists them. When `allDevices` is given, a problem seen on only some
 * of them says which (in the title and the description), so "broken on this phone" is never mistaken for "broken everywhere".
 */
export function groupIssues(entries, cap = MAX_FINDINGS, { allDevices = null } = {}) {
  const map = new Map();
  for (const { issue, url, device, captureKey, cap: capRef } of entries) {
    const g = map.get(issue.key) ?? { issue, pages: [], captureKey, device, capRef };
    if (!g.pages.some((p) => p.url === url && p.device === device)) g.pages.push({ url, device });
    map.set(issue.key, g);
  }
  const path = (u) => { try { return new URL(u).pathname; } catch { return u; } };
  return [...map.values()].map((g) => {
    const i = g.issue;
    const devs = [...new Set(g.pages.map((p) => p.device))];
    const urls = [...new Set(g.pages.map((p) => p.url))];
    const some = allDevices && allDevices.length > 1 && !allDevices.every((a) => devs.includes(a));
    const where = deviceList(devs, allDevices);
    const list = urls.slice(0, 5).map(path).join(", ");
    const multi = allDevices && allDevices.length > 1;
    const seen = urls.length > 1 ? ` Seen on ${urls.length} pages: ${list}${urls.length > 5 ? ", …" : ""}.` : "";
    return {
      title: `${i.title}${some ? ` (${where})` : ""}`.slice(0, 300), severity: i.severity, confidence: i.confidence,
      description: `${i.observed}${seen}${multi ? ` Seen on: ${where} (emulated devices).` : ""}`,
      observed: i.observed, expected: i.expected, suggested_correction: i.fix,
      evidence_note: "Found automatically while loading the page in a headless browser; the console and network entries are attached where relevant.",
      affected_page: g.pages[0].url,
      reproducibility: `Seen on ${urls.length} page${urls.length === 1 ? "" : "s"}${multi ? ` · ${where}` : ` (${g.device})`}`,
      capture_key: g.captureKey, requirement_id: null,
      ...(i.console ? { console: i.console } : {}), ...(i.network ? { network: i.network } : {}),
      ...(g.capRef ? { _cap: g.capRef } : {}),
    };
  }).sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)).slice(0, cap);
}

const CLAUDE_SCHEMA = {
  type: "object", required: ["findings"],
  properties: { findings: { type: "array", items: { type: "object", required: ["title", "severity", "confidence", "evidence_note"], properties: {
    title: { type: "string" }, severity: { type: "string", enum: SEVERITY }, description: { type: "string" }, observed: { type: "string" }, expected: { type: "string" },
    suggested_correction: { type: "string" }, confidence: { type: "string", enum: CONFIDENCE }, evidence_note: { type: "string" },
    device: { type: ["string", "null"] },
    file: { type: ["string", "null"] }, box: { type: ["array", "null"], items: { type: "number" }, minItems: 4, maxItems: 4 } } } } },
};

const outOfTime = (e) => e instanceof JobFailed && /ran out of time/.test(e.message);

/** The login result as a finding a person can act on, or nothing when it simply worked or there was no login. */
export function loginFinding(login, startUrl) {
  if (!login || ["ok", "none", "registered"].includes(login.status)) return null;
  const reg = login.kind === "registration";
  const base = { confidence: "high", requirement_id: null, affected_page: startUrl, evidence_note: "Recorded while signing in with the details stored on the environment. The values are never shown or saved here." };
  if (login.status === "failed") return { ...base, title: reg ? "The registration form did not go through" : "Sign-in did not work with the stored details", severity: "high", description: login.message, observed: login.message, expected: reg ? "The registration form accepts the details and the campaign opens." : "The stored test login signs in.", suggested_correction: reg ? "Check the mobile number and other details you gave are valid on staging, and that the form works by hand." : "Check the username and password stored on the test environment, and that the test account is active on staging.", reproducibility: reg ? "Happened when the check filled in the registration form" : "Happened when the check tried to sign in" };
  if (login.status === "needs") return { ...base, title: `${reg ? "The page" : "The login"} asks for details that are not given: ${login.needs.join(", ")}`, severity: "informational", description: login.message, observed: login.message, expected: "", suggested_correction: `Open the test environment, choose Credentials, and add ${login.needs.map((n) => `“${n} = value”`).join(" and ")} under Extra. Then run the check again to test the pages behind the login.`, reproducibility: "The pages behind the login were not checked" };
  return { ...base, title: reg ? "A CAPTCHA or a payment form blocks the registration" : "A CAPTCHA blocks the sign-in", severity: "informational", description: login.message, observed: login.message, expected: "", suggested_correction: "Turn the CAPTCHA off on staging for the test account, or test the pages behind the login by hand.", reproducibility: "The pages behind the login were not checked" };
}

/**
 * The whole check, on every device. `run` is the staging Run (browser helpers, uploads, Claude calls); `browser` is an open Browser.
 * The first device (desktop) signs in if credentials are stored, finds the pages, and every other device then opens the same pages,
 * signed in the same way. Problems are grouped across pages and devices and say which devices they were seen on.
 */
export async function siteCheck(run, browser) {
  const inp = run.brief.input;
  const maxPages = Math.max(1, Math.min(30, Number(inp.limits?.site_check_max_pages) || DEFAULT_MAX_PAGES));
  const devices = pickDevices(inp.limits?.site_check_devices);
  const labels = devices.map((d) => d.label);
  const startUrl = new URL(String(inp.staging_url)).toString();
  const hasLogin = Boolean(run.creds?.username && run.creds?.password);
  const seen = new Set();
  const queue = [];
  for (const p of run.paths) {
    const u = new URL(String(p).replace(/^\//, ""), run.base).toString();
    if (!seen.has(pageKey(u))) { seen.add(pageKey(u)); queue.push(u); }
  }
  const pages = []; // { url, cap, key } from the first device
  const entries = []; // deterministic issues with where (page, device) they were seen
  // Every problem is also sent to `run.onPage` the moment it is found, so a live run can show errors as the test goes.
  entries.push = (...items) => { for (const e of items) run.onPage?.({ device: e.device, url: e.url, issue: e.issue }); return Array.prototype.push.apply(entries, items); };
  const allLinks = new Map(); // href -> [source pages]
  const report = new Map(devices.map((d) => [d.id, { id: d.id, label: d.label, family: d.family, engine: "Chromium (emulated)", pages_tested: 0, pages_failed: 0, login: "none" }]));
  const deviceCaps = new Map(); // device id -> Map(url -> cap)
  const logins = new Map();
  /** The per-device report so far: pages opened, the problems seen on each device, and whether the sign-in worked. Also sent to `run.onDevice` as each device finishes. */
  const snapshot = () => {
    const perDevice = new Map();
    for (const e of entries) { const s = perDevice.get(e.device) ?? new Map(); s.set(e.issue.title, e.issue.severity); perDevice.set(e.device, s); }
    return [...report.values()].map((r) => {
      const mine = perDevice.get(r.label) ?? new Map();
      const titles = [...mine.entries()].sort((x, y) => SEV_ORDER.indexOf(x[1]) - SEV_ORDER.indexOf(y[1]));
      const claude = r.claude ?? [];
      return { id: r.id, label: r.label, family: r.family, engine: r.engine, pages_tested: r.pages_tested, pages_failed: r.pages_failed, login: r.login,
        ...(r.skipped ? { skipped: r.skipped } : {}), issues: titles.length + claude.length, top_issues: [...titles.map(([t]) => t), ...claude].slice(0, 8) };
    });
  };
  let captcha = 0, stoppedEarly = null;

  /** A browser context for one device, signed in if there are stored credentials. Returns { ctx, login }. */
  // Most campaigns have no password: a landing page, a registration form (mobile number, name), an OTP, then the real pages. The first device
  // fills that in with what a person gave (in advance, or typed when asked) and its session is then carried to every other device.
  const extraFields = parseExtras(run.creds?.extra).fields;
  const canRegister = !hasLogin && Boolean(run.ask || extraFields.length);
  let sessionState = null;
  const open = async (dev) => {
    const ctx = await browser.newContext(dev.id, sessionState ? { storageState: sessionState } : {});
    let login = { status: "none", needs: [], message: "" };
    if (canRegister && !sessionState && dev === devices[0]) {
      run.step(`${dev.label}: looking for a registration form`);
      const pg = await ctx.newPage();
      const stopFrames = startFrames(pg, { everyMs: 500 });
      live.where({ url: startUrl, device: dev.label });
      try {
        await pg.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
        try { await pg.waitForLoadState("networkidle", { timeout: 15_000 }); } catch { await pg.waitForTimeout(1500); }
        await settle(pg);
        const res = await completeForms(pg, { extras: extraFields, ask: run.ask ?? null, settle, pause: (on) => live.pause(on), step: run.step });
        if (res.status === "done") { sessionState = await ctx.storageState(); login = { status: "registered", kind: "registration", needs: [], message: `Registered (${res.filled.join(", ")}).` }; }
        else if (res.status !== "none" && res.status !== "skipped") login = { status: res.status, kind: "registration", needs: res.needs ?? [], message: res.message };
      } catch (e) {
        if (e instanceof JobFailed) throw e;
        login = { status: "failed", kind: "registration", needs: [], message: `The registration form could not be completed: ${String(e.message).split("\n")[0].slice(0, 160)}` };
      } finally { stopFrames(); await pg.close().catch(() => undefined); }
      logins.set(dev.id, login);
      report.get(dev.id).login = login.status;
    } else if (sessionState) {
      login = { status: "registered", needs: [], message: "Started from the registered session." };
      report.get(dev.id).login = "registered";
    }
    if (hasLogin) {
      run.step(`${dev.label}: signing in`);
      const pg = await ctx.newPage();
      const stopFrames = startFrames(pg, { everyMs: 500 });
      live.where({ url: startUrl, device: dev.label });
      try {
        await pg.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
        try { await pg.waitForLoadState("networkidle", { timeout: 15_000 }); } catch { await pg.waitForTimeout(1500); }
        await settle(pg);
        login = await signIn(pg, run.creds, { settle, pause: (on) => live.pause(on) });
      } catch (e) {
        login = { status: "failed", needs: [], message: `Could not reach the login: ${String(e.message).split("\n")[0].slice(0, 160)}` };
      } finally { stopFrames(); await pg.close().catch(() => undefined); }
      logins.set(dev.id, login);
      report.get(dev.id).login = login.status;
    }
    return { ctx, login };
  };
  const view = (dev) => (dev.touch || isSmallScreen(dev) ? "mobile" : "desktop");

  // ---- 1. first device: open pages, follow same-site links
  const primary = devices[0];
  const first = await open(primary);
  try {
    for (let i = 0; queue.length && pages.length < maxPages; i++) {
      const url = queue.shift();
      run.step(`${primary.label}: checking page ${pages.length + 1}: ${new URL(url).pathname || "/"}`);
      live.where({ pageNo: pages.length + 1, pageTotal: maxPages, device: primary.label });
      let cap;
      try {
        cap = await browser.capture(url, primary.id, { inspect: true, ctx: first.ctx });
      } catch (e) {
        if (!pages.length && e instanceof JobFailed) throw e; // the start page itself cannot be opened: say so, loudly
        report.get(primary.id).pages_failed++;
        entries.push({ issue: { kind: "load", key: `load:${url}`, severity: "high", confidence: "high", title: `Page could not be opened: ${new URL(url).pathname}`,
          observed: String(e.message).slice(0, 300), expected: "The page opens.", fix: "Check the link and the server." }, url, device: primary.label, captureKey: null });
        continue;
      }
      if (cap.contentType && !/html/i.test(cap.contentType)) continue; // a file, not a page
      const key = await run.addCapture(cap);
      pages.push({ url: cap.url, cap, key });
      report.get(primary.id).pages_tested++;
      if (cap.captcha) captcha++;
      for (const issue of pageIssues(cap, { device: view(primary), isStart: pages.length === 1, primary: true })) entries.push({ issue, url: cap.url, device: primary.label, captureKey: key });
      for (const l of cap.facts?.links ?? []) { const a = allLinks.get(l.href) ?? []; if (a.length < 5) a.push(cap.url); allLinks.set(l.href, a); }
      queue.push(...pickCrawlLinks(cap.facts?.links, startUrl, seen));
    }
  } catch (e) { if (!outOfTime(e)) throw e; stoppedEarly = "ran out of time while opening pages"; } finally { await first.ctx.close().catch(() => undefined); }
  run.onDevice?.(snapshot());

  // ---- 2. every other device opens the same pages
  for (const dev of devices.slice(1)) {
    if (stoppedEarly) { report.get(dev.id).skipped = "not reached: the check ran out of time"; continue; }
    let s;
    try {
      s = await open(dev);
      for (const [n, pg] of pages.entries()) {
        run.step(`${dev.label}: page ${n + 1} of ${pages.length}: ${new URL(pg.url).pathname || "/"}`);
        live.where({ pageNo: n + 1, pageTotal: pages.length, device: dev.label });
        try {
          const cap = await browser.capture(pg.url, dev.id, { inspect: true, ctx: s.ctx });
          if (!deviceCaps.has(dev.id)) deviceCaps.set(dev.id, new Map());
          deviceCaps.get(dev.id).set(pg.url, cap);
          report.get(dev.id).pages_tested++;
          for (const issue of pageIssues(cap, { device: view(dev), isStart: n === 0, touch: dev.touch })) entries.push({ issue, url: cap.url, device: dev.label, captureKey: null, cap });
        } catch (e) {
          if (e instanceof JobFailed && /Refusing/.test(e.message)) throw e;
          if (outOfTime(e)) throw e;
          report.get(dev.id).pages_failed++;
          entries.push({ issue: { kind: "load", key: `load:${pg.url}`, severity: "medium", confidence: "high", title: `Page could not be opened: ${new URL(pg.url).pathname}`,
            observed: `It opened on ${primary.label} but not here: ${String(e.message).split("\n")[0].slice(0, 200)}`, expected: "The page opens on every device.", fix: "Check what differs for this device (redirects, user-agent rules, blocked scripts)." }, url: pg.url, device: dev.label, captureKey: null });
        }
      }
    } catch (e) {
      if (outOfTime(e)) { stoppedEarly = "ran out of time while testing devices"; report.get(dev.id).skipped = "stopped part way: the check ran out of time"; }
      else throw e;
    } finally { await s?.ctx.close().catch(() => undefined); }
    run.onDevice?.(snapshot());
  }

  // ---- 3. links that were not opened as pages
  run.step("checking links");
  const opened = new Set(pages.map((p) => pageKey(p.url)));
  const toCheck = [...allLinks.keys()].filter((h) => !opened.has(pageKey(h)) && !FILE.test(new URL(h).pathname.split("?")[0]) && !RISKY.test(h)).slice(0, MAX_LINK_CHECKS);
  let external = 0, checked = 0;
  for (const href of stoppedEarly ? [] : toCheck) {
    const r = await browser.linkStatus(href);
    if (r.skipped) { external++; continue; }
    checked++;
    const internal = sameSite(href, startUrl);
    const from = allLinks.get(href) ?? [];
    const broken = (r.status >= 400 && ![401, 403, 429].includes(r.status)) || (!r.status && Boolean(r.error)); // login walls and rate limits are not broken links
    if (broken) {
      entries.push({ issue: { kind: "link", key: `link:${href}`, severity: r.status === 404 || r.status === 410 || r.status >= 500 ? (internal ? "high" : "medium") : "low", confidence: "high",
        title: `Broken link: ${new URL(href).pathname === "/" ? new URL(href).host : href.replace(/^https?:\/\//, "").slice(0, 80)}`,
        observed: r.status ? `${href} answers HTTP ${r.status}.` : `${href} could not be reached (${r.error}).`, expected: "Every link opens a real page.", fix: "Fix or remove the link." }, url: from[0] ?? startUrl, device: primary.label, captureKey: null });
    }
  }

  // ---- 4. Claude looks at what a person would notice, on every device
  const claudeFindings = [];
  const looked = stoppedEarly || run.noModel ? [] : pages.slice(0, MODEL_PAGES); // a live run has no model to ask: the automatic checks are the result
  for (const [i, pg] of looked.entries()) {
    run.step(`Claude is reading page ${i + 1} of ${looked.length} on ${devices.length} devices`);
    const files = [];
    const map = new Map();
    const addTiles = async (cap, key, dev, max) => {
      const t = await tileForModel(cap.png, { maxTiles: max });
      t.tiles.forEach((tile, k) => {
        const name = `site-${i + 1}-${dev.id}-part${k + 1}.png`;
        fs.writeFileSync(path.join(run.brief.dir, name), tile.data);
        files.push(`${name} (${dev.label}, part ${k + 1} of ${t.tiles.length}, top to bottom)`);
        map.set(name, { key, offset: tile.y / t.height, span: tile.h / t.height, cap, device: dev.label });
      });
    };
    await addTiles(pg.cap, pg.key, primary, 3);
    for (const dev of devices.slice(1)) { const c = deviceCaps.get(dev.id)?.get(pg.url); if (c) await addTiles(c, null, dev, 1); }
    const known = entries.filter((e) => e.url === pg.url).map((e) => `- ${e.issue.title}`).slice(0, 15).join("\n") || "(none)";
    let answer;
    try {
      answer = await run.claude(`${PREAMBLE}

TASK: Review screenshots of ONE page of a campaign website, as a careful tester would, on several devices, and report problems a person would notice. Page: ${pg.url}
The files are the same page on: ${labels.join(", ")}. Each file name says which device it is. The first device is shown in full; the other devices show the first screen.
Files (read each with the Read tool):
${files.map((f) => `- ${f}`).join("\n")}

The automatic checks already report these, so do NOT repeat them:
${known}
Also not your job: console errors, failed requests, broken links and images, alt text, speed. Do not report a loading screen, loader or splash screen: the tool waits for those to finish and reports one itself if it never does.

Look for: error messages shown to the user, placeholder or test text (lorem ipsum, TODO, test@test), typos and spelling mistakes, text that is cut off or overlaps, a broken or empty-looking layout, images that look wrong or missing, buttons or text that are too small to use on a phone, content hidden or squeezed on a small screen, and things that look different or broken on ONE device compared with the others.
Be careful and specific. Report only what you can actually see. If the page looks fine, return an empty list. A screenshot never proves a backend rule.

<page_text>
${(pg.cap.text ?? "").slice(0, 5000)}
</page_text>

For each finding give file = the file name where you saw it, device = the device label of that file (or null if it is the same on all of them), and box = [x1, y1, x2, y2] on a 0-1000 grid of THAT file (or null if it is about the whole page). Every finding needs an evidence_note saying exactly what you saw.
Return {"findings": [...]}.`, CLAUDE_SCHEMA);
    } catch (e) {
      if (e instanceof JobFailed && /Cancelled/.test(e.message)) throw e;
      if (outOfTime(e)) { stoppedEarly ??= "ran out of time before Claude finished reading every page"; break; }
      continue; // one page the model could not read must not lose the deterministic results
    }
    for (const f of answer.findings ?? []) {
      const mp = map.get(String(f.file));
      const box = normaliseBox(f.box);
      const region = box && mp ? { x: box.x, y: Math.round((mp.offset + box.y * mp.span) * 10000) / 10000, w: box.w, h: Math.round(box.h * mp.span * 10000) / 10000 } : null;
      const dev = f.device && labels.includes(String(f.device)) ? String(f.device) : mp?.device ?? null;
      const onlyOne = dev && devices.length > 1 && dev !== primary.label;
      claudeFindings.push({
        title: `${String(f.title).slice(0, 280)}${onlyOne ? ` (${dev})` : ""}`, severity: sev(f.severity), confidence: f.confidence ?? "medium", description: f.description ?? "", observed: f.observed ?? "", expected: f.expected ?? "",
        suggested_correction: f.suggested_correction ?? "", evidence_note: `${f.evidence_note ?? "Seen in the screenshot."}${region ? " (region approximate)" : ""}`,
        affected_page: pg.url, reproducibility: dev ? `Seen in a screenshot on ${dev} (emulated)` : "Seen in a screenshot of the page", capture_key: mp?.key ?? pg.key, requirement_id: null, ...(region ? { region } : {}),
        ...(mp && !mp.key ? { _cap: mp.cap } : {}),
      });
      if (dev) { const entry = [...report.values()].find((r) => r.label === dev); if (entry) (entry.claude ??= []).push(String(f.title).slice(0, 120)); }
    }
  }

  const found = groupIssues(entries, MAX_FINDINGS, { allDevices: labels });
  const lf = loginFinding(logins.get(primary.id), startUrl);
  if (lf) found.push(lf);
  if (captcha) {
    found.push({ title: `A CAPTCHA protects ${captcha === 1 ? "a page" : `${captcha} pages`} of this site`, severity: "informational", confidence: "high", description: "The check never bypasses CAPTCHAs, so those pages were not checked beyond what is visible.",
      observed: "A CAPTCHA was detected.", expected: "", suggested_correction: "Turn the CAPTCHA off on staging, or test those pages by hand.", evidence_note: "Detected in the page source.", affected_page: pages[0]?.url, reproducibility: "Seen while opening the pages", requirement_id: null });
  }
  if (stoppedEarly) {
    found.push({ title: "The check stopped early", severity: "informational", confidence: "high", description: `It ${stoppedEarly}, so some devices or pages were not covered. What was found before that is reported.`, observed: stoppedEarly, expected: "", suggested_correction: "Run it again with fewer pages, or ask for a longer time limit in Settings.", evidence_note: "Recorded by the check itself.", affected_page: pages[0]?.url, reproducibility: "Time limit reached", requirement_id: null });
  }
  const findings = [...found, ...claudeFindings].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)).slice(0, MAX_FINDINGS);

  // Pictures are kept for the primary device always, and for another device only where it is the evidence for a finding (storage is limited).
  const stored = new Map();
  for (const f of findings) {
    if (f._cap) {
      if (!stored.has(f._cap)) stored.set(f._cap, await run.addCapture(f._cap));
      f.capture_key = stored.get(f._cap);
      delete f._cap;
    }
  }

  const devicesReport = snapshot();
  run.findings.push(...findings);
  const lg = logins.get(primary.id);
  run.siteNotes = { pages_checked: pages.length, devices_tested: devicesReport.filter((d) => d.pages_tested > 0).length, devices: devicesReport,
    login: lg ? { status: lg.status, needs: lg.needs ?? [], message: lg.message } : { status: "none" }, links_checked: checked, external_links_not_checked: external, found: findings.length, ...(stoppedEarly ? { stopped_early: stoppedEarly } : {}) };
}
