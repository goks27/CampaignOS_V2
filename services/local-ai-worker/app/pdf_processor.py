"""PDF handling with pypdfium2 (Apache-2.0/BSD): text first, render to image only for scanned pages."""

from __future__ import annotations

import io
from dataclasses import dataclass

import pypdfium2 as pdfium

from .errors import JobError, LimitExceeded

MIN_TEXT_CHARS = 40  # fewer extractable characters than this → treat the page as scanned


@dataclass
class PdfPage:
    page_no: int
    text: str
    scanned: bool


def open_pdf(data: bytes, max_pages: int) -> pdfium.PdfDocument:
    try:
        doc = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as e:
        raise JobError(f"Could not open the PDF: {e}. Re-export it and upload again.", {}) from e
    n = len(doc)
    if n > max_pages:
        doc.close()
        raise LimitExceeded(
            f"Limit reached: the PDF has {n} pages and the maximum is {max_pages}. "
            "Split the document or raise “Max PDF pages” in Settings, then run again.",
            {"limit": "max_pdf_pages", "value": n, "max": max_pages},
        )
    return doc


def extract_text_pages(doc: pdfium.PdfDocument) -> list[PdfPage]:
    pages: list[PdfPage] = []
    for i in range(len(doc)):
        page = doc[i]
        tp = page.get_textpage()
        text = tp.get_text_range().replace("\r\n", "\n").replace("\r", "\n").strip()
        tp.close()
        page.close()
        pages.append(PdfPage(i + 1, text, len(text.replace(" ", "").replace("\n", "")) < MIN_TEXT_CHARS))
    return pages


def render_page_png(doc: pdfium.PdfDocument, page_no: int, long_edge: int) -> bytes:
    page = doc[page_no - 1]
    w, h = page.get_size()
    scale = long_edge / max(w, h)
    bitmap = page.render(scale=scale)
    img = bitmap.to_pil()
    page.close()
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def chunk_pages(pages: list[PdfPage], max_chars: int = 7000) -> list[tuple[list[int], str]]:
    """Group consecutive pages into chunks under `max_chars`, keeping === Page N === markers for citations."""
    chunks: list[tuple[list[int], str]] = []
    cur_pages: list[int] = []
    cur = ""
    for p in pages:
        if not p.text.strip():
            continue
        block = f"=== Page {p.page_no} ===\n{p.text}\n"
        if len(block) > max_chars:  # one very long page: split on paragraphs
            if cur:
                chunks.append((cur_pages, cur))
                cur_pages, cur = [], ""
            part = ""
            for para in block.split("\n\n"):
                if len(part) + len(para) > max_chars and part:
                    chunks.append(([p.page_no], part))
                    part = f"=== Page {p.page_no} (continued) ===\n"
                part += para + "\n\n"
            if part.strip():
                chunks.append(([p.page_no], part))
            continue
        if cur and len(cur) + len(block) > max_chars:
            chunks.append((cur_pages, cur))
            cur_pages, cur = [], ""
        cur_pages.append(p.page_no)
        cur += block
    if cur:
        chunks.append((cur_pages, cur))
    return chunks
