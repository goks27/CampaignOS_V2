"""Benchmark gate (Phase 2, milestone 4).

Runs the real SOW-extraction and design-check prompts on local sample files, with no Supabase involved,
and writes benchmark-report.md so Gokul can judge whether local model quality is good enough.

    python -m app.benchmark --sow samples/gold-drop-sow.pdf --screens samples/screens --journey "Consumer promotion"
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from .cache import Cache
from .config import Settings
from .errors import JobError
from .job_logger import JobLog, setup_logging
from .jobs import design, sow
from .jobs.context import JobContext
from .providers.base import GenResult
from .providers.ollama import OllamaProvider

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}


class LocalFiles:
    """Storage stand-in that serves local files by path."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = files

    def download(self, bucket: str, path: str) -> bytes:
        return self.files[path]

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        self.files[path] = data

    def rpc(self, fn: str, params: dict[str, Any] | None = None) -> Any:
        return None


class TimedProvider(OllamaProvider):
    """Records every call's duration and outcome for the report."""

    calls: list[dict[str, Any]]

    def __init__(self, *a: Any, **k: Any) -> None:
        super().__init__(*a, **k)
        self.calls = []

    def _chat(self, messages: list[dict[str, Any]], *, max_tokens: int, fmt: dict[str, object] | str | None) -> GenResult:
        t0 = time.monotonic()
        try:
            r = super()._chat(messages, max_tokens=max_tokens, fmt=fmt)
            self.calls.append({"ok": True, "seconds": time.monotonic() - t0, "in": r.tokens_in, "out": r.tokens_out,
                               "images": len(messages[-1].get("images", []))})
            return r
        except Exception as e:
            self.calls.append({"ok": False, "seconds": time.monotonic() - t0, "error": str(e), "images": len(messages[-1].get("images", []))})
            raise


class VramSampler(threading.Thread):
    def __init__(self) -> None:
        super().__init__(daemon=True)
        self.peak_mb = 0
        self.available = shutil.which("nvidia-smi") is not None
        self._stop_event = threading.Event()

    def run(self) -> None:
        while self.available and not self._stop_event.wait(1.0):
            try:
                out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],  # noqa: S607
                                     capture_output=True, text=True, timeout=5, check=False).stdout
                self.peak_mb = max(self.peak_mb, *(int(x) for x in out.split() if x.strip().isdigit()))
            except (OSError, ValueError, subprocess.SubprocessError):
                self.available = False

    def stop(self) -> None:
        self._stop_event.set()


