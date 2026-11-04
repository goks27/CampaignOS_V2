# Journ design system

Journ was CampaignOS (renamed 4 Nov 2026; the name is a working name until trademark and domain checks clear).
Calm, precise and editorial: a workspace you can scan quickly, with technical detail where it helps and nothing decorative.

## Brand
- **Name:** Journ, always lowercase in the wordmark ("journ"), "Journ" in running text.
- **Tagline:** Every project has a journey. **Descriptor:** A connected workspace to plan, manage, review and deliver digital experiences.
- **Phases:** Plan, Build, Review, Launch. The seven detailed campaign stages map onto them (Plan: brief and planning; Build: design, development; Review: internal QA, client UAT; Launch: live deployment, completed). Show the phase at a glance and the exact stage beside the current phase.
- **Philosophy:** every stage connected, every decision traceable. **Personality:** intelligent, structured, collaborative, precise.
- **Voice:** plain, specific and calm. Say what happened and what to do next. No exclamation marks, no hype. AI output is always called a suggestion or a draft.
- **Mark:** two points joined by one line (a journey, drawn once). **Wordmark:** the mark in the accent colour next to "journ" in the display serif, 22px in the sidebar and 34px on sign-in, where the line draws itself once (700ms). Favicon: the mark in white on an accent square. The product never uses the mark as decoration.

## Colour tokens
Warm paper neutrals and one deep ink-blue accent. Defined as RGB triplets in `apps/web/src/index.css`.
| Token | Light | Dark | Use |
|---|---|---|---|
| bg | #FAFAF7 | #10100F | App canvas |
| side | #F4F4F0 | #0C0C0B | Sidebar, subtle wells |
| surface | #FFFFFE | #161614 | Tables, lists, drawers, cards |
| hover | #F0F0EB | #1E1E1C | Row and button hover |
| active | #E9E9E3 | #262623 | Selected nav item |
| line | #E5E4DE | #262623 | Borders, row dividers |
| line-strong | #D6D5CD | #343430 | Inputs, secondary buttons, edges |
| text | #1A1A18 | #EDECE8 | Primary text |
| text-2 | #52524D | #B6B5AF | Secondary text |
| muted | #807F78 | #807F78 | Labels, metadata |
| accent | #3446CD | #8494FA | Primary action, focus ring, current phase |
| on-accent | #FFFFFF | #10100F | Text on the accent colour (dark ink in dark mode, for contrast) |

Status colours (dot + label, never a filled chip except Health and Severity):
- Green #2E9A5B — Approved, Passed, Done, Verified, On track
- Blue #3A6FE0 — In progress
- Violet #7C5AD6 — In review, awaiting client
- Amber #C98A12 — Changes requested, At risk, Overdue
- Red #D2463C — Failing, Blocked, Critical
- Gray #9A9CA5 — Not started, Dismissed

Tinted backgrounds only for Health pills, Severity tags and the "Demo data" badge.

## Type
- **Interface:** Geist (400, 500, 600). Geist Mono only for IDs such as `REQ-014`, `F-203`, versions and URLs.
- **Display:** Instrument Serif (400, and 400 italic for the tagline) for page titles, the wordmark and sign-in headings only. It is for titles, never for body text, buttons, tables or labels.
- Base 13px / 1.5. Small 12px. Section heading 13px/600. **Page title 28px display serif** (`font-display text-2xl`), drawer title 18px/600. Sign-in wordmark 34px.
- Tabular numbers on all counts and dates. Sentence case everywhere; no all-caps labels.

## Motion
- Short and quiet, only on arrival: page content fades up 4px in 180ms (`.page-enter`), the sign-in mark draws its line once, drawers slide 24px, toasts rise 8px.
- Nothing moves while you are reading: no looping animation except the accent edge on the canvas while Claude is working, and the pulse on the "Claude is working" icon.
- `prefers-reduced-motion` removes all of it.

## Spacing, radius, elevation
- 4px grid. Row padding 9px 12px. Page padding 22px 24px. Max content width 1280px.
- Radius: 6px controls, 7px list items, 10px tables and lists, no larger.
- Borders do the separating. Shadows only on overlays (drawer, menus, command palette).

