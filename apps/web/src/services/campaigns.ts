import { supabase, must, mustMaybe, type Tables, type Insert, type Update } from "./db";

export type Campaign = Tables<"campaigns">;
export type Journey = Tables<"journeys">;
export type CampaignMember = Tables<"campaign_members"> & { profiles: { full_name: string; email: string } | null };
export type CampaignWithRelations = Campaign & {
  clients: { id: string; name: string } | null;
  journeys: Journey[];
  campaign_members: CampaignMember[];
};

const SELECT = "*, clients(id, name), journeys(*), campaign_members(*, profiles(full_name, email))";

export const campaignsService = {
  async list(): Promise<CampaignWithRelations[]> {
    const rows = must(await supabase.from("campaigns").select(SELECT).order("target_launch_date", { ascending: true, nullsFirst: false }));
    return (rows as unknown as CampaignWithRelations[]).map(sortJourneys);
  },
  async get(id: string): Promise<CampaignWithRelations> {
    const row = must(await supabase.from("campaigns").select(SELECT).eq("id", id).single());
    return sortJourneys(row as unknown as CampaignWithRelations);
  },
  async create(input: Omit<Insert<"campaigns">, "workspace_id">, workspaceId: string, managerId: string) {
    const c = must(await supabase.from("campaigns").insert({ ...input, workspace_id: workspaceId }).select().single());
    must(await supabase.from("campaign_members").insert({ campaign_id: c.id, user_id: managerId, campaign_role: "primary_manager" }));
    return c;
  },
  async update(id: string, patch: Update<"campaigns">) {
    return must(await supabase.from("campaigns").update(patch).eq("id", id).select().single());
  },
  async remove(id: string) {
    must(await supabase.from("campaigns").delete().eq("id", id));
  },
};

function sortJourneys(c: CampaignWithRelations): CampaignWithRelations {
  return { ...c, journeys: [...(c.journeys ?? [])].sort((a, b) => a.sort_order - b.sort_order) };
}

export const journeysService = {
  async create(input: Insert<"journeys">) {
    return must(await supabase.from("journeys").insert(input).select().single());
  },
  async update(id: string, patch: Update<"journeys">) {
    return must(await supabase.from("journeys").update(patch).eq("id", id).select().single());
  },
  async remove(id: string) {
    must(await supabase.from("journeys").delete().eq("id", id));
  },
  async reorder(ids: string[]) {
    await Promise.all(ids.map((id, i) => supabase.from("journeys").update({ sort_order: i }).eq("id", id)));
  },
};

export const campaignMembersService = {
  async add(campaignId: string, userId: string, role: Insert<"campaign_members">["campaign_role"]) {
    return must(await supabase.from("campaign_members").insert({ campaign_id: campaignId, user_id: userId, campaign_role: role }).select().single());
  },
  async remove(id: string) {
    must(await supabase.from("campaign_members").delete().eq("id", id));
  },
};

export type Client = Tables<"clients">;
export const clientsService = {
  async list() {
    return must(await supabase.from("clients").select("*").order("name"));
  },
  async findOrCreate(name: string, workspaceId: string) {
    const trimmed = name.trim();
    const existing = mustMaybe(await supabase.from("clients").select("*").ilike("name", trimmed).maybeSingle());
    if (existing) return existing;
    return must(await supabase.from("clients").insert({ name: trimmed, workspace_id: workspaceId }).select().single());
  },
};
