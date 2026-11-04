"""Small on-disk JSON cache keyed by content hash, so unchanged images and pages are never re-analysed."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


class Cache:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def key(*parts: str) -> str:
        return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()

    def get(self, key: str) -> Any | None:
        p = self.root / key[:2] / f"{key}.json"
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def put(self, key: str, value: Any) -> None:
        d = self.root / key[:2]
        d.mkdir(exist_ok=True)
        tmp = d / f"{key}.tmp"
        tmp.write_text(json.dumps(value), encoding="utf-8")
        tmp.replace(d / f"{key}.json")
