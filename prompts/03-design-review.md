# Phase 3 — Design review

Read `CLAUDE.md`, Phase 3 in `docs/BUILD-PLAN.md`, the Findings Inbox section of `docs/DESIGN.md`, and PRD §7 and §9.

## Planning gate
Confirm Phase 2 (including an approved benchmark) is in place. Write the Phase 3 plan covering every milestone below, with the files, migrations, risks and acceptance criteria for each. Stop and wait for my approval.

## After approval, build these milestones in order without pausing
1. **Design submission.** Drag-and-drop PDF/PNG/JPG/WEBP, multiple files, screen name, screen type, journey, version. Split PDFs into page images, downscale before upload, store original dimensions and a content hash. Private `designs` bucket with signed URLs.
2. **analyse-design job.** Inputs: accepted requirements for the selected journeys and the selected screens (within the resource limits). Run one screen or a small batch per call, then a journey-level pass for missing screens and incomplete flows. Each finding: ID, title, severity, description, requirement ID or "Additional observation", screen, expected, observed, suggested correction, confidence, evidence note, region (normalised 0–1, marked approximate). Requirements that cannot be checked are returned as NEEDS_VERIFICATION, not as findings.
3. **Findings Inbox.** The three-column review workspace from DESIGN.md. Statuses per PRD §9. Editing preserves the original AI output.
4. **Feedback and tasks.** Editable feedback (Issue, Location, Observation, Expected, Action required, Priority). Assign creates a task keeping finding ID, requirement ID, campaign, journey, submission, evidence, owner, priority and due date. Every change is written to the activity log.
5. **End-to-end tests.** Mocked provider for: upload SOW → accept requirements → upload screens → run review → accept/dismiss → edit feedback → assign task → history preserved. A real local-model smoke test that runs only when Ollama and the model are available.
6. **Figma adapter.** Behind a setting, with a token stored only in the worker's local config. If it is not configured, show setup steps and keep image upload. Never claim to have read a Figma file that could not be accessed.
