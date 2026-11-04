"""Worker configuration, read from environment variables or a local .env file."""

from __future__ import annotations

import ipaddress
import socket
from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Output token budgets per job type. Context size is set once (OLLAMA_CONTEXT).
MAX_OUTPUT_TOKENS: dict[str, int] = {
    "ocr": 2048,
    "sow_extraction": 4096,
    "design_screen": 3072,
    "design_journey": 2048,
    "design_consistency": 3072,
    "dev_diff": 1536,
    "dev_compliance": 2048,
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    supabase_url: str
    supabase_publishable_key: str
    worker_email: str
    worker_password: str
    worker_name: str = Field(default_factory=socket.gethostname)

    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3-vl:8b"
    ollama_context: int = 16384

    poll_interval: float = 5.0
    max_poll_interval: float = 60.0
    heartbeat_seconds: float = 30.0

    figma_token: str | None = None
    cache_dir: Path = Path("./cache")

    @field_validator("ollama_url")
    @classmethod
    def ollama_must_be_local(cls, v: str) -> str:
        """Ollama must never be reached over the network: only loopback addresses are accepted."""
        host = urlparse(v).hostname or ""
        if host == "localhost":
            return v.rstrip("/")
        try:
            if ipaddress.ip_address(host).is_loopback:
                return v.rstrip("/")
        except ValueError:
            pass
        raise ValueError(f"OLLAMA_URL must point at this machine (127.0.0.1 or localhost), got {host!r}")

    @field_validator("supabase_url")
    @classmethod
    def supabase_https(cls, v: str) -> str:
        p = urlparse(v)
        if p.scheme != "https" and p.hostname not in ("127.0.0.1", "localhost"):
            raise ValueError("SUPABASE_URL must use https (http is allowed only for a local Supabase)")
        return v.rstrip("/")
