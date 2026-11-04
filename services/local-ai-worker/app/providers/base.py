"""Provider interface. Only local providers are implemented; there is no cloud fallback."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from ..errors import ValidationFailed

M = TypeVar("M", bound=BaseModel)


@dataclass
class Health:
    ok: bool
    model: str
    model_present: bool
    accelerator: str = "unknown"  # gpu | cpu | unknown
    message: str = ""
    info: dict[str, object] = field(default_factory=dict)


@dataclass
class GenResult:
    text: str
    tokens_in: int = 0
    tokens_out: int = 0
    duration_ms: int = 0


@dataclass
class Usage:
    """Accumulates token counts and time across all calls of one job."""

    tokens_in: int = 0
    tokens_out: int = 0
    duration_ms: int = 0
    calls: int = 0

    def add(self, r: GenResult) -> None:
        self.tokens_in += r.tokens_in
        self.tokens_out += r.tokens_out
        self.duration_ms += r.duration_ms
        self.calls += 1


class AIProvider(Protocol):
    model: str
    context_size: int

    def health_check(self) -> Health: ...

    def generate_text(self, prompt: str, *, system: str = "", max_tokens: int = 1024) -> GenResult: ...

    def analyse_images(self, prompt: str, images: list[bytes], *, system: str = "", max_tokens: int = 1024,
                       schema: dict[str, object] | None = None) -> GenResult: ...

    def extract_structured(self, prompt: str, schema: type[M], *, images: list[bytes] | None = None,
                           system: str = "", max_tokens: int = 2048, usage: Usage | None = None) -> M: ...


def parse_json_loose(text: str) -> object:
    """Parse a JSON object even if the model wrapped it in a code fence or added text around it."""
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`")
        t = t[t.find("\n") + 1:] if "\n" in t else t
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        start, end = t.find("{"), t.rfind("}")
        if start >= 0 and end > start:
            return json.loads(t[start:end + 1])
        raise


def structured_with_retry(call: StructuredCall, schema: type[M], prompt: str, usage: Usage | None) -> M:
    """Call once; on invalid output retry once with the validation error; then give up."""
    error: str | None = None
    for attempt in (1, 2):
        p = prompt if error is None else (
            f"{prompt}\n\nYour previous answer was rejected because it did not match the required JSON schema:\n"
            f"{error[:1500]}\nReturn ONLY a corrected JSON object."
        )
        res = call(p)
        if usage is not None:
            usage.add(res)
        try:
            return schema.model_validate(parse_json_loose(res.text))
        except (ValidationError, json.JSONDecodeError, ValueError) as e:
            error = str(e)
            if attempt == 2:
                raise ValidationFailed(
                    "The model's answer failed validation twice; nothing was saved.",
                    {"schema": schema.__name__, "error": error[:2000], "raw": res.text[:2000]},
                ) from e
    raise AssertionError("unreachable")


class StructuredCall(Protocol):
    def __call__(self, prompt: str) -> GenResult: ...
