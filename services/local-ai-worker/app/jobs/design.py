"""Design review: one call per screen (or a small batch for consistency), then a journey-level pass."""

from __future__ import annotations

from typing import Any

from ..cache import Cache
from ..config import MAX_OUTPUT_TOKENS
from ..errors import LimitExceeded
from ..figma import export_frames
from ..image_processor import downscale, sha256
from ..prompts import design as P
from ..response_validator import JourneyReview, ScreenReview, normalise_box
from .context import JobContext

RESULT_RANK = {"verified": 3, "failed": 2, "needs_verification": 1, "not_tested": 0, "blocked": 0}


def _screens(ctx: JobContext) -> list[dict[str, Any]]:
    """Downloaded, downscaled screens: {id|key, name, type, data, w, h}."""
    long_edge = ctx.limit("image_long_edge", 1600)
    max_screens = ctx.limit("max_screens_per_review", 12)
    out: list[dict[str, Any]] = []
    assets = ctx.input.get("assets") or []
    if ctx.input.get("source") == "figma" and not assets:
        ctx.step("export frames from Figma")
        frames = export_frames(str(ctx.input.get("figma_url")), ctx.figma_token, max_screens)
        figma_assets = []
        for i, f in enumerate(frames):
            prep = downscale(f.png, long_edge)
            path = f"{ctx.input['capture_prefix']}figma-{i:02d}.png"
            ctx.storage.upload("captures", path, prep.data, "image/png")
            key = f"f{i}"
            figma_assets.append({"key": key, "screen_name": f.name, "storage_path": path, "width": prep.width, "height": prep.height,
                                 "original_width": prep.original_width, "original_height": prep.original_height,
                                 "content_hash": sha256(prep.data), "node_id": f.node_id, "sort_order": i})
            out.append({"key": key, "name": f.name, "type": "figma_frame", "data": prep.data, "w": prep.width, "h": prep.height,
                        "hash": sha256(prep.data)})
        ctx.input["_figma_assets"] = figma_assets
        return out
    if len(assets) > max_screens:
        raise LimitExceeded(f"Limit reached: {len(assets)} screens; the maximum per review is {max_screens}. Split the submission or raise the limit in Settings.",
                            {"limit": "max_screens_per_review"})
    for a in assets:
        ctx.step(f"download {a['screen_name']}")
        raw = ctx.storage.download(a.get("bucket") or "designs", a["path"])
        prep = downscale(raw, long_edge)
        out.append({"id": a["id"], "name": a["screen_name"], "type": a.get("screen_type", "screen"), "data": prep.data,
                    "w": prep.width, "h": prep.height, "hash": a.get("content_hash") or sha256(raw)})
    return out


def _finding_out(f: Any, screen: dict[str, Any] | None, ref_to_id: dict[str, str]) -> dict[str, Any]:
    req_id = ref_to_id.get(f.requirement_ref or "")
    region = normalise_box(f.box, screen["w"], screen["h"]) if screen and f.box else None
    d: dict[str, Any] = {
        "title": f.title, "severity": f.severity, "description": f.description, "expected": f.expected,
        "observed": f.observed, "suggested_correction": f.suggested_correction, "confidence": f.confidence,
        "evidence_note": f.evidence_note + (" (region approximate)" if region else ""),
        "requirement_id": req_id, "region": region,
        "model_requirement_ref": f.requirement_ref,
    }
    if screen:
        if "id" in screen:
            d["design_asset_id"] = screen["id"]
        else:
            d["design_asset_key"] = screen["key"]
    return d


def _dedupe(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str, str]] = set()
    out = []
    for f in findings:
        k = (str(f.get("design_asset_id") or f.get("design_asset_key") or ""), str(f.get("requirement_id") or ""), f["title"].lower()[:60])
        if k in seen:
            continue
        seen.add(k)
        out.append(f)
    return out


def run(ctx: JobContext) -> tuple[dict[str, Any], dict[str, Any]]:
    mode = ctx.review_type
    reqs = ctx.input.get("requirements") or []
    ref_to_id = {str(r["ref"]).upper(): str(r["id"]) for r in reqs}
    journey = ctx.input.get("journey")
    screens = _screens(ctx)
    findings: list[dict[str, Any]] = []
    checks: dict[str, dict[str, Any]] = {}
    req_sig = ",".join(sorted(f"{r['id']}@{r.get('version')}" for r in reqs))

    if mode == "design_consistency":
        batch = 4
        for start in range(0, len(screens), batch):
            group = screens[start:start + batch]
            ctx.step(f"consistency check, screens {start + 1}–{start + len(group)}")
            key = Cache.key("consistency", P.VERSION, ctx.provider.model, *[s["hash"] for s in group])
            cached = ctx.cache.get(key)
            review = JourneyReview.model_validate(cached) if cached is not None else ctx.provider.extract_structured(
                P.consistency_prompt([s["name"] for s in group]), JourneyReview, images=[s["data"] for s in group],
                system=P.SYSTEM, max_tokens=MAX_OUTPUT_TOKENS["design_consistency"], usage=ctx.usage)
            if cached is None:
                ctx.cache.put(key, review.model_dump())
            for f in review.findings:
                idx = (f.screen_index or 1) - 1
                screen = group[idx] if 0 <= idx < len(group) else None
                findings.append(_finding_out(f, screen, {}))
    else:
        for s in screens:
            ctx.step(f"review screen {s['name']}")
            key = Cache.key("screen", P.VERSION, ctx.provider.model, s["hash"], req_sig)
            cached = ctx.cache.get(key)
            sreview = ScreenReview.model_validate(cached) if cached is not None else ctx.provider.extract_structured(
                P.screen_prompt(s["name"], s["type"], journey, reqs, mode), ScreenReview, images=[s["data"]],
                system=P.SYSTEM, max_tokens=MAX_OUTPUT_TOKENS["design_screen"], usage=ctx.usage)
            if cached is None:
                ctx.cache.put(key, sreview.model_dump())
            for f in sreview.findings:
                findings.append(_finding_out(f, s, ref_to_id))
            for c in sreview.checks:
                rid = ref_to_id.get(c.requirement_ref)
                if not rid or c.result not in ("verified", "needs_verification"):
                    continue
                prev = checks.get(rid)
                if prev is None or RESULT_RANK[c.result] > RESULT_RANK[prev["result"]]:
                    checks[rid] = {"requirement_id": rid, "result": c.result, "method": "visually_observed" if c.result == "verified" else None,
                                   "note": f"{s['name']}: {c.note}".strip(": ")}

        if reqs:
            ctx.step("journey-level pass")
            jr = ctx.provider.extract_structured(P.journey_prompt(journey, [s["name"] for s in screens], reqs), JourneyReview,
                                                 system=P.SYSTEM, max_tokens=MAX_OUTPUT_TOKENS["design_journey"], usage=ctx.usage)
            for f in jr.findings:
                f.box = None
                findings.append(_finding_out(f, None, ref_to_id))

    result: dict[str, Any] = {"findings": _dedupe(findings), "checks": list(checks.values())}
    if ctx.input.get("_figma_assets"):
        result["figma_assets"] = ctx.input["_figma_assets"]
    return result, ctx.meta(P.VERSION)
