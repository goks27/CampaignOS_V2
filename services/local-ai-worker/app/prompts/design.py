from . import GUARD, untrusted

VERSION = "design-review-v1"

SYSTEM = (
    "You are a meticulous QA reviewer for campaign microsites. You compare design screens against an accepted list of "
    "requirements and report only problems you can actually see. " + GUARD
)

BOX_RULE = (
    "For each finding give box = [x1, y1, x2, y2] locating the problem area on a 0–1000 grid relative to the image "
    "(0,0 top-left; 1000,1000 bottom-right). Use null when the problem is something missing from the whole screen."
)


def requirements_block(reqs: list[dict[str, object]]) -> str:
    lines = []
    for r in reqs:
        crit = f" | Acceptance: {r.get('acceptance_criteria')}" if r.get("acceptance_criteria") else ""
        lines.append(f"{r['ref']} [{r.get('category')}] {r.get('title')}: {r.get('description', '')}{crit}")
    return "\n".join(lines) if lines else "(no accepted requirements)"


def screen_prompt(screen_name: str, screen_type: str, journey: str | None, reqs: list[dict[str, object]], mode: str) -> str:
    focus = (
        "Check the screen against the requirements: missing mandatory content, missing form fields, missing validation "
        "and error states, incorrect button labels or actions, missing consent and legal sections, inconsistent content, "
        "navigation problems, responsive layout concerns and potential accessibility issues (contrast, tiny tap targets, "
        "missing labels)."
        if mode == "sow_vs_design"
        else "Check visual and content consistency: typography, colours, spacing, button styles, naming and tone."
    )
    return f"""Screen: "{screen_name}" (type: {screen_type}){f", journey: {journey}" if journey else ""}.

Accepted requirements (the only baseline; use their REQ IDs):
{untrusted("requirements", requirements_block(reqs))}

{focus}

Rules:
- Report only issues visible in this screen. Do not invent content you cannot see.
- requirement_ref: the REQ ID the issue violates, or null if it is an additional observation not tied to a requirement.
- {BOX_RULE}
- checks: for each requirement that SHOULD be verifiable on this screen, add {{"requirement_ref", "result", "note"}}:
  "verified" if clearly satisfied, "needs_verification" if it cannot be judged from a static design (e.g. backend
  rules, limits, timing). Do not add checks for requirements unrelated to this screen. Never mark a backend rule verified.
- severity: critical (blocks launch or legal risk), high, medium, low, informational.

Return JSON: {{"findings": [...], "checks": [...]}}"""


def consistency_prompt(screen_names: list[str]) -> str:
    listing = "\n".join(f"Screen {i + 1}: {n}" for i, n in enumerate(screen_names))
    return f"""These {len(screen_names)} images are screens of one campaign journey, in order:
{listing}

Report visual consistency problems ACROSS the screens: inconsistent typography, colours, button styles, spacing,
header/footer, naming of the same thing, tone of copy. For each finding set screen_index (1-based) to the screen that
deviates, requirement_ref to null, and {BOX_RULE}
Report only real, visible inconsistencies. Return JSON: {{"findings": [...]}}"""


def journey_prompt(journey: str | None, screens: list[str], reqs: list[dict[str, object]]) -> str:
    return f"""Journey: {journey or "whole campaign"}.
Submitted screens, in order: {", ".join(screens)}.

Accepted requirements:
{untrusted("requirements", requirements_block(reqs))}

Find journey-level gaps only: screens the requirements imply but that are missing (e.g. OTP verification, error or
success states, terms and privacy pages, ineligible/limit-reached states) and incomplete flows. Each finding must cite
the requirement_ref it comes from. box must be null. Do not repeat issues inside individual screens.
Return JSON: {{"findings": [...]}}"""
