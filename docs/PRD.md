# CampaignOS — Product Requirements Document

> **Architecture note:** Where this PRD mentions hosted AI providers, Vercel or hosted workers, follow `CLAUDE.md` and `docs/BUILD-PLAN.md` instead (Cloudflare Pages, Supabase, local Python worker with Ollama). Product behaviour in this document still applies.

**Product:** CampaignOS
**Type:** Internal campaign operations and AI quality-control platform
**Primary user:** Campaign manager / administrator
**Other users:** Project managers, designers, developers and QA team
**Access:** Internal team only
**Primary objective:** Manage campaigns from client SOW to live deployment, while using AI to analyse requirements, designs and developed websites to identify errors, missing requirements and implementation gaps.

---

## 1. Product vision

CampaignOS is an internal campaign management and AI review platform. It provides one central place to:

- Store and understand client SOW documents.
- Convert campaign requirements into structured, trackable requirements.
- Upload designs or connect Figma files.
- Compare designs against client requirements.
- Submit staging URLs for development review.
- Compare developed websites against approved designs and SOW requirements.
- Identify visual inconsistencies, missing screens, functional errors and business-rule gaps.
- Generate actionable feedback.
- Assign corrections to team members.
- Track revisions, retesting, client approvals and deployment.

It behaves like a combination of a project management system, campaign QA tool and AI design/development auditor.

**Core philosophy:**
- The campaign requirements are the source of truth. Designs and development are evaluated against them.
- AI identifies potential issues. The manager reviews and decides what becomes an official task or feedback item.
- AI must never independently approve campaign work or mark a campaign ready for launch.

## 2. User roles and access

One internal agency workspace.

**Admin**
- Full application access.
- Invite and deactivate team members.
- Manage user roles and workspace settings.
- Access all campaigns and reports.

**Manager**
- Create and manage campaigns.
- Upload SOW documents and manage campaign requirements.
- Upload designs and staging links.
- Initiate AI reviews; review and approve or dismiss findings.
- Assign tasks to team members.
- Track client feedback and approvals.
- Manage campaign milestones.

**Team member**
- View assigned campaigns and tasks.
- Update task statuses.
- Upload design or development submissions.
- Respond to feedback and mark tasks ready for review.
- View relevant AI findings.

**Viewer**
- Read-only access to authorised campaigns: requirements, deliverables, reports and progress.

Clients do not receive accounts in the initial release. Managers manually record client feedback and approvals.

Permissions are enforced with Supabase Auth and PostgreSQL Row Level Security. Hiding UI elements alone is not sufficient.

## 3. Application navigation

Persistent left sidebar:

1. Dashboard
2. Campaigns
3. Tasks & Feedback
4. AI Reviews
5. Team
6. Timeline
7. Reports
8. Settings

Clean, professional, Linear-inspired interface (see `docs/DESIGN.md`): compact navigation, clear typography, minimal clutter, neutral backgrounds, subtle borders, restrained status colours, fast interactions, desktop-first and responsive. Not a generic admin dashboard with excessive cards.

## 4. Dashboard

Answers three questions:
1. What campaigns are currently active?
2. What work needs my attention?
3. What issues are blocking delivery?

**Summary:** active campaigns; awaiting design approval; in development; pending internal QA; awaiting client UAT; critical open findings; overdue tasks; upcoming launch dates.

**Campaign overview table columns:** campaign name, client, primary manager, current stage, design status, development status, QA status, UAT status, target launch date, overall health.

**Attention required:** high-priority AI findings awaiting review; overdue tasks; campaigns awaiting client feedback; builds awaiting QA; campaigns blocked by unresolved requirements; campaigns awaiting deployment approval.

Filter by manager, client, status and date.

## 5. Campaign management

A campaign is the primary workspace and must support multiple journeys.

Example — Gold Drop (BigCity):
- Consumer promotion.
- Andhra Pradesh retailer scheme.
- Telangana retailer contest.

Do not create unrelated campaigns for each journey.

**Campaign fields:** name, client, description, primary manager, supporting managers, designer, developer, QA owner, start date, target launch date, current stage, priority, status, SOW document, staging URL, production URL, notes.

**Stages:**
1. Brief & Planning
2. Design
3. Development
4. Internal QA
5. Client UAT
6. Live Deployment
7. Completed

**Workspace tabs:** Overview, Requirements, Journeys, Designs, Development, AI Reviews, Tasks, Approvals, Documents, Activity.

## 6. SOW intelligence engine

**Input:** client SOW in PDF format — text-based PDFs, scanned PDFs (via OCR), multi-page PDFs, and multiple supporting requirement documents.

