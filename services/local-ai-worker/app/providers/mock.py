"""Deterministic provider for tests and dry runs. Never used in production."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import TypeVar

from pydantic import BaseModel

from .base import GenResult, Health, Usage, structured_with_retry

M = TypeVar("M", bound=BaseModel)
Responder = Callable[[str, int], str]  # (prompt, image_count) -> raw text


class MockProvider:
    model = "mock-model"
    context_size = 8192

    def __init__(self, responder: Responder | None = None) -> None:
        self.responder = responder or (lambda _p, _n: json.dumps({}))
        self.calls: list[tuple[str, int]] = []

    def health_check(self) -> Health:
        return Health(True, self.model, True, "cpu", "mock")

    def _run(self, prompt: str, n_images: int) -> GenResult:
        self.calls.append((prompt, n_images))
        return GenResult(self.responder(prompt, n_images), tokens_in=len(prompt) // 4, tokens_out=50, duration_ms=5)

    def generate_text(self, prompt: str, *, system: str = "", max_tokens: int = 1024) -> GenResult:
        return self._run(prompt, 0)

    def analyse_images(self, prompt: str, images: list[bytes], *, system: str = "", max_tokens: int = 1024,
                       schema: dict[str, object] | None = None) -> GenResult:
        return self._run(prompt, len(images))

    def extract_structured(self, prompt: str, schema: type[M], *, images: list[bytes] | None = None,
                           system: str = "", max_tokens: int = 2048, usage: Usage | None = None) -> M:
        return structured_with_retry(lambda p: self._run(p, len(images or [])), schema, prompt, usage)
