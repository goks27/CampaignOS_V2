"""Figma adapter: exports frames as PNG through the Figma REST API with the worker's own token.

Behind a workspace setting. If the file can't be accessed, the job fails and says so — it never pretends.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx

from .errors import Unsupported

API = "https://api.figma.com/v1"


@dataclass
class Frame:
    node_id: str
    name: str
    png: bytes


def parse_url(url: str) -> tuple[str, str | None]:
    m = re.search(r"figma\.com/(?:design|file|proto)/([A-Za-z0-9]+)", url)
    if not m:
        raise Unsupported("That is not a Figma design/file URL.")
    node = re.search(r"node-id=([0-9]+[-:][0-9]+)", url)
    return m.group(1), node.group(1).replace("-", ":") if node else None


def export_frames(url: str, token: str | None, max_frames: int, *, transport: httpx.BaseTransport | None = None) -> list[Frame]:
    if not token:
        raise Unsupported("FIGMA_TOKEN is not set in the worker's .env. Add a Figma personal access token, or upload PDF/PNG exports instead.")
    key, node = parse_url(url)
    h = {"X-Figma-Token": token}
    with httpx.Client(timeout=60.0, transport=transport) as http:
        params = {"ids": node, "depth": "2"} if node else {"depth": "2"}
        r = http.get(f"{API}/files/{key}" + ("/nodes" if node else ""), headers=h, params=params)
        if r.status_code in (403, 404):
            raise Unsupported(f"The worker's Figma token cannot open this file ({r.status_code}). Share the file with that account, or upload exports instead.")
        r.raise_for_status()
        data = r.json()
        if node:
            root = (data.get("nodes", {}).get(node) or {}).get("document") or {}
            candidates = root.get("children", []) if root.get("type") in ("CANVAS", "SECTION") else [root]
        else:
            first_page = (data.get("document", {}).get("children") or [{}])[0]
            candidates = first_page.get("children", [])
        frames = [c for c in candidates if c.get("type") in ("FRAME", "COMPONENT", "INSTANCE")][:max_frames]
        if not frames:
            raise Unsupported("No frames found at that Figma link. Link a page or a frame.")
        ids = ",".join(f["id"] for f in frames)
        img = http.get(f"{API}/images/{key}", headers=h, params={"ids": ids, "format": "png", "scale": "1"})
        img.raise_for_status()
        urls = img.json().get("images", {})
        out: list[Frame] = []
        for f in frames:
            u = urls.get(f["id"])
            if not u:
                continue
            png = http.get(u).content
            out.append(Frame(f["id"], f.get("name", f["id"]), png))
        return out
