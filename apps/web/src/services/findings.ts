import { supabase, must, type Tables, type Update } from "./db";
import type { FindingStatus } from "@/lib/labels";

export type FindingEvidence = Tables<"finding_evidence">;
export type Finding = Tables<"findings"> & {
  campaigns: { id: string; name: string } | null;
  journeys: { id: string; name: string } | null;
  requirements: Pick<Tables<"requirements">, "id" | "ref" | "title" | "description" | "source_text" | "source_pages" | "status"> | null;
  design_assets: Pick<Tables<"design_assets">, "id" | "bucket" | "storage_path" | "screen_name" | "width" | "height" | "original_width" | "original_height" | "submission_id"> | null;
  dev_captures: Pick<Tables<"dev_captures">, "id" | "storage_path" | "url" | "viewport" | "width" | "height" | "design_asset_id"> | null;
  finding_evidence: FindingEvidence[];
};

export type Feedback = {
  issue: string;
  location: string;
  observation: string;
  expected: string;
  action_required: string;
  priority: "low" | "medium" | "high" | "critical";
};

const SELECT = `*, campaigns(id, name), journeys(id, name),
  requirements(id, ref, title, description, source_text, source_pages, status),
  design_assets(id, bucket, storage_path, screen_name, width, height, original_width, original_height, submission_id),
  dev_captures(id, storage_path, url, viewport, width, height, design_asset_id),
  finding_evidence(*)`;

export function defaultFeedback(f: Finding): Feedback {
  const fb = (f.feedback ?? null) as Partial<Feedback> | null;
  const location = [f.journeys?.name, f.design_assets?.screen_name ?? f.affected_page ?? f.dev_captures?.url].filter(Boolean).join(" – ");
  return {
    issue: fb?.issue ?? f.title,
    location: fb?.location ?? location,
    observation: fb?.observation ?? f.observed ?? f.description,
    expected: fb?.expected ?? f.expected ?? "",
    action_required: fb?.action_required ?? f.suggested_correction ?? "",
    priority: fb?.priority ?? (f.severity === "critical" ? "critical" : f.severity === "high" ? "high" : f.severity === "medium" ? "medium" : "low"),
  };
}

export const findingsService = {
  async list(filter: { campaignId?: string; statuses?: FindingStatus[] } = {}): Promise<Finding[]> {
    let q = supabase.from("findings").select(SELECT).order("created_at", { ascending: false }).limit(500);
    if (filter.campaignId) q = q.eq("campaign_id", filter.campaignId);
    if (filter.statuses?.length) q = q.in("status", filter.statuses);
    return must(await q) as unknown as Finding[];
  },
  async get(id: string): Promise<Finding> {
    return must(await supabase.from("findings").select(SELECT).eq("id", id).single()) as unknown as Finding;
  },
  async update(id: string, patch: Update<"findings">) {
    return must(await supabase.from("findings").update(patch).eq("id", id).select().single());
  },
  async setStatus(ids: string[], status: FindingStatus) {
    must(await supabase.from("findings").update({ status }).in("id", ids));
  },
  /** Creates the linked task and marks the finding Assigned. Keeps every trace back to the source. */
  async assign(f: Finding, input: { ownerId: string; dueDate: string | null; priority: Feedback["priority"]; feedback: Feedback }) {
    const evidence = {
      finding_ref: f.ref,
      requirement_ref: f.requirements?.ref ?? null,
      screen: f.design_assets?.screen_name ?? null,
      asset: f.design_assets ? { bucket: f.design_assets.bucket, path: f.design_assets.storage_path } : null,
      capture: f.dev_captures ? { path: f.dev_captures.storage_path, url: f.dev_captures.url } : null,
      regions: f.finding_evidence.filter((e) => e.kind === "region").map((e) => e.region),
    };
    const fb = input.feedback;
    const description = [
      `Issue: ${fb.issue}`, `Location: ${fb.location}`, `Observation: ${fb.observation}`,
      `Expected: ${fb.expected}`, `Action required: ${fb.action_required}`,
      "", `From finding ${f.ref}${f.requirements ? ` · requirement ${f.requirements.ref}` : " · Additional observation"}`,
    ].join("\n");
    const task = must(await supabase.from("tasks").insert({
      campaign_id: f.campaign_id, journey_id: f.journey_id, title: fb.issue, description,
      assignee_id: input.ownerId, priority: input.priority, due_date: input.dueDate,
      source_finding_id: f.id, source_requirement_id: f.requirement_id,
      source_submission_id: f.design_submission_id ?? f.development_submission_id, evidence,
    }).select().single());
    must(await supabase.from("findings").update({ status: "assigned", owner_id: input.ownerId, feedback: fb }).eq("id", f.id));
    return task;
  },
  async addManual(input: { campaignId: string; title: string; description: string; severity: Tables<"findings">["severity"]; requirementId: string | null; reviewType: Tables<"findings">["review_type"] }) {
    return must(await supabase.from("findings").insert({
      campaign_id: input.campaignId, ref: "", title: input.title, description: input.description, severity: input.severity,
      requirement_id: input.requirementId, additional_observation: !input.requirementId, review_type: input.reviewType,
      status: "accepted", confidence: "high",
    }).select().single());
  },
  async tasksFor(findingId: string) {
    return must(await supabase.from("tasks").select("id, ref, title, status, assignee_id, due_date").eq("source_finding_id", findingId));
  },
};
