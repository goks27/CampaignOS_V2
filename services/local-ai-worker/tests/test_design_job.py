from app.jobs import design
from app.providers.mock import MockProvider
from tests.conftest import FakeStorage, make_png, responder_from

REQS = [
    {"id": "11111111-1111-1111-1111-111111111111", "ref": "REQ-001", "title": "OTP resend after 30 seconds", "category": "functional", "version": 1},
    {"id": "22222222-2222-2222-2222-222222222222", "ref": "REQ-002", "title": "Daily participation limit", "category": "business_rule", "version": 1},
]


def test_design_review_links_requirements_and_normalises_regions(make_ctx):
    storage = FakeStorage({"designs/c1/s1/otp.png": make_png(1080, 2160)})
    screen = {
        "findings": [
            {"title": "No OTP resend action", "severity": "high", "requirement_ref": "REQ-001", "box": [100, 600, 900, 700]},
            {"title": "Low contrast footer text", "severity": "low", "requirement_ref": None, "box": None},
            {"title": "Mentions a requirement that is not accepted", "requirement_ref": "REQ-999"},
        ],
        "checks": [{"requirement_ref": "REQ-002", "result": "needs_verification", "note": "Backend limit"}],
    }
    journey = {"findings": [{"title": "Missing limit-reached screen", "requirement_ref": "REQ-002", "box": [0, 0, 10, 10]}]}
    provider = MockProvider(responder_from([("Find journey-level gaps", journey), ("Accepted requirements (the only baseline", screen)]))
    inp = {"assets": [{"id": "a1", "screen_name": "OTP", "path": "c1/s1/otp.png", "bucket": "designs", "content_hash": "h1"}],
           "requirements": REQS, "journey": "Consumer promotion", "limits": {"image_long_edge": 1600}}
    result, meta = design.run(make_ctx("sow_vs_design", inp, provider, storage))
    f = {x["title"]: x for x in result["findings"]}
    assert f["No OTP resend action"]["requirement_id"] == REQS[0]["id"]
    assert f["No OTP resend action"]["region"] == {"x": 0.1, "y": 0.6, "w": 0.8, "h": 0.1}
    assert f["No OTP resend action"]["design_asset_id"] == "a1"
    assert f["Low contrast footer text"]["requirement_id"] is None
    assert f["Mentions a requirement that is not accepted"]["requirement_id"] is None
    assert f["Missing limit-reached screen"]["region"] is None, "journey-level findings never carry a region"
    assert result["checks"] == [{"requirement_id": REQS[1]["id"], "result": "needs_verification", "method": None, "note": "OTP: Backend limit"}]
    assert provider.calls[0][1] == 1, "one screen per call"
    assert meta["prompt_version"] == "design-review-v1"


def test_screen_limit(make_ctx):
    import pytest

    from app.errors import LimitExceeded

    assets = [{"id": f"a{i}", "screen_name": f"S{i}", "path": f"p{i}"} for i in range(5)]
    with pytest.raises(LimitExceeded):
        design.run(make_ctx("sow_vs_design", {"assets": assets, "requirements": REQS, "limits": {"max_screens_per_review": 4}}, MockProvider(), FakeStorage()))


def test_unchanged_screen_is_not_reanalysed(make_ctx):
    storage = FakeStorage({"designs/x.png": make_png()})
    provider = MockProvider(responder_from([("Find journey-level gaps", {"findings": []}), ("Screen:", {"findings": [], "checks": []})]))
    inp = {"assets": [{"id": "a1", "screen_name": "Home", "path": "x.png", "content_hash": "same"}], "requirements": REQS}
    ctx = make_ctx("sow_vs_design", inp, provider, storage)
    design.run(ctx)
    n = len([c for c in provider.calls if c[1] == 1])
    ctx2 = make_ctx("sow_vs_design", inp, provider, storage)
    ctx2.cache = ctx.cache
    design.run(ctx2)
    assert len([c for c in provider.calls if c[1] == 1]) == n


def test_consistency_maps_screen_index(make_ctx):
    storage = FakeStorage({"designs/a.png": make_png(), "designs/b.png": make_png(color="#eeeeee")})
    answer = {"findings": [{"title": "Button style differs", "screen_index": 2, "box": [0, 0, 500, 100]}]}
    provider = MockProvider(responder_from([("visual consistency problems", answer)]))
    inp = {"assets": [{"id": "a", "screen_name": "A", "path": "a.png"}, {"id": "b", "screen_name": "B", "path": "b.png"}], "requirements": []}
    result, _ = design.run(make_ctx("design_consistency", inp, provider, storage))
    assert result["findings"][0]["design_asset_id"] == "b"
    assert provider.calls[0][1] == 2
