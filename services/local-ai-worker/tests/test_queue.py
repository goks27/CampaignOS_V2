import json
from pathlib import Path

from app.cache import Cache
from app.providers.mock import MockProvider
from app.queue import Worker
from tests.conftest import FakeStorage, make_text_pdf, responder_from


def make_worker(storage, provider, tmp_path: Path) -> Worker:
    return Worker(storage, provider, name="test-pc", cache=Cache(tmp_path / "c"), poll_interval=0.01, heartbeat_seconds=999)


def job(review_type="sow_analysis", **inp):
    return {"id": "11111111-2222-3333-4444-555555555555", "campaign_id": "c1", "review_type": review_type,
            "attempts": 1, "max_attempts": 3, "timeout_seconds": 600,
            "input": {"bucket": "sow", "path": "c1/sow.pdf", "journeys": [], **inp}}


def test_claim_process_complete(tmp_path):
    storage = FakeStorage({"sow/c1/sow.pdf": make_text_pdf(["Users register with a mobile number and OTP."])})
    jobs = [job()]
    storage.rpc_results["claim_review_job"] = lambda p: jobs.pop() if jobs else None
    storage.rpc_results["heartbeat_job"] = {"cancel_requested": False}
    provider = MockProvider(responder_from([("Extract every requirement", {"requirements": [
        {"title": "Mobile registration", "source_text": "register with a mobile number", "source_pages": [1]}]})]))
    w = make_worker(storage, provider, tmp_path)
    assert w.tick() is True
    assert w.tick() is False
    names = [n for n, _ in storage.rpcs]
    assert "complete_review_job" in names and "fail_review_job" not in names
    params = dict(storage.rpcs)["complete_review_job"]
    assert params["p_result"]["requirements"][0]["title"] == "Mobile registration"
    assert params["p_meta"]["prompt_version"] == "sow-extract-v1"
    json.dumps(params)  # payload must be JSON serialisable


def test_validation_failure_is_final_and_saves_nothing(tmp_path):
    storage = FakeStorage({"sow/c1/sow.pdf": make_text_pdf(["Some requirement text that is long enough to be text."])})
    storage.rpc_results["claim_review_job"] = lambda p: job()
    provider = MockProvider(lambda p, n: "{broken")
    w = make_worker(storage, provider, tmp_path)
    w.process(job())
    names = [n for n, _ in storage.rpcs]
    assert "complete_review_job" not in names
    fail = dict(storage.rpcs)["fail_review_job"]
    assert fail["p_retryable"] is False and "failed validation twice" in fail["p_error"]


def test_limit_error_is_final_with_clear_message(tmp_path):
    storage = FakeStorage({"sow/c1/sow.pdf": make_text_pdf(["x" * 60] * 3)})
    w = make_worker(storage, MockProvider(), tmp_path)
    w.process(job(limits={"max_pdf_pages": 2}))
    fail = dict(storage.rpcs)["fail_review_job"]
    assert fail["p_retryable"] is False and "Max PDF pages" in fail["p_error"]


def test_cancel_between_steps(tmp_path):
    storage = FakeStorage({"sow/c1/sow.pdf": make_text_pdf(["Users register with a mobile number."])})
    w = make_worker(storage, MockProvider(), tmp_path)
    original = w.process

    def cancel_then_process(j):
        # The heartbeat thread would set this when the manager clicks Cancel.
        import threading
        ev = threading.Event()
        ev.set()
        from app.jobs import context
        real_init = context.JobContext.__init__

        def patched(self, *a, **k):
            real_init(self, *a, **k)
            self.cancel_flag = ev
        context.JobContext.__init__ = patched
        try:
            return original(j)
        finally:
            context.JobContext.__init__ = real_init

    assert cancel_then_process(job()) == "cancelled"
    fail = dict(storage.rpcs)["fail_review_job"]
    assert fail["p_retryable"] is False


def test_model_not_ready_leaves_jobs_queued(tmp_path):
    storage = FakeStorage()
    storage.rpc_results["claim_review_job"] = lambda p: job()
    provider = MockProvider()
    provider.health_check = lambda: __import__("app.providers.base", fromlist=["Health"]).Health(False, "m", False, message="Run: ollama pull m")
    w = make_worker(storage, provider, tmp_path)
    assert w.tick() is False
    assert "claim_review_job" not in [n for n, _ in storage.rpcs]


def test_unexpected_errors_are_retryable(tmp_path):
    storage = FakeStorage()  # download will KeyError
    w = make_worker(storage, MockProvider(), tmp_path)
    assert w.process(job()) == "failed"
    assert dict(storage.rpcs)["fail_review_job"]["p_retryable"] is True
