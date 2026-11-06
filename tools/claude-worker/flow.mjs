/**
 * Getting past a registration form, the way a campaign works: a landing page, a "Register" or "Play now" button, a form that asks for a
 * mobile number (and maybe a name), an OTP, and then the real pages. There is no password.
 *
 * The check finds what the page asks for, and fills ONLY with what a person gave it: values written in advance (a "Label = value" line)
 * or typed when asked. It never invents a number, a name or a code. It never fills anything that looks like a payment (card, CVV, UPI),
 * never bypasses a CAPTCHA, never clicks anything but the registration button and the form's own submit button, and a one-time code is
 * asked for every time and never reused. A footer newsletter box is not mistaken for the registration form.
 */

const CODE = /otp|one.?time|verification|verify|passcode|security.?code|\bcode\b|\bpin\b/i;
const PAYMENT = /card ?(number|no)|\bcvv\b|\bcvc\b|expir|\bupi\b|net ?banking|account ?number|\bifsc\b/i;
const CONSENT = /consent|agree|terms|privacy|policy|accept|i confirm|i have read|conditions/i;
const CTA = /^(register|sign ?up|play( now)?|get started|join( now)?|participate|enter( now)?|start( now)?|register (&|and) play( now)?|let'?s go)\b/i;
const SUBMIT = /^(submit|register|sign ?up|continue|next|send( otp| code)?|get ?(otp|code)|verify|confirm|proceed|start|play|go|enter|join|participate)\b/i;
const RISKY = /log ?out|sign ?out|delete|remove|unsubscribe|checkout|payment|cancel/i;
const CAPTCHA = /recaptcha|hcaptcha|turnstile/i;

/** Mobile, phone and email first: the fields that make a form a registration form. */
const WEIGHT = (f) => (/mobile|phone|tel|contact|whatsapp/i.test(`${f.label} ${f.name} ${f.type}`) ? 3 : /e-?mail/i.test(`${f.label} ${f.name} ${f.type}`) ? 2 : /name/i.test(`${f.label} ${f.name}`) ? 2 : CODE.test(`${f.label} ${f.name}`) ? 3 : 1);

const FIELDS = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !e.disabled; };
  const label = (e) => {
    const l = (e.labels && e.labels[0] && e.labels[0].innerText) || (e.closest("label") && e.closest("label").innerText) || e.getAttribute("aria-label") || "";
    return (l || e.getAttribute("placeholder") || e.getAttribute("name") || e.id || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  };
  const els = [...document.querySelectorAll("input, select, textarea")].filter((e) => !["hidden", "submit", "button", "image", "file", "search", "reset"].includes((e.type || "").toLowerCase()) && vis(e) && !e.readOnly);
  const forms = new Map(); let nf = 0;
  return els.map((e, i) => {
    e.setAttribute("data-jf", String(i));
    const f = e.closest("form");
    if (f && !forms.has(f)) forms.set(f, nf++);
    return { i, tag: e.tagName.toLowerCase(), type: (e.type || "text").toLowerCase(), label: label(e), name: e.getAttribute("name") || "", required: e.required || e.getAttribute("aria-required") === "true",
      form: f ? forms.get(f) : -1, footer: Boolean(e.closest("footer, [class*=newsletter i], [id*=newsletter i]")), options: e.tagName === "SELECT" ? [...e.options].slice(0, 12).map((o) => o.text.trim()) : [], checked: Boolean(e.checked) };
  });
})()`;

const BUTTONS = `((formIdx) => {
  const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !e.disabled; };
  const fields = [...document.querySelectorAll("[data-jf]")];
  const last = fields.length ? fields[fields.length - 1] : null;
  const scope = formIdx >= 0 && fields.find((f) => f.closest("form")) ? fields.filter((f) => f.closest("form"))[0].closest("form") : document;
  const forms = [...new Set(fields.map((f) => f.closest("form")).filter(Boolean))];
  const root = formIdx >= 0 ? forms[formIdx] || scope : document;
  return [...root.querySelectorAll("button, input[type=submit], input[type=button], [role=button], a.btn, a[class*=button i]")].filter(vis).map((b, i) => {
    b.setAttribute("data-jb", String(i));
    return { i, text: (b.innerText || b.value || b.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 60), submit: (b.type || "").toLowerCase() === "submit",
      after: Boolean(last && (last.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)) };
  });
})`;

const CTAS = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  return [...document.querySelectorAll("a, button, [role=button]")].filter(vis).map((e, i) => {
    e.setAttribute("data-jc", String(i));
    let same = true; try { if (e.href) same = new URL(e.href, location.href).origin === location.origin; } catch { same = false; }
    return { i, text: (e.innerText || e.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 60), same };
  });
})()`;

const find = (extras, label) => {
  const l = label.toLowerCase();
  return extras.find((e) => l.includes(e.label.toLowerCase()) || e.label.toLowerCase().includes(l)) ?? null;
};

async function settleAfter(page, settle) {
  try { await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }); } catch { /* it may not navigate at all */ }
  try { await page.waitForLoadState("networkidle", { timeout: 8_000 }); } catch { await page.waitForTimeout(1200); }
  if (settle) await settle(page).catch(() => undefined);
}

