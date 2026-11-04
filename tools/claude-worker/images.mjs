/**
 * Image helpers for staging reviews: downscale, crop and a deterministic pixel diff (no model involved).
 * Port of services/local-ai-worker/app/image_processor.py, using sharp.
 */
import crypto from "node:crypto";
import sharp from "sharp";

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const isPng = (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const flat = (buf) => sharp(buf).flatten({ background: "#ffffff" });

export async function size(buf) {
  const m = await sharp(buf).metadata();
  return { width: m.width ?? 0, height: m.height ?? 0 };
}

/** Downscale so the long edge is at most `longEdge`. Uniform scaling keeps normalised regions valid. */
export async function downscale(buf, longEdge) {
  const { width: ow, height: oh } = await size(buf);
  const scale = Math.min(1, longEdge / Math.max(ow, oh));
  if (scale < 1) {
    const out = await flat(buf).resize(Math.max(1, Math.round(ow * scale)), Math.max(1, Math.round(oh * scale)), { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    return { data: out.data, width: out.info.width, height: out.info.height, originalWidth: ow, originalHeight: oh };
  }
  return { data: isPng(buf) ? buf : await flat(buf).png().toBuffer(), width: ow, height: oh, originalWidth: ow, originalHeight: oh };
}

const gray = async (buf, w, h) => {
  const { data } = await flat(buf).extract({ left: 0, top: 0, width: w, height: h }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return data;
};

/**
 * Compares a design and a staging screenshot at the design's width.
 * Returns { ratio, regions: [{x,y,w,h,ratio}] in staging-image pixels, stagingPng (resized to the design width), width, height }.
 */
export async function pixelDiff(designBuf, stagingBuf, { block = 24, threshold = 40, minBlockRatio = 0.08, maxRegions = 8 } = {}) {
  const { width: dw, height: dh } = await size(designBuf);
  let { width: sw, height: sh } = await size(stagingBuf);
  let staging = stagingBuf;
  if (sw !== dw) {
    const r = await flat(stagingBuf).resize(dw, Math.max(1, Math.round((sh * dw) / sw)), { kernel: "lanczos3" }).png().toBuffer({ resolveWithObject: true });
    staging = r.data; sh = r.info.height; sw = dw;
  }
  const h = Math.min(dh, sh);
  const a = await gray(designBuf, dw, h), b = await gray(staging, dw, h);
  const changed = new Uint8Array(dw * h);
  let n = 0;
  for (let i = 0; i < changed.length; i++) if (Math.abs(a[i] - b[i]) > threshold) { changed[i] = 1; n++; }
  const ratio = changed.length ? n / changed.length : 0;

  const gy = Math.ceil(h / block), gx = Math.ceil(dw / block);
  const grid = new Uint8Array(gy * gx);
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      let c = 0, t = 0;
      for (let y = j * block; y < Math.min(h, (j + 1) * block); y++) for (let x = i * block; x < Math.min(dw, (i + 1) * block); x++) { t++; c += changed[y * dw + x]; }
      grid[j * gx + i] = t > 0 && c / t >= minBlockRatio ? 1 : 0;
    }
  }
  // Connected components on the block grid (4-neighbour flood fill).
  const seen = new Uint8Array(gy * gx);
  const regions = [];
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      if (!grid[j * gx + i] || seen[j * gx + i]) continue;
      const stack = [[j, i]];
      seen[j * gx + i] = 1;
      let minx = i, miny = j, maxx = i, maxy = j;
      while (stack.length) {
        const [cy, cx] = stack.pop();
        minx = Math.min(minx, cx); miny = Math.min(miny, cy); maxx = Math.max(maxx, cx); maxy = Math.max(maxy, cy);
        for (const [ny, nx] of [[cy + 1, cx], [cy - 1, cx], [cy, cx + 1], [cy, cx - 1]]) {
          if (ny >= 0 && ny < gy && nx >= 0 && nx < gx && grid[ny * gx + nx] && !seen[ny * gx + nx]) { seen[ny * gx + nx] = 1; stack.push([ny, nx]); }
        }
      }
      const x0 = minx * block, y0 = miny * block, x1 = Math.min(dw, (maxx + 1) * block), y1 = Math.min(h, (maxy + 1) * block);
      let c = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) c += changed[y * dw + x];
      const area = (x1 - x0) * (y1 - y0);
      regions.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, ratio: area ? c / area : 0 });
    }
  }
  regions.sort((p, q) => q.w * q.h * q.ratio - p.w * p.h * p.ratio);
  const top = regions.slice(0, maxRegions);
  // Staging page much longer than the design: flag the extra part once.
  if (sh > dh * 1.15) top.push({ x: 0, y: h, w: dw, h: sh - h, ratio: 1 });
  return { ratio, regions: top, stagingPng: staging, width: dw, height: sh };
}

/**
 * Splits a tall screenshot into readable parts (top to bottom). Shrinking a very tall page to a small long edge would make
 * its text unreadable, so the full width is kept and the page is cut into tiles instead.
 */
export async function tileForModel(buf, { tileHeight = 1800, maxTiles = 4 } = {}) {
  const { width, height } = await size(buf);
  const tiles = [];
  for (let y = 0; y < height && tiles.length < maxTiles; y += tileHeight) {
    const h = Math.min(tileHeight, height - y);
    tiles.push({ data: await flat(buf).extract({ left: 0, top: y, width, height: h }).png().toBuffer(), y, h });
  }
  return { width, height, tiles, truncated: tiles.length * tileHeight < height };
}

/** PNG crops of the same area of the design and of the staging screenshot, with padding. */
export async function cropPair(designBuf, stagingPng, r, pad = 24) {
  const d = await size(designBuf), s = await size(stagingPng);
  const x0 = Math.max(0, r.x - pad), y0 = Math.max(0, r.y - pad), x1 = Math.min(d.width, r.x + r.w + pad);
  const width = Math.max(1, x1 - x0);
  const cut = async (buf, dims) => {
    const bottom = Math.min(dims.height, r.y + r.h + pad);
    if (y0 >= dims.height || bottom <= y0) return sharp({ create: { width, height: 32, channels: 3, background: "#ffffff" } }).png().toBuffer();
    return flat(buf).extract({ left: x0, top: y0, width: Math.min(width, dims.width - x0), height: bottom - y0 }).png().toBuffer();
  };
  return [await cut(designBuf, d), await cut(stagingPng, s)];
}
