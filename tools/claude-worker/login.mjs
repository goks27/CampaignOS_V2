/**
 * Signing in to a staging site so a check can go further than the public pages.
 *
 * Only runs when the environment has stored test credentials. It types the STORED values into the site's login form, and nothing else:
 *   - it never fills or submits any other form, never clicks anything but the login form's own submit button,
 *   - it never submits a form that still has a required field it has no stored value for (it reports what is missing instead),
 *   - it never bypasses a CAPTCHA, and it never puts credentials in a prompt, a file or a log.
 * Every request still goes through the network guard, so it can only reach the site's own allowed hosts.
 */

const USER_HINT = /user|e-?mail|mobile|phone|login|account|member|contact/i;
const CODE_HINT = /otp|one.?time|verification|verify|passcode|security.?code|\bcode\b|\bpin\b|captcha/i;
const LOGIN_LINK = /\b(log ?in|sign ?in|signin|login|my account)\b/i;
const SUBMIT_TEXT = /^(log ?in|sign ?in|submit|continue|next|enter|go|verify)\b/i;
const FAIL_TEXT = /invalid|incorrect|wrong|not match|failed|try again|unauthori[sz]ed|doesn'?t exist|not registered/i;
const FIELD = 'input:visible:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=image]):not([type=file])';

/**
 * The environment's "extra" box holds two kinds of lines. `user:pass` is HTTP basic auth for the staging server. `Label = value`
 * is another detail a login asks for (an OTP for a test number, a PIN, an outlet code), matched to the field by its label.
 */
