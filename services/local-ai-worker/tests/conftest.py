from __future__ import annotations

import io
import json
import threading
from pathlib import Path
from typing import Any

import pytest
from PIL import Image, ImageDraw

from app.cache import Cache
from app.job_logger import JobLog
from app.jobs.context import JobContext
from app.providers.mock import MockProvider


def make_text_pdf(pages: list[str]) -> bytes:
    """Hand-built PDF with real text objects (no extra dependencies)."""
    objs: list[bytes] = []
    kids = []
    font_id = 3 + 2 * len(pages)
    for i, text in enumerate(pages):
        page_id, content_id = 3 + 2 * i, 4 + 2 * i
        kids.append(f"{page_id} 0 R")
        lines = [ln.replace("(", "[").replace(")", "]") for ln in text.split("\n")]
        stream = "BT /F1 11 Tf 50 780 Td 14 TL " + " ".join(f"({ln}) '" for ln in lines) + " ET"
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents {content_id} 0 R /Resources << /Font << /F1 {font_id} 0 R >> >> >>".encode())
        objs.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream".encode())
    catalog = b"<< /Type /Catalog /Pages 2 0 R >>"
    pages_obj = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(pages)} >>".encode()
    font = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    all_objs = [catalog, pages_obj, *objs, font]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for n, o in enumerate(all_objs, start=1):
        offsets.append(out.tell())
        out.write(f"{n} 0 obj\n".encode() + o + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(all_objs) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer << /Size {len(all_objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


def make_scanned_pdf(text: str) -> bytes:
    img = Image.new("RGB", (800, 1100), "white")
    ImageDraw.Draw(img).text((40, 40), text, fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PDF")
    return buf.getvalue()


def make_png(w: int = 400, h: int = 800, color: str = "white", box: tuple[int, int, int, int] | None = None) -> bytes:
    img = Image.new("RGB", (w, h), color)
    if box:
        ImageDraw.Draw(img).rectangle(box, fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class FakeStorage:
    def __init__(self, files: dict[str, bytes] | None = None) -> None:
        self.files = files or {}
        self.uploads: dict[str, bytes] = {}
        self.rpcs: list[tuple[str, dict[str, Any]]] = []
        self.rpc_results: dict[str, Any] = {}

    def download(self, bucket: str, path: str) -> bytes:
        return self.files[f"{bucket}/{path}"]

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        self.uploads[f"{bucket}/{path}"] = data

    def rpc(self, fn: str, params: dict[str, Any] | None = None) -> Any:
        self.rpcs.append((fn, params or {}))
        r = self.rpc_results.get(fn)
        return r(params) if callable(r) else r


def responder_from(mapping: list[tuple[str, Any]]):
    """Return canned JSON for the first prompt substring that matches."""

    def respond(prompt: str, _n: int) -> str:
        for needle, value in mapping:
            if needle in prompt:
                return value if isinstance(value, str) else json.dumps(value)
        return json.dumps({})

    return respond


@pytest.fixture
def make_ctx(tmp_path: Path):
    def _make(review_type: str, inp: dict[str, Any], provider: MockProvider, storage: FakeStorage) -> JobContext:
        return JobContext(job_id="00000000-0000-0000-0000-000000000001", campaign_id="c1", review_type=review_type,
                          input=inp, provider=provider, storage=storage, cache=Cache(tmp_path / "cache"),
                          log=JobLog("job", review_type), timeout_s=600, stop_flag=threading.Event())
    return _make
