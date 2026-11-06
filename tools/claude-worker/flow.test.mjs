import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright-core";
import { completeForms, findForm } from "./flow.mjs";

let browser = null;
try { browser = await chromium.launch({ headless: true }); } catch { /* skipped below */ }
const skip = browser ? false : "Chromium is not installed (npm run claude:browser)";

const posts = [];
const doc = (b, extra = "") => `<!doctype html><html lang="en"><head><title>Cremica</title><meta name="viewport" content="width=device-width, initial-scale=1">${extra}</head><body style="font-family:sans-serif">${b}</body></html>`;
const NEWSLETTER = `<footer><form method="post" action="/newsletter"><input name="email" type="email" placeholder="Your email"><button>Subscribe</button></form></footer>`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const authed = /s=1/.test(req.headers.cookie ?? "");
  const send = (code, html, h = {}) => { res.writeHead(code, { "Content-Type": "text/html", ...h }); res.end(html); };
  if (req.method === "POST") {
    let b = ""; req.on("data", (d) => { b += d; });
    req.on("end", () => {
      const p = Object.fromEntries(new URLSearchParams(b)); posts.push({ path: url.pathname, ...p });
      if (url.pathname === "/otp") return p.mobile === "9876543210" && p.agree ? send(200, doc(`<form method="post" action="/verify"><label>Enter OTP <input name="otp" type="text" required></label><button type="submit">Verify</button></form>`)) : send(200, doc("<p role=alert>Invalid mobile number</p>"));
      if (url.pathname === "/verify") return p.otp === "424242" ? send(302, "", { Location: "/game", "Set-Cookie": "s=1; Path=/" }) : send(200, doc(`<p role=alert>Wrong OTP</p><form method="post" action="/verify"><label>Enter OTP <input name="otp" type="text" required></label><button type="submit">Verify</button></form>`));
      send(200, doc("ok"));
    });
    return;
  }
  const REG = `<form method="post" action="/otp"><label>Mobile number <input name="mobile" type="tel" required></label><label>Your name <input name="name" type="text"></label>
    <label><input type="checkbox" name="agree"> I agree to the terms and conditions</label><button type="submit">Get OTP</button></form>`;
  if (url.pathname === "/") return send(200, doc(`<h1>Win a console</h1><button id="cta" onclick="document.getElementById('reg').style.display='block'">REGISTER &amp; PLAY NOW</button><div id="reg" style="display:none">${REG}</div>${NEWSLETTER}`));
  if (url.pathname === "/direct") return send(200, doc(`<h1>Register</h1>${REG}`));
  if (url.pathname === "/news") return send(200, doc(`<h1>Just a page</h1><a href="/">Home</a>${NEWSLETTER}`));
  if (url.pathname === "/pay") return send(200, doc(`<form method="post" action="/pay"><label>Card number <input name="card"></label><label>CVV <input name="cvv"></label><button>Pay</button></form>`));
  if (url.pathname === "/captcha") return send(200, doc(`<div class="g-recaptcha"></div><script src="https://www.google.com/recaptcha/api.js"></script>${REG}`));
  if (url.pathname === "/game") return authed ? send(200, doc("<h1>Game</h1>")) : send(302, "", { Location: "/" });
  send(404, doc("nope"));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

const open = async (path) => { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(base + path); return { ctx, p }; };
const answers = (map, log = []) => async (label, opts) => { log.push({ label, ...opts }); return typeof map === "function" ? map(label, opts) : map[label] ?? map[Object.keys(map).find((k) => label.toLowerCase().includes(k.toLowerCase())) ?? ""] ?? null; };
const GOOD = { mobile: "9876543210", name: "Test Tester", otp: "424242" };

test("finds the registration button, asks for what the form wants, ticks the consent box, then asks for the OTP", { skip }, async () => {
  const log = [];
  const { ctx, p } = await open("/");
  const r = await completeForms(p, { ask: answers(GOOD, log) });
  assert.equal(r.status, "done", JSON.stringify(r));
  assert.deepEqual(log.map((l) => l.label.toLowerCase()), ["mobile number", "your name", "enter otp"]);
  assert.equal(log.find((l) => /otp/i.test(l.label)).secret, true, "an OTP is asked as a secret");
  assert.equal(log.find((l) => /mobile/i.test(l.label)).secret, false);
  assert.ok(r.filled.some((f) => /terms/i.test(f) && /ticked/.test(f)), "the consent box was ticked");
  const cookies = await ctx.cookies();
  assert.ok(cookies.some((c) => c.name === "s"), "the registration went through");
  assert.ok(!posts.some((x) => x.path === "/newsletter"), "the footer newsletter box was never touched");
  await ctx.close();
});

