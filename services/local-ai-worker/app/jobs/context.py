"""Everything a job handler needs, plus cancellation, timeout and stop checks between steps."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from ..cache import Cache
from ..errors import JobCancelled, JobTimeout, WorkerStopping
from ..job_logger import JobLog
from ..providers.base import AIProvider, Usage


class Storage(Protocol):
    def download(self, bucket: str, path: str) -> bytes: ...
    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None: ...
    def rpc(self, fn: str, params: dict[str, Any] | None = None) -> Any: ...


@dataclass
class JobContext:
    job_id: str
    campaign_id: str
    review_type: str
    input: dict[str, Any]
    provider: AIProvider
    storage: Storage
    cache: Cache
    log: JobLog
    timeout_s: float
    cancel_flag: threading.Event = field(default_factory=threading.Event)
    stop_flag: threading.Event = field(default_factory=threading.Event)
    started: float = field(default_factory=time.monotonic)
    usage: Usage = field(default_factory=Usage)
    figma_token: str | None = None
    on_step: Callable[[str], None] | None = None

    @property
    def limits(self) -> dict[str, Any]:
        lim: dict[str, Any] = self.input.get("limits") or {}
        return lim

    def limit(self, name: str, default: int) -> int:
        try:
            return int(self.limits.get(name, default))
        except (TypeError, ValueError):
            return default

    def step(self, name: str) -> None:
        """Call between steps: honours cancellation, worker shutdown and the job timeout."""
        if self.cancel_flag.is_set():
            raise JobCancelled("Cancelled by a manager.")
        if self.stop_flag.is_set():
            raise WorkerStopping("The worker was stopped; the job goes back to the queue.")
        if time.monotonic() - self.started > self.timeout_s:
            raise JobTimeout(f"Job exceeded the job timeout of {int(self.timeout_s)}s.")
        self.log.info("step: %s", name)
        if self.on_step:
            self.on_step(name)

    def meta(self, prompt_version: str) -> dict[str, Any]:
        return {
            "prompt_version": prompt_version,
            "model": getattr(self.provider, "model", "unknown"),
            "context_size": getattr(self.provider, "context_size", None),
            "duration_ms": int((time.monotonic() - self.started) * 1000),
            "tokens_in": self.usage.tokens_in,
            "tokens_out": self.usage.tokens_out,
        }
