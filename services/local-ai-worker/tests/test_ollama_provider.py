import json

import httpx
import pytest

from app.config import Settings
from app.errors import ProviderUnavailable
from app.providers.ollama import OllamaProvider
from app.response_validator import SowExtraction


def transport(handler):
    return httpx.MockTransport(handler)


def test_health_reports_missing_model_with_pull_command():
    p = OllamaProvider("http://127.0.0.1:11434", "qwen3-vl:8b", transport=transport(lambda r: httpx.Response(200, json={"models": [{"name": "llama3:8b"}]})))
    h = p.health_check()
    assert not h.ok and "ollama pull qwen3-vl:8b" in h.message


def test_health_detects_gpu():
    def handler(r: httpx.Request):
        if r.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "qwen3-vl:8b"}]})
        return httpx.Response(200, json={"models": [{"name": "qwen3-vl:8b", "size_vram": 6_000_000_000}]})
    h = OllamaProvider("http://127.0.0.1:11434", "qwen3-vl:8b", transport=transport(handler)).health_check()
    assert h.ok and h.accelerator == "gpu"


def test_structured_call_sends_schema_and_images():
    seen = {}

    def handler(r: httpx.Request):
        body = json.loads(r.content)
        seen.update(body)
        return httpx.Response(200, json={"message": {"content": json.dumps({"requirements": []})}, "prompt_eval_count": 10, "eval_count": 3, "total_duration": 5_000_000})

    p = OllamaProvider("http://127.0.0.1:11434", "qwen3-vl:8b", context_size=8192, transport=transport(handler))
    out = p.extract_structured("go", SowExtraction, images=[b"\x89PNG"])
    assert out.requirements == []
    assert seen["format"]["title"] == "SowExtraction"
    assert seen["options"]["num_ctx"] == 8192 and seen["options"]["temperature"] == 0
    assert seen["messages"][-1]["images"] and seen["stream"] is False


def test_unreachable_ollama_is_retryable():
    def handler(r):
        raise httpx.ConnectError("refused")
    p = OllamaProvider("http://127.0.0.1:11434", "m", transport=transport(handler))
    with pytest.raises(ProviderUnavailable) as e:
        p.generate_text("hi")
    assert e.value.retryable


def test_ollama_url_must_be_loopback(monkeypatch):
    base = {"supabase_url": "https://x.supabase.co", "supabase_publishable_key": "k", "worker_email": "w@x", "worker_password": "p"}
    assert Settings(**base, ollama_url="http://127.0.0.1:11434").ollama_url.startswith("http://127.0.0.1")
    for bad in ("http://192.168.1.5:11434", "http://0.0.0.0:11434", "https://my-ollama.example.com"):
        with pytest.raises(ValueError):
            Settings(**base, ollama_url=bad)
