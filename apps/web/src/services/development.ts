import { supabase, must, type Tables, type Insert, type Update } from "./db";
import { connectorService } from "./connector";

export type TestEnvironment = Tables<"test_environments">;
export type DevSubmission = Tables<"development_submissions">;
export type TestCase = Tables<"qa_test_cases">;
export type TestRun = Tables<"qa_test_runs"> & { qa_test_results: Tables<"qa_test_results">[] };
export type DevCapture = Tables<"dev_captures">;

export type Step = { action: "goto" | "fill" | "click" | "select" | "check" | "expect_text" | "expect_url" | "expect_visible" | "wait"; target: string; value?: string };

export const developmentService = {
  async environments(campaignId: string) {
    return must(await supabase.from("test_environments").select("*").eq("campaign_id", campaignId).order("created_at"));
  },
  async saveEnvironment(input: Insert<"test_environments"> & { id?: string }) {
    const { id, ...rest } = input;
    if (id) return must(await supabase.from("test_environments").update(rest).eq("id", id).select().single());
    return must(await supabase.from("test_environments").insert(rest).select().single());
  },
  async setCredentials(envId: string, username: string, password: string, extra?: string) {
    must(await supabase.rpc("set_environment_credentials", { p_environment: envId, p_username: username, p_password: password, p_extra: extra ?? undefined }));
  },
  async clearCredentials(envId: string) {
    must(await supabase.rpc("clear_environment_credentials", { p_environment: envId }));
  },
  async submissions(campaignId: string) {
    return must(await supabase.from("development_submissions").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: false }));
  },
  async createSubmission(input: Insert<"development_submissions">) {
    const sub = must(await supabase.from("development_submissions").insert(input).select().single());
    const autoQueued = must(await supabase.rpc("finalize_development_submission", { p_submission: sub.id })) as number;
    if (autoQueued > 0) void connectorService.wake();
    return { submission: sub, autoQueued };
  },
  async updateSubmission(id: string, patch: Update<"development_submissions">) {
    must(await supabase.from("development_submissions").update(patch).eq("id", id));
  },
  async testCases(campaignId: string) {
    return must(await supabase.from("qa_test_cases").select("*").eq("campaign_id", campaignId).order("created_at"));
  },
  async saveTestCase(input: Insert<"qa_test_cases"> & { id?: string }) {
    const { id, ...rest } = input;
    if (id) return must(await supabase.from("qa_test_cases").update(rest).eq("id", id).select().single());
    return must(await supabase.from("qa_test_cases").insert(rest).select().single());
  },
  async removeTestCase(id: string) {
    must(await supabase.from("qa_test_cases").delete().eq("id", id));
  },
  async runs(campaignId: string): Promise<TestRun[]> {
    return must(await supabase.from("qa_test_runs").select("*, qa_test_results(*)").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(20)) as unknown as TestRun[];
  },
  async captures(submissionId: string) {
    return must(await supabase.from("dev_captures").select("*").eq("development_submission_id", submissionId).order("created_at", { ascending: false }));
  },
};
