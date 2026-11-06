# Journey design system

Journey was CampaignOS (renamed 4 Nov 2026; the name is a working name until trademark and domain checks clear).
Calm, precise and editorial: a workspace you can scan quickly, with technical detail where it helps and nothing decorative.

## Brand
- **Name:** Journey, always lowercase in the wordmark ("journey"), "Journey" in running text.
- **Tagline:** Every project has a journey. **Descriptor:** A connected workspace to plan, manage, review and deliver digital experiences.
- **Phases:** Plan, Build, Review, Launch. The seven detailed campaign stages map onto them (Plan: brief and planning; Build: design, development; Review: internal QA, client UAT; Launch: live deployment, completed). Show the phase at a glance and the exact stage beside the current phase.
- **Philosophy:** every stage connected, every decision traceable. **Personality:** intelligent, structured, collaborative, precise.
- **Voice:** plain, specific and calm. Say what happened and what to do next. No exclamation marks, no hype. AI output is always called a suggestion or a draft.
- **Mark:** an open geometric frame (two corner brackets, a workspace) with a path moving through it to a point (direction and possibility); an architectural, premium feel. **Wordmark:** the mark in the accent colour next to "journey" in the display serif, 22px in the sidebar and 34px on sign-in, where the line draws itself once (700ms). Favicon: the mark in white on an accent square. The product never uses the mark as decoration.

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
Journey is a workspace, not a set of pages. The campaign is the interface: it opens on its canvas, and everything else is one click away.

- **Left rail (240px, collapsible to 60px; one slide-out menu below 1024px).** The wordmark (it opens Projects), search (⌘K), then Projects, Playground, Live test. Inbox is in the account menu at the bottom, with a count, and a dot on your avatar when something is waiting. Under "Workspaces", your campaigns (recently opened first) with a coloured letter each. "New Project" and the account menu sit at the bottom; Team, Timeline, Reports, Settings, Import and Sign out live in the account menu. The rail never changes inside a campaign.
- **Top bar (52px).** On ordinary pages: the page name. Inside a campaign it becomes the campaign bar: back to Projects, the campaign (letter icon, name, health), team avatars, Share (copies the link), Run tests (starts a Site check on the latest build), and a ⋯ menu (Campaign summary, Manage journeys, Copy link, Edit campaign). On the right, always: AI status, Ask Claude (Ctrl+J), theme, notifications.
- **Campaign sections (a 44px row under the top bar):** Canvas, Requirements, Designs, Review, Development, Testing, Issues, Activity. The canvas is the home. The old tab addresses (overview, journeys, approvals, documents, ai-reviews, tasks) redirect to the section that now holds that content. A campaign page fills the window and does its own scrolling; other pages scroll as a page.
- **Projects** is the landing page: the address / goes straight to it. Inbox (findings waiting for a manager, and your tasks) lives in the account menu, with a dot on the avatar when something is waiting. There is no separate Home page.
- Detail views open as a right drawer (up to 920px) for peeking.
- **Dark is the default.** Light is one click away in the top bar; a saved choice always wins.

### Canvas
The canvas fills the campaign workspace: a **journey dropdown** (top left; "All journeys (pipeline)" is the last item and "Manage journeys" opens the journeys drawer), a **zoom toolbar** (top right: fit, zoom out, percentage, zoom in, full screen), the **inspector** docked on the right (400px; below 1024px it opens as a drawer), and the **dock** underneath (AI Review, Issues, Test Runs, Activity for the open journey; collapsible, remembered).

#### Live test page

