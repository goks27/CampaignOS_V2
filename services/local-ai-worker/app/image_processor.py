"""Image preparation: downscale, crop, and a deterministic pixel diff for development reviews."""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass

import numpy as np
from PIL import Image


@dataclass
class Prepared:
    data: bytes
    width: int
    height: int
    original_width: int
    original_height: int


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img.convert("RGB")


def to_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def downscale(data: bytes, long_edge: int) -> Prepared:
    """Downscale so the long edge is at most `long_edge`. Region coordinates stay valid because scaling is uniform."""
    img = load(data)
    ow, oh = img.size
    scale = min(1.0, long_edge / max(ow, oh))
    if scale < 1.0:
        img = img.resize((max(1, round(ow * scale)), max(1, round(oh * scale))), Image.Resampling.LANCZOS)
        out = to_png(img)
    else:
        out = data if data[:8] == b"\x89PNG\r\n\x1a\n" else to_png(img)
    return Prepared(out, img.size[0], img.size[1], ow, oh)


def tiles_for_model(img: Image.Image, long_edge: int, max_tiles: int = 3) -> list[tuple[Image.Image, int]]:
    """Very tall full-page screenshots are split into vertical tiles; returns (tile, y_offset_in_original)."""
    w, h = img.size
    tile_h = max(w, round(w * 1.6))
    if h <= tile_h * 1.2:
        return [(img, 0)]
    tiles: list[tuple[Image.Image, int]] = []
    y = 0
    while y < h and len(tiles) < max_tiles:
        tiles.append((img.crop((0, y, w, min(h, y + tile_h))), y))
        y += tile_h
    return tiles


@dataclass
class DiffRegion:
    x: int
    y: int
    w: int
    h: int
    ratio: float  # share of changed pixels inside the box


def pixel_diff(design: Image.Image, staging: Image.Image, *, block: int = 24, threshold: int = 40,
               min_block_ratio: float = 0.08, max_regions: int = 8) -> tuple[float, list[DiffRegion], Image.Image]:
    """Compare a design and a staging screenshot at the design's width.

    Returns (overall changed-pixel ratio, merged regions in staging-image pixels, the resized staging image).
    Deterministic: no model involved.
    """
    dw, dh = design.size
    sw, sh = staging.size
    if sw != dw:
        staging = staging.resize((dw, max(1, round(sh * dw / sw))), Image.Resampling.LANCZOS)
    h = min(dh, staging.size[1])
    a = np.asarray(design.crop((0, 0, dw, h)).convert("L"), dtype=np.int16)
    b = np.asarray(staging.crop((0, 0, dw, h)).convert("L"), dtype=np.int16)
    changed = np.abs(a - b) > threshold
    overall = float(changed.mean()) if changed.size else 0.0

    gy, gx = (h + block - 1) // block, (dw + block - 1) // block
    grid = np.zeros((gy, gx), dtype=bool)
    for j in range(gy):
        for i in range(gx):
            cell = changed[j * block:(j + 1) * block, i * block:(i + 1) * block]
            grid[j, i] = cell.size > 0 and cell.mean() >= min_block_ratio

    # Connected components on the block grid (4-neighbour flood fill).
    seen = np.zeros_like(grid)
    regions: list[DiffRegion] = []
    for j in range(gy):
        for i in range(gx):
            if not grid[j, i] or seen[j, i]:
                continue
            stack = [(j, i)]
            seen[j, i] = True
            minx, miny, maxx, maxy = i, j, i, j
            while stack:
                cy, cx = stack.pop()
                minx, miny, maxx, maxy = min(minx, cx), min(miny, cy), max(maxx, cx), max(maxy, cy)
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < gy and 0 <= nx < gx and grid[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            x0, y0 = minx * block, miny * block
            x1, y1 = min(dw, (maxx + 1) * block), min(h, (maxy + 1) * block)
            box = changed[y0:y1, x0:x1]
            regions.append(DiffRegion(x0, y0, x1 - x0, y1 - y0, float(box.mean()) if box.size else 0.0))
    regions.sort(key=lambda r: r.w * r.h * r.ratio, reverse=True)
    if sh > dh * 1.15:  # staging page much longer than the design: flag the extra part once
        regions.append(DiffRegion(0, h, dw, staging.size[1] - h, 1.0))
    return overall, regions[:max_regions], staging


def crop_pair(design: Image.Image, staging: Image.Image, r: DiffRegion, pad: int = 24) -> tuple[bytes, bytes]:
    x0, y0 = max(0, r.x - pad), max(0, r.y - pad)
    x1 = min(design.size[0], r.x + r.w + pad)
    d = design.crop((x0, y0, x1, min(design.size[1], r.y + r.h + pad))) if y0 < design.size[1] else Image.new("RGB", (x1 - x0, 32), "white")
    s = staging.crop((x0, y0, x1, min(staging.size[1], r.y + r.h + pad)))
    return to_png(d), to_png(s)
