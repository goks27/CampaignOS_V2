"""Polling loop: claim one job at a time, heartbeat while working, report the result."""

from __future__ import annotations

import logging
import signal
import threading
import time
from collections.abc import Callable
from typing import Any

from .cache import Cache
from .errors import JobCancelled, JobError, WorkerStopping
from .job_logger import JobLog
from .jobs import design, development, sow
from .jobs.context import JobContext, Storage
from .providers.base import AIProvider, Health

log = logging.getLogger("campaignos.worker")

Handler = Callable[[JobContext], tuple[dict[str, Any], dict[str, Any]]]
HANDLERS: dict[str, Handler] = {
    "sow_analysis": sow.run,
    "sow_vs_design": design.run,
    "design_consistency": design.run,
    "design_vs_development": development.run,
    "sow_vs_development": development.run,
    "functional_qa": development.run,
    "regression": development.run,
}


class Worker:
    def __init__(self, client: Storage, provider: AIProvider, *, name: str, cache: Cache, poll_interval: float = 5.0,
                 max_poll_interval: float = 60.0, heartbeat_seconds: float = 30.0, figma_token: str | None = None) -> None:
        self.client = client
        self.provider = provider
        self.name = name
        self.cache = cache
        self.poll_interval = poll_interval
        self.max_poll_interval = max_poll_interval
        self.heartbeat_seconds = heartbeat_seconds
        self.figma_token = figma_token
        self.stop = threading.Event()
        self.health: Health = Health(False, provider.model, False, message="Not checked yet")
        self.current: JobContext | None = None
        self._hb_thread: threading.Thread | None = None
        self._last_health = float("-inf")

    # ---------------------------------------------------------------- heartbeat
    def _send_heartbeat(self) -> None:
        cur = self.current
        try:
            self.client.rpc("worker_heartbeat", {
                "p_worker_name": self.name, "p_model": self.provider.model, "p_model_ready": self.health.ok,
                "p_model_message": self.health.message[:300], "p_accelerator": self.health.accelerator,
                "p_busy": cur is not None, "p_current_job": cur.job_id if cur else None,
                "p_info": {"version": "0.1.0"},
            })
        except Exception as e:
            log.warning("heartbeat failed: %s", e)
        if cur is not None:
            try:
                res = self.client.rpc("heartbeat_job", {"p_job": cur.job_id}) or {}
                if res.get("cancel_requested"):
                    cur.cancel_flag.set()
            except Exception as e:
                log.warning("job heartbeat failed: %s", e)

    def _heartbeat_loop(self) -> None:
        while not self.stop.wait(self.heartbeat_seconds):
            self._send_heartbeat()

    def refresh_health(self, force: bool = False) -> Health:
        if force or time.monotonic() - self._last_health > 60:
            self.health = self.provider.health_check()
            self._last_health = time.monotonic()
        return self.health

    # ---------------------------------------------------------------- jobs
    def process(self, job: dict[str, Any]) -> str:
        jid = str(job["id"])
        jlog = JobLog(jid, job["review_type"])
        ctx = JobContext(
            job_id=jid, campaign_id=str(job["campaign_id"]), review_type=job["review_type"], input=dict(job.get("input") or {}),
            provider=self.provider, storage=self.client, cache=self.cache, log=jlog,
            timeout_s=float(job.get("timeout_seconds") or 1800), stop_flag=self.stop, figma_token=self.figma_token,
        )
        self.current = ctx
        jlog.info("claimed %s (attempt %s/%s)", job["review_type"], job.get("attempts"), job.get("max_attempts"))
        try:
            handler = HANDLERS.get(job["review_type"])
            if handler is None:
                raise JobError(f"Unknown review type {job['review_type']}")
            result, meta = handler(ctx)
            ctx.step("save results")
            summary = self.client.rpc("complete_review_job", {"p_job": jid, "p_result": result, "p_meta": meta})
            jlog.info("completed: %s", summary)
            return "completed"
        except JobCancelled:
            self._fail(jid, "Cancelled by a manager.", {}, retryable=False)
            jlog.info("cancelled")
            return "cancelled"
        except JobError as e:
            self._fail(jid, str(e), e.detail, retryable=e.retryable)
            jlog.warning("failed (%s): %s", "will retry" if e.retryable else "final", e)
            return "failed"
        except Exception as e:
            log.exception("unexpected error in job %s", jid)
            self._fail(jid, f"Unexpected worker error: {e}", {"type": type(e).__name__}, retryable=True)
            return "failed"
        finally:
            self.current = None

    def _fail(self, jid: str, message: str, detail: dict[str, Any], *, retryable: bool) -> None:
        try:
            self.client.rpc("fail_review_job", {"p_job": jid, "p_error": message[:2000], "p_detail": detail, "p_retryable": retryable})
        except Exception as e:
            log.error("could not report failure of %s: %s", jid, e)

    def tick(self) -> bool:
        """One poll. Returns True if a job was processed."""
        if not self.refresh_health().ok:
            return False  # model not ready: leave jobs queued, the UI shows why
        job = self.client.rpc("claim_review_job", {"p_worker_name": self.name})
        if not job:
            return False
        self._send_heartbeat()
        self.process(job)
        return True

    # ---------------------------------------------------------------- main loop
    def run_forever(self) -> None:
        self._install_signals()
        self.refresh_health(force=True)
        log.info("worker %s started; model %s: %s", self.name, self.provider.model, self.health.message)
        self._send_heartbeat()
        self._hb_thread = threading.Thread(target=self._heartbeat_loop, name="heartbeat", daemon=True)
        self._hb_thread.start()
        delay = self.poll_interval
        while not self.stop.is_set():
            try:
                worked = self.tick()
                delay = self.poll_interval if worked else min(self.max_poll_interval, delay * 1.5)
            except WorkerStopping:
                break
            except Exception as e:
                log.warning("poll failed: %s", e)
                delay = min(self.max_poll_interval, delay * 2)
            self.stop.wait(0 if self.stop.is_set() else delay)
        log.info("worker stopping")
        try:
            self.health.message = "Worker stopped"
            self.client.rpc("worker_heartbeat", {
                "p_worker_name": self.name, "p_model": self.provider.model, "p_model_ready": False,
                "p_model_message": "Worker stopped", "p_accelerator": self.health.accelerator, "p_busy": False,
                "p_current_job": None, "p_info": {},
            })
        except Exception as e:
            log.debug("final heartbeat failed: %s", e)

    def _install_signals(self) -> None:
        def handler(signum: int, _frame: object) -> None:
            if self.stop.is_set():
                raise SystemExit(1)
            log.info("shutdown requested (signal %s): finishing the current step, then returning the job to the queue", signum)
            self.stop.set()

        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                signal.signal(sig, handler)
            except (ValueError, OSError):
                pass
