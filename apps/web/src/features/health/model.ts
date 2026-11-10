/**
 * Campaign health check: one report from what has actually been run, grouped by how it was checked.
 *
 *   Independent of AI: browser and devices, business rules, scenarios.
 *   AI-assisted: design and requirement review (findings are suggestions until a manager accepts them; they never count as confirmed).
 *
 * The verdict never says "verified" while something that matters has not been run. Pure functions: no fetching here.
 */
import type { SiteNotes } from "@/lib/devices";

export type Area = "browser" | "rules" | "scenarios" | "ai";
export type AreaStatus = "failed" | "incomplete" | "passed" | "not_run";
export type Evidence = "CONFIRMED" | "OBSERVED" | "AI SUGGESTION" | "NEEDS VERIFICATION";

export type HealthInput = {
  scenarios: { id: string; name: string; suite: string; accepted: boolean; enabled: boolean }[];
  runs: { scenario_id: string | null; status: string; ran_at: string; build_label: string | null }[];
  site: { finishedAt: string | null; status: string; notes: SiteNotes | null } | null;
  qaCases: number;
  /** Results of the latest run of the browser scenarios, or null when they have never been run. */
  qaLatest: { result: string }[] | null;
  findings: { severity: string; status: string; review_type: string }[];
  acceptedRequirements: number;
  draftRequirements: number;
  aiOnline: boolean | null;
};
export type Line = { text: string; evidence: Evidence };
export type Section = { area: Area; title: string; independentOfAi: boolean; status: AreaStatus; summary: string; lines: Line[]; notTested: string[] };
export type Health = { verdict: "failed" | "incomplete" | "no_failures"; headline: string; sections: Section[]; notTested: string[]; confirmedFailures: number; generatedAt: string };

/** Review types that are decided by a model. Everything else here is a deterministic check. */
export const AI_REVIEW_TYPES = new Set(["sow_analysis", "sow_vs_design", "design_consistency", "design_vs_development", "sow_vs_development"]);
const OPEN = new Set(["new", "awaiting_review", "accepted", "assigned", "in_progress", "ready_for_retest", "reopened"]);

/** Latest run of each scenario that counts (accepted and enabled). */
export function latestRuns(i: Pick<HealthInput, "scenarios" | "runs">) {
  const live = i.scenarios.filter((s) => s.accepted && s.enabled);
  const latest = new Map<string, HealthInput["runs"][number]>();
  for (const r of i.runs) if (r.scenario_id && (!latest.has(r.scenario_id) || r.ran_at > latest.get(r.scenario_id)!.ran_at)) latest.set(r.scenario_id, r);
  return live.map((s) => ({ scenario: s, run: latest.get(s.id) ?? null }));
}

