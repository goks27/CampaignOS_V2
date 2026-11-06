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
import { DEVICES } from "./devices.mjs";

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
      case "/about": return send(200, page(`<h1>About</h1><div style="width:500px;height:20px;background:#ddd">wide</div><p>Lorem ipsum dolor</p><script>console.error("about exploded")</script>`));
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

test("site_check: opens the pages, follows safe links only, reports what is broken, and never touches risky or private URLs", { timeout: 300_000 }, async () => {
  hits.length = 0;
  const { srv, base } = await site();
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-site-"));
    const brief = { id: "job-1", review_type: "site_check", dir, timeout_seconds: 900, files: [], input: {
      staging_url: base, page_paths: ["/"], devices: ["desktop"], allowed_domains: [], environment: null, design_assets: [], requirements: [], test_cases: [],
      capture_prefix: "camp/job-1/", limits: { site_check_max_pages: 2 } } };
    let prompts = [];
    const run = async (o) => { prompts.push(o.prompt); return claudeAnswer([
      { title: "Typo in the heading", severity: "low", confidence: "medium", evidence_note: "Heading reads 'Hmoe'", file: "site-1-iphone-15-part1.png", box: [0, 0, 900, 150], description: "d", observed: "Hmoe", expected: "Home", suggested_correction: "Fix" },
      { title: "Unknown file ignored for region", severity: "low", confidence: "low", evidence_note: "x", file: "../../etc/passwd", box: [0, 0, 10, 10] }])(o); };
    const { result, meta } = await runStaging(brief, { db: fakeDb(), model: "sonnet", timeoutMs: 5000, run, guard: new NetGuard(["localhost"], { unsafeAllowPrivateForTests: true }) });
    const titles = result.findings.map((f) => f.title);

    // what it found
    assert.ok(titles.some((t) => /Broken image: missing\.png/.test(t)), titles.join(" | "));
    assert.ok(titles.some((t) => /Console error: about exploded/.test(t) || /about exploded/.test(t)));
    assert.ok(titles.some((t) => /Placeholder text on \/about/.test(t)));
    assert.ok(titles.some((t) => /scrolls sideways on small screens: \/about/.test(t)), titles.join(" | "));
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

    // every device opened every page, and the report says which device has which problem
    const dev = Object.fromEntries(result.notes.devices.map((d) => [d.id, d]));
    assert.deepEqual(Object.keys(dev), DEVICES.map((d) => d.id));
    assert.ok(DEVICES.every((d) => d.touch) && !DEVICES.some((d) => /desktop|laptop/i.test(d.id)), "phones and tablets only");
    assert.ok(["iPhone", "Android", "iPad", "Android tablet"].every((f) => DEVICES.some((d) => d.family === f)), "iOS and Android, phones and tablets");
    assert.ok(result.notes.devices.every((d) => d.pages_tested === 2 && d.pages_failed === 0 && d.engine === "Chromium (emulated)"), JSON.stringify(result.notes.devices.map((d) => [d.id, d.pages_tested])));
    assert.ok(dev["iphone-15"].top_issues.some((t) => /scrolls sideways/.test(t)), "the wide block is a problem on a phone");
    assert.ok(!dev.ipad.top_issues.some((t) => /scrolls sideways/.test(t)), "and not on a tablet, where it fits");
    const side = result.findings.find((f) => /scrolls sideways/.test(f.title));
    assert.match(side.title, /\(.*iPhone 15/, "a problem seen on only some devices says which");
    assert.match(side.description, /emulated devices/);
    assert.doesNotMatch(result.findings.find((f) => /Broken image: missing/.test(f.title)).title, /\(/, "a problem seen on every device is not narrowed to one");
    assert.match(prompts[0], /iPhone 15.*Pixel 7/s);
    assert.ok(prompts[0].includes("site-1-iphone-15-part1.png"));

    // shape
    assert.equal(result.notes.pages_checked, 2);
    assert.equal(result.notes.devices_tested, DEVICES.length);
    assert.ok(result.notes.links_checked >= 1);
    assert.ok(result.captures.length >= 2 && result.captures.every((c) => c.storage_path.startsWith("camp/job-1/")));
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

// ---------------------------------------------------------------- signing in to go further
async function memberSite() {
  const posts = [], hits = [];
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const authed = /s=1/.test(req.headers.cookie ?? "");
    hits.push(`${req.method} ${url.pathname}`);
    const send = (code, body, h = {}) => { res.writeHead(code, { "Content-Type": "text/html", ...h }); res.end(body); };
    if (req.method === "POST") {
      let b = ""; req.on("data", (d) => { b += d; });
      req.on("end", () => { const p = new URLSearchParams(b); posts.push(url.pathname);
        return p.get("user") === "tester" && p.get("pw") === "secret" ? send(302, "", { Location: "/", "Set-Cookie": "s=1; Path=/" }) : send(200, page("<p role=alert>Invalid username or password</p>")); });
      return;
    }
    if (url.pathname === "/") return send(200, page(`<h1>Home</h1>${authed ? '<a href="/members">Members</a>' : '<a href="/login">Log in</a>'}<a href="/public">Public</a>`));
    if (url.pathname === "/login") return send(200, page('<form method="post" action="/login"><label>Mobile number <input name="user" type="text"></label><label>Password <input name="pw" type="password"></label><button type="submit">Log in</button></form>'));
    if (url.pathname === "/members") return authed ? send(200, page('<h1>Members</h1><img src="/secret-banner.png" alt="banner">')) : send(302, "", { Location: "/login" });
    if (url.pathname === "/public") return send(200, page("<h1>Public</h1>"));
    send(404, "nope");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, posts, hits, base: `http://localhost:${srv.address().port}/` };
}
const memberBrief = (base, creds) => ({ id: "job-m", review_type: "site_check", dir: fs.mkdtempSync(path.join(os.tmpdir(), "cw-site-")), timeout_seconds: 900, files: [], input: {
  staging_url: base, page_paths: ["/"], allowed_domains: [], environment: creds ? { id: "e", base_url: base, has_credentials: true } : null, design_assets: [], requirements: [], test_cases: [],
  capture_prefix: "camp/job-m/", limits: { site_check_max_pages: 5, site_check_devices: ["iphone-15", "pixel-7"] } } });
const memberDb = (creds) => ({ ...fakeDb(), rpc: async (fn) => (fn === "worker_get_credentials" ? creds : null) });
const guardLocal = () => new NetGuard(["localhost"], { unsafeAllowPrivateForTests: true });

test("site_check with stored credentials signs in on every device and checks the pages behind the login", async () => {
  const { srv, posts, base } = await memberSite();
  try {
    const { result } = await runStaging(memberBrief(base, true), { db: memberDb({ username: "tester", password: "secret" }), model: "sonnet", timeoutMs: 5000, run: claudeAnswer([]), guard: guardLocal() });
    const titles = result.findings.map((f) => f.title);
    assert.ok(titles.some((t) => /Broken image: secret-banner\.png/.test(t)), "the members-only page was reached and checked: " + titles.join(" | "));
    assert.equal(result.notes.login.status, "ok");
    assert.deepEqual(result.notes.devices.map((d) => [d.id, d.login, d.pages_tested]), [["iphone-15", "ok", 3], ["pixel-7", "ok", 3]]);
    assert.deepEqual([...new Set(posts)], ["/login"], "the only form ever submitted is the login");
  } finally { srv.close(); }
});

test("site_check without credentials stays on the public pages and does not type anything", async () => {
  const { srv, posts, base } = await memberSite();
  try {
    const { result } = await runStaging(memberBrief(base, false), { db: fakeDb(), model: "sonnet", timeoutMs: 5000, run: claudeAnswer([]), guard: guardLocal() });
    assert.ok(!result.findings.some((f) => /secret-banner/.test(f.title)));
    assert.equal(result.notes.login.status, "none");
    assert.equal(posts.length, 0, "nothing was typed or submitted");
  } finally { srv.close(); }
});

test("site_check with wrong credentials reports it plainly and still checks the public pages", async () => {
  const { srv, base } = await memberSite();
  try {
    const { result } = await runStaging(memberBrief(base, true), { db: memberDb({ username: "tester", password: "wrong" }), model: "sonnet", timeoutMs: 5000, run: claudeAnswer([]), guard: guardLocal() });
    const f = result.findings.find((x) => /Sign-in did not work/.test(x.title));
    assert.ok(f && f.severity === "high", JSON.stringify(result.findings.map((x) => x.title)));
    assert.equal(result.notes.login.status, "failed");
    assert.ok(result.notes.pages_checked >= 2);
  } finally { srv.close(); }
});

// ---------------------------------------------------------------- hosts outside the allow-list
test("images the network guard refused are reported as not loaded, never as broken images", async () => {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/cdn.png") { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")); }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(page(`<h1>Home</h1><img src="http://127.0.0.1:${srv.address().port}/cdn.png" alt="from another host"><img src="/missing.png" alt="really broken">`));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const base = `http://localhost:${srv.address().port}/`;
    const brief = memberBrief(base, false);
    brief.input.limits.site_check_devices = ["iphone-15"];
    const { result } = await runStaging(brief, { db: fakeDb(), model: "sonnet", timeoutMs: 5000, run: claudeAnswer([]), guard: new NetGuard(["localhost"], { unsafeAllowPrivateForTests: true }) });
    const titles = result.findings.map((f) => f.title);
    assert.ok(!titles.some((t) => /Broken image: cdn\.png/.test(t)), "an image that was refused is not a broken image: " + titles.join(" | "));
    assert.ok(titles.some((t) => /Broken image: missing\.png/.test(t)), "a genuinely missing image is still reported");
    const note = result.findings.find((f) => /to other hosts were not loaded/.test(f.title));
    assert.ok(note && note.severity === "informational");
    assert.match(note.observed, /127\.0\.0\.1/);
    assert.match(note.suggested_correction, /allowed domains/);
  } finally { srv.close(); }
});
