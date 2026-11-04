import { supabase, must, type Tables, type Insert, type Update } from "./db";
import { storageService, safeName } from "./storage";

export type Approval = Tables<"approvals">;
export type ClientFeedback = Tables<"client_feedback">;
export type Deployment = Tables<"deployments">;
export type Milestone = Tables<"milestones"> & { campaigns?: { name: string } | null };
export type DocumentRow = Tables<"documents">;

export const deliveryService = {
  async approvals(campaignId: string) {
    return must(await supabase.from("approvals").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: false }));
  },
  /** Append-only: a correction is recorded as a new decision. */
  async recordApproval(input: Insert<"approvals">) {
    return must(await supabase.from("approvals").insert(input).select().single());
  },
  async feedback(campaignId: string) {
    return must(await supabase.from("client_feedback").select("*").eq("campaign_id", campaignId).order("received_on", { ascending: false }));
  },
  async saveFeedback(input: Insert<"client_feedback"> & { id?: string }) {
    const { id, ...rest } = input;
    if (id) return must(await supabase.from("client_feedback").update(rest).eq("id", id).select().single());
    return must(await supabase.from("client_feedback").insert(rest).select().single());
  },
  async feedbackToTask(fb: ClientFeedback, input: { title: string; assigneeId: string | null; dueDate: string | null; priority: Tables<"tasks">["priority"] }) {
    const task = must(await supabase.from("tasks").insert({
      campaign_id: fb.campaign_id, journey_id: fb.journey_id, title: input.title,
      description: `Client feedback (${fb.channel}, ${fb.received_on}${fb.client_contact ? `, ${fb.client_contact}` : ""}):\n${fb.summary}\n\n${fb.details ?? ""}`,
      assignee_id: input.assigneeId, due_date: input.dueDate, priority: input.priority, source_feedback_id: fb.id,
    }).select().single());
    must(await supabase.from("client_feedback").update({ status: "converted" }).eq("id", fb.id));
    return task;
  },
  async deployments(campaignId: string) {
    return must(await supabase.from("deployments").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: false }));
  },
  async saveDeployment(input: Insert<"deployments"> & { id?: string }) {
    const { id, ...rest } = input;
    if (id) return must(await supabase.from("deployments").update(rest).eq("id", id).select().single());
    return must(await supabase.from("deployments").insert(rest).select().single());
  },
  async updateDeployment(id: string, patch: Update<"deployments">) {
    return must(await supabase.from("deployments").update(patch).eq("id", id).select().single());
  },
  async milestones(campaignId?: string): Promise<Milestone[]> {
    let q = supabase.from("milestones").select("*, campaigns(name)").order("due_date");
    if (campaignId) q = q.eq("campaign_id", campaignId);
    return must(await q) as unknown as Milestone[];
  },
  async saveMilestone(input: Insert<"milestones"> & { id?: string }) {
    const { id, ...rest } = input;
    if (id) return must(await supabase.from("milestones").update(rest).eq("id", id).select().single());
    return must(await supabase.from("milestones").insert(rest).select().single());
  },
  async removeMilestone(id: string) {
    must(await supabase.from("milestones").delete().eq("id", id));
  },
  async documents(campaignId: string) {
    return must(await supabase.from("documents").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: false }));
  },
  async uploadDocument(campaignId: string, file: File, title: string, kind: DocumentRow["kind"]) {
    const path = `${campaignId}/${crypto.randomUUID()}-${safeName(file.name)}`;
    await storageService.upload("documents", path, file);
    return must(await supabase.from("documents").insert({
      campaign_id: campaignId, title, kind, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size,
    }).select().single());
  },
  async removeDocument(doc: DocumentRow) {
    await storageService.remove("documents", [doc.storage_path]);
    must(await supabase.from("documents").delete().eq("id", doc.id));
  },
};
