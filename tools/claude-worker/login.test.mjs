import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright-core";
import { parseExtras, signIn } from "./login.mjs";

let browser = null;
try { browser = await chromium.launch({ headless: true }); } catch { /* skipped below */ }
const skip = browser ? false : "Chromium is not installed (npm run claude:browser)";

const posts = [];
const page = (title, body) => `<!doctype html><title>${title}</title><body>${body}</body>`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const cookie = /s=1/.test(req.headers.cookie ?? "");
  const send = (code, html, h = {}) => { res.writeHead(code, { "Content-Type": "text/html", ...h }); res.end(html); };
  const form = (extra = "", err = "") => page("Login", `${err ? `<p role="alert">${err}</p>` : ""}<form method="post" action="${url.pathname}">
    <label>Mobile number <input name="user" type="text" required></label><label>Password <input name="pw" type="password" required></label>${extra}<button type="submit">Log in</button></form>`);
  if (req.method === "POST") {
    let body = ""; req.on("data", (d) => { body += d; });
    req.on("end", () => {
      const p = new URLSearchParams(body); posts.push({ path: url.pathname, ...Object.fromEntries(p) });
      const good = p.get("user") === "tester" && p.get("pw") === "secret" && (url.pathname !== "/otp" || p.get("otp") === "123456");
      if (url.pathname === "/two-step") return good ? send(200, page("Code", `<form method="post" action="/two-step-2"><label>Verification code <input name="code" type="text" required></label><button>Verify</button></form>`)) : send(200, form("", "Invalid details"));
      return good ? send(302, "", { Location: "/account", "Set-Cookie": "s=1; Path=/" }) : send(200, form(url.pathname === "/otp" ? '<label>OTP <input name="otp" type="text"></label>' : "", "Invalid username or password"));
    });
    return;
  }
  if (url.pathname === "/") return send(200, page("Home", `<form method="post" action="/newsletter"><input name="email" placeholder="Your email"><button>Subscribe</button></form><a href="/logout">Log out</a><a href="/login">Sign in</a>`));
  if (url.pathname === "/plain") return send(200, page("Plain", "<p>Nothing to sign in to.</p>"));
  if (url.pathname === "/login") return send(200, form());
  if (url.pathname === "/otp") return send(200, form('<label>OTP <input name="otp" type="text"></label>'));
  if (url.pathname === "/two-step") return send(200, form());
  if (url.pathname === "/captcha") return send(200, page("Captcha", `<div class="g-recaptcha"></div><script src="https://www.google.com/recaptcha/api.js"></script>${form()}`));
  if (url.pathname === "/account") return cookie ? send(200, page("Account", "<h1>Welcome</h1>")) : send(302, "", { Location: "/login" });
  send(404, page("Not found", "no"));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

const open = async (path) => { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(base + path); return { ctx, p }; };
const GOOD = { username: "tester", password: "secret" };

test("parseExtras separates basic auth from login details", () => {
  assert.deepEqual(parseExtras("staging:letmein"), { basic: { username: "staging", password: "letmein" }, fields: [] });
  assert.deepEqual(parseExtras("OTP = 123456\nOutlet code=AB12\nstaging:pw"), { basic: { username: "staging", password: "pw" }, fields: [{ label: "OTP", value: "123456" }, { label: "Outlet code", value: "AB12" }] });
  assert.deepEqual(parseExtras(""), { basic: null, fields: [] });
  assert.deepEqual(parseExtras("Mobile: 98765 = x").basic, null); // an = line is a login detail, never HTTP auth
});

test("signs in through a link to the login page, and the session carries on", { skip }, async () => {
  const { ctx, p } = await open("/");
  const r = await signIn(p, GOOD);
  assert.equal(r.status, "ok");
  await p.goto(base + "/account");
  assert.match(await p.locator("h1").innerText(), /Welcome/);
  assert.ok(!posts.some((x) => x.path === "/newsletter"), "no other form was touched");
  await ctx.close();
});

test("wrong details are reported as rejected, not as a crash", { skip }, async () => {
  const { ctx, p } = await open("/login");
  const r = await signIn(p, { username: "tester", password: "nope" });
  assert.equal(r.status, "failed");
  assert.match(r.message, /rejected|not accepted/);
  await ctx.close();
});

test("a form that asks for an OTP that is not stored is NOT submitted, and says what is missing", { skip }, async () => {
  const before = posts.length;
  const { ctx, p } = await open("/otp");
  const r = await signIn(p, GOOD);
  assert.equal(r.status, "needs");
  assert.deepEqual(r.needs, ["OTP"]);
  assert.match(r.message, /OTP = value/);
  assert.equal(posts.length, before, "nothing was sent to the server");
  await ctx.close();
});

test("once the OTP is stored it is used, and the login works", { skip }, async () => {
  const { ctx, p } = await open("/otp");
  const r = await signIn(p, { ...GOOD, extra: "OTP = 123456" });
  assert.equal(r.status, "ok");
  await ctx.close();
});

test("a second step that asks for a code is reported as needed details", { skip }, async () => {
  const { ctx, p } = await open("/two-step");
  const r = await signIn(p, GOOD);
  assert.equal(r.status, "needs");
  assert.match(r.needs.join(" "), /code/i);
  await ctx.close();
});

test("no login form means nothing is typed anywhere", { skip }, async () => {
  const { ctx, p } = await open("/plain");
  assert.equal((await signIn(p, GOOD)).status, "none");
  assert.equal((await signIn(p, { username: "", password: "" })).status, "none");
  await ctx.close();
});

test("a CAPTCHA is never bypassed", { skip }, async () => {
  const before = posts.length;
  const { ctx, p } = await open("/captcha");
  assert.equal((await signIn(p, GOOD)).status, "blocked");
  assert.equal(posts.length, before);
  await ctx.close();
});

test("the live picture is paused while signing in", { skip }, async () => {
  const events = [];
  const { ctx, p } = await open("/login");
  await signIn(p, GOOD, { pause: (on) => events.push(on) });
  assert.equal(events[0], true);
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(events.at(-1), false);
  await ctx.close();
});

test.after(async () => { server.close(); await browser?.close(); });