## Layout
Journ is a workspace, not a set of pages. The campaign is the interface: it opens on its canvas, and everything else is one click away.

- **Left rail (240px, collapsible to 60px; one slide-out menu below 1024px).** The wordmark, search (⌘K), then Home, My Inbox (with a count), Tasks, Projects, Playground. Under "Workspaces", your campaigns (recently opened first) with a coloured letter each. "New Project" and the account menu sit at the bottom; Team, Timeline, Reports, Settings, Import and Sign out live in the account menu. The rail never changes inside a campaign.
- **Top bar (52px).** On ordinary pages: the page name. Inside a campaign it becomes the campaign bar: back to Projects, the campaign (letter icon, name, health), team avatars, Share (copies the link), Run tests (starts a Site check on the latest build), and a ⋯ menu (Campaign summary, Manage journeys, Copy link, Edit campaign). On the right, always: AI status, Ask Claude (Ctrl+J), theme, notifications.
- **Campaign sections (a 44px row under the top bar):** Canvas, Requirements, Designs, Review, Development, Testing, Issues, Activity. The canvas is the home. The old tab addresses (overview, journeys, approvals, documents, ai-reviews, tasks) redirect to the section that now holds that content. A campaign page fills the window and does its own scrolling; other pages scroll as a page.
- **Home** is a working surface, not a report: "Continue" (campaigns you were last in, with a cover of their first design screen), "Waiting for your review", "Assigned to you", recent activity, quick starts. **Projects** is a grid of campaign covers with a list option. **My Inbox** is one worklist: findings waiting for you, tasks assigned to you, updates.
- Detail views open as a right drawer (up to 920px) for peeking.
- **Dark is the default.** Light is one click away in the top bar; a saved choice always wins.

### Canvas
The canvas fills the campaign workspace: a **journey dropdown** (top left; "All journeys (pipeline)" is the last item and "Manage journeys" opens the journeys drawer), a **zoom toolbar** (top right: fit, zoom out, percentage, zoom in, full screen), the **inspector** docked on the right (400px; below 1024px it opens as a drawer), and the **dock** underneath (AI Review, Issues, Test Runs, Activity for the open journey; collapsible, remembered).

## Components
- Tables: header 12px muted, rows with 1px dividers, hover row background, journeys as indented sub-rows.
- Stage: a small progress ring + stage name. Seven stages, always in PRD order.
- Summary strip: one bordered row of metrics, not separate cards.
- Attention list: icon by type, title, campaign · journey, tags, time on the right.
- Buttons: primary (accent fill, white text), secondary (surface + line-strong border), icon buttons 28px.

## Interaction
- Keyboard: ⌘K command menu, J/K or arrows to move rows, Enter to open, Esc to close.
- Motion only to show a change: drawer slide 200ms, chevron rotate 150ms. Respect reduced motion.
- Visible focus ring (2px accent) on every interactive element.

## Writing
- Plain verbs, sentence case. Buttons say what happens ("Accept finding", "Run design review").
- Empty states say what goes here and the next action.
- Errors say what failed and how to fix it; no apologies.

## Findings Inbox (Phase 3)
A review workspace, not a table. Three columns at ≥1280px; the right column becomes a drawer below that.
- Left (320px): search, filters (campaign, severity, review type, owner, status, date), findings list. Each row shows severity tag, title, screen name, requirement ID (mono) and status dot. J/K moves between findings.
- Centre (flexible): the screenshot with the finding region outlined in the accent colour and the region labelled "approximate". Fit, zoom and previous/next screen controls. Other findings on the same screen show as faint outlines.
- Right (380px): title, Expected vs Observed side by side, suggested correction, confidence, linked requirement with its source text, editable feedback, and an "Original AI output" disclosure when edited. Actions: Accept (primary), Dismiss, Assign (owner + due date creates the linked task).
- Keyboard: A accept, D dismiss, E edit, Enter assign.

## AI status indicator
- Lives in the top bar: a dot and label, "AI online", "AI busy · 2 queued", "AI offline · jobs will wait" or "Not set up".
- Clicking it opens a popover with worker last seen, model name and readiness, GPU or CPU, and queue length.
- Offline is shown in muted grey, not red. It is an expected state, not an error.
