"""Development reviews on a staging build.

- design_vs_development: deterministic pixel diff first; only differing regions go to the model.
- functional_qa / regression: run the manager's scenarios with Playwright; no model needed.
- sow_vs_development: scenario results for linked requirements; screenshot checks for visible ones;
  backend rules are always "Needs verification".
"""

from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urljoin

from ..browser import Browser, PageCapture
from ..config import MAX_OUTPUT_TOKENS
from ..errors import Unsupported
from ..image_processor import crop_pair, downscale, load, pixel_diff, to_png
from ..net_guard import NetGuard
from ..prompts import development as P
from ..response_validator import ComplianceReview, DiffDescription
from .context import JobContext

BACKEND_CATEGORIES = {"business_rule", "reward_logic", "api_integration", "security", "performance", "analytics", "deployment"}
MAX_DIFF_REGIONS_TO_MODEL = 5


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _match_design(path: str, index: int, assets: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not assets:
        return None
    words = set(_norm(path).split())
    best = max(assets, key=lambda a: len(words & set(_norm(str(a["screen_name"])).split())))
    if words & set(_norm(str(best["screen_name"])).split()):
        return best
    return assets[index] if index < len(assets) else assets[0]


class Run:
    def __init__(self, ctx: JobContext) -> None:
        self.ctx = ctx
        inp = ctx.input
        self.base = str(inp["staging_url"]).rstrip("/") + "/"
        self.paths: list[str] = list(inp.get("page_paths") or ["/"])
        self.devices: list[str] = list(inp.get("devices") or ["desktop"])
        self.guard = NetGuard(inp.get("allowed_domains") or [])
        self.creds: dict[str, str] = {}
        if (inp.get("environment") or {}).get("has_credentials"):
            c = ctx.storage.rpc("worker_get_credentials", {"p_job": ctx.job_id}) or {}
            self.creds = {k: str(v) for k, v in c.items() if v}
        http = None
        if "extra" in self.creds and ":" in self.creds["extra"]:
            u, p = self.creds["extra"].split(":", 1)
            http = {"username": u, "password": p}
        self.browser = Browser(self.guard, http)
        self.captures: list[dict[str, Any]] = []
        self.findings: list[dict[str, Any]] = []
        self.checks: list[dict[str, Any]] = []
        self.test_results: list[dict[str, Any]] = []
        self._n = 0
        self.req_by_id = {str(r["id"]): r for r in inp.get("requirements") or []}
        self.ref_to_id = {str(r["ref"]).upper(): str(r["id"]) for r in inp.get("requirements") or []}

    # ---------------------------------------------------------------- helpers
    def upload_png(self, png: bytes, label: str) -> str:
        self._n += 1
        path = f"{self.ctx.input['capture_prefix']}{self._n:02d}-{re.sub(r'[^a-z0-9]+', '-', label.lower())[:40]}.png"
        self.ctx.storage.upload("captures", path, png, "image/png")
        return path

    def add_capture(self, cap: PageCapture, design_asset_id: str | None = None, diff_ratio: float | None = None,
                    regions: list[dict[str, float]] | None = None) -> str:
        key = f"c{len(self.captures)}"
        img = load(cap.png)
        stored = downscale(cap.png, 2400) if img.size[1] > 2400 else None
        data = stored.data if stored else cap.png
        path = self.upload_png(data, f"{cap.viewport}-{cap.url.split('/')[-1] or 'home'}")
        w, h = (stored.width, stored.height) if stored else img.size
        self.captures.append({
            "key": key, "url": cap.url, "viewport": cap.viewport, "storage_path": path, "width": w, "height": h,
            "design_asset_id": design_asset_id, "diff_ratio": diff_ratio, "diff_regions": regions or [],
            "console_messages": cap.console[:50], "failed_requests": cap.failed[:50],
        })
        return key

    def console_finding(self, cap: PageCapture, key: str) -> None:
        errors = [c for c in cap.console if c["type"] in ("error", "pageerror")]
        bad = [f for f in cap.failed if f.get("status", 0) >= 500 or "error" in f]
        if not errors and not bad:
            return
        self.findings.append({
            "title": f"{len(errors)} console error(s), {len(bad)} failed request(s) on {cap.url.replace(self.base, '/')}",
            "severity": "medium" if bad else "low", "confidence": "high",
            "description": "Captured while loading the page in a headless browser.",
            "observed": "; ".join(e["text"] for e in errors[:3])[:900], "expected": "No console errors or failed requests.",
            "suggested_correction": "Check the browser console and network tab for these errors.",
            "affected_page": cap.url, "reproducibility": "Seen on page load", "capture_key": key,
            "console": errors[:20], "network": bad[:20], "requirement_id": None,
        })

    # ---------------------------------------------------------------- visual
    def visual(self) -> None:
        assets = self.ctx.input.get("design_assets") or []
        for i, path in enumerate(self.paths):
            for device in self.devices:
                url = urljoin(self.base, path.lstrip("/"))
                self.ctx.step(f"capture {path} ({device})")
                cap = self.browser.capture(url, device)
                design = _match_design(path, i, assets) if device == "desktop" or len(assets) == 1 else None
                if not design:
                    key = self.add_capture(cap)
                    self.console_finding(cap, key)
                    continue
                d_img = load(self.ctx.storage.download(design.get("bucket") or "designs", design["path"]))
                s_img = load(cap.png)
                ratio, regions, s_resized = pixel_diff(d_img, s_img)
                key_regions = [{"x": r.x / s_resized.size[0], "y": r.y / s_resized.size[1], "w": r.w / s_resized.size[0], "h": r.h / s_resized.size[1]}
                               for r in regions]
                resized_cap = PageCapture(cap.url, cap.viewport, to_png(s_resized), *s_resized.size, cap.text, cap.console, cap.failed, cap.captcha)
                key = self.add_capture(resized_cap, str(design["id"]), round(ratio, 4), key_regions)
                self.console_finding(cap, key)
                for r, nr in list(zip(regions, key_regions, strict=False))[:MAX_DIFF_REGIONS_TO_MODEL]:
                    self.ctx.step(f"describe difference on {path}")
                    dpng, spng = crop_pair(d_img, s_resized, r)
                    desc = self.ctx.provider.extract_structured(P.diff_prompt(path, device), DiffDescription, images=[dpng, spng],
                                                                system=P.SYSTEM, max_tokens=MAX_OUTPUT_TOKENS["dev_diff"], usage=self.ctx.usage)
                    if not desc.relevant or not desc.title:
                        continue
                    self.findings.append({
                        "title": desc.title, "severity": desc.severity, "description": desc.description, "expected": desc.expected,
                        "observed": desc.observed, "suggested_correction": desc.suggested_correction, "confidence": desc.confidence,
                        "evidence_note": f"Pixel diff {r.ratio:.0%} of this area changed vs design “{design['screen_name']}” (region approximate).",
                        "affected_page": url, "capture_key": key, "region": {k: round(min(1.0, max(0.0, v)), 4) for k, v in nr.items()},
                        "requirement_id": None, "reproducibility": "Deterministic screenshot comparison",
                    })

    # ---------------------------------------------------------------- functional
    def _fill_value(self, v: str | None) -> str:
        v = v or ""
        return v.replace("{{username}}", self.creds.get("username", "")).replace("{{password}}", self.creds.get("password", ""))

    @staticmethod
    def _locate(page: Any, target: str, kind: str) -> Any:
        if re.match(r"^[#.\[]|^\w+\[|^//", target) or target.startswith("css="):
            return page.locator(target.removeprefix("css=")).first
        if kind == "fill":
            for loc in (page.get_by_label(target), page.get_by_placeholder(target)):
                if loc.count():
                    return loc.first
        if kind == "click":
            for loc in (page.get_by_role("button", name=target), page.get_by_role("link", name=target)):
                if loc.count():
                    return loc.first
        if kind == "check":
            loc = page.get_by_label(target)
            if loc.count():
                return loc.first
        return page.get_by_text(target, exact=False).first

    def run_case(self, case: dict[str, Any], device: str = "desktop") -> dict[str, Any]:
        ctx_b = self.browser.new_context(device)
        console: list[dict[str, str]] = []
        failed: list[dict[str, Any]] = []
        t0 = time.monotonic()
        page = ctx_b.new_page()
        self.browser.attach_listeners(page, console, failed)
        page.set_default_timeout(15_000)
        result, actual, error = "verified", "All steps passed.", None
        shot: str | None = None
        try:
            for i, step in enumerate(case.get("steps") or [], start=1):
                a, target, value = step.get("action"), str(step.get("target", "")), step.get("value")
                if a == "goto":
                    url = urljoin(self.base, target.lstrip("/"))
                    ok, why = self.guard.check(url)
                    if not ok:
                        raise Unsupported(f"Step {i}: {why}")
                    page.goto(url, wait_until="domcontentloaded")
                    if re.search(r"recaptcha|hcaptcha|turnstile", page.content(), re.I):
                        result, actual = "blocked", "A CAPTCHA is present. The worker never bypasses CAPTCHAs; test this step manually or disable the CAPTCHA on staging."
                        break
                elif a == "fill":
                    self._locate(page, target, "fill").fill(self._fill_value(value))
                elif a == "click":
                    self._locate(page, target, "click").click()
                elif a == "select":
                    self._locate(page, target, "fill").select_option(label=value or "")
                elif a == "check":
                    self._locate(page, target, "check").check()
                elif a == "expect_text":
                    page.get_by_text(target, exact=False).first.wait_for(state="visible")
                elif a == "expect_visible":
                    self._locate(page, target, "visible").wait_for(state="visible")
                elif a == "expect_url":
                    page.wait_for_url(re.compile(re.escape(target)))
                elif a == "wait":
                    page.wait_for_timeout(min(10_000, int(target or 1000)))
        except Unsupported:
            raise
        except Exception as e:
            result = "failed"
            msg = str(e).split("\n")[0][:400]
            actual, error = f"Failed at a step: {msg}", msg
        if result != "verified":
            try:
                shot = self.upload_png(page.screenshot(full_page=False), f"fail-{case['title']}")
            except Exception:
                shot = None
        ctx_b.close()
        return {"test_case_id": case["id"], "result": result, "actual": actual, "error": error,
                "duration_ms": int((time.monotonic() - t0) * 1000), "evidence": {"screenshot": shot, "console": console[:20], "failed_requests": failed[:20]}}

    def functional(self) -> None:
        for case in self.ctx.input.get("test_cases") or []:
            self.ctx.step(f"scenario: {case['title']}")
            r = self.run_case(case)
            self.test_results.append(r)
            req_id = str(case["requirement_id"]) if case.get("requirement_id") and str(case["requirement_id"]) in self.req_by_id else None
            if r["result"] in ("failed", "blocked"):
                self.findings.append({
                    "title": f"Scenario {'failed' if r['result'] == 'failed' else 'blocked'}: {case['title']}"[:300],
                    "severity": "high" if r["result"] == "failed" else "medium", "confidence": "high",
                    "description": r["actual"], "expected": case.get("expected") or "All steps pass.", "observed": r["actual"],
                    "suggested_correction": "", "test_scenario": case["title"], "reproducibility": "Failed in 1 of 1 automated runs",
                    "requirement_id": req_id, "console": r["evidence"]["console"], "network": r["evidence"]["failed_requests"],
                    "affected_page": self.base,
                })
            if req_id:
                self.checks.append({"requirement_id": req_id, "result": "verified" if r["result"] == "verified" else r["result"],
                                    "method": "functionally_tested", "note": f"Scenario “{case['title']}”: {r['actual']}"[:900]})

    # ---------------------------------------------------------------- SOW compliance
    def compliance(self) -> None:
        reqs = list(self.req_by_id.values())
        tested = {str(c.get("requirement_id")) for c in self.ctx.input.get("test_cases") or [] if c.get("requirement_id")}
        if tested:
            self.functional()
        visible = [r for r in reqs if str(r["id"]) not in tested and r.get("category") not in BACKEND_CATEGORIES]
        for r in reqs:
            if str(r["id"]) not in tested and r.get("category") in BACKEND_CATEGORIES:
                self.checks.append({"requirement_id": str(r["id"]), "result": "needs_verification", "method": None,
                                    "note": "Backend rule: a screenshot can’t prove it. Add a test scenario or verify manually."})
        best: dict[str, dict[str, Any]] = {}
        rank = {"verified": 3, "failed": 2, "needs_verification": 1}
        visible_ids = {str(r["id"]) for r in visible}
        for path in self.paths:
            if not visible:
                break
            url = urljoin(self.base, path.lstrip("/"))
            self.ctx.step(f"compliance check {path}")
            cap = self.browser.capture(url, "desktop")
            key = self.add_capture(cap)
            self.console_finding(cap, key)
            img = downscale(cap.png, self.ctx.limit("image_long_edge", 1600)).data
            review = self.ctx.provider.extract_structured(P.compliance_prompt(path, "desktop", visible, cap.text), ComplianceReview,
                                                          images=[img], system=P.SYSTEM, max_tokens=MAX_OUTPUT_TOKENS["dev_compliance"], usage=self.ctx.usage)
            for c in review.checks:
                rid = self.ref_to_id.get(c.requirement_ref)
                # Only requirements we asked about; backend rules can never be judged from a screenshot.
                if not rid or rid not in visible_ids or c.result not in rank:
                    continue
                if rid not in best or rank[c.result] > rank[best[rid]["result"]]:
                    best[rid] = {"requirement_id": rid, "result": c.result, "method": "visually_observed" if c.result != "needs_verification" else None,
                                 "note": f"{path}: {c.note}"[:900], "_key": key, "_url": url}
        for rid, b in best.items():
            if b["result"] == "failed":
                r = self.req_by_id[rid]
                self.findings.append({
                    "title": f"Not implemented as required: {r['title']}"[:300], "severity": "high", "confidence": "medium",
                    "description": b["note"], "expected": str(r.get("description") or r["title"]), "observed": b["note"],
                    "requirement_id": rid, "capture_key": b["_key"], "affected_page": b["_url"],
                    "evidence_note": "Judged from a screenshot of the staging page; verify before assigning.",
                })
            self.checks.append({k: v for k, v in b.items() if not k.startswith("_")})
        for r in visible:
            if str(r["id"]) not in best:
                self.checks.append({"requirement_id": str(r["id"]), "result": "not_tested", "method": None,
                                    "note": "Not visible on the captured pages. Add the page path or a test scenario."})


def run(ctx: JobContext) -> tuple[dict[str, Any], dict[str, Any]]:
    run_ = Run(ctx)
    if not run_.guard.allowed:
        raise Unsupported("No allowed domains for this job. Add the staging domain to the test environment.")
    ctx.step("start browser")
    with run_.browser:
        if ctx.review_type == "design_vs_development":
            run_.visual()
        elif ctx.review_type in ("functional_qa", "regression"):
            run_.functional()
        elif ctx.review_type == "sow_vs_development":
            run_.compliance()
    summary: dict[str, Any] = {"blocked_requests": run_.guard.blocked[:50]}
    passed = sum(1 for r in run_.test_results if r["result"] == "verified")
    if run_.test_results:
        summary.update({"passed": passed, "total": len(run_.test_results)})
    result = {"captures": run_.captures, "findings": run_.findings, "checks": run_.checks,
              "test_results": run_.test_results, "test_summary": summary,
              "notes": {"blocked_requests": len(run_.guard.blocked)}}
    return result, ctx.meta(P.VERSION)
