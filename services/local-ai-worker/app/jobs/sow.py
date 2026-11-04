"""SOW analysis: text extraction → local OCR for scanned pages → chunked extraction → merge and de-duplicate."""

from __future__ import annotations

import re
from typing import Any

from ..cache import Cache
from ..config import MAX_OUTPUT_TOKENS
from ..image_processor import sha256
from ..pdf_processor import PdfPage, chunk_pages, extract_text_pages, open_pdf, render_page_png
from ..prompts import sow as P
from ..response_validator import ExtractedRequirement, SowExtraction
from .context import JobContext


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _tokens(s: str) -> set[str]:
    return {t for t in _norm(s).split() if len(t) > 2}


def _similar(a: str, b: str) -> bool:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return _norm(a) == _norm(b)
    return len(ta & tb) / len(ta | tb) >= 0.75


def quote_found(quote: str, pages_text: str) -> bool:
    """True when the model's 'verbatim' quote really occurs in the cited pages (whitespace/case-insensitive)."""
    q = _norm(quote)
    if not q:
        return False
    body = _norm(pages_text)
    if q in body:
        return True
    qt = q.split()
    if len(qt) < 6:
        return False
    # allow small OCR/line-break differences: 80% of 6-word shingles present
    shingles = [" ".join(qt[i:i + 6]) for i in range(len(qt) - 5)]
    return sum(1 for s in shingles if s in body) / len(shingles) >= 0.8


def merge_requirements(items: list[ExtractedRequirement]) -> list[ExtractedRequirement]:
    merged: list[ExtractedRequirement] = []
    for r in items:
        for m in merged:
            if m.category == r.category and _similar(m.title, r.title):
                m.source_pages = sorted(set(m.source_pages) | set(r.source_pages))
                if len(r.description) > len(m.description):
                    m.description = r.description
                if r.source_text not in m.source_text and len(m.source_text) + len(r.source_text) < 1900:
                    m.source_text = f"{m.source_text} … {r.source_text}"
                if not m.acceptance_criteria and r.acceptance_criteria:
                    m.acceptance_criteria = r.acceptance_criteria
                if not m.journey_hint and r.journey_hint:
                    m.journey_hint = r.journey_hint
                break
        else:
            merged.append(r.model_copy(deep=True))
    return merged


def run(ctx: JobContext) -> tuple[dict[str, Any], dict[str, Any]]:
    inp = ctx.input
    long_edge = ctx.limit("image_long_edge", 1600)
    ctx.step("download SOW")
    data = ctx.storage.download(inp["bucket"], inp["path"])

    ctx.step("extract text")
    doc = open_pdf(data, ctx.limit("max_pdf_pages", 30))
    try:
        pages = extract_text_pages(doc)
        methods: dict[int, str] = {}
        for p in pages:
            if not p.scanned:
                methods[p.page_no] = "text"
                continue
            ctx.step(f"OCR page {p.page_no}")
            png = render_page_png(doc, p.page_no, long_edge)
            key = Cache.key("ocr", P.OCR_VERSION, ctx.provider.model, sha256(png))
            cached = ctx.cache.get(key)
            if cached is not None:
                p.text = str(cached)
            else:
                res = ctx.provider.analyse_images(P.OCR_PROMPT, [png], max_tokens=MAX_OUTPUT_TOKENS["ocr"])
                ctx.usage.add(res)
                p.text = res.text.strip()
                ctx.cache.put(key, p.text)
            methods[p.page_no] = "ocr" if p.text else "skipped"
    finally:
        doc.close()

    journeys = [str(j["name"]) for j in inp.get("journeys") or []]
    found: list[ExtractedRequirement] = []
    text_by_page = {p.page_no: p.text for p in pages}
    for idx, (chunk_page_nos, chunk_text) in enumerate(chunk_pages(pages), start=1):
        ctx.step(f"extract requirements, chunk {idx}")
        key = Cache.key("sow", P.VERSION, ctx.provider.model, sha256(chunk_text.encode()), ",".join(journeys))
        cached = ctx.cache.get(key)
        if cached is not None:
            result = SowExtraction.model_validate(cached)
        else:
            result = ctx.provider.extract_structured(
                P.extraction_prompt(chunk_text, chunk_page_nos, journeys), SowExtraction,
                system=P.SYSTEM, max_tokens=MAX_OUTPUT_TOKENS["sow_extraction"], usage=ctx.usage)
            ctx.cache.put(key, result.model_dump())
        for r in result.requirements:
            # Keep only page refs inside this chunk; default to the chunk's pages.
            r.source_pages = [p for p in r.source_pages if p in chunk_page_nos] or chunk_page_nos
            cited = "\n".join(text_by_page.get(p, "") for p in r.source_pages)
            if not quote_found(r.source_text, cited) and not quote_found(r.source_text, chunk_text):
                r.confidence = "needs_manual_verification"
            found.append(r)

    ctx.step("merge and de-duplicate")
    merged = merge_requirements(found)
    result_pages = [{"page_no": p.page_no, "method": methods.get(p.page_no, "text"), "text": p.text[:20000]} for p in pages]
    return (
        {"page_count": len(pages), "pages": result_pages, "requirements": [r.model_dump() for r in merged]},
        ctx.meta(P.VERSION),
    )


__all__ = ["PdfPage", "merge_requirements", "quote_found", "run"]
