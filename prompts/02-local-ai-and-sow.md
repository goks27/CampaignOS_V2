# Phase 2 — Local worker, model benchmark and SOW intelligence

Read `CLAUDE.md` and Phase 2 in `docs/BUILD-PLAN.md`.

## Planning gate
Inspect the repo, confirm Phase 1 is in place, and write the Phase 2 plan. Stop and wait for my approval.

## Milestone 1 — Job system
- Tables `review_jobs` (type, campaign_id, source ids, source_hash, status, attempts, error, prompt_version, model, context_size, duration_ms, tokens, timestamps) and `worker_status`.
- SECURITY DEFINER functions: `enqueue_review` (called by managers, checks permission and duplicates), `claim_review_job` (FOR UPDATE SKIP LOCKED), `heartbeat_job`, `complete_review_job`, `fail_review_job`, `cancel_review_job`, `worker_heartbeat`.
- Worker-scoped storage access: the worker can read an object only while it holds the claimed job that references it.
- Tests for atomic claiming (two concurrent claimers), duplicate rejection, cancellation and worker isolation.

## Milestone 2 — Python worker
- `services/local-ai-worker/` with Python 3.11+, venv, `pyproject.toml`, ruff, mypy, pytest.
- Modules: config, supabase_client (signs in as the worker user, no service-role key), queue, job_logger, pdf_processor, image_processor, response_validator, main.
- Polling with backoff, job timeout, cancellation checks between steps, graceful shutdown on Ctrl+C, heartbeat every 30 s.
- `start-worker.ps1` and an optional Task Scheduler setup in the README.
- Frontend: wire the AI status indicator to `worker_status` via Realtime.

## Milestone 3 — Ollama provider
- `AIProvider` interface; `OllamaProvider` using the local Ollama HTTP API on localhost only.
- Health check: Ollama reachable, configured model present (never auto-download; tell the user the exact `ollama pull` command), GPU or CPU in use.
- Structured outputs with a JSON schema in `format`, Pydantic validation, retry once with the error.
- Image preparation: downscale to the configured long edge and record the original dimensions for coordinate normalisation.

## Milestone 4 — Benchmark gate (STOP after this)
- `python -m app.benchmark --sow <pdf> --screens <folder> --journey "<name>"`.
- Runs the SOW-extraction prompt (chunked) and the design-check prompt on the given files, and writes `benchmark-report.md` with: extracted requirements with page refs, findings with regions drawn on copies of the screens, schema failures, time per call, GPU or CPU, and peak VRAM if available.
- Do not build any review UI yet. Stop and ask me to run it on real Gold Drop files and decide whether to proceed.

## Milestones 5–6 (only after I approve the benchmark)
5. SOW upload to a private `sow` bucket, sow_documents and sow_versions, text extraction per page, scanned-page detection and local OCR (method recorded per page), chunked extraction, merge and de-duplication, drafts saved with verbatim source text and page refs.
6. Requirements tab: table grouped by journey, source-text side panel with page reference, actions Accept, Edit, Reject, Needs client clarification, Add requirement. Only accepted requirements form the baseline.

## Tests
- Mocked-provider integration test for SOW upload → drafts.
- A malformed model response fails validation and never reaches the requirements table.
- A real-model smoke test marked to run only when Ollama and the model are available.
