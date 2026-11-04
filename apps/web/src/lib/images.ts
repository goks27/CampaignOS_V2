import { sha256Hex } from "@/lib/utils";

export type PreparedImage = {
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  hash: string;
  name: string;
  pageNumber?: number;
};

const OUT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality = 0.9) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the image"))), type, quality));
}

async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/** Downscale so the long edge is at most `longEdge`, keeping the original dimensions for region normalisation. */
export async function prepareImage(file: File, longEdge: number): Promise<PreparedImage> {
  const bmp = await loadBitmap(file);
  const ow = bmp.width;
  const oh = bmp.height;
  const scale = Math.min(1, longEdge / Math.max(ow, oh));
  const w = Math.round(ow * scale);
  const h = Math.round(oh * scale);
  let blob: Blob = file;
  if (scale < 1 || !OUT_TYPES.has(file.type)) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    blob = await canvasToBlob(c, OUT_TYPES.has(file.type) ? file.type : "image/png");
  }
  bmp.close();
  return { blob, width: w, height: h, originalWidth: ow, originalHeight: oh, hash: await sha256Hex(await blob.arrayBuffer()), name: file.name };
}

/** Split a PDF into page images in the browser (pdf.js), downscaled to `longEdge`. */
export async function pdfToImages(file: File, longEdge: number, maxPages: number): Promise<PreparedImage[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  if (doc.numPages > maxPages) {
    throw new Error(`${file.name} has ${doc.numPages} pages; the limit is ${maxPages} per submission. Split the PDF or raise the limit in Settings.`);
  }
  const out: PreparedImage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = longEdge / Math.max(base.width, base.height);
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
    const blob = await canvasToBlob(c, "image/png");
    out.push({
      blob, width: c.width, height: c.height, originalWidth: c.width, originalHeight: c.height,
      hash: await sha256Hex(await blob.arrayBuffer()), name: `${file.name.replace(/\.pdf$/i, "")} – page ${p}`, pageNumber: p,
    });
  }
  return out;
}
