import json

import pytest

from app.errors import ValidationFailed
from app.providers.mock import MockProvider
from app.response_validator import ModelFinding, SowExtraction, normalise_box


def test_box_on_1000_grid():
    assert normalise_box([100, 200, 400, 300], 800, 1600) == {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1}


def test_box_fractions_and_pixels():
    assert normalise_box([0.1, 0.1, 0.5, 0.2], 800, 1600) == {"x": 0.1, "y": 0.1, "w": 0.4, "h": 0.1}
    # absolute pixels of the sent image (values beyond 1000)
    assert normalise_box([400, 800, 800, 1600], 800, 1600) == {"x": 0.5, "y": 0.5, "w": 0.5, "h": 0.5}


def test_box_swapped_and_clamped_and_degenerate():
    assert normalise_box([500, 500, 100, 100], 100, 100) == {"x": 0.1, "y": 0.1, "w": 0.4, "h": 0.4}
    assert normalise_box([900, 900, 1200, 1100], 2000, 2000)["w"] <= 1
    assert normalise_box([10, 10, 10, 50], 100, 100) is None
    assert normalise_box(None, 1, 1) is None


def test_bad_requirement_ref_becomes_additional_observation():
    f = ModelFinding(title="Missing OTP resend", requirement_ref="see requirement 4")
    assert f.requirement_ref is None
    assert ModelFinding(title="x y z", requirement_ref="req-7").requirement_ref == "REQ-7"


def test_retry_once_with_validation_error_then_succeed():
    answers = iter(["not json at all", json.dumps({"requirements": [{"title": "Mobile number field", "source_text": "mobile"}]})])
    p = MockProvider(lambda prompt, n: next(answers))
    out = p.extract_structured("extract", SowExtraction)
    assert out.requirements[0].title == "Mobile number field"
    assert "previous answer was rejected" in p.calls[1][0]


def test_malformed_twice_fails_and_never_returns_data():
    p = MockProvider(lambda prompt, n: json.dumps({"requirements": [{"title": "x"}]}))  # title too short, no source_text
    with pytest.raises(ValidationFailed) as e:
        p.extract_structured("extract", SowExtraction)
    assert len(p.calls) == 2
    assert e.value.retryable is False
    assert "raw" in e.value.detail


def test_code_fenced_json_is_accepted():
    p = MockProvider(lambda prompt, n: '```json\n{"requirements": []}\n```')
    assert p.extract_structured("x", SowExtraction).requirements == []
