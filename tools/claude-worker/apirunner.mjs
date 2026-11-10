/**
 * API checks: call a staging endpoint and assert on the answer, with no browser and no AI.
 *
 * Same network rules as every other test: http(s) only, allow-listed public hosts only (the request's own host is allowed), private,
 * loopback, link-local and metadata addresses refused, every redirect checked by hand. A secret header (an API key) is sent but never
 * returned, logged or stored. The response is read up to a limit. An expected 4xx or 5xx is a PASS when that is what was expected:
 * "rejected the duplicate code with 409" is the behaviour being tested.
 */
import { NetGuard } from "./netguard.mjs";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY_OUT = 100_000, MAX_BODY_IN = 1_000_000, MAX_REDIRECTS = 3;
const FORBIDDEN_HEADERS = /^(host|connection|content-length|transfer-encoding|upgrade|proxy-.*)$/i;

export class ApiCheckError extends Error { constructor(msg, code = "bad_request") { super(msg); this.code = code; } }

/** `a.b[0].c` -> the value, or undefined. */
export function pick(obj, p) {
  let cur = obj;
  for (const part of String(p).replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** Validates a request definition. Throws ApiCheckError with a plain message. */
export function parseRequest(r) {
  if (!r || typeof r !== "object") throw new ApiCheckError("Send a request object.");
  const method = String(r.method ?? "GET").toUpperCase();
  if (!METHODS.has(method)) throw new ApiCheckError(`${method} is not allowed. Use GET, POST, PUT, PATCH or DELETE.`);
  let url;
  try { url = new URL(String(r.url ?? "")); } catch { throw new ApiCheckError("Enter a full address, starting with https://"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new ApiCheckError("Only http:// and https:// addresses can be called.");
  const headers = {};
  for (const [k, v] of Object.entries(r.headers ?? {})) {
    if (typeof v !== "string" || !/^[A-Za-z0-9-]{1,60}$/.test(k)) throw new ApiCheckError(`Header "${k}" is not valid.`);
    if (FORBIDDEN_HEADERS.test(k)) throw new ApiCheckError(`The ${k} header cannot be set.`);
    headers[k] = v.slice(0, 2000);
  }
  let body;
  if (r.body != null && method !== "GET") {
    body = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    if (body.length > 100_000) throw new ApiCheckError("The request body is too large (100 KB at most).");
    if (typeof r.body !== "string" && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["Content-Type"] = "application/json";
  }
  const secretHeaders = (r.secret_headers ?? []).map((h) => String(h).toLowerCase());
  return { method, url, headers, body, expect: r.expect ?? {}, timeoutMs: Math.min(30_000, Math.max(1000, Number(r.timeout_ms) || 15_000)), secretHeaders, label: String(r.label ?? "").slice(0, 120) };
}

/** Pure: the assertions of `expect` against what came back. */
export function assertAll(expect, res) {
  const out = [];
  const add = (name, ok, expected, actual) => out.push({ name, ok, expected: String(expected), actual: String(actual) });
  if (expect.status != null) { const want = [].concat(expect.status).map(Number); add("Status", want.includes(res.status), want.join(" or "), res.status); }
  else add("Status", res.status < 400, "a success (below 400)", res.status);
  if (expect.maxMs != null) add("Answered in time", res.ms <= expect.maxMs, `within ${expect.maxMs} ms`, `${res.ms} ms`);
  for (const j of expect.json ?? []) {
    const v = pick(res.json, j.path);
    if ("equals" in j) add(`${j.path} equals`, JSON.stringify(v) === JSON.stringify(j.equals), JSON.stringify(j.equals), v === undefined ? "missing" : JSON.stringify(v));
    else if (j.type) add(`${j.path} is ${j.type}`, typeOf(v) === j.type, j.type, v === undefined ? "missing" : typeOf(v));
    else add(`${j.path} exists`, v !== undefined, "present", v === undefined ? "missing" : "present");
  }
  if (expect.schema) {
    const miss = [];
    for (const k of expect.schema.required ?? []) if (pick(res.json, k) === undefined) miss.push(`${k} is missing`);
    for (const [k, t] of Object.entries(expect.schema.properties ?? {})) { const v = pick(res.json, k); if (v !== undefined && typeOf(v) !== t) miss.push(`${k} is ${typeOf(v)}, expected ${t}`); }
    add("Response shape", !miss.length, "matches the expected shape", miss.length ? miss.join("; ") : "matches");
  }
  return out;
}

/**
 * Runs one API check. Resolves with {status, ms, bytes, json?, assertions, result}; never throws for a refused address or a network
 * failure (those are results: `blocked`, `failed`). result is passed | failed | blocked.
 */
export async function runApiCheck(raw, { guard, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const r = parseRequest(raw);
  const g = guard ?? new NetGuard([r.url.hostname]);
  let url = r.url.toString(), method = r.method, body = r.body;
  const started = now();
  let res = null;
  try {
    for (let hop = 0; ; hop++) {
      const ok = await g.check(url);
      if (!ok.ok) return { result: "blocked", error: `That address was not called: ${ok.why}. Add its domain in Settings if it is yours.`, assertions: [], ms: now() - started };
      res = await fetchImpl(url, { method, headers: r.headers, body, redirect: "manual", signal: AbortSignal.timeout(r.timeoutMs) });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) return { result: "failed", error: `Too many redirects (more than ${MAX_REDIRECTS}).`, assertions: [], ms: now() - started };
        url = new URL(res.headers.get("location"), url).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) { method = "GET"; body = undefined; }
        continue;
      }
      break;
    }
  } catch (e) {
    const timeout = e?.name === "TimeoutError" || /aborted|timed out/i.test(String(e?.message));
    return { result: "failed", error: timeout ? `No answer within ${r.timeoutMs / 1000} seconds.` : `The request failed: ${String(e?.cause?.code ?? e?.message ?? e).split("\n")[0].slice(0, 160)}`, assertions: [{ name: "Reachable", ok: false, expected: "an answer", actual: timeout ? "timeout" : "no connection" }], ms: now() - started, timeout };
  }
  const ms = now() - started;
  const reader = res.body?.getReader?.();
  let text = "", bytes = 0;
  if (reader) {
    const dec = new TextDecoder();
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > MAX_BODY_IN) { await reader.cancel(); return { result: "failed", status: res.status, ms, error: "The response is larger than 1 MB.", assertions: [] }; } text += dec.decode(value, { stream: true }); }
  } else text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { /* not JSON: asserts on json paths will fail */ }
  const assertions = assertAll(r.expect, { status: res.status, ms, json });
  const out = { result: assertions.every((a) => a.ok) ? "passed" : "failed", status: res.status, ms, bytes, finalUrl: url, assertions, contentType: res.headers.get("content-type") ?? "" };
  if (json !== undefined) out.json = text.length > MAX_BODY_OUT ? undefined : json;
  else out.text = text.slice(0, 2000);
  return out;
}
