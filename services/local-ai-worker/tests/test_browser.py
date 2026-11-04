"""Real Chromium run of the scenario runner and capture (skipped when Playwright isn't installed)."""

import http.server
import threading
from functools import partial

import pytest

pytest.importorskip("playwright.sync_api")
pytestmark = pytest.mark.browser

from app.jobs import development  # noqa: E402
from app.net_guard import NetGuard  # noqa: E402
from app.providers.mock import MockProvider  # noqa: E402
from tests.conftest import FakeStorage  # noqa: E402

PAGE = b"""<!doctype html><html><body>
<h1>Register</h1>
<img src="http://10.0.0.1/tracker.png">
<label for="m">Mobile number</label><input id="m">
<label><input type="checkbox" id="t"> I accept the terms</label>
<button onclick="var v=document.getElementById('m').value; document.getElementById('out').textContent = v.length===10 ? 'OTP sent' : 'Enter a valid 10-digit mobile number'">Send OTP</button>
<p id="out"></p><script>console.error('demo console error')</script>
</body></html>"""


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, *a):
        pass


class LocalTestGuard(NetGuard):
    """Test only: lets the browser reach the local test server, everything else follows the real rules."""

    def check(self, url):
        if url.startswith("http://localhost:"):
            return True, ""
        return super().check(url)


@pytest.fixture
def server():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://localhost:{srv.server_address[1]}"
    srv.shutdown()


def test_scenarios_and_capture_in_real_chromium(make_ctx, server, monkeypatch):
    monkeypatch.setattr(development, "NetGuard", partial(LocalTestGuard))
    cases = [
        {"id": "t1", "title": "Valid mobile gets OTP", "requirement_id": "r1", "steps": [
            {"action": "goto", "target": "/register"}, {"action": "fill", "target": "Mobile number", "value": "9876543210"},
            {"action": "check", "target": "I accept the terms"}, {"action": "click", "target": "Send OTP"},
            {"action": "expect_text", "target": "OTP sent"}]},
        {"id": "t2", "title": "Short number is rejected", "steps": [
            {"action": "goto", "target": "/register"}, {"action": "fill", "target": "Mobile number", "value": "12345"},
            {"action": "click", "target": "Send OTP"}, {"action": "expect_text", "target": "Welcome back"}]},
    ]
    inp = {"staging_url": server, "page_paths": ["/register"], "devices": ["desktop"], "allowed_domains": ["localhost"],
           "requirements": [{"id": "r1", "ref": "REQ-001", "title": "OTP on valid mobile", "category": "functional"}],
           "test_cases": cases, "capture_prefix": "c1/job/"}
    storage = FakeStorage()
    result, _ = development.run(make_ctx("functional_qa", inp, MockProvider(), storage))
    res = {r["test_case_id"]: r for r in result["test_results"]}
    assert res["t1"]["result"] == "verified"
    assert res["t2"]["result"] == "failed" and res["t2"]["evidence"]["screenshot"].startswith("c1/job/")
    assert any(f["title"].startswith("Scenario failed") for f in result["findings"])
    assert {"requirement_id": "r1", "result": "verified", "method": "functionally_tested"}.items() <= result["checks"][0].items()
    assert any("10.0.0.1" in b for b in result["test_summary"]["blocked_requests"]), "private-network request must be blocked"