/** The group of fields that looks like the registration form on the page right now, or null. */
export async function findForm(page) {
  const all = await page.evaluate(FIELDS).catch(() => []);
  const groups = new Map();
  for (const f of all) {
    const k = f.form;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const scored = [...groups.entries()].map(([form, fields]) => {
    const inputs = fields.filter((f) => !["checkbox", "radio"].includes(f.type));
    const footerOnly = fields.every((f) => f.footer);
    const weight = Math.max(0, ...inputs.map(WEIGHT));
    // a lone email box in a footer is a newsletter, not a registration
    const newsletter = footerOnly && inputs.length <= 1;
    return { form, fields, inputs, score: newsletter || !inputs.length ? -1 : weight * 10 + inputs.length };
  }).filter((g) => g.score > 0).sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

async function clickRegistration(page, settle) {
  const list = await page.evaluate(CTAS).catch(() => []);
  const cta = list.find((c) => c.same && CTA.test(c.text) && !RISKY.test(c.text));
  if (!cta) return null;
  await page.locator(`[data-jc="${cta.i}"]`).first().click({ timeout: 8000 }).catch(() => undefined);
  await settleAfter(page, settle);
  return cta.text;
}

async function submitForm(page, group) {
  const buttons = await page.evaluate(`(${BUTTONS})(${group.form})`).catch(() => []);
  const pick = buttons.find((b) => b.submit) ?? buttons.find((b) => SUBMIT.test(b.text) && !RISKY.test(b.text)) ?? buttons.filter((b) => b.after && !RISKY.test(b.text))[0];
  if (pick) { await page.locator(`[data-jb="${pick.i}"]`).first().click({ timeout: 8000 }); return pick.text || "the button"; }
  const field = page.locator(`[data-jf="${group.inputs.at(-1).i}"]`).first();
  await field.press("Enter");
  return "Enter";
}

/**
 * Fills in whatever registration steps the page shows, one after another (details, then an OTP, ...), and stops when the page shows no
 * more form. `ask(label, { secret, options })` returns what the person typed, null to cancel, or "" to skip the form; without `ask`, a
 * missing value is reported instead. Returns { status, filled, needs, message } where status is
 *   "none" no registration form was found, "done" the form(s) were completed, "needs" a value is missing (and `needs` lists them),
 *   "skipped" the person skipped it, "failed" the page did not accept the details, "blocked" a CAPTCHA or a payment form is in the way.
 */
export async function completeForms(page, { extras = [], ask = null, settle, pause, step = () => {} } = {}) {
  const hold = (on) => { try { pause?.(on); } catch { /* the live view is optional */ } };
  const filled = [];
  let last = "";
  let usedCta = false;
  try {
    for (let round = 0; round < 6; round++) {
      let group = await findForm(page);
      if (!group && !usedCta) {
        const clicked = await clickRegistration(page, settle);
        usedCta = true;
        if (clicked) { step(`Opened “${clicked}”`); group = await findForm(page); }
      }
      if (!group) break;
      if (CAPTCHA.test(await page.content())) return { status: "blocked", filled, needs: [], message: "A CAPTCHA is on the form. It is never bypassed." };
      const pay = group.fields.find((f) => PAYMENT.test(`${f.label} ${f.name}`));
      if (pay) return { status: "blocked", filled, needs: [], message: `The form asks for a payment detail (${pay.label}). Payments are never filled in or tested here.` };

      // the same form again after a submit means the page did not accept what was sent
      const sig = group.fields.map((f) => `${f.label}|${f.type}`).join(",");
      if (sig === last) return { status: "failed", filled, needs: [], message: "The page showed the same form again, so it probably did not accept the details." };
      last = sig;

      const toType = [];
      const missing = [];
      for (const f of group.fields) {
        if (f.type === "checkbox") { if (CONSENT.test(f.label) && !f.checked) toType.push({ f, check: true }); continue; }
        if (f.type === "radio") continue;
        const code = CODE.test(`${f.label} ${f.name}`) || f.type === "password";
        const known = code ? null : find(extras, f.label);
        if (known) { toType.push({ f, value: known.value, secret: false }); continue; }
        if (!ask) { if (f.required || code || WEIGHT(f) >= 2) missing.push(f.label); continue; }
        step(`Waiting for you: ${f.label}`);
        const typed = await ask(f.label, { secret: code, options: f.options });
        if (typed == null) return { status: "failed", filled, needs: [f.label], message: "Nobody answered, so the test stopped." };
        if (typed === "") return { status: "skipped", filled, needs: [], message: "You skipped this form." };
        toType.push({ f, value: typed, secret: code });
      }
      if (missing.length) return { status: "needs", filled, needs: missing, message: `The page asks for ${missing.join(", ")}. Add ${missing.length === 1 ? "it" : "them"} in advance (as “${missing[0]} = value”) and run the test again.` };

      const secret = toType.some((t) => t.secret);
      if (secret) hold(true);
      for (const t of toType) {
        const loc = page.locator(`[data-jf="${t.f.i}"]`).first();
        if (t.check) { await loc.check({ timeout: 6000 }).catch(() => undefined); filled.push(`${t.f.label} (ticked)`); continue; }
        if (t.f.tag === "select") { await loc.selectOption({ label: t.value }, { timeout: 6000 }).catch(() => loc.selectOption({ index: 1 }).catch(() => undefined)); filled.push(t.f.label); continue; }
        await loc.fill(t.value, { timeout: 6000 });
        filled.push(t.f.label);
      }
      const pressed = await submitForm(page, group);
      step(`Sent the form (${pressed})`);
      await settleAfter(page, settle);
      await page.waitForTimeout(600);
      if (secret) setTimeout(() => hold(false), 1500);
    }
    return filled.length ? { status: "done", filled, needs: [], message: "Registered." } : { status: "none", filled, needs: [], message: "No registration form was found." };
  } finally { setTimeout(() => hold(false), 1500); }
}