**Processing workflow:**
1. Upload the PDF.
2. Extract text and document structure.
3. Use OCR when text extraction is insufficient.
4. Identify campaign objectives.
5. Identify user journeys.
6. Extract screens and functional requirements.
7. Extract mandatory fields and validation rules.
8. Extract business rules.
9. Extract reward and eligibility conditions.
10. Extract technical requirements.
11. Extract legal requirements.
12. Extract device and browser requirements.
13. Identify dependencies and unresolved questions.
14. Organise into structured requirements.

**Requirement categories:** user journey, screen, UI, functional, validation, business rule, reward logic, API/integration, legal, performance, security, analytics, deployment.

**Requirement record:** ID, title, description, category, source document, source page number, extracted source text, priority, acceptance criteria, associated journey, status, confidence level, manager verification status.

**Human confirmation:** extracted requirements are never confirmed automatically. The extraction review screen lets the manager:
- Accept a requirement.
- Edit it.
- Delete an incorrect extraction.
- Change priority.
- Mark it as requiring client clarification.
- Add a missing requirement manually.

Only accepted requirements form the approved campaign baseline. Keep the original SOW and its version history.

## 7. Design submission and review

### A. File uploads
Accept PDF, PNG, JPG/JPEG, WEBP. Support multiple screens and grouped submissions.

Each submission records: campaign, journey, screen name, screen type, version, submission date, submitted by, review status, related SOW requirements.

### B. Figma links
Accept Figma design, file, page or frame URLs. Use an authenticated Figma API connection where available. Do not assume a Figma URL is publicly accessible. If access is unavailable, offer PDF or image exports as a fallback. The manager chooses which frames or screens to include.

### Design AI review
Compare submitted screens against accepted SOW requirements. Check:
1. Missing screens.
2. Missing mandatory content.
3. Missing form fields.
4. Missing validation and error states.
5. Incomplete user journeys.
6. Incorrect button labels or actions.
7. Missing consent and legal sections.
8. Inconsistent content.
9. Inconsistent navigation.
10. Visual consistency across screens.
11. Responsive layout considerations.
12. Potential accessibility issues.

### Design review output
Each finding: finding ID, title, severity, description, expected behaviour, observed design, evidence, related requirement ID, affected screen, suggested correction, AI confidence, review status.

Where possible, show the screen with the area highlighted. Do not invent missing content. If a requirement cannot be verified from the design, mark it "Needs verification".

## 8. Development submission and review

**Fields:** staging URL, campaign, journey, submission version, developer, test credentials or access instructions, supported devices, browser requirements, related approved design submission, notes.

Credentials are never stored in plain text or exposed in browser-visible data.

### A. Visual comparison
Compare approved designs with the staging site: layout, typography, font weights, colours, spacing, image placement, missing components, responsive behaviour, overflow and clipping, alignment, button and input appearance. Show design and implementation screenshots side by side.

### B. Functional testing
A server-side Playwright browser worker tests: navigation, form submission, required field validation, OTP flow, button actions, conditional fields, error messages, success states, reward flows, redirects, broken links, console errors, failed network requests.

Operates only on approved URLs and permitted environments. Never bypasses authentication, CAPTCHAs or security controls. Test scenarios can be configured from accepted requirements.

### C. SOW compliance
Compare the implementation against accepted requirements — for example mandatory registration fields, participation limits, unique code validation, daily reward caps, duplicate submission handling, reward allocation, legal acceptance, journey completion, required API integrations.

Distinguish: visually observed, functionally tested, backend verified, not tested, needs manual verification. A screenshot cannot prove a backend business rule works.

### Development review output
Each issue: title, severity, affected page, test scenario, expected result, actual result, screenshot evidence, console/network evidence if available, related requirement, suggested fix, AI confidence, reproducibility status.

## 9. AI Review Engine

**Review types:** SOW analysis; SOW vs Design; design consistency; Design vs Development; SOW vs Development; functional QA; regression review.

**Triggers:**
- Manual: the manager clicks Analyse, selects the review type and the relevant documents, screens or staging version.
- Automatic: new SOW uploaded; new design submission; Figma submission updated or re-synced; new staging URL; new development version.

Automatic analysis creates a pending review job; it never silently approves or assigns findings. Each review type's automatic analysis can be enabled or disabled. Identical versions are not re-analysed.

**Processing requirements:** server-side AI only; model abstraction layer; multimodal image analysis; structured JSON outputs validated against a strict schema before storage; stored prompts and model versions; recorded status and errors; retries; asynchronous long-running work; findings linked to source requirements.

**Finding statuses:** New, Awaiting manager review, Accepted, Dismissed, Assigned, In progress, Ready for retest, Fixed, Verified, Reopened.

AI must not mark a finding verified solely because a developer says it is fixed. Verification requires a new review or an explicit manual decision.

**Severity:** Critical, High, Medium, Low, Informational.
**Confidence:** High confidence, Medium confidence, Low confidence, Needs manual verification.