test("values given in advance are used, so only the OTP is asked", { skip }, async () => {
  const log = [];
  const { ctx, p } = await open("/direct");
  const r = await completeForms(p, { extras: [{ label: "Mobile number", value: "9876543210" }, { label: "Name", value: "Test Tester" }], ask: answers({ otp: "424242" }, log) });
  assert.equal(r.status, "done", JSON.stringify(r));
  assert.deepEqual(log.map((l) => l.label.toLowerCase()), ["enter otp"]);
  await ctx.close();
});

test("a one-time code is never taken from advance details: without anyone to ask it is reported, not guessed", { skip }, async () => {
  const before = posts.length;
  const { ctx, p } = await open("/direct");
  const r = await completeForms(p, { extras: [{ label: "Mobile number", value: "9876543210" }, { label: "Name", value: "Test Tester" }, { label: "OTP", value: "111111" }] });
  assert.equal(r.status, "needs", JSON.stringify(r));
  assert.ok(r.needs.some((n) => /otp/i.test(n)), "it says the OTP is what is missing");
  const sent = posts.slice(before);
  assert.ok(sent.some((x) => x.path === "/otp"), "the registration details were sent");
  assert.ok(!sent.some((x) => x.path === "/verify"), "no code was ever typed in");
  await ctx.close();
});

test("with no one to ask and nothing given, it says what the page wants and sends nothing", { skip }, async () => {
  const before = posts.length;
  const { ctx, p } = await open("/direct");
  const r = await completeForms(p, {});
  assert.equal(r.status, "needs");
  assert.ok(r.needs.some((n) => /mobile/i.test(n)));
  assert.match(r.message, /Mobile number = value/);
  assert.equal(posts.length, before, "nothing was sent");
  await ctx.close();
});

test("skipping a form leaves the page alone", { skip }, async () => {
  const before = posts.length;
  const { ctx, p } = await open("/direct");
  const r = await completeForms(p, { ask: async () => "" });
  assert.equal(r.status, "skipped");
  assert.equal(posts.length, before);
  await ctx.close();
});

test("a wrong OTP is reported as a form that did not go through", { skip }, async () => {
  const { ctx, p } = await open("/direct");
  const r = await completeForms(p, { ask: answers({ ...GOOD, otp: "000000" }) });
  assert.equal(r.status, "failed");
  assert.match(r.message, /did not accept/);
  await ctx.close();
});

test("a newsletter box is not a registration form", { skip }, async () => {
  const log = [];
  const { ctx, p } = await open("/news");
  assert.equal(await findForm(p), null);
  const r = await completeForms(p, { ask: answers({}, log) });
  assert.equal(r.status, "none");
  assert.equal(log.length, 0, "nothing was asked");
  await ctx.close();
});

test("payment details are never filled, and a CAPTCHA is never bypassed", { skip }, async () => {
  const before = posts.length;
  const pay = await open("/pay");
  const a = await completeForms(pay.p, { ask: answers({ card: "4111" }) });
  assert.equal(a.status, "blocked");
  assert.match(a.message, /payment/i);
  await pay.ctx.close();
  const cap = await open("/captcha");
  const b = await completeForms(cap.p, { ask: answers(GOOD) });
  assert.equal(b.status, "blocked");
  assert.match(b.message, /CAPTCHA/);
  assert.equal(posts.length, before);
  await cap.ctx.close();
});

test("the live picture is paused while an OTP is typed", { skip }, async () => {
  const events = [];
  const { ctx, p } = await open("/direct");
  await completeForms(p, { ask: answers(GOOD), pause: (on) => events.push(on) });
  assert.ok(events.includes(true), "paused while the code was typed");
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(events.at(-1), false);
  await ctx.close();
});

test.after(async () => { server.close(); await browser?.close(); });