**Interactive workspace (6 Nov 2026).** Three columns on a wide screen: set-up on the left (URL, build, screen size, details in advance, Open preview, Run test on every device, Save session, saved sessions, recent runs), the browser in the centre, and the inspection panel on the right (tabs Errors, Console, Network, Steps, Findings; 340px). The browser has a toolbar (back, forward, refresh, address bar with a loading spinner, screen size, zoom, screenshot, open in a new tab, full screen, close), then the page as a live picture. Every blank state has words and no empty box: no URL, connector off, starting, loading, unreachable, too slow, blocked address, disconnected, closed; banners for a CAPTCHA (never bypassed), a lost connection, a test using the browser (input off) and a secret being typed (picture paused). Errors can be filtered by category, opened for details and the screenshot taken at that moment, marked reviewed, or turned into a Journey task. A line under the page says the device is emulated.
The default is automatic: one box for the staging URL. Pasting an address (or pressing Enter) runs the test on every device with nothing to choose; "This site needs a login" opens username, password and other details; "Test a particular flow with your own steps" holds the step editor and a device picker. The preview is a browser: an address bar (the URL, and the device and page it is on), the live picture (or an opening state the moment a URL is pasted), and an Errors panel beside it that lists problems as they are found, newest first, each with its device and page. Under it, one result line and tabs Devices (each device, live, with its issues), Findings (worst first, with the fix) and Progress.
It appears in two places. Inside a campaign it is the "Live test" section of Development, as part of that campaign's flow: the URL starts as its latest staging build (with a build picker), scenarios are the campaign's own, the allowed domains come from its test environments, and Save as scenario saves back to it. On its own it is the sidebar item "Live test", for any URL and any campaign. Two columns on a wide screen (a 420px set-up card, then the preview), stacked on a phone. Set-up: URL, device, optional campaign scenario, the step editor (action, target, value, a Hide box for anything secret), and one box per {{name}} the steps use. Preview: a status line (Running, Waiting for you, Passed, Failed, Blocked, Stopped) with Run again, Save as scenario and Log; the live picture, or the picture kept for the step you click; an amber answer box when a step asks you to type (a password field when the answer is secret); then Steps, Console and Network tabs. It says plainly when the connector is not running.

#### Device report
On the Development section, under the builds: one card for the latest finished site check. A sentence (when, pages, how many devices have issues, link to the findings), a sign-in note when the login failed or asked for details that are not stored (what to add), a table of devices (pages opened, result, sign-in) where a click opens the issues seen on that device, and a plain note that the devices are emulated.

#### Live view
While the connector runs a job, a card appears bottom right on every page: the live picture of the test browser (a phone-width picture for mobile passes), a headline for the current step, the last few steps, and where it is (device, page n of N, path). It can be made larger, or hidden to a pill, and remembers which. It says plainly that it is live on this PC only and cannot control the browser.

#### The journey graph
A journey canvas is a graph the team edits: **screens** (phone frames from the designs), **logic steps** and **connections**. Everything on it is documentation until a scenario covers it; the AI never edits the graph.
- **Steps you can add** ("+ Add", top left, placed in free space inside the view): form submission, OTP validation, API request, eligibility check, decision, reward allocation, voucher distribution, KYC verification, error or fallback, End, note. Start comes with the journey (one per journey, cannot be deleted). Screens come from the designs; a design that has no node yet waits in a **New screens** tray (bottom left) with Add and Add all.
- **Logic step card:** 210px, a 4px bar on the left in the kind’s tone, kind label in small caps, name, the first thing its settings say, and a requirement count. A note is a dashed card. Screen nodes also show the design version, how the built page compares and the scenarios passed.
- **Connections:** drag from a dot on any side of a step to any side of another. Dots appear on hover and on the selected step. Arrows have heads, may carry a label, run dashed into error and success states, and turn accent when selected. Rules (also enforced by the database): same journey, nothing into Start, nothing out of End, notes are not part of the flow, one connection per ordered pair (a loop back is allowed).
- **Keyboard:** Delete or Backspace deletes the selection after a confirmation, Ctrl/Cmd+D copies a step (not Start or a screen), F fits, + and - zoom, M toggles the minimap (remembered), Esc clears the selection. Shift-drag selects several.
- **The inspector follows the selected object:** a screen (Overview, Findings, Requirements, Tests, Tasks), a logic step (name, its settings, linked requirements, connections), a connection (label), a finding or a requirement (with a link back to the step). Viewers see the same graph with no dots, no Add and a "View only" note. Below 1024px the inspector is a drawer and the canvas tools sit bottom right.

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
