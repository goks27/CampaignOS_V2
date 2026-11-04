// Run with: node --test tools/claude-worker
// Site check: pure checks, plus real headless Chromium against a local site that is broken on purpose.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { groupIssues, pageIssues, pageKey, pickCrawlLinks, RISKY, sameSite } from "./sitecheck.mjs";
import { runStaging } from "./staging.mjs";
import { NetGuard } from "./netguard.mjs";
import { validate } from "./core.mjs";

// ---------------------------------------------------------------- pure functions
test("pageKey collapses queries, fragments, case and trailing slashes", () => {
  assert.equal(pageKey("https://A.com/Path/?page=2#x"), "https://a.com/path");
  assert.equal(pageKey("https://a.com/"), "https://a.com/");
  assert.ok(sameSite("https://www.a.com/x", "https://a.com/y"));
  assert.ok(!sameSite("https://a.com", "https://b.com"));
});

test("the crawler never follows links that could change something, files, downloads or other sites", () => {
  const seen = new Set([pageKey("https://s.example/")]);
  const links = [
    { href: "https://s.example/about?utm_source=x", text: "About" }, { href: "https://s.example/about?utm_source=y", text: "About again" },
    { href: "https://s.example/logout", text: "Log out" }, { href: "https://s.example/account/delete", text: "Delete account" },
    { href: "https://s.example/cart/add-to-cart?id=1", text: "Add" }, { href: "https://s.example/x", text: "Unsubscribe now" },
    { href: "https://s.example/brochure.pdf", text: "Brochure" }, { href: "https://s.example/dl", text: "Get", download: true },
    { href: "https://other.example/", text: "Other" }, { href: "mailto:a@b.c", text: "Mail" }, { href: "https://s.example/", text: "Home" },
    { href: "https://s.example/contact", text: "Contact" }, { href: "https://www.s.example/terms", text: "Terms" },
  ];
  const picked = pickCrawlLinks(links, "https://s.example/", seen);
  assert.deepEqual(picked, ["https://s.example/about", "https://s.example/contact", "https://www.s.example/terms"]);
  for (const bad of ["/logout", "/sign-out", "/delete", "/unsubscribe", "/checkout", "/payment", "/pay", "/add-to-cart"]) assert.ok(RISKY.test(bad), bad);
});

const cap = (over = {}) => ({ url: "https://s.example/about", status: 200, console: [], failed: [], mixed: [], loadMs: 800, text: "Hello", facts: { title: "About", imgs: [], links: [], overflow: 0, unlabelledInputs: 0, viewportMeta: true, emptyLinks: 0 }, ...over });

test("pageIssues finds the problems a person would care about, and nothing on a clean page", () => {
  assert.deepEqual(pageIssues(cap()), []);
  const bad = cap({
    status: 404, loadMs: 14000, mixed: ["http://s.example/a.js"], text: "Lorem ipsum dolor. Welcome undefined",
    console: [{ type: "error", text: "Failed to load" }, { type: "pageerror", text: "TypeError: x is null" }, { type: "error", text: "Failed to load" }],
    failed: [{ url: "https://s.example/app.css?v=3", status: 404 }, { url: "https://s.example/favicon.ico", status: 404 }, { url: "https://cdn.other.example/x.js", status: 500 }],
    facts: { title: "", imgs: [{ src: "https://s.example/hero.png", broken: true, visible: true, alt: "" }, { src: "https://s.example/a.png", broken: false, visible: true, alt: null }, { src: "https://s.example/b.png", broken: false, visible: true, alt: null }], links: [], overflow: 0, unlabelledInputs: 2, viewportMeta: true },
  });
  const kinds = pageIssues(bad, { isStart: true }).map((i) => i.kind).sort();
  assert.deepEqual(kinds, ["alt", "console", "console", "http", "image", "label", "mixed", "request", "request", "slow", "text", "text"].sort()); // no "title" issue: an error page without a title is not news
  const http404 = pageIssues(bad, { isStart: true }).find((i) => i.kind === "http");
  assert.equal(http404.severity, "high"); // the start page itself returning 404
  assert.ok(!pageIssues(bad).some((i) => /favicon/.test(i.title)), "favicon noise is ignored");
});

