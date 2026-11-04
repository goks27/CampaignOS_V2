# CampaignOS local AI worker

Runs every AI job for CampaignOS on this PC (Windows 11, NVIDIA RTX 3060) with **Ollama**. There are no metered AI APIs and no cloud fallback: if this PC or the model is off, jobs wait in the queue and the web app says so.

**What it does:** polls Supabase for review jobs, then runs:

- SOW analysis: PDF text extraction, local OCR (via the vision model) for scanned pages, chunked requirement extraction with page references, merge and de-duplication.
- Design reviews: one call per screen against accepted requirements, a journey-level pass for missing screens, and an optional consistency pass. Evidence regions are stored as approximate 0–1 coordinates.
- Development reviews (Playwright): screenshots, a deterministic pixel diff against the approved design (only the differing areas go to the model), the manager's test scenarios, console and network capture, and SOW compliance checks. A screenshot never "verifies" a backend rule.

**Security:**

- **Outbound only.** The worker connects out to Supabase over HTTPS. Nothing on the PC accepts inbound connections. Ollama must stay on `127.0.0.1:11434`; the worker refuses any other address. Never port-forward 11434 and never use a tunnel.
- **No service-role key.** The worker signs in as its own Supabase user with the `worker` role. That role can only claim, heartbeat, complete and fail jobs, and read the files of the job it holds.
- **Uploaded files are untrusted.** PDFs, screenshots and staging pages are wrapped as untrusted data in prompts, and every answer is validated with Pydantic before anything is saved.
- **The browser can't reach your network.** It only visits allow-listed domains, and private, loopback, link-local and metadata addresses are blocked on every request and redirect. It never bypasses CAPTCHAs or logins.

## Setup (about 20 minutes)

1. **Install** Python 3.11+ (python.org, tick “Add to PATH”) and [Ollama](https://ollama.com/download/windows). Make sure the NVIDIA driver is current.
2. **Pull the model:** `ollama pull qwen3-vl:8b` (about 6 GB). Check it works with `ollama run qwen3-vl:8b "hello"`.
3. **Create the worker account.**
   - In Supabase: Authentication → Users → **Add user**. Use an email like `worker@octech.in` and a long random password, with "Auto confirm" ticked.
   - In CampaignOS: Team → set that user’s role to **AI worker (service account)**.
4. **Configure.** Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (the same values as the web app).
   - `WORKER_EMAIL` and `WORKER_PASSWORD`.
5. **Check:** `powershell -ExecutionPolicy Bypass -File scripts\start-worker.ps1 -Check`. You should see “Ollama: Ready (gpu)” and “Supabase: signed in”. The top bar in the web app turns to **AI online**.
6. **Run:** `powershell -ExecutionPolicy Bypass -File scripts\start-worker.ps1`. Add `-WithBrowser` once, to install Playwright + Chromium for development reviews.
7. **Optional, start at sign-in:** `powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1`.

If Ollama shows **CPU** instead of GPU, update the NVIDIA driver and restart Ollama. CPU works, but it is roughly 10× slower.

## Benchmark gate: run this before relying on reviews

```powershell
.venv\Scripts\python -m app.benchmark --sow "C:\path\Gold Drop SOW.pdf" --screens "C:\path\gold-drop-screens" --journey "Consumer promotion"
```

This runs the real prompts on your files without touching Supabase and writes `benchmark-output\benchmark-report.md`, which contains:

- the extracted requirements, with page references and verbatim quotes;
- findings drawn on copies of your screens;
- schema failures;
- time per call, GPU or CPU, and peak VRAM.

If the quality isn't good enough, try these in order (BUILD-PLAN.md):

1. Tune the prompts, chunk size and image size, and check one rule at a time.
2. Try another local model: set `OLLAMA_MODEL` and `ollama pull` it.
3. Only as an explicit decision: allow a cloud model for selected review types. That would end the zero-cost goal.

## Settings (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `OLLAMA_MODEL` | `qwen3-vl:8b` | Any Ollama vision model |
| `OLLAMA_CONTEXT` | `16384` | Lower it if you run out of VRAM |
| `POLL_INTERVAL` / `MAX_POLL_INTERVAL` | 5 / 60 s | Backs off while idle |
| `HEARTBEAT_SECONDS` | 30 | The web app shows offline after 2 minutes without one |
| `FIGMA_TOKEN` | — | Optional. Turn on the Figma adapter in Settings |
| `CACHE_DIR` | `./cache` | OCR and analysis results by content hash; safe to delete |

Per-workspace limits (max screens, PDF pages, image size, inference time, retries, job timeout) are set in the web app under **Settings** and travel with each job.

## Development

```bash
pip install -e ".[dev,browser]" && python -m playwright install chromium
ruff check app tests && mypy && pytest                      # normal tests need no model
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pytest -m db   # atomic-claim test
pytest -m ollama                                            # real-model smoke test (needs Ollama)
```

- **Prompts:** `app/prompts/`. Each module has a `VERSION` that is saved on every job.
- **Providers:** `app/providers/`. `OllamaProvider` is the only real one; `MockProvider` is for tests.
