"""Pydantic schemas for every model response, plus region normalisation.

Nothing the model returns is written to Supabase until it has passed these models.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Category = Literal[
    "user_journey", "screen", "ui", "functional", "validation", "business_rule", "reward_logic",
    "api_integration", "legal", "performance", "security", "analytics", "deployment",
]
Priority = Literal["low", "medium", "high", "critical"]
Confidence = Literal["high", "medium", "low", "needs_manual_verification"]
Severity = Literal["critical", "high", "medium", "low", "informational"]
CheckResult = Literal["verified", "failed", "needs_verification", "not_tested", "blocked"]

REF_RE = re.compile(r"^REQ-\d{1,4}$")


class Strict(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


# ---------------------------------------------------------------- SOW extraction
class ExtractedRequirement(Strict):
    title: str = Field(min_length=3, max_length=300)
    description: str = Field(default="", max_length=4000)
    category: Category = "functional"
    priority: Priority = "medium"
    acceptance_criteria: str | None = Field(default=None, max_length=4000)
    journey_hint: str | None = Field(default=None, max_length=200)
    source_pages: list[int] = Field(default_factory=list, max_length=50)
    source_text: str = Field(min_length=1, max_length=2000, description="Verbatim quote from the document")
    confidence: Confidence = "medium"

    @field_validator("source_pages")
    @classmethod
    def positive_pages(cls, v: list[int]) -> list[int]:
        return sorted({p for p in v if p >= 1})


class SowExtraction(Strict):
    requirements: list[ExtractedRequirement] = Field(default_factory=list, max_length=200)


# ---------------------------------------------------------------- regions
class ModelBox(Strict):
    """Bounding box as emitted by the model: [x1, y1, x2, y2].

    We ask for integers on a 0–1000 grid relative to the image (Qwen-VL's native format),
    but also accept 0–1 fractions or absolute pixels and convert them.
    """

    box: list[float] = Field(min_length=4, max_length=4)


def normalise_box(box: list[float] | tuple[float, ...] | None, sent_w: int, sent_h: int) -> dict[str, float] | None:
    """Convert a model box to {x, y, w, h} in 0–1 relative to the image. Returns None if unusable."""
    if not box or len(box) != 4:
        return None
    x1, y1, x2, y2 = (float(v) for v in box)
    if x2 < x1:
        x1, x2 = x2, x1
    if y2 < y1:
        y1, y2 = y2, y1
    hi = max(x1, y1, x2, y2)
    if hi <= 1.0:
        sx, sy = 1.0, 1.0
    elif hi <= 1000.0:
        sx, sy = 1000.0, 1000.0
    else:  # absolute pixels of the image we sent
        sx, sy = float(sent_w), float(sent_h)
    nx1, ny1 = max(0.0, x1 / sx), max(0.0, y1 / sy)
    nx2, ny2 = min(1.0, x2 / sx), min(1.0, y2 / sy)
    w, h = nx2 - nx1, ny2 - ny1
    if w <= 0.002 or h <= 0.002:
        return None
    return {"x": round(nx1, 4), "y": round(ny1, 4), "w": round(w, 4), "h": round(h, 4)}


# ---------------------------------------------------------------- design review
class ModelFinding(Strict):
    title: str = Field(min_length=3, max_length=300)
    severity: Severity = "medium"
    description: str = Field(default="", max_length=4000)
    expected: str = Field(default="", max_length=2000)
    observed: str = Field(default="", max_length=2000)
    suggested_correction: str = Field(default="", max_length=2000)
    confidence: Confidence = "medium"
    evidence_note: str = Field(default="", max_length=1000)
    requirement_ref: str | None = Field(default=None, description="REQ-### or null for an additional observation")
    box: list[float] | None = Field(default=None, description="[x1,y1,x2,y2] on a 0-1000 grid, or null")
    screen_index: int | None = Field(default=None, description="For multi-screen calls: 1-based screen number")

    @field_validator("requirement_ref")
    @classmethod
    def ref_format(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().upper()
        return v if REF_RE.match(v) else None

    @field_validator("box")
    @classmethod
    def box_len(cls, v: list[float] | None) -> list[float] | None:
        return v if v is not None and len(v) == 4 else None


class ModelCheck(Strict):
    requirement_ref: str
    result: CheckResult
    note: str = Field(default="", max_length=1000)

    @field_validator("requirement_ref")
    @classmethod
    def ref_format(cls, v: str) -> str:
        v = v.strip().upper()
        if not REF_RE.match(v):
            raise ValueError("requirement_ref must look like REQ-001")
        return v


class ScreenReview(Strict):
    findings: list[ModelFinding] = Field(default_factory=list, max_length=40)
    checks: list[ModelCheck] = Field(default_factory=list, max_length=200)


class JourneyReview(Strict):
    findings: list[ModelFinding] = Field(default_factory=list, max_length=30)


# ---------------------------------------------------------------- development
class DiffDescription(Strict):
    relevant: bool = Field(description="False when the difference is only anti-aliasing, dynamic content or noise")
    title: str = Field(default="", max_length=300)
    severity: Severity = "low"
    description: str = Field(default="", max_length=2000)
    expected: str = Field(default="", max_length=1000)
    observed: str = Field(default="", max_length=1000)
    suggested_correction: str = Field(default="", max_length=1000)
    confidence: Confidence = "medium"


class ComplianceReview(Strict):
    checks: list[ModelCheck] = Field(default_factory=list, max_length=200)