## 10. Findings and feedback management

A unified Findings Inbox where the manager can view, filter (campaign, review type, severity, owner), accept or dismiss, edit AI descriptions, add personal feedback, convert findings into tasks, assign, set deadlines, comment, attach evidence and track resolution.

**Feedback format example:**
- **Issue:** Missing OTP resend state.
- **Location:** Registration – OTP screen.
- **Observation:** The submitted design does not show an OTP resend action.
- **Expected:** User should be able to request a new OTP after the countdown expires.
- **Action required:** Add a resend action, countdown timer and expired OTP state.
- **Priority:** High.

Feedback is editable before it is assigned or shared.

A task created from a finding retains: original finding ID, related requirement ID, source submission, screenshot evidence, owner, priority, deadline, status.

## 11. Campaign workflow

**Stage 1 – Brief & Planning:** receive and upload SOW; extract requirements; manager validates; confirm journeys.

**Stage 2 – Design:** assign designer; upload Figma link or exports; run AI design review; manager reviews findings; designer fixes; internal design approval; record client feedback and approval.

**Stage 3 – Development:** hand over approved designs; assign frontend/backend work; implement journeys; integrate T&C and Privacy Policy; submit staging URL.

**Stage 4 – Internal QA:** run AI development review and browser tests; record bugs; assign fixes; retest; internal QA sign-off.

**Stage 5 – Client UAT:** share staging link; record feedback; create correction tasks; track revisions; record client approval.

**Stage 6 – Live Deployment:** confirm production readiness; deploy; record live URL; verify production pages; final QA; record deployment date; close campaign.

T&C and Privacy Policy are part of Development, not a separate stage.

## 12. Activity and version history

Every campaign has an activity timeline recording: SOW uploads and replacements, requirement edits, design submissions, Figma syncs, AI analysis runs, findings accepted or dismissed, tasks created, owner changes, feedback updates, approval decisions, staging URL changes, QA sign-offs, production deployment.

Preserve previous versions. Never overwrite an approved design or historical review record without keeping the previous version.

## 13. Database design

Supabase PostgreSQL. Suggested tables: workspaces, profiles, workspace_members, clients, campaigns, campaign_members, journeys, sow_documents, sow_versions, requirements, requirement_links, design_submissions, design_assets, figma_connections, development_submissions, test_environments, review_jobs, review_results, findings, finding_evidence, tasks, task_comments, approvals, client_feedback, qa_test_cases, qa_test_runs, qa_test_results, documents, activity_logs, notifications.

UUID primary keys and proper foreign keys; created_at, updated_at, created_by and version fields; RLS on all user-accessible tables and storage buckets; indexes on campaign IDs, statuses, owners and dates; store source document references, page numbers and evidence metadata.

## 14. Technical architecture

See `CLAUDE.md` for the current architecture. Summary: React, Vite, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query, React Hook Form and Zod on the frontend; Supabase Postgres, Auth, Storage and functions on the backend; a separate worker for AI, document processing and Playwright. Never run unrestricted browser automation inside the frontend. Server secrets never go into frontend environment variables.

## 15. Security and reliability

Role-based permissions and RLS; staging tests restricted to approved domains; worker protected against SSRF and private-network access; temporary, encrypted test credentials; no plaintext passwords; validated file types and sizes; signed URLs for protected files; server-side secrets; audit logs for important actions; rate and job limits; retries and failure reporting; database backups and tested restoration; separate development and production configurations.

## 16. Release scope

- **MVP 1 – Operations:** authentication, dashboard, campaign management, multiple journeys, team, SOW upload, requirement extraction, manual verification, tasks and activity.
- **MVP 2 – Design intelligence:** PDF/image uploads, Figma links, design analysis, SOW vs Design, Findings Inbox, feedback generation, task assignment.
- **MVP 3 – Development intelligence:** staging URL submission, browser worker, visual comparison, functional test scenarios, console/network errors, SOW vs Development.
- **MVP 4 – Delivery:** internal QA, client UAT, revisions, approval records, production deployment tracking, final reports.

Build order follows `docs/BUILD-PLAN.md`. Each stage must work before the next begins.

## 17. Definition of success

A manager can:
1. Create a campaign.
2. Upload its SOW.
3. Review and approve extracted requirements.
4. Submit designs.
5. Run AI design analysis.
6. Identify missing screens and design gaps.
7. Submit a development link.
8. Run visual and functional checks.
9. Compare the implementation against the SOW.
10. Review and assign findings.
11. Track fixes and retesting.
12. Record client approval.
13. Track production deployment.

The manager can understand the complete status of any campaign without searching across separate documents, chats or task boards.

**Most important principle: AI does the analysis; the manager makes the decision; the team executes the correction.**
