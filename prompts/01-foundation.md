# Phase 1 — Foundation

Read `CLAUDE.md`, `docs/PRD.md`, `docs/BUILD-PLAN.md` and `docs/DESIGN.md`.

## Planning gate
Inspect the repo and write the Phase 1 plan: folder layout, tables, RLS approach (including the `worker` role, which is created now but used in Phase 2), and the files you will create. Stop and wait for my approval.

## After approval, build these milestones without pausing
1. Monorepo layout and tooling (`apps/web`, `services/local-ai-worker` placeholder with README only, `supabase/`).
2. Migrations: workspaces, profiles, workspace_members (roles incl. worker), clients, campaigns, campaign_members, journeys, tasks, task_comments, activity_logs, notifications. RLS on all. Tests proving a Team member cannot read unassigned campaigns, a Viewer cannot write, and the worker role cannot read campaigns at all yet.
3. App shell, dashboard, campaign drawer and workspace per DESIGN.md. AI status indicator shows "Not set up".
4. Campaign CRUD, journeys, team assignment, basic tasks (list view), activity logging on every change.
5. Notion CSV import with a mapping preview and dry run.
6. Gated routes for later phases. Development-only demo seed.
7. Cloudflare Pages deployment guide (build command, output dir, env vars, SPA fallback) and Supabase setup guide.

Run the definition of done after each milestone and report.
