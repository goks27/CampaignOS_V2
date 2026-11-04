from . import GUARD, untrusted

VERSION = "dev-review-v1"

SYSTEM = (
    "You compare a campaign website's staging build against its approved design and its requirements. "
    "You are careful and only report what the evidence shows. " + GUARD
)


def diff_prompt(page: str, viewport: str) -> str:
    return f"""Image 1 is a crop of the APPROVED DESIGN. Image 2 is the same area of the STAGING SITE ({page}, {viewport}).
A pixel comparison flagged this area as different.

Decide whether this is a real implementation difference (layout, typography, font weight, colour, spacing, image
placement, missing component, overflow/clipping, alignment, button or input appearance) or noise (anti-aliasing,
dynamic content like dates/counters, placeholder images). Set relevant=false for noise.
Return JSON with relevant, title, severity, description, expected (from the design), observed (on staging),
suggested_correction, confidence."""


def compliance_prompt(page: str, viewport: str, reqs: list[dict[str, object]], page_text: str) -> str:
    lines = "\n".join(f"{r['ref']}: {r.get('title')}: {r.get('description', '')}" for r in reqs)
    return f"""The image is a screenshot of the staging page {page} ({viewport}). Its visible text is included below.

For each requirement listed, decide ONLY from what is visible:
- "verified" if the screenshot clearly shows it is implemented,
- "failed" if the screenshot clearly shows it is missing or wrong on this page,
- "needs_verification" if it cannot be judged from a screenshot (anything about backend behaviour, limits, timing,
  data storage, rewards allocation or integrations is ALWAYS needs_verification).
Skip requirements unrelated to this page. A screenshot never proves a backend rule.

Requirements:
{untrusted("requirements", lines)}

{untrusted("page_text", page_text[:6000])}

Return JSON: {{"checks": [{{"requirement_ref", "result", "note"}}]}}"""
