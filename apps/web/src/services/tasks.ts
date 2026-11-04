import { supabase, must, type Tables, type Insert, type Update } from "./db";

export type Task = Tables<"tasks"> & {
  campaigns: { id: string; name: string } | null;
  journeys: { id: string; name: string } | null;
  assignee: { id: string; full_name: string } | null;
};
export type TaskComment = Tables<"task_comments">;

const SELECT = "*, campaigns(id, name), journeys(id, name), assignee:profiles!tasks_assignee_id_fkey(id, full_name)";

export const tasksService = {
  async list(filter: { campaignId?: string; assigneeId?: string } = {}): Promise<Task[]> {
    let q = supabase.from("tasks").select(SELECT).order("due_date", { ascending: true, nullsFirst: false }).order("created_at");
    if (filter.campaignId) q = q.eq("campaign_id", filter.campaignId);
    if (filter.assigneeId) q = q.eq("assignee_id", filter.assigneeId);
    return must(await q) as unknown as Task[];
  },
  async get(id: string): Promise<Task> {
    return must(await supabase.from("tasks").select(SELECT).eq("id", id).single()) as unknown as Task;
  },
  async create(input: Insert<"tasks">) {
    return must(await supabase.from("tasks").insert(input).select().single());
  },
  async update(id: string, patch: Update<"tasks">) {
    return must(await supabase.from("tasks").update(patch).eq("id", id).select().single());
  },
  async remove(id: string) {
    must(await supabase.from("tasks").delete().eq("id", id));
  },
  async comments(taskId: string): Promise<TaskComment[]> {
    return must(await supabase.from("task_comments").select("*").eq("task_id", taskId).order("created_at"));
  },
  async addComment(taskId: string, campaignId: string, body: string) {
    return must(await supabase.from("task_comments").insert({ task_id: taskId, campaign_id: campaignId, body }).select().single());
  },
};