export function parseExtras(extra) {
  const lines = String(extra ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let basic = null;
  const fields = [];
  for (const l of lines) {
    const eq = l.indexOf("=");
    if (eq > 0) { fields.push({ label: l.slice(0, eq).trim(), value: l.slice(eq + 1).trim() }); continue; }
    const c = l.indexOf(":");
    if (c > 0 && !basic) basic = { username: l.slice(0, c), password: l.slice(c + 1) };
  }
  return { basic, fields: fields.filter((f) => f.label && f.value) };
}

const text = async (loc) => ((await loc.getAttribute("aria-label").catch(() => null)) || (await loc.getAttribute("placeholder").catch(() => null)) || (await loc.getAttribute("name").catch(() => null)) || (await loc.getAttribute("id").catch(() => null)) || "").trim();

/** What a visible field is called, in words a person would use. */
async function describe(loc) {
  const label = await loc.evaluate((el) => {
    const l = el.labels?.[0]?.innerText || el.closest("label")?.innerText || "";
    return l.trim();
  }).catch(() => "");
  return (label || (await text(loc)) || "an input").slice(0, 60);
}

async function findField(page, scope, label) {
  const esc = label.replace(/["\\]/g, "");
  for (const loc of [scope.getByLabel(label, { exact: false }), scope.getByPlaceholder(label, { exact: false }),
    scope.locator(`input[name*="${esc}" i]:visible, input[id*="${esc}" i]:visible, textarea[name*="${esc}" i]:visible`)]) {
    try { if (await loc.count()) return loc.first(); } catch { /* try the next way of finding it */ }
  }
  return null;
}

async function settleAfter(page, settle) {
  try { await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }); } catch { /* it may not navigate at all */ }
  try { await page.waitForLoadState("networkidle", { timeout: 10_000 }); } catch { await page.waitForTimeout(1500); }
  if (settle) await settle(page).catch(() => undefined);
}

/** A link to the login page, if this page has one and the current page has no password box. Same site only. */
async function loginLink(page) {
  return page.evaluate(`((src) => {
    const re = new RegExp(src, "i");
    for (const a of document.querySelectorAll("a[href]")) {
      const t = (a.innerText || a.getAttribute("aria-label") || a.getAttribute("title") || "").trim();
      const h = a.getAttribute("href") || "";
      if (/out|off|register|sign ?up|forgot|reset/i.test(t + " " + h)) continue;
      if (re.test(t) || /\\/(log-?in|sign-?in|account\\/login)\\b/i.test(h)) { try { const u = new URL(a.href, location.href); if (u.origin === location.origin) return u.toString(); } catch {} }
    }
    return null;
  })(${JSON.stringify(LOGIN_LINK.source)})`);
}

/**
 * Tries to sign in on the page it is given (opening the login page first if there is a link to it).
 * Returns { status, needs, message } where status is
 *   "none"    no login form was found,
 *   "ok"      signed in (the password box is gone),
 *   "failed"  the site did not accept the stored details,
 *   "needs"   the login asks for something that is not stored (`needs` lists what), so nothing was submitted or the next step is missing,
 *   "blocked" a CAPTCHA is in the way.
 */
export async function signIn(page, creds, { settle, pause } = {}) {
  const hold = (on) => { try { pause?.(on); } catch { /* the live view is optional */ } };
  hold(true);
  try {
    if (!creds?.username || !creds?.password) return { status: "none", needs: [], message: "No login details are stored." };
    const extras = parseExtras(creds.extra).fields;

    let pw = page.locator("input[type=password]:visible").first();
    if (!(await pw.count())) {
      const href = await loginLink(page);
      if (!href) return { status: "none", needs: [], message: "No login form was found on the start page." };
      await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await settleAfter(page, settle);
      pw = page.locator("input[type=password]:visible").first();
      if (!(await pw.count())) return { status: "none", needs: [], message: "The login page has no password box." };
    }
    if (/recaptcha|hcaptcha|turnstile/i.test(await page.content())) return { status: "blocked", needs: [], message: "A CAPTCHA protects the login. It is never bypassed." };

    const form = pw.locator("xpath=ancestor::form[1]");
    const scope = (await form.count()) ? form : page.locator("body");

    // The username box: the first text-like field that sounds like one, else the first field before the password.
    const fields = scope.locator(FIELD);
    const n = await fields.count();
    let userBox = null;
    for (let i = 0; i < n && !userBox; i++) { const f = fields.nth(i); if (USER_HINT.test(await text(f)) || /email|tel/i.test((await f.getAttribute("type")) ?? "")) userBox = f; }
    userBox ??= n ? fields.first() : null;

    // Every other visible field needs a stored value, or the form is not submitted.
    const filled = new Set();
    const missing = [];
    for (let i = 0; i < n; i++) {
      const f = fields.nth(i);
      if (userBox && (await f.evaluate((a, b) => a === b, await userBox.elementHandle()))) continue;
      const name = await describe(f);
      const match = extras.find((e) => name.toLowerCase().includes(e.label.toLowerCase()) || e.label.toLowerCase().includes(name.toLowerCase()));
      if (match) { await f.fill(match.value); filled.add(name); continue; }
      const required = (await f.getAttribute("required")) !== null || (await f.getAttribute("aria-required")) === "true" || CODE_HINT.test(name);
      if (required) missing.push(name);
    }
    if (missing.length) return { status: "needs", needs: missing, message: `The login asks for ${missing.join(", ")}. Add ${missing.length === 1 ? "it" : "them"} to the environment's extra details (as “${missing[0]} = value”) and run the check again.` };

    if (userBox) await userBox.fill(creds.username);
    await pw.fill(creds.password);

    const submit = scope.locator("button[type=submit]:visible, input[type=submit]:visible").first();
    if (await submit.count()) await submit.click({ timeout: 10_000 });
    else {
      const byText = scope.getByRole("button", { name: SUBMIT_TEXT }).first();
      if (await byText.count()) await byText.click({ timeout: 10_000 }); else await pw.press("Enter");
    }
    await settleAfter(page, settle);
    await page.waitForTimeout(800);

    if (/recaptcha|hcaptcha|turnstile/i.test(await page.content()) && (await page.locator("input[type=password]:visible").count())) return { status: "blocked", needs: [], message: "A CAPTCHA appeared at sign-in. It is never bypassed." };

    const stillThere = (await page.locator("input[type=password]:visible").count()) > 0;
    // A second step: the site now wants a code or similar that was not stored.
    const next = page.locator(FIELD);
    const asks = [];
    for (let i = 0; i < Math.min(await next.count(), 6); i++) {
      const name = await describe(next.nth(i));
      if (CODE_HINT.test(name) && !extras.some((e) => name.toLowerCase().includes(e.label.toLowerCase()))) asks.push(name);
    }
    if (asks.length) return { status: "needs", needs: asks, message: `After the username and password, the site asks for ${asks.join(", ")}. Add ${asks.length === 1 ? "it" : "them"} to the environment's extra details (as “${asks[0]} = value”) and run the check again.` };
    // An error message in an alert or error box means the details were refused, even when the form is not shown again.
    const alerts = (await page.locator('[role=alert]:visible, .error:visible, .alert:visible, .alert-danger:visible, [class*=error i]:visible, [class*=invalid i]:visible').allInnerTexts().catch(() => [])).join(" ").slice(0, 1500);
    if (FAIL_TEXT.test(alerts)) return { status: "failed", needs: [], message: "The site rejected the stored login details." };
    if (stillThere) {
      const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
      return { status: "failed", needs: [], message: FAIL_TEXT.test(body) ? "The site rejected the stored login details." : "The login form is still showing after sign-in, so the stored details were probably not accepted." };
    }
    return { status: "ok", needs: [], message: "Signed in." };
  } finally {
    // The picture stays paused a moment longer so the typed values are never on screen.
    setTimeout(() => hold(false), 1500);
  }
}