export function buildHealth(i: HealthInput, now = () => new Date().toISOString()): Health {
  const sections: Section[] = [];

  // ---- browser and devices (no AI)
  {
    const n = i.site?.notes, devs = n?.devices ?? [];
    if (!i.site || !i.site.finishedAt) sections.push({ area: "browser", title: "Browser and devices", independentOfAi: true, status: "not_run", summary: "No site check has run on a build yet.", lines: [], notTested: ["Pages, forms, console and network on phones and tablets: no site check has run."] });
    else if (!devs.length) sections.push({ area: "browser", title: "Browser and devices", independentOfAi: true, status: i.site.status === "failed" ? "failed" : "incomplete", summary: "The last site check finished without a device report.", lines: [], notTested: ["The last site check has no per-device result."] });
    else {
      const ran = devs.filter((d) => d.pages_tested > 0), skipped = devs.filter((d) => d.pages_tested === 0);
      const withIssues = ran.filter((d) => d.issues > 0);
      const lines: Line[] = withIssues.map((d) => ({ text: `${d.label}: ${d.issues} issue${d.issues === 1 ? "" : "s"}${d.top_issues[0] ? `, such as ${d.top_issues[0]}` : ""}`, evidence: "OBSERVED" }));
      const notTested = [...skipped.map((d) => `${d.label}: ${d.skipped ?? "no page was opened"}`), "Real phones and Safari's own engine are never tested; these are emulated devices."];
      sections.push({ area: "browser", title: "Browser and devices", independentOfAi: true, status: withIssues.length ? "failed" : skipped.length ? "incomplete" : "passed",
        summary: `${ran.length} of ${devs.length} devices tested over ${n?.pages_checked ?? "?"} pages; ${withIssues.length} with issues.`, lines, notTested });
    }
  }

  // ---- business rules (no AI)
  {
    const rows = latestRuns(i);
    if (!rows.length) sections.push({ area: "rules", title: "Business rules", independentOfAi: true, status: "not_run", summary: "No rule scenarios yet.", lines: [], notTested: ["Eligibility, unique codes, winner selection, caps and rewards: no scenario exists."] });
    else {
      const never = rows.filter((r) => !r.run), failed = rows.filter((r) => r.run?.status === "failed"), incomplete = rows.filter((r) => r.run?.status === "incomplete"), passed = rows.filter((r) => r.run?.status === "passed");
      const lines: Line[] = [...failed.map((r) => ({ text: `${r.scenario.name} failed${r.run?.build_label ? ` on ${r.run.build_label}` : ""}`, evidence: "CONFIRMED" as const })), ...incomplete.map((r) => ({ text: `${r.scenario.name}: some checks could not be verified`, evidence: "NEEDS VERIFICATION" as const }))];
      sections.push({ area: "rules", title: "Business rules", independentOfAi: true, status: failed.length ? "failed" : never.length || incomplete.length ? "incomplete" : "passed",
        summary: `${passed.length} passed, ${failed.length} failed, ${incomplete.length} incomplete, ${never.length} never run (of ${rows.length}).`, lines,
        notTested: [...never.map((r) => `${r.scenario.name} has never been run`), ...incomplete.map((r) => `${r.scenario.name} ran without everything verified`), "Backend rules that only staging can show stay Needs verification until tested there."] });
    }
  }

  // ---- browser scenarios (no AI)
  if (!i.qaCases) sections.push({ area: "scenarios", title: "Browser scenarios", independentOfAi: true, status: "not_run", summary: "No browser scenarios yet.", lines: [], notTested: ["Journey steps such as registration and OTP are not covered by a scenario."] });
  else if (!i.qaLatest) sections.push({ area: "scenarios", title: "Browser scenarios", independentOfAi: true, status: "incomplete", summary: `${i.qaCases} scenarios are defined and have never been run.`, lines: [], notTested: ["Press Test build to run the scenarios on the latest build."] });
  else {
    const count = (r: string) => i.qaLatest!.filter((x) => x.result === r).length;
    const failed = count("failed"), verified = count("verified"), unsure = i.qaLatest.length - failed - verified;
    sections.push({ area: "scenarios", title: "Browser scenarios", independentOfAi: true, status: failed ? "failed" : unsure || verified < i.qaCases ? "incomplete" : "passed",
      summary: `Latest run: ${verified} verified, ${failed} failed, ${unsure} not verified, of ${i.qaCases} scenarios.`,
      lines: failed ? [{ text: `${failed} scenario step${failed === 1 ? "" : "s"} failed in the browser`, evidence: "OBSERVED" }] : [],
      notTested: [...(unsure ? [`${unsure} scenario results are blocked, not tested or need verification`] : []), ...(verified < i.qaCases && !unsure && !failed ? [`${i.qaCases - verified} scenarios have no result in the latest run`] : [])] });
  }

  // ---- AI review (assistive)
  {
    const open = i.findings.filter((f) => OPEN.has(f.status));
    const ai = open.filter((f) => AI_REVIEW_TYPES.has(f.review_type));
    const waiting = ai.filter((f) => f.status === "new" || f.status === "awaiting_review").length;
    sections.push({ area: "ai", title: "Design and requirement review", independentOfAi: false,
      status: i.aiOnline === false && !ai.length ? "not_run" : ai.length ? "incomplete" : "passed",
      summary: ai.length ? `${ai.length} open AI findings (${waiting} waiting for a manager). They are suggestions, not confirmed defects.` : i.aiOnline === false ? "AI is offline, so nothing was reviewed. Everything above still ran." : "No open AI findings.",
      lines: ai.slice(0, 5).map((f) => ({ text: `${f.severity} finding awaiting a decision`, evidence: "AI SUGGESTION" as const })),
      notTested: [...(i.draftRequirements ? [`${i.draftRequirements} draft requirements are not accepted yet`] : []), ...(!i.acceptedRequirements ? ["No requirement is accepted, so nothing was checked against requirements"] : [])] });
  }

  const confirmedFailures = sections.filter((s) => s.independentOfAi && s.status === "failed").reduce((a, s) => a + Math.max(1, s.lines.filter((l) => l.evidence === "CONFIRMED").length), 0);
  const notTested = sections.flatMap((s) => s.notTested);
  const anyFailed = sections.some((s) => s.independentOfAi && s.status === "failed");
  // "No failures" needs the browser, the rules AND the scenarios to have run and passed. Anything less is incomplete, never fine.
  const everyIndependentPassed = sections.filter((s) => s.independentOfAi).every((s) => s.status === "passed");
  const verdict: Health["verdict"] = anyFailed ? "failed" : everyIndependentPassed ? "no_failures" : "incomplete";
  const headline = verdict === "failed" ? "Failures found: fix them before launch."
    : verdict === "incomplete" ? "No confirmed failures, but not everything was verified."
    : "No failures in what was tested. This is not a guarantee: see what was not tested.";
  return { verdict, headline, sections, notTested, confirmedFailures, generatedAt: now() };
}
