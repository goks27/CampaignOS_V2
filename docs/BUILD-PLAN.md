# CampaignOS build plan (local-AI architecture)

Frontend on Cloudflare Pages, Supabase free tier, Python AI worker + Ollama on Gokul's Windows 11 PC.
Each phase starts at a planning gate (inspect, report, plan, wait for approval), then runs its milestones without pausing.

## Phase 0 — Inspect (`prompts/00-inspect.md`)
Report what exists. No code changes. Decides which phase to start.

## Phase 1 — Foundation (`prompts/01-foundation.md`)
1. Monorepo layout: `apps/web`, `services/local-ai-worker`, `supabase/migrations`, `docs`.
2. Supabase schema, invite-only Auth, roles (Admin, Manager, Team member, Viewer, worker), RLS with tests.
3. App shell per DESIGN.md: sidebar, top bar, breadcrumbs, ⌘K, theme, AI status indicator (shows "Not set up" until Phase 2).
4. Dashboard: summary strip, campaign table with journey sub-rows, attention list, recent activity.
5. Campaign CRUD, journeys, team assignment, campaign drawer and workspace (Overview and Journeys tabs live; the rest gated).
6. Basic tasks (create, assign, status, due date, list view) and activity logging on every change.
7. ~~Notion CSV import with a mapping preview.~~ Removed on 6 Nov 2026 (Gokul: not needed).
8. Cloudflare Pages deployment guide and the development-only demo seed.

## Phase 2 — Local worker, model benchmark and SOW intelligence (`prompts/02-local-ai-and-sow.md`)
1. Job system: `review_jobs`, `worker_status`, claim/heartbeat/complete/fail functions, worker role and RLS tests.
2. Python worker: config, Supabase client, polling loop, backoff, timeout, cancellation, graceful shutdown, heartbeat, PowerShell start script and optional Task Scheduler setup.
3. `OllamaProvider`: health check, model availability, GPU vs CPU check, structured outputs, Pydantic validation.
4. **Benchmark gate (STOP after this milestone).** A command-line benchmark runs the SOW-extraction and design-check prompts on real sample files that Gokul provides and writes a report. Gokul decides whether local quality is good enough before any review UI is built.
5. SOW upload, versioning, text extraction, scanned-page detection, local OCR, chunked requirement extraction with page refs, saved as drafts.
6. Requirements tab: verification workspace (accept, edit, reject, needs client clarification, add manually).

## Phase 3 — Design review (`prompts/03-design-review.md`)
Milestones in this order:
1. Design submission: uploads, PDF-to-image split, downscaling, screen metadata, versions.
2. analyse-design job: accepted requirements + screens → validated findings with normalised evidence regions.
3. Findings Inbox as a three-column review workspace (DESIGN.md).
4. Editable feedback and finding-to-task conversion with full traceability.
5. End-to-end tests: mocked provider for the full flow; a real local-model smoke test that runs only when Ollama is available.
6. Figma adapter last, behind a setting. Image upload stays fully supported.

## Phase 4 — Development auditor
- Development submissions; staging credentials in Vault.
- Playwright runs in the local worker. The PC is inside a home or office network, so block private, loopback, link-local and metadata IP ranges (re-checked after every redirect and DNS resolution) and allow only listed domains.
- Deterministic pixel diff at fixed viewports first; only the differing regions go to the model for description.
- Functional scenarios from accepted requirements, console and network capture, SOW compliance states.

## Phase 5 — Delivery
Task board view, append-only approvals, client UAT, deployment tracking, reports, timeline, automatic analysis triggers with per-type toggles.

## If local model quality is not good enough (decided at the Phase 2 benchmark)
Options, in order:
1. Tune prompts, chunk sizes and image resolution, and narrow each check to one rule at a time.
2. Try another local model through the same provider interface.
3. Allow a cloud provider for selected review types only, as an explicit, visible, per-workspace setting. This would change the zero-cost goal and needs Gokul's decision.
