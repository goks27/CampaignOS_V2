"""Real local-model smoke test. Runs only when Ollama is up and the configured model is installed."""

import os

import pytest

from app.providers.ollama import OllamaProvider
from app.response_validator import SowExtraction

URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("OLLAMA_MODEL", "qwen3-vl:8b")
pytestmark = pytest.mark.ollama


@pytest.fixture(scope="module")
def provider():
    p = OllamaProvider(URL, MODEL, context_size=8192)
    if not p.health_check().ok:
        pytest.skip(f"Ollama or {MODEL} not available")
    return p


def test_real_model_returns_valid_structured_output(provider):
    text = "=== Page 1 ===\nParticipants must register with their name and a 10-digit mobile number. Each mobile number can enter once per day."
    from app.prompts import sow as P

    out = provider.extract_structured(P.extraction_prompt(text, [1], ["Consumer promotion"]), SowExtraction, system=P.SYSTEM, max_tokens=1500)
    assert len(out.requirements) >= 1
    assert all(r.source_text for r in out.requirements)
