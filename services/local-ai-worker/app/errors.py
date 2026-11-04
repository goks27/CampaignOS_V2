"""Errors that decide how a failed job is reported back to Supabase."""

from __future__ import annotations


class JobError(Exception):
    """Base class. `retryable` decides whether the job goes back to the queue."""

    retryable = True

    def __init__(self, message: str, detail: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.detail = detail or {}


class LimitExceeded(JobError):
    """A configured resource limit was hit. The message says which limit and what to do."""

    retryable = False


class ValidationFailed(JobError):
    """The model returned output that failed schema validation twice."""

    retryable = False


class ProviderUnavailable(JobError):
    """Ollama is not reachable or the model is not loaded. Retry later."""

    retryable = True


class JobCancelled(JobError):
    retryable = False


class JobTimeout(JobError):
    retryable = True


class WorkerStopping(JobError):
    """The worker is shutting down; the job is returned to the queue."""

    retryable = True


class Unsupported(JobError):
    """The job needs something this machine doesn't have (e.g. Playwright, a Figma token)."""

    retryable = False