test("noise is not reported: duplicate console lines, our own blocked requests, the page itself, and login walls are not bugs", () => {
  const c = cap({
    url: "https://s.example/app",
    console: [{ type: "error", text: "Failed to load resource: the server responded with a status of 404 ()" }, { type: "error", text: "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector" }],
    failed: [{ url: "https://tracker.other.example/e", error: "net::ERR_BLOCKED_BY_CLIENT" }, { url: "https://s.example/app", status: 404 }, { url: "https://s.example/app.css", status: 404 }],
  });
  assert.deepEqual(pageIssues(c).map((i) => i.title), ["HTTP 404 request: s.example/app.css"]);
  const login = pageIssues(cap({ status: 401 }));
  assert.equal(login.length, 1);
  assert.equal(login[0].severity, "informational");
  assert.match(login[0].title, /needs a login/);
});

test("mobile-only problems: sideways scrolling and the missing viewport tag", () => {
  const m = cap({ facts: { ...cap().facts, overflow: 120, viewportMeta: false } });
  assert.deepEqual(pageIssues(m, { device: "mobile", isStart: true }).map((i) => i.kind).sort(), ["overflow", "viewport"]);
  assert.deepEqual(pageIssues(cap({ facts: { ...cap().facts, overflow: 120 } }), { device: "desktop" }), []); // overflow is judged on mobile only
});

test("the same problem on several pages becomes one finding that lists them", () => {
  const issue = { kind: "console", key: "console:boom", severity: "low", confidence: "high", title: "Console error: boom", observed: "boom", expected: "", fix: "fix" };
  const g = groupIssues([
    { issue, url: "https://s.example/a", device: "desktop", captureKey: "c0" }, { issue, url: "https://s.example/b", device: "desktop", captureKey: "c1" }, { issue, url: "https://s.example/a", device: "desktop", captureKey: "c0" },
    { issue: { ...issue, key: "http:x", severity: "high", title: "Page returns HTTP 500" }, url: "https://s.example/c", device: "desktop", captureKey: "c2" },
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].severity, "high"); // most severe first
  assert.match(g[1].description, /Seen on 2 pages/);
});

// ---------------------------------------------------------------- real browser against a site that is broken on purpose
const hits = [];
function page(body, extra = "") { return `<!doctype html><html lang="en"><head><title>T</title><meta name="viewport" content="width=device-width, initial-scale=1">${extra}</head><body style="margin:0;font-family:sans-serif">${body}</body></html>`; }
async function site() {
  const srv = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const send = (code, body, type = "text/html") => { res.writeHead(code, { "Content-Type": type }); res.end(body); };
    switch (req.url.split("?")[0]) {
      case "/": return send(200, page(`<h1>Home</h1>
        <a href="/about">About</a> <a href="/logout">Log out</a> <a href="/account/delete">Delete my account</a> <a href="/gone">Old page</a>
        <a href="/redir">Elsewhere</a> <a href="https://elsewhere.example/">External</a> <a href="/file.pdf">PDF</a>
        <img src="/missing.png" alt="hero"> <img src="/ok.png"><input type="text">`));
      case "/about": return send(200, page(`<h1>About</h1><div style="width:900px;height:20px;background:#ddd">wide</div><p>Lorem ipsum dolor</p><script>console.error("about exploded")</script>`));
      case "/gone": return send(404, "nope");
      case "/redir": res.writeHead(302, { Location: `http://127.0.0.1:${srv.address().port}/secret` }); return res.end();
      case "/secret": return send(200, "TOP SECRET");
      case "/ok.png": return send(200, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), "image/png");
      case "/file.pdf": return send(200, "%PDF-1.4", "application/pdf");
      default: return send(404, "not found");
    }
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, base: `http://localhost:${srv.address().port}/` };
}
const fakeDb = () => { const uploads = []; return { uploads, upload: async (b, p) => { uploads.push(`${b}/${p}`); }, rpc: async () => null }; };
const claudeAnswer = (findings) => async (o) => ({ structured_output: { findings }, usage: { input_tokens: 4, output_tokens: 3 }, modelUsage: { "claude-sonnet-5-5": { outputTokens: 3 } }, _prompt: o.prompt });

