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

const DEFAULT_MAX_PAGES = 10;
const MOBILE_PAGES = 3;
const MAX_LINK_CHECKS = 40;
const MODEL_PAGES = 6;
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
export function pageIssues(cap, { device = "desktop", isStart = false } = {}) {
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
  for (const i of (f.imgs ?? []).filter((x) => x.broken)) {
    add({ kind: "image", key: `img:${String(i.src).split("?")[0]}`, severity: "medium", title: `Broken image: ${String(i.src).split("/").pop()?.slice(0, 60) || "image"}`,
      observed: `The image ${i.src} did not load.`, expected: "The image appears.", fix: "Check the image path and that the file is uploaded." });
  }
  const noAlt = (f.imgs ?? []).filter((x) => x.visible && x.alt === null && !x.broken);
  if (noAlt.length) {
    add({ kind: "alt", key: `alt:${where}`, severity: "low", title: `${noAlt.length} image${noAlt.length === 1 ? "" : "s"} without alt text on ${where}`,
      observed: `${noAlt.length} visible image(s) have no alt attribute, so screen readers cannot describe them.`, expected: "Every meaningful image has alt text (empty alt for decoration).", fix: "Add alt text to the images." });
  }
  if (device === "mobile" && f.overflow > 8) {
    add({ kind: "overflow", key: `overflow:${where}`, severity: "medium", title: `Page scrolls sideways on mobile: ${where}`,
      observed: `The page is ${f.overflow}px wider than a 390px phone screen.`, expected: "Nothing is wider than the screen on mobile.", fix: "Find the element that is too wide (fixed widths, wide images or tables) and make it fit." });
  }
  if (device === "desktop" && f.title === "" && cap.status < 400) {
    add({ kind: "title", key: `title:${where}`, severity: "low", title: `Page has no title: ${where}`, observed: "The page <title> is empty.", expected: "Every page has a clear title.", fix: "Add a <title>." });
  }
  if (isStart && device === "mobile" && f.viewportMeta === false) {
    add({ kind: "viewport", key: "viewport", severity: "medium", title: "No mobile viewport setting", observed: "The page has no <meta name=\"viewport\">, so phones show it zoomed out.", expected: "A viewport meta tag.", fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' });
  }
  if ((cap.mixed ?? []).length) {
    add({ kind: "mixed", key: `mixed:${where}`, severity: "medium", title: `Insecure content on a secure page: ${where}`,
      observed: `${cap.mixed.length} request(s) use http://, for example ${cap.mixed[0]}.`, expected: "Everything on an https page loads over https.", fix: "Change those URLs to https." });
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

/** Same problem on several pages becomes one finding that lists the pages. */
export function groupIssues(entries, cap = MAX_FINDINGS) {
  const map = new Map();
  for (const { issue, url, device, captureKey } of entries) {
    const g = map.get(issue.key) ?? { issue, pages: [], captureKey, device };
    if (!g.pages.some((p) => p.url === url && p.device === device)) g.pages.push({ url, device });
    map.set(issue.key, g);
  }
  return [...map.values()].map((g) => {
    const i = g.issue;
    const list = g.pages.slice(0, 5).map((p) => `${p.device} ${(() => { try { return new URL(p.url).pathname; } catch { return p.url; } })()}`).join(", ");
    return {
      title: i.title.slice(0, 300), severity: i.severity, confidence: i.confidence, description: `${i.observed}${g.pages.length > 1 ? ` Seen on ${g.pages.length} pages: ${list}${g.pages.length > 5 ? ", …" : ""}.` : ""}`,
      observed: i.observed, expected: i.expected, suggested_correction: i.fix,
      evidence_note: "Found automatically while loading the page in a headless browser; the console and network entries are attached where relevant.",
      affected_page: g.pages[0].url, reproducibility: `Seen on ${g.pages.length} page${g.pages.length === 1 ? "" : "s"} (${g.device})`, capture_key: g.captureKey, requirement_id: null,
      ...(i.console ? { console: i.console } : {}), ...(i.network ? { network: i.network } : {}),
    };
  }).sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)).slice(0, cap);
}

const CLAUDE_SCHEMA = {
  type: "object", required: ["findings"],
  properties: { findings: { type: "array", items: { type: "object", required: ["title", "severity", "confidence", "evidence_note"], properties: {
    title: { type: "string" }, severity: { type: "string", enum: SEVERITY }, description: { type: "string" }, observed: { type: "string" }, expected: { type: "string" },
    suggested_correction: { type: "string" }, confidence: { type: "string", enum: CONFIDENCE }, evidence_note: { type: "string" },
    file: { type: ["string", "null"] }, box: { type: ["array", "null"], items: { type: "number" }, minItems: 4, maxItems: 4 } } } } },
};

/** The whole check. `run` is the staging Run (browser helpers, uploads, Claude calls); `browser` is an open Browser. */
export async function siteCheck(run, browser) {
  const inp = run.brief.input;
  const maxPages = Math.max(1, Math.min(30, Number(inp.limits?.site_check_max_pages) || DEFAULT_MAX_PAGES));
  const startUrl = new URL(String(inp.staging_url)).toString();
  const seen = new Set();
  const queue = [];
  for (const p of run.paths) {
    const u = new URL(String(p).replace(/^\//, ""), run.base).toString();
    if (!seen.has(pageKey(u))) { seen.add(pageKey(u)); queue.push(u); }
  }
  const pages = []; // { url, cap, key }
  const entries = []; // deterministic issues with where they were seen
  const allLinks = new Map(); // href -> [source pages]
  let captcha = 0;

  // ---- 1. desktop pass: open pages, follow same-site links
  for (let i = 0; queue.length && pages.length < maxPages; i++) {
    const url = queue.shift();
    run.step(`checking page ${pages.length + 1}: ${new URL(url).pathname || "/"}`);
    let cap;
    try {
      cap = await browser.capture(url, "desktop", { inspect: true });
    } catch (e) {
      if (!pages.length && e instanceof JobFailed) throw e; // the start page itself cannot be opened: say so, loudly
      entries.push({ issue: { kind: "load", key: `load:${url}`, severity: "high", confidence: "high", title: `Page could not be opened: ${new URL(url).pathname}`,
        observed: String(e.message).slice(0, 300), expected: "The page opens.", fix: "Check the link and the server." }, url, device: "desktop", captureKey: null });
      continue;
    }
    if (cap.contentType && !/html/i.test(cap.contentType)) continue; // a file, not a page
    const key = await run.addCapture(cap);
    pages.push({ url: cap.url, cap, key });
    if (cap.captcha) captcha++;
    for (const issue of pageIssues(cap, { device: "desktop", isStart: pages.length === 1 })) entries.push({ issue, url: cap.url, device: "desktop", captureKey: key });
    for (const l of cap.facts?.links ?? []) { const a = allLinks.get(l.href) ?? []; if (a.length < 5) a.push(cap.url); allLinks.set(l.href, a); }
    queue.push(...pickCrawlLinks(cap.facts?.links, startUrl, seen));
  }

  // ---- 2. mobile pass for the first pages
  const mobile = [];
  for (const pg of pages.slice(0, MOBILE_PAGES)) {
    run.step(`checking ${new URL(pg.url).pathname || "/"} on a phone`);
    try {
      const cap = await browser.capture(pg.url, "mobile", { inspect: true });
      const key = await run.addCapture(cap);
      mobile.push({ url: cap.url, cap, key });
      for (const issue of pageIssues(cap, { device: "mobile", isStart: pg === pages[0] })) {
        // Problems already reported on desktop for the same page are not repeated; mobile adds the mobile-only ones.
        if (!entries.some((e) => e.issue.key === issue.key && e.url === cap.url)) entries.push({ issue, url: cap.url, device: "mobile", captureKey: key });
      }
    } catch (e) {
      if (e instanceof JobFailed && /Refusing/.test(e.message)) throw e;
      // a mobile load that fails after the desktop one worked is worth a mention, but not worth failing the check
    }
  }

  // ---- 3. links that were not opened as pages
  run.step("checking links");
  const opened = new Set(pages.map((p) => pageKey(p.url)));
  const toCheck = [...allLinks.keys()].filter((h) => !opened.has(pageKey(h)) && !FILE.test(new URL(h).pathname.split("?")[0]) && !RISKY.test(h)).slice(0, MAX_LINK_CHECKS);
  let external = 0, checked = 0;
  for (const href of toCheck) {
    const r = await browser.linkStatus(href);
    if (r.skipped) { external++; continue; }
    checked++;
    const internal = sameSite(href, startUrl);
    const from = allLinks.get(href) ?? [];
    const broken = (r.status >= 400 && ![401, 403, 429].includes(r.status)) || (!r.status && Boolean(r.error)); // login walls and rate limits are not broken links
    if (broken) {
      entries.push({ issue: { kind: "link", key: `link:${href}`, severity: r.status === 404 || r.status === 410 || r.status >= 500 ? (internal ? "high" : "medium") : "low", confidence: "high",
        title: `Broken link: ${new URL(href).pathname === "/" ? new URL(href).host : href.replace(/^https?:\/\//, "").slice(0, 80)}`,
        observed: r.status ? `${href} answers HTTP ${r.status}.` : `${href} could not be reached (${r.error}).`, expected: "Every link opens a real page.", fix: "Fix or remove the link." }, url: from[0] ?? startUrl, device: "desktop", captureKey: pages.find((p) => p.url === from[0])?.key ?? pages[0]?.key ?? null });
    }
  }

  // ---- 4. Claude looks at what a person would notice
  const claudeFindings = [];
  const looked = pages.slice(0, MODEL_PAGES);
  for (const [i, pg] of looked.entries()) {
    run.step(`Claude is reading page ${i + 1} of ${looked.length}`);
    const files = [];
    const map = new Map();
    const addTiles = async (cap, key, label, max) => {
      const t = await tileForModel(cap.png, { maxTiles: max });
      t.tiles.forEach((tile, k) => {
        const name = `site-${i + 1}-${label}-part${k + 1}.png`;
        fs.writeFileSync(path.join(run.brief.dir, name), tile.data);
        files.push(`${name} (${label}, part ${k + 1} of ${t.tiles.length}, top to bottom)`);
        map.set(name, { key, offset: tile.y / t.height, span: tile.h / t.height });
      });
    };
    await addTiles(pg.cap, pg.key, "desktop", 3);
    const m = mobile.find((x) => x.url === pg.url);
    if (m) await addTiles(m.cap, m.key, "mobile", 2);
    const known = entries.filter((e) => e.url === pg.url).map((e) => `- ${e.issue.title}`).slice(0, 15).join("\n") || "(none)";
    let answer;
    try {
      answer = await run.claude(`${PREAMBLE}

TASK: Review screenshots of ONE page of a campaign website, as a careful tester would, and report problems a person would notice. Page: ${pg.url}
Files (read each with the Read tool):
${files.map((f) => `- ${f}`).join("\n")}

The automatic checks already report these, so do NOT repeat them:
${known}
Also not your job: console errors, failed requests, broken links and images, alt text, speed.

Look for: error messages shown to the user, placeholder or test text (lorem ipsum, TODO, test@test), typos and spelling mistakes, text that is cut off or overlaps, a broken or empty-looking layout, images that look wrong or missing, unreadable text (low contrast), buttons or forms that look unfinished (for example a form with no submit button), inconsistent styling, and anything that looks half-built.
Be careful and specific. Report only what you can actually see. If the page looks fine, return an empty list. A screenshot never proves a backend rule.

<page_text>
${(pg.cap.text ?? "").slice(0, 5000)}
</page_text>

For each finding give file = the file name where you saw it and box = [x1, y1, x2, y2] on a 0-1000 grid of THAT file (or null if it is about the whole page). Every finding needs an evidence_note saying exactly what you saw.
Return {"findings": [...]}.`, CLAUDE_SCHEMA);
    } catch (e) {
      if (e instanceof JobFailed && /Cancelled|ran out of time/.test(e.message)) throw e;
      continue; // one page the model could not read must not lose the deterministic results
    }
    for (const f of answer.findings ?? []) {
      const mp = map.get(String(f.file));
      const box = normaliseBox(f.box);
      const region = box && mp ? { x: box.x, y: Math.round((mp.offset + box.y * mp.span) * 10000) / 10000, w: box.w, h: Math.round(box.h * mp.span * 10000) / 10000 } : null;
      claudeFindings.push({
        title: String(f.title).slice(0, 300), severity: sev(f.severity), confidence: f.confidence ?? "medium", description: f.description ?? "", observed: f.observed ?? "", expected: f.expected ?? "",
        suggested_correction: f.suggested_correction ?? "", evidence_note: `${f.evidence_note ?? "Seen in the screenshot."}${region ? " (region approximate)" : ""}`,
        affected_page: pg.url, reproducibility: "Seen in a screenshot of the page", capture_key: mp?.key ?? pg.key, requirement_id: null, ...(region ? { region } : {}),
      });
    }
  }

  const found = groupIssues(entries);
  if (captcha) {
    found.push({ title: `A CAPTCHA protects ${captcha === 1 ? "a page" : `${captcha} pages`} of this site`, severity: "informational", confidence: "high", description: "The check never bypasses CAPTCHAs, so those pages were not checked beyond the CAPTCHA.",
      observed: "A CAPTCHA was detected.", expected: "", suggested_correction: "Turn the CAPTCHA off on staging, or test those pages by hand.", evidence_note: "Detected in the page source.", affected_page: pages[0]?.url, reproducibility: "Seen on load", capture_key: pages[0]?.key, requirement_id: null });
  }
  const findings = [...found, ...claudeFindings].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)).slice(0, MAX_FINDINGS);
  run.findings.push(...findings);
  run.siteNotes = { pages_checked: pages.length, mobile_pages: mobile.length, links_checked: checked, external_links_not_checked: external, found: findings.length };
}
