"""Ollama provider: local HTTP API on loopback only, structured outputs via `format`."""

from __future__ import annotations

import base64
import threading
import time
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel

from ..errors import ProviderUnavailable
from .base import GenResult, Health, Usage, structured_with_retry

M = TypeVar("M", bound=BaseModel)

# One inference at a time, across threads.
_INFERENCE_LOCK = threading.Lock()


class OllamaProvider:
    def __init__(self, base_url: str, model: str, *, context_size: int = 16384, timeout_s: float = 180.0,
                 transport: httpx.BaseTransport | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.context_size = context_size
        self.timeout_s = timeout_s
        self._http = httpx.Client(timeout=httpx.Timeout(timeout_s, connect=5.0), transport=transport)

    # ------------------------------------------------------------------ health
    def health_check(self) -> Health:
        try:
            tags = self._http.get(f"{self.base_url}/api/tags", timeout=5.0).json()
        except (httpx.HTTPError, ValueError) as e:
            return Health(False, self.model, False, message=f"Ollama is not reachable at {self.base_url}: {e}. Start Ollama.")
        names = {m.get("name") for m in tags.get("models", [])} | {m.get("model") for m in tags.get("models", [])}
        present = self.model in names or f"{self.model}:latest" in names
        if not present:
            return Health(False, self.model, False, message=f"Model not installed. Run: ollama pull {self.model}")
        accel = "unknown"
        try:
            ps = self._http.get(f"{self.base_url}/api/ps", timeout=5.0).json()
            for m in ps.get("models", []):
                if m.get("name", "").startswith(self.model) or m.get("model", "").startswith(self.model):
                    accel = "gpu" if int(m.get("size_vram", 0)) > 0 else "cpu"
        except (httpx.HTTPError, ValueError):
            pass
        msg = "Ready" if accel != "cpu" else "Ready, but running on CPU (slow). Check the NVIDIA driver and that Ollama sees the GPU."
        return Health(True, self.model, True, accel, msg)

    def warm_up(self) -> Health:
        """Load the model into memory so /api/ps can report GPU vs CPU."""
        try:
            self._chat([{"role": "user", "content": "Reply with OK."}], max_tokens=4, fmt=None)
        except ProviderUnavailable:
            pass
        return self.health_check()

    # ------------------------------------------------------------------ calls
    def _chat(self, messages: list[dict[str, Any]], *, max_tokens: int, fmt: dict[str, object] | str | None) -> GenResult:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "think": False,
            "options": {"num_ctx": self.context_size, "num_predict": max_tokens, "temperature": 0, "seed": 7},
            "keep_alive": "15m",
        }
        if fmt is not None:
            body["format"] = fmt
        t0 = time.monotonic()
        with _INFERENCE_LOCK:
            try:
                r = self._http.post(f"{self.base_url}/api/chat", json=body)
            except httpx.TimeoutException as e:
                raise ProviderUnavailable(f"Ollama call exceeded {self.timeout_s:.0f}s (max inference time). Reduce image size or chunk size.") from e
            except httpx.HTTPError as e:
                raise ProviderUnavailable(f"Ollama is not reachable: {e}") from e
        if r.status_code >= 400:
            raise ProviderUnavailable(f"Ollama returned {r.status_code}: {r.text[:300]}")
        data = r.json()
        return GenResult(
            text=(data.get("message") or {}).get("content", ""),
            tokens_in=int(data.get("prompt_eval_count") or 0),
            tokens_out=int(data.get("eval_count") or 0),
            duration_ms=int((data.get("total_duration") or 0) / 1_000_000) or int((time.monotonic() - t0) * 1000),
        )

    @staticmethod
    def _messages(prompt: str, system: str, images: list[bytes] | None) -> list[dict[str, Any]]:
        msgs: list[dict[str, Any]] = []
        if system:
            msgs.append({"role": "system", "content": system})
        user: dict[str, Any] = {"role": "user", "content": prompt}
        if images:
            user["images"] = [base64.b64encode(i).decode("ascii") for i in images]
        msgs.append(user)
        return msgs

    def generate_text(self, prompt: str, *, system: str = "", max_tokens: int = 1024) -> GenResult:
        return self._chat(self._messages(prompt, system, None), max_tokens=max_tokens, fmt=None)

    def analyse_images(self, prompt: str, images: list[bytes], *, system: str = "", max_tokens: int = 1024,
                       schema: dict[str, object] | None = None) -> GenResult:
        return self._chat(self._messages(prompt, system, images), max_tokens=max_tokens, fmt=schema)

    def extract_structured(self, prompt: str, schema: type[M], *, images: list[bytes] | None = None,
                           system: str = "", max_tokens: int = 2048, usage: Usage | None = None) -> M:
        js = schema.model_json_schema()
        return structured_with_retry(
            lambda p: self._chat(self._messages(p, system, images), max_tokens=max_tokens, fmt=js),
            schema, prompt, usage,
        )
