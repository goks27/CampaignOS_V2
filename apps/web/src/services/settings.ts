import { supabase, must, mustMaybe, type Tables, type Update } from "./db";
import type { CampaignStage, CampaignStatus, Priority } from "./types-helpers";

export type WorkspaceSettings = Tables<"workspace_settings">;

export const settingsService = {
  async get(): Promise<WorkspaceSettings | null> {
    return mustMaybe(await supabase.from("workspace_settings").select("*").maybeSingle());
  },
  async update(workspaceId: string, patch: Update<"workspace_settings">) {
    return must(await supabase.from("workspace_settings").update(patch).eq("workspace_id", workspaceId).select().single());
  },
  async renameWorkspace(id: string, name: string) {
    must(await supabase.from("workspaces").update({ name }).eq("id", id));
  },
  async storageUsage() {
    return must(await supabase.rpc("storage_usage")) as { buckets: Record<string, number>; database_bytes: number };
  },
};

export type ImportRow = {
  name: string; client?: string; description?: string; stage?: CampaignStage | ""; status?: CampaignStatus | "";
  priority?: Priority | ""; start_date?: string; target_launch_date?: string; staging_url?: string; production_url?: string;
  notes?: string; journeys?: string;
};
export type ImportResult = {
  dry_run: boolean; create: number; update: number; error: number;
  rows: { row: number; name: string; action: "create" | "update" | "error"; message?: string }[];
};

export const importService = {
  async run(rows: ImportRow[], dryRun: boolean): Promise<ImportResult> {
    return must(await supabase.rpc("import_campaigns", { p_rows: rows, p_dry_run: dryRun })) as unknown as ImportResult;
  },
};

export const reportsService = {
  async campaign(campaignId: string) {
    return must(await supabase.rpc("campaign_report", { p_campaign: campaignId })) as Record<string, Record<string, number> | number>;
  },
};
