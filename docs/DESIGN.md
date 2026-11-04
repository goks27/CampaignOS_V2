# CampaignOS design system

Light, Linear-style workspace. Calm, dense enough to scan, never decorative.
Reference prototype: the CampaignOS dashboard artifact (light theme).

## Colour tokens
| Token | Light | Dark | Use |
|---|---|---|---|
| bg | #FCFCFD | #111215 | App canvas |
| side | #F6F6F8 | #0C0D10 | Sidebar, subtle wells |
| surface | #FFFFFF | #16171B | Tables, lists, drawers |
| hover | #F1F1F4 | #1E1F24 | Row and button hover |
| active | #EBEBEF | #25262C | Selected nav item |
| line | #E7E7EC | #25262C | Borders, row dividers |
| line-strong | #D9D9E0 | #32333A | Inputs, secondary buttons |
| text | #1C1D21 | #ECEDF0 | Primary text |
| text-2 | #55575F | #B4B6BD | Secondary text |
| muted | #8A8C95 | #7D7F88 | Labels, metadata |
| accent | #3A50D9 | #7C8CF5 | Primary action, focus ring, current stage |

Status colours (dot + label, never a filled chip except Health and Severity):
- Green #2E9A5B — Approved, Passed, Done, Verified, On track
- Blue #3A6FE0 — In progress
- Violet #7C5AD6 — In review, awaiting client
- Amber #C98A12 — Changes requested, At risk, Overdue
- Red #D2463C — Failing, Blocked, Critical
- Gray #9A9CA5 — Not started, Dismissed

Tinted backgrounds only for Health pills, Severity tags and the "Demo data" badge.

## Type
- Geist (400, 500, 600). Geist Mono only for IDs such as `REQ-014`, `F-203`, versions and URLs.
- Base 13px / 1.5. Small 12px. Section heading 13px/600. Page title 20px/600. Drawer title 18px/600.
- Tabular numbers on all counts and dates. Sentence case everywhere; no all-caps labels.

## Spacing, radius, elevation
- 4px grid. Row padding 9px 12px. Page padding 22px 24px. Max content width 1280px.
- Radius: 6px controls, 7px list items, 10px tables and lists, no larger.
- Borders do the separating. Shadows only on overlays (drawer, menus, command palette).

## Layout
- Sidebar 232px: workspace switcher, search (⌘K), 8 nav items, "Your campaigns" list, user.
- Top bar 46px: breadcrumb, Demo data badge when relevant, theme, notifications.
- Detail views open as a right drawer (560px) for peeking; "Open workspace" goes to the full campaign page with tabs.

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
