# Phase 0 — Inspect the project

Read `CLAUDE.md`, `docs/PRD.md` and `docs/BUILD-PLAN.md`, then inspect the actual codebase.
Do not modify files or write code.

Report the status of each item as Implemented and tested / Partially implemented / Not implemented / Cannot verify, with the evidence (file paths, migrations, tests) for each:
- Supabase Auth, schema and RLS (including tests)
- Campaign and journey management
- Tasks: creation and assignment
- Activity logging
- Storage buckets, policies and signed URLs
- Job queue tables and claim functions
- Local AI worker (`services/local-ai-worker`)
- Ollama provider and health check
- SOW upload, extraction and requirement drafts
- Requirement review and acceptance
- Deployment configuration (Cloudflare Pages, Supabase)

Also list anything in the repo that conflicts with CLAUDE.md (for example OpenAI calls, a service-role key in the worker or frontend, or a hosted worker).

End with the recommended starting phase and the missing dependencies. Then stop and wait for my approval.