def draw_regions(png: bytes, findings: list[dict[str, Any]], out: Path) -> None:
    import io

    img = Image.open(io.BytesIO(png)).convert("RGB")
    d = ImageDraw.Draw(img)
    w, h = img.size
    for i, f in enumerate(findings, start=1):
        r = f.get("region")
        if not r:
            continue
        box = (r["x"] * w, r["y"] * h, (r["x"] + r["w"]) * w, (r["y"] + r["h"]) * h)
        d.rectangle(box, outline=(58, 80, 217), width=3)
        d.text((box[0] + 4, box[1] + 4), str(i), fill=(58, 80, 217))
    img.save(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Benchmark the local model on real campaign files")
    ap.add_argument("--sow", type=Path, required=True)
    ap.add_argument("--screens", type=Path, required=True, help="folder of PNG/JPG/WEBP screens")
    ap.add_argument("--journey", default=None)
    ap.add_argument("--out", type=Path, default=Path("benchmark-output"))
    ap.add_argument("--max-screens", type=int, default=12)
    args = ap.parse_args(argv)
    setup_logging()

    try:
        settings = Settings()  # type: ignore[call-arg]
        url, model, ctx_size = settings.ollama_url, settings.ollama_model, settings.ollama_context
    except Exception:
        url, model, ctx_size = "http://127.0.0.1:11434", "qwen3-vl:8b", 16384
    provider = TimedProvider(url, model, context_size=ctx_size)
    health = provider.warm_up()
    if not health.ok:
        print(f"Ollama not ready: {health.message}")
        return 2

    args.out.mkdir(parents=True, exist_ok=True)
    files: dict[str, bytes] = {"sow.pdf": args.sow.read_bytes()}
    screens = sorted(p for p in args.screens.iterdir() if p.suffix.lower() in IMAGE_EXT)[: args.max_screens]
    for p in screens:
        files[p.name] = p.read_bytes()
    storage = LocalFiles(files)
    cache = Cache(args.out / "no-cache-" / str(time.time_ns()))  # fresh: a benchmark must not reuse cached answers
    limits = {"max_pdf_pages": 30, "image_long_edge": 1600, "max_screens_per_review": args.max_screens}
    sampler = VramSampler()
    sampler.start()
    errors: list[str] = []

    # ---------------- SOW
    t0 = time.monotonic()
    sow_ctx = JobContext("bench-sow", "bench", "sow_analysis", {"bucket": "local", "path": "sow.pdf", "journeys": [{"name": args.journey}] if args.journey else [], "limits": limits},
                         provider, storage, cache, JobLog("bench-sow", "sow_analysis"), timeout_s=7200)
    try:
        sow_result, _ = sow.run(sow_ctx)
    except JobError as e:
        errors.append(f"SOW extraction failed: {e} {e.detail}")
        sow_result = {"requirements": [], "pages": [], "page_count": 0}
    sow_seconds = time.monotonic() - t0

    reqs = [{"id": f"r{i}", "ref": f"REQ-{i:03d}", "version": 1, **r} for i, r in enumerate(sow_result["requirements"], start=1)]
    if args.journey:
        reqs_for_design = [r for r in reqs if not r.get("journey_hint") or str(r["journey_hint"]).lower() == args.journey.lower()]
    else:
        reqs_for_design = reqs

    # ---------------- design
    t1 = time.monotonic()
    assets = [{"id": f"a{i}", "screen_name": p.stem, "screen_type": "screen", "bucket": "local", "path": p.name,
               "content_hash": hashlib.sha256(files[p.name]).hexdigest()} for i, p in enumerate(screens)]
    d_ctx = JobContext("bench-design", "bench", "sow_vs_design", {"assets": assets, "requirements": reqs_for_design, "journey": args.journey, "limits": limits},
                       provider, storage, cache, JobLog("bench-design", "sow_vs_design"), timeout_s=7200)
    try:
        design_result, _ = design.run(d_ctx)
    except JobError as e:
        errors.append(f"Design review failed: {e} {e.detail}")
        design_result = {"findings": [], "checks": []}
    design_seconds = time.monotonic() - t1
    sampler.stop()

    # ---------------- report
    by_asset: dict[str, list[dict[str, Any]]] = {}
    for f in design_result["findings"]:
        by_asset.setdefault(str(f.get("design_asset_id")), []).append(f)
    for a in assets:
        draw_regions(files[a["path"]], by_asset.get(a["id"], []), args.out / f"{a['screen_name']}-findings.png")

    ref_of = {r["id"]: r["ref"] for r in reqs}
    calls = provider.calls
    ok_calls = [c for c in calls if c["ok"]]
    lines = [
        "# CampaignOS local model benchmark", "",
        f"- Model: `{model}` · context {ctx_size} · runs on **{health.accelerator.upper()}**",
        f"- Peak GPU memory: {f'{sampler.peak_mb} MB' if sampler.available and sampler.peak_mb else 'not available (nvidia-smi not found)'}",
        f"- SOW: `{args.sow.name}`, {sow_result.get('page_count', 0)} pages, OCR pages: {sum(1 for p in sow_result.get('pages', []) if p['method'] == 'ocr')}",
        f"- Screens: {len(screens)} · Journey: {args.journey or '—'}",
        f"- Time: SOW {sow_seconds:.0f}s, design {design_seconds:.0f}s · {len(calls)} model calls, "
        f"average {sum(c['seconds'] for c in ok_calls) / max(1, len(ok_calls)):.1f}s, slowest {max((c['seconds'] for c in calls), default=0):.1f}s",
        f"- Failed calls: {len(calls) - len(ok_calls)} · Schema failures / job errors: {len(errors)}", "",
        "## How to judge this", "",
        "1. Requirements: are the important obligations there? Is each quote verbatim and on the cited page?",
        "2. Findings: are they real problems you would raise? Are regions roughly in the right place?",
        "3. False positives: how many findings would you dismiss?",
        "4. Speed: is the time per screen acceptable for your workflow?", "",
    ]
    if errors:
        lines += ["## Errors", "", *[f"- {e}" for e in errors], ""]
    lines += [f"## Extracted requirements ({len(reqs)})", "", "| ID | Category | Title | Pages | Confidence | Quote |", "|---|---|---|---|---|---|"]
    for r in reqs:
        quote = str(r["source_text"]).replace("|", "\\|").replace("\n", " ")[:160]
        lines.append(f"| {r['ref']} | {r['category']} | {str(r['title']).replace('|', '/')} | {', '.join(map(str, r['source_pages']))} | {r['confidence']} | {quote} |")
    lines += ["", f"## Design findings ({len(design_result['findings'])})", ""]
    for a in assets:
        fs = by_asset.get(a["id"], [])
        lines += [f"### {a['screen_name']} — {len(fs)} findings", "", f"![{a['screen_name']}]({a['screen_name']}-findings.png)", ""]
        for i, f in enumerate(fs, start=1):
            lines.append(f"{i}. **[{f['severity']}] {f['title']}** — {ref_of.get(f.get('requirement_id') or '', 'Additional observation')} · {f['confidence']}")
            if f.get("expected") or f.get("observed"):
                lines.append(f"   Expected: {f.get('expected') or '—'} · Observed: {f.get('observed') or '—'}")
        lines.append("")
    journey_level = by_asset.get("None", [])
    if journey_level:
        lines += ["### Journey-level (missing screens, incomplete flows)", ""]
        lines += [f"- **[{f['severity']}] {f['title']}** — {ref_of.get(f.get('requirement_id') or '', 'Additional observation')}" for f in journey_level]
        lines.append("")
    lines += ["## Requirements needing verification", ""]
    lines += [f"- {ref_of.get(c['requirement_id'])}: {c['result']} — {c['note']}" for c in design_result["checks"]] or ["- none"]
    lines += ["", "## Every model call", "", "| # | OK | Seconds | Images | Tokens in/out |", "|---|---|---|---|---|"]
    lines += [f"| {i} | {'yes' if c['ok'] else 'no: ' + str(c.get('error', ''))[:60]} | {c['seconds']:.1f} | {c['images']} | {c.get('in', '—')}/{c.get('out', '—')} |"
              for i, c in enumerate(calls, start=1)]
    report = args.out / "benchmark-report.md"
    report.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report written to {report.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
