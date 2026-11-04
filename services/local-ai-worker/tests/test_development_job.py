from app.browser import PageCapture
from app.jobs import development
from app.providers.mock import MockProvider
from tests.conftest import FakeStorage, make_png, responder_from

REQS = [
    {"id": "r1", "ref": "REQ-001", "title": "Terms checkbox on registration", "category": "legal", "version": 1},
    {"id": "r2", "ref": "REQ-002", "title": "One entry per mobile per day", "category": "business_rule", "version": 1},
    {"id": "r3", "ref": "REQ-003", "title": "Leaderboard page", "category": "screen", "version": 1},
]


class FakeBrowser:
    def __init__(self, guard, creds=None):
        self.guard = guard

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return None

    def capture(self, url, device):
        return PageCapture(url, device, make_png(1440, 1800), 1440, 1800, "Register  I accept the terms", [{"type": "error", "text": "TypeError: x"}], [])


def test_compliance_never_verifies_backend_rules_from_screenshots(make_ctx, monkeypatch):
    monkeypatch.setattr(development, "Browser", FakeBrowser)
    storage = FakeStorage()
    answer = {"checks": [
        {"requirement_ref": "REQ-001", "result": "verified", "note": "Checkbox visible"},
        {"requirement_ref": "REQ-002", "result": "verified", "note": "model overreach"},
    ]}
    provider = MockProvider(responder_from([("decide ONLY from what is visible", answer)]))
    inp = {"staging_url": "https://staging.example.com", "page_paths": ["/register"], "devices": ["desktop"],
           "allowed_domains": ["staging.example.com"], "requirements": REQS, "test_cases": [], "capture_prefix": "c1/job/"}
    result, meta = development.run(make_ctx("sow_vs_development", inp, provider, storage))
    checks = {c["requirement_id"]: c for c in result["checks"]}
    assert checks["r1"]["result"] == "verified" and checks["r1"]["method"] == "visually_observed"
    assert checks["r2"]["result"] == "needs_verification", "backend rule stays Needs verification"
    assert checks["r3"]["result"] == "not_tested"
    assert result["captures"][0]["storage_path"].startswith("c1/job/")
    assert any("console error" in f["title"] for f in result["findings"])
    assert "REQ-002" not in provider.calls[0][0], "backend rules aren't even sent to the model"


def test_no_allowed_domains_refuses_to_run(make_ctx):
    import pytest

    from app.errors import Unsupported

    with pytest.raises(Unsupported):
        development.run(make_ctx("functional_qa", {"staging_url": "https://x.example.com", "allowed_domains": [], "capture_prefix": "c/j/"}, MockProvider(), FakeStorage()))
