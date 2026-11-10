# Journey

> Formerly CampaignOS. Journey is the working product name until trademark and domain checks clear. Repo, database, folder and command names still say campaignos.

*Every project has a journey.* Octech's internal campaign operations and AI quality-control platform. It takes a campaign from client SOW to live deployment. AI does the analysis, the manager makes the decision, the team executes the correction.

- **Web app:** React + Vite + TypeScript (`apps/web`), hosted on Cloudflare Pages.
- **Backend:** Supabase (Postgres, Auth, Storage, Realtime) with Row Level Security on every table and bucket (`supabase/`).
- **AI:** a Python worker on Gokul's PC running a local model through Ollama (`services/local-ai-worker`). There are no metered AI APIs.

| Area | What's there |
|---|---|
| Campaigns | Multi-journey campaigns, 7-stage tracking, team assignment, health, milestones |
| Requirements | SOW upload with versions, local extraction with page refs and verbatim quotes, OCR for scanned pages, manager verification |
| Design review | PDF/image (or Figma) submissions, SOW vs Design, consistency review, Findings Inbox with evidence regions |
| Development review | Staging builds, Vault-stored credentials, pixel diff vs design, Playwright scenarios, SOW compliance states |
| Delivery | Tasks (list and board), client feedback → tasks, append-only approvals, deployments, timeline, reports, automatic triggers |

## Quick start (local development)

Needs Node 20+, Docker Desktop and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
supabase start                       # local Postgres/Auth/Storage/Realtime; applies migrations + seed
cp apps/web/.env.example apps/web/.env.local   # paste the anon key that `supabase start` prints
npm run dev                          # http://localhost:5173
```

### Migrations to run on a hosted Supabase project, in this order (each once, in the SQL editor)

After the original ones, the newer files are: `20261104000300_site_check.sql`, `20261105000100_journey_graph.sql`, `20261105000200_brand_assets.sql`, `20261106000100_live_test_sessions.sql` (saved Live test sessions), `20261106000200_simplify.sql` (Phase 6: automatic reviews on by default, `enqueue_reviews`, `campaign_progress`, `home_summary`, `portfolio_report`), `20261107000100_rules_lab.sql` (rule scenarios and runs). A file that says "already exists" has already been run.


Demo logins (local only, password `campaignos-demo`): admin@ / manager@ / designer@ / developer@ / viewer@campaignos.local. The seed adds one clearly fake "Sample campaign".

Checks:

```bash
npm run check                        # tsc, lint, unit tests, build
supabase test db                     # RLS + job pgTAP tests (or scripts/db-test-local.sh without Docker)
cd services/local-ai-worker && ruff check app tests && mypy && pytest
```

## Going live

- **Website:** [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md). A step-by-step guide to Supabase plus Cloudflare Pages.
- **AI worker:** [services/local-ai-worker/README.md](services/local-ai-worker/README.md).
- **Running it day to day** (users, backups, upgrades): [docs/SETUP.md](docs/SETUP.md).

## Free-tier notes (read this)

- **Supabase Free pauses a project after about a week with no activity.** Unpause it from the Supabase dashboard. The data is kept.
- **Free limits (check supabase.com/pricing, they change):** roughly 500 MB database, 1 GB file storage, 50 MB per file, and no automatic downloadable backups. Settings → Storage and backups shows current usage. Images are downscaled before upload, and run the backup in docs/SETUP.md weekly.
- **Cloudflare Pages Free** is enough for an internal tool. The limits are on builds and requests, not users.
- **AI costs nothing per call,** but it uses the PC's electricity and runs only while the PC is on. If you ever outgrow the free tiers, that is a paid plan; nothing here pretends otherwise.

## Repository layout

```
apps/web/                  React app (services/* is the only code that talks to Supabase)
services/local-ai-worker/  Python worker, prompts, benchmark, Windows scripts
supabase/migrations/       Schema, RLS, job functions, storage policies, journey graph (run new files once in the Supabase SQL editor on a hosted project)
supabase/tests/            pgTAP tests (permissions, jobs, worker isolation) and simplify.pglite.test.mjs, which runs every migration on an in-memory Postgres: npm run db:test (no Docker)
supabase/seed.sql          Local-only demo data
docs/                      PRD, build plan, design system, setup and deploy guides
```
