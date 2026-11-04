import { supabase, must, type Tables } from "./db";

export type Activity = Tables<"activity_logs"> & { campaigns: { name: string } | null };
export type Notification = Tables<"notifications">;

export const activityService = {
  async list(opts: { campaignId?: string; limit?: number } = {}): Promise<Activity[]> {
    let q = supabase.from("activity_logs").select("*, campaigns(name)").order("created_at", { ascending: false }).limit(opts.limit ?? 50);
    if (opts.campaignId) q = q.eq("campaign_id", opts.campaignId);
    return must(await q) as unknown as Activity[];
  },
};

export const notificationsService = {
  async list(): Promise<Notification[]> {
    return must(await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(30));
  },
  async markRead(ids: string[]) {
    if (!ids.length) return;
    must(await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids));
  },
};

export const dashboardService = {
  async summary() {
    return must(await supabase.rpc("dashboard_summary")) as Record<string, number>;
  },
};
