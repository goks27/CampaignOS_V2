"""Logging setup: readable console output plus a rotating file next to the worker."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


def setup_logging(log_dir: Path = Path("logs"), level: int = logging.INFO) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s", "%Y-%m-%d %H:%M:%S")
    root = logging.getLogger()
    root.setLevel(level)
    if not root.handlers:
        console = logging.StreamHandler()
        console.setFormatter(fmt)
        root.addHandler(console)
        file = RotatingFileHandler(log_dir / "worker.log", maxBytes=2_000_000, backupCount=5, encoding="utf-8")
        file.setFormatter(fmt)
        root.addHandler(file)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    return logging.getLogger("campaignos.worker")


class JobLog:
    """Per-job log lines with a short job prefix and step timings."""

    def __init__(self, job_id: str, review_type: str) -> None:
        self.log = logging.getLogger(f"campaignos.job.{job_id[:8]}")
        self.review_type = review_type

    def info(self, msg: str, *args: object) -> None:
        self.log.info(msg, *args)

    def warning(self, msg: str, *args: object) -> None:
        self.log.warning(msg, *args)
