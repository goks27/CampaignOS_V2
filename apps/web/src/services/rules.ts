import { supabase, must, type Tables } from "./db";
import type { RunResult, Scenario } from "@/features/rules/engine";

export type RuleScenarioRow = Tables<"rule_scenarios">;
export type RuleRunRow = Tables<"rule_runs">;

/** Saved business-rule scenarios and the record of each run, per campaign. RLS decides who can add, edit, run and delete them. */
export const rulesService = {
  async scenarios(campaignId: string): Promise<RuleScenarioRow[]> {
    return must(await supabase.from("rule_scenarios").select("*").eq("campaign_id", campaignId).order("suite").order("name"));
  },
  async saveScenario(input: { id?: string; campaignId: string; suite: string; name: string; scenario: Scenario; source?: "manual" | "imported" }) {
    const row = { campaign_id: input.campaignId, suite: input.suite.slice(0, 80) || "General", name: input.name.slice(0, 200), scenario: input.scenario as never };
    if (input.id) return must(await supabase.from("rule_scenarios").update(row).eq("id", input.id).select().single());
    return must(await supabase.from("rule_scenarios").insert({ ...row, source: input.source ?? "manual" }).select().single());
  },
  /** Only a Manager or Admin can accept a suggested scenario; the database refuses anyone else. */
  async accept(id: string) { return must(await supabase.from("rule_scenarios").update({ accepted: true }).eq("id", id).select().single()); },
  async removeScenario(id: string) { must(await supabase.from("rule_scenarios").delete().eq("id", id)); },
  async runs(campaignId: string, limit = 100): Promise<RuleRunRow[]> {
    return must(await supabase.from("rule_runs").select("*").eq("campaign_id", campaignId).order("ran_at", { ascending: false }).limit(limit));
  },
  async saveRun(input: { campaignId: string; scenarioId?: string | null; scenarioVersion?: number | null; buildLabel?: string | null; result: RunResult }) {
    return must(await supabase.from("rule_runs").insert({
      campaign_id: input.campaignId, scenario_id: input.scenarioId ?? null, scenario_name: input.result.name.slice(0, 200), scenario_version: input.scenarioVersion ?? null,
      build_label: input.buildLabel?.slice(0, 200) ?? null, status: input.result.status, counts: input.result.counts as never, result: input.result as never, ran_at: input.result.ranAt,
    }).select().single());
  },
};
