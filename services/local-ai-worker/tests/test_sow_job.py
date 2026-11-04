import json

import pytest

from app.errors import LimitExceeded, ValidationFailed
from app.jobs import sow
from app.pdf_processor import chunk_pages, extract_text_pages, open_pdf
from app.providers.mock import MockProvider
from app.response_validator import ExtractedRequirement
from tests.conftest import FakeStorage, make_scanned_pdf, make_text_pdf, responder_from

SOW_P1 = "Gold Drop consumer promotion\nUsers register with name and a 10 digit mobile number.\nAn OTP must be verified before entry."
SOW_P2 = "Each mobile number may participate once per day.\nRetailers in Telangana join the contest via the retailer app."


def test_text_pdf_pages_and_chunks():
    doc = open_pdf(make_text_pdf([SOW_P1, SOW_P2]), 30)
    pages = extract_text_pages(doc)
    doc.close()
    assert [p.page_no for p in pages] == [1, 2]
    assert not pages[0].scanned and "10 digit mobile" in pages[0].text
    chunks = chunk_pages(pages, max_chars=10_000)
    assert len(chunks) == 1 and chunks[0][0] == [1, 2] and "=== Page 2 ===" in chunks[0][1]


def test_page_limit_is_enforced():
    with pytest.raises(LimitExceeded) as e:
        open_pdf(make_text_pdf(["a" * 50] * 3), max_pages=2)
    assert "maximum is 2" in str(e.value)


def test_quote_check():
    assert sow.quote_found("register with name and a 10 digit mobile", SOW_P1)
    assert not sow.quote_found("users must be over 21 years of age to enter", SOW_P1)


def test_merge_dedupes_and_keeps_page_refs():
    a = ExtractedRequirement(title="OTP verification required", category="validation", source_pages=[1], source_text="OTP must be verified")
    b = ExtractedRequirement(title="OTP verification is required", category="validation", source_pages=[3], source_text="verify the OTP")
    c = ExtractedRequirement(title="Daily participation limit", category="business_rule", source_pages=[2], source_text="once per day")
    merged = sow.merge_requirements([a, b, c])
    assert len(merged) == 2
    assert merged[0].source_pages == [1, 3]


def test_sow_job_end_to_end_with_mock_provider(make_ctx):
    storage = FakeStorage({"sow/c1/sow.pdf": make_text_pdf([SOW_P1, SOW_P2])})
    answer = {"requirements": [
        {"title": "Registration collects name and mobile", "category": "validation", "priority": "high",
         "journey_hint": "Consumer promotion", "source_pages": [1], "source_text": "register with name and a 10 digit mobile number", "confidence": "high"},
        {"title": "Users must be 21+", "category": "legal", "source_pages": [2], "source_text": "Only adults over 21 may enter", "confidence": "high"},
        {"title": "One entry per mobile per day", "category": "business_rule", "source_pages": [99], "source_text": "may participate once per day"},
    ]}
    provider = MockProvider(responder_from([("Extract every requirement", answer)]))
    ctx = make_ctx("sow_analysis", {"bucket": "sow", "path": "c1/sow.pdf", "journeys": [{"name": "Consumer promotion"}]}, provider, storage)
    result, meta = sow.run(ctx)
    reqs = {r["title"]: r for r in result["requirements"]}
    assert result["page_count"] == 2 and result["pages"][0]["method"] == "text"
    assert reqs["Registration collects name and mobile"]["confidence"] == "high"
    # a quote that is not in the document is downgraded, never trusted
    assert reqs["Users must be 21+"]["confidence"] == "needs_manual_verification"
    # page 99 doesn't exist in the chunk → falls back to the chunk's pages
    assert reqs["One entry per mobile per day"]["source_pages"] == [1, 2]
    assert meta["prompt_version"] == "sow-extract-v1" and meta["model"] == "mock-model"
    assert "<untrusted" in provider.calls[0][0]


def test_scanned_page_goes_through_ocr_and_is_cached(make_ctx):
    storage = FakeStorage({"sow/c1/scan.pdf": make_scanned_pdf("Prize: 1 gram gold coin")})
    provider = MockProvider(responder_from([("Transcribe all text", "Prize: 1 gram gold coin for each daily winner"),
                                           ("Extract every requirement", {"requirements": []})]))
    ctx = make_ctx("sow_analysis", {"bucket": "sow", "path": "c1/scan.pdf"}, provider, storage)
    result, _ = sow.run(ctx)
    assert result["pages"][0]["method"] == "ocr"
    assert "gold coin" in result["pages"][0]["text"]
    ocr_calls = [c for c in provider.calls if c[1] == 1]
    ctx2 = make_ctx("sow_analysis", {"bucket": "sow", "path": "c1/scan.pdf"}, provider, storage)
    ctx2.cache = ctx.cache
    sow.run(ctx2)
    assert len([c for c in provider.calls if c[1] == 1]) == len(ocr_calls), "unchanged page must not be OCR'd twice"


def test_malformed_model_output_fails_the_job(make_ctx):
    storage = FakeStorage({"sow/c1/sow.pdf": make_text_pdf([SOW_P1])})
    provider = MockProvider(lambda p, n: json.dumps({"requirements": "nope"}))
    ctx = make_ctx("sow_analysis", {"bucket": "sow", "path": "c1/sow.pdf"}, provider, storage)
    with pytest.raises(ValidationFailed):
        sow.run(ctx)
