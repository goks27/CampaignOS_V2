// Run with: node --test tools/claude-worker/worker.test.mjs
// Offline tests: no Supabase, no model. They cover PDF text extraction and result validation.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pdfPages, validate } from "./core.mjs";

// jsPDF is installed in apps/web; reuse it to build a tiny PDF instead of committing a binary fixture.
const here = path.dirname(fileURLToPath(import.meta.url));
const { jsPDF } = createRequire(path.join(here, "..", "..", "apps", "web", "package.json"))("jspdf");

function samplePdf() {
  const d = new jsPDF();
  d.text("Users must register using a valid 10 digit mobile number and verify with an OTP before entering.", 10, 20);
  d.addPage();
  d.text("Each user may participate only once per day. Reward is credited within 7 working days.", 10, 20);
  d.addPage(); // intentionally blank = looks scanned
  return Buffer.from(d.output("arraybuffer"));
}

test("extracts text per page and flags pages without text", async () => {
  const pages = await pdfPages(samplePdf(), 30);
  assert.equal(pages.length, 3);
  assert.match(pages[0].text, /valid 10 digit mobile number/);
  assert.equal(pages[0].method, "text");
  assert.equal(pages[2].scanned, true);
  assert.equal(pages[2].method, "ocr");
});

test("refuses a PDF over the page limit with a clear message", async () => {
  await assert.rejects(pdfPages(samplePdf(), 2), /maximum per submission is 2/);
});

const sowBrief = { review_type: "sow_analysis", input: {} };
const pages = [{ page_no: 1, method: "text", text: "Users must register using a valid 10 digit mobile number and verify with an OTP before entering." }];
const goodReq = { title: "Register with mobile number", category: "validation", priority: "high", confidence: "high", source_pages: [1],
  source_text: "Users must register using a valid 10 digit mobile number and verify with an OTP" };

test("accepts a SOW result whose quote is verbatim", () => {
  assert.deepEqual(validate({ pages, requirements: [goodReq] }, sowBrief), []);
});

test("rejects an invented quote, a bad category and missing pages", () => {
  const bad = { ...goodReq, category: "marketing", source_text: "Winners will receive a free holiday to Goa for two people next year" };
  const errs = validate({ pages, requirements: [bad] }, sowBrief);
  assert.ok(errs.some((e) => /category/.test(e)));
  assert.ok(errs.some((e) => /not found verbatim/.test(e)));
  assert.ok(validate({ requirements: [goodReq] }, sowBrief).some((e) => /pages/.test(e)));
});

test("an unverifiable quote is allowed only when marked needs_manual_verification", () => {
  const r = { ...goodReq, source_text: "Something paraphrased, not in the document", confidence: "needs_manual_verification" };
  assert.deepEqual(validate({ pages, requirements: [r] }, sowBrief), []);
});

const designBrief = {
  review_type: "sow_vs_design",
  input: {
    requirements: [{ id: "11111111-1111-1111-1111-111111111111", ref: "REQ-001", category: "validation" },
                   { id: "22222222-2222-2222-2222-222222222222", ref: "REQ-002", category: "reward_logic" }],
    assets: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", screen_name: "Home" }],
  },
};

test("accepts a well-formed design finding with an approximate region", () => {
  const f = { title: "OTP field missing", severity: "high", confidence: "medium", requirement_id: "11111111-1111-1111-1111-111111111111",
    design_asset_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, evidence_note: "No OTP input below the mobile field" };
  assert.deepEqual(validate({ findings: [f], checks: [] }, designBrief), []);
});

test("rejects unknown requirement ids, foreign screens and out-of-range regions", () => {
  const f = { title: "Bad", requirement_id: "99999999-9999-9999-9999-999999999999", design_asset_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    region: { x: 0.9, y: 0.2, w: 0.5, h: 0.1 }, evidence_note: "x" };
  const errs = validate({ findings: [f] }, designBrief);
  assert.equal(errs.length, 3);
});

test("an additional observation (no requirement) must say what was seen", () => {
  assert.ok(validate({ findings: [{ title: "Low contrast button" }] }, designBrief).some((e) => /evidence_note/.test(e)));
  assert.deepEqual(validate({ findings: [{ title: "Low contrast button", evidence_note: "Grey text on white CTA" }] }, designBrief), []);
});

test("a backend rule can never be verified from a screenshot", () => {
  const errs = validate({ findings: [], checks: [{ requirement_id: "22222222-2222-2222-2222-222222222222", result: "verified", method: "visually_observed" }] }, designBrief);
  assert.ok(errs.some((e) => /backend rule/.test(e)));
  const ok = validate({ findings: [], checks: [{ requirement_id: "22222222-2222-2222-2222-222222222222", result: "needs_verification" }] }, designBrief);
  assert.deepEqual(ok, []);
});
