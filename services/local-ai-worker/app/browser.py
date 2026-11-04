"""Playwright helpers (optional dependency: pip install .[browser] && python -m playwright install chromium)."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

from .errors import Unsupported
from .net_guard import NetGuard

VIEWPORTS = {
    "desktop": {"viewport": {"width": 1440, "height": 900}, "device_scale_factor": 1},
    "mobile": {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2, "is_mobile": True, "has_touch": True},
}
CAPTCHA_RE = re.compile(r"recaptcha|hcaptcha|turnstile|captcha", re.I)
MAX_FULLPAGE_HEIGHT = 8000


@dataclass
class PageCapture:
    url: str
    viewport: str
    png: bytes
    width: int
    height: int
    text: str
    console: list[dict[str, str]] = field(default_factory=list)
    failed: list[dict[str, Any]] = field(default_factory=list)
    captcha: bool = False


def require_playwright() -> Any:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise Unsupported(
            "Browser testing needs Playwright on the AI PC. Run: pip install .[browser] then python -m playwright install chromium"
        ) from e
    return sync_playwright


class Browser:
    """One Chromium per job. Every request is checked by the NetGuard."""

    def __init__(self, guard: NetGuard, http_credentials: dict[str, str] | None = None) -> None:
        self.guard = guard
        self.http_credentials = http_credentials
        self._pw: Any = None
        self._browser: Any = None

    def __enter__(self) -> Browser:
        sync_playwright = require_playwright()
        self._pw = sync_playwright().start()
        args = ["--disable-background-networking", "--no-first-run", "--disable-sync", "--disable-extensions"]
        rules = self.guard.resolver_rules()
        if rules:
            args.append(f"--host-resolver-rules={rules}")
        self._browser = self._pw.chromium.launch(headless=True, args=args)
        return self

    def __exit__(self, *exc: object) -> None:
        if self._browser:
            self._browser.close()
        if self._pw:
            self._pw.stop()

    def new_context(self, device: str) -> Any:
        opts: dict[str, Any] = dict(VIEWPORTS.get(device, VIEWPORTS["desktop"]))
        opts["service_workers"] = "block"
        opts["ignore_https_errors"] = False
        if self.http_credentials:
            opts["http_credentials"] = self.http_credentials
        ctx = self._browser.new_context(**opts)

        def route(r: Any) -> None:
            ok, why = self.guard.check(r.request.url)
            if ok:
                r.continue_()
            else:
                self.guard.blocked.append(f"{r.request.url} ({why})")
                r.abort("blockedbyclient")

        ctx.route("**/*", route)
        return ctx

    @staticmethod
    def attach_listeners(page: Any, console: list[dict[str, str]], failed: list[dict[str, Any]]) -> None:
        page.on("console", lambda m: console.append({"type": m.type, "text": m.text[:500]}) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: console.append({"type": "pageerror", "text": str(e)[:500]}))
        page.on("requestfailed", lambda r: failed.append({"url": r.url[:300], "error": (r.failure or "")[:200]}))
        page.on("response", lambda r: failed.append({"url": r.url[:300], "status": r.status}) if r.status >= 400 else None)

    def capture(self, url: str, device: str) -> PageCapture:
        ok, why = self.guard.check(url)
        if not ok:
            raise Unsupported(f"Refusing to open {url}: {why}. Add the domain to the environment's allowed domains.")
        ctx = self.new_context(device)
        console: list[dict[str, str]] = []
        failed: list[dict[str, Any]] = []
        try:
            page = ctx.new_page()
            self.attach_listeners(page, console, failed)
            page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            try:
                page.wait_for_load_state("networkidle", timeout=15_000)
            except Exception:
                time.sleep(2)
            height = min(MAX_FULLPAGE_HEIGHT, int(page.evaluate("document.documentElement.scrollHeight") or 900))
            vp = page.viewport_size or {"width": 1440, "height": 900}
            png = page.screenshot(full_page=True, clip={"x": 0, "y": 0, "width": vp["width"], "height": height}, animations="disabled")
            text = page.evaluate("document.body ? document.body.innerText : ''")[:20000]
            html = page.content()
            return PageCapture(page.url, device, png, vp["width"], height, text, console, failed, bool(CAPTCHA_RE.search(html)))
        finally:
            ctx.close()