test("site_check: opens the pages, follows safe links only, reports what is broken, and never touches risky or private URLs", async () => {
  hits.length = 0;
  const { srv, base } = await site();
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-site-"));
    const brief = { id: "job-1", review_type: "site_check", dir, timeout_seconds: 900, files: [], input: {
      staging_url: base, page_paths: ["/"], devices: ["desktop"], allowed_domains: [], environment: null, design_assets: [], requirements: [], test_cases: [],
      capture_prefix: "camp/job-1/", limits: { site_check_max_pages: 2 } } };
    let prompts = [];
    const run = async (o) => { prompts.push(o.prompt); return claudeAnswer([
      { title: "Typo in the heading", severity: "low", confidence: "medium", evidence_note: "Heading reads 'Hmoe'", file: "site-1-desktop-part1.png", box: [0, 0, 500, 100], description: "d", observed: "Hmoe", expected: "Home", suggested_correction: "Fix" },
      { title: "Unknown file ignored for region", severity: "low", confidence: "low", evidence_note: "x", file: "../../etc/passwd", box: [0, 0, 10, 10] }])(o); };
    const { result, meta } = await runStaging(brief, { db: fakeDb(), model: "sonnet", timeoutMs: 5000, run, guard: new NetGuard(["localhost"], { unsafeAllowPrivateForTests: true }) });
    const titles = result.findings.map((f) => f.title);

    // what it found
    assert.ok(titles.some((t) => /Broken image: missing\.png/.test(t)), titles.join(" | "));
    assert.ok(titles.some((t) => /Console error: about exploded/.test(t) || /about exploded/.test(t)));
    assert.ok(titles.some((t) => /Placeholder text on \/about/.test(t)));
    assert.ok(titles.some((t) => /scrolls sideways on mobile: \/about/.test(t)));
    assert.ok(titles.some((t) => /form field without a label/.test(t)));
    assert.ok(titles.some((t) => /Broken link: .*\/gone/.test(t)), "a link not opened as a page is checked and reported");
    const typo = result.findings.find((f) => f.title === "Typo in the heading");
    assert.ok(typo && typo.region && typo.region.w > 0.4 && typo.capture_key === "c0", JSON.stringify(typo));
    assert.equal(result.findings.find((f) => /Unknown file/.test(f.title)).region, undefined);

    // what it must never do
    const log = hits.join("\n");
    assert.doesNotMatch(log, /\/logout/); assert.doesNotMatch(log, /\/account\/delete/);
    assert.doesNotMatch(log, /\/secret/, "a redirect to a private address is never followed");
    assert.doesNotMatch(log, /\/file\.pdf/);
    assert.ok(hits.every((h) => /^(GET|HEAD) /.test(h)), "only GET and HEAD, no POST/PUT/DELETE");
    assert.doesNotMatch(prompts[0], /Ignore/); // sanity: prompt is ours
    assert.match(prompts[0], /UNTRUSTED DATA/);
    assert.match(prompts[0], /do NOT repeat/);

    // shape
    assert.equal(result.notes.pages_checked, 2);
    assert.ok(result.notes.links_checked >= 1);
    assert.ok(result.captures.length >= 3 && result.captures.every((c) => c.storage_path.startsWith("camp/job-1/")));
    assert.match(meta.prompt_version, /sitecheck/);
    assert.deepEqual(validate(result, brief), []);
  } finally { srv.close(); }
});

test("site_check: the start page failing is an error you can read, not an empty result", async () => {
  const brief = { id: "j", review_type: "site_check", dir: fs.mkdtempSync(path.join(os.tmpdir(), "cw-site-")), timeout_seconds: 600, files: [], input: {
    staging_url: "http://localhost:1/", page_paths: ["/"], allowed_domains: [], capture_prefix: "c/j/", limits: {}, design_assets: [], requirements: [], test_cases: [] } };
  await assert.rejects(runStaging(brief, { db: fakeDb(), model: "sonnet", timeoutMs: 1000, guard: new NetGuard(["localhost"], { unsafeAllowPrivateForTests: true }), run: claudeAnswer([]) }), /Could not open/);
});

test("site_check allows only the submitted site's own host, never private addresses", async () => {
  const brief = { id: "j", review_type: "site_check", dir: os.tmpdir(), timeout_seconds: 600, files: [], input: { staging_url: "http://192.168.1.20/", page_paths: ["/"], allowed_domains: [], capture_prefix: "c/", limits: {}, design_assets: [], requirements: [], test_cases: [] } };
  // No injected guard: the real NetGuard is used and an IP literal is refused outright.
  await assert.rejects(runStaging(brief, { db: fakeDb(), model: "sonnet", timeoutMs: 1000, run: claudeAnswer([]) }), /IP literals|Refusing/);
});
