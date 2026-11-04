/**
 * Playground: check files and URLs against Claude without saving anything. The connector (npm run claude) does the work.
 * Documents are converted to PDF here first (same converter as SOW uploads), images are downscaled, text is sent as text.
 */
import { CONNECTOR_URL } from "./connector";
import { ConnectorOffline } from "./assistant";
import { prepareImage } from "@/lib/images";
import { toPdf } from "@/lib/toPdf";

export const MAX_FILES = 12;
export const MAX_URLS = 3;
/** The connector refuses more than about 45 MB; stay under it so the browser never sees a bare connection reset. */
export const MAX_REQUEST_BYTES = 40_000_000;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const TEXT = /\.(txt|csv|md|markdown)$/i;

export type Item =
  | { id: string; kind: "image" | "pdf" | "text"; name: string; file: File; bytes: number }
  | { id: string; kind: "url"; name: string; url: string; device: "desktop" | "mobile" };

export type Finding = {
  title: string; severity: "critical" | "high" | "medium" | "low" | "informational"; confidence: string; description: string; expected: string; observed: string;
  suggested_correction: string; evidence_note: string; requirement_ref: string | null; source: string | null; region: { x: number; y: number; w: number; h: number } | null;
};
export type Check = { requirement_ref: string; result: "verified" | "needs_verification"; note: string };
export type Capture = { source: string; url: string; device: string; image: string; width: number; height: number; console: { type: string; text: string }[] };
export type Result = { verdict: "yes" | "partly" | "no" | "unclear"; summary: string; findings: Finding[]; checks: Check[]; captures: Capture[]; blocked: string[]; ms: number };

let n = 0;
export const newId = () => `p${++n}`;

export function classify(file: File): "image" | "pdf" | "text" | null {
  if (IMAGE.test(file.name) || file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (TEXT.test(file.name)) return "text";
  if (/\.(docx|xlsx|pptx)$/i.test(file.name)) return "pdf"; // converted to PDF when sent
  return null;
}

export const domainOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };
export const domainAllowed = (host: string, allowed: string[]) => allowed.some((p) => {
  const d = p.toLowerCase().trim();
  return d.startsWith("*.") ? host === d.slice(2) || host.endsWith(d.slice(1)) : host === d;
});

const toBase64 = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] ?? "");
  r.onerror = () => rej(r.error);
  r.readAsDataURL(b);
});
const readText = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(b); });

export const playgroundService = {
  /** Turns the dropped items into the request body. Throws a readable Error when something cannot be sent. */
  async prepare(items: Item[], longEdge = 1600) {
    const files: { id: string; name: string; data?: string; kind?: "text"; text?: string }[] = [];
    for (const it of items) {
      if (it.kind === "url") continue;
      if (it.kind === "image") {
        const p = await prepareImage(it.file, longEdge);
        files.push({ id: it.id, name: it.name, data: await toBase64(p.blob) });
      } else if (it.kind === "text") {
        files.push({ id: it.id, name: it.name, kind: "text", text: await readText(it.file) });
      } else {
        const pdf = it.file.type === "application/pdf" || /\.pdf$/i.test(it.name) ? it.file : (await toPdf(it.file)).file;
        files.push({ id: it.id, name: it.name, data: await toBase64(pdf) });
      }
    }
    const size = files.reduce((s, f) => s + (f.data?.length ?? f.text?.length ?? 0), 0);
    if (size > MAX_REQUEST_BYTES) throw new Error(`That is about ${Math.round(size / 1e6)} MB, more than the 40 MB limit for one check. Remove some files.`);
    return { files, urls: items.flatMap((i) => (i.kind === "url" ? [{ id: i.id, url: i.url, device: i.device }] : [])) };
  },

  async check(body: Record<string, unknown>, signal?: AbortSignal): Promise<Result> {
    let res: Response;
    try {
      res = await fetch(`${CONNECTOR_URL}/playground`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(660_000)]) : AbortSignal.timeout(660_000),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (e instanceof DOMException && e.name === "TimeoutError") throw new Error("Claude took too long. Try fewer files.");
      throw new ConnectorOffline();
    }
    const out = (await res.json().catch(() => null)) as (Result & { error?: string }) | null;
    if (!res.ok || !out) throw new Error(out?.error ?? `The connector returned an error (${res.status}).`);
    return out;
  },
};
