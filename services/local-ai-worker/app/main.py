"""Entry point: python -m app.main  (or start-worker.ps1 on Windows)."""

from __future__ import annotations

import argparse
import sys

from .cache import Cache
from .config import Settings
from .job_logger import setup_logging
from .providers.ollama import OllamaProvider
from .queue import Worker
from .supabase_client import SupabaseClient, SupabaseError


def build(settings: Settings) -> Worker:
    client = SupabaseClient(settings.supabase_url, settings.supabase_publishable_key, settings.worker_email, settings.worker_password)
    provider = OllamaProvider(settings.ollama_url, settings.ollama_model, context_size=settings.ollama_context)
    return Worker(client, provider, name=settings.worker_name, cache=Cache(settings.cache_dir),
                  poll_interval=settings.poll_interval, max_poll_interval=settings.max_poll_interval,
                  heartbeat_seconds=settings.heartbeat_seconds, figma_token=settings.figma_token)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="CampaignOS local AI worker")
    parser.add_argument("--check", action="store_true", help="check Supabase sign-in and the Ollama model, then exit")
    args = parser.parse_args(argv)
    log = setup_logging()
    try:
        settings = Settings()  # type: ignore[call-arg]
    except Exception as e:
        log.error("Configuration problem: %s\nCopy .env.example to .env and fill it in.", e)
        return 2
    worker = build(settings)
    provider = worker.provider
    assert isinstance(provider, OllamaProvider)
    health = provider.warm_up()
    log.info("Ollama: %s (%s)", health.message, health.accelerator)
    try:
        worker.client.rpc("worker_heartbeat", {
            "p_worker_name": settings.worker_name, "p_model": settings.ollama_model, "p_model_ready": health.ok,
            "p_model_message": health.message, "p_accelerator": health.accelerator, "p_busy": False, "p_current_job": None, "p_info": {},
        })
        log.info("Supabase: signed in as the worker account and sent a heartbeat.")
    except SupabaseError as e:
        log.error("Supabase: %s\nCheck that the account's role is “AI worker” on the Team page.", e)
        return 3
    if args.check:
        return 0 if health.ok else 4
    worker.run_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
