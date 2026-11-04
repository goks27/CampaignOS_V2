import { supabase, must, type Tables } from "./db";
import { storageService, safeName } from "./storage";
import { connectorService } from "./connector";
import type { PreparedImage } from "@/lib/images";

export type DesignSubmission = Tables<"design_submissions"> & { design_assets: Tables<"design_assets">[] };
export type DesignAsset = Tables<"design_assets">;

export type NewScreen = PreparedImage & { screenName: string; screenType: string; sourceFile: string };

export const designsService = {
  /** Screens of the newest design submissions, for campaign covers. The cover itself is picked in features/home/model.ts. */
  async coverRows(campaignIds: string[]) {
    if (!campaignIds.length) return [];
    return must(await supabase.from("design_assets").select("campaign_id, submission_id, bucket, storage_path, sort_order, created_at").in("campaign_id", campaignIds).order("created_at", { ascending: false }).limit(400));
  },
  async list(campaignId: string): Promise<DesignSubmission[]> {
    const rows = must(await supabase.from("design_submissions").select("*, design_assets(*)").eq("campaign_id", campaignId).order("created_at", { ascending: false })) as unknown as DesignSubmission[];
    return rows.map((r) => ({ ...r, design_assets: [...r.design_assets].sort((a, b) => a.sort_order - b.sort_order) }));
  },
  async nextVersion(campaignId: string, journeyId: string | null) {
    let q = supabase.from("design_submissions").select("version_no").eq("campaign_id", campaignId).order("version_no", { ascending: false }).limit(1);
    q = journeyId ? q.eq("journey_id", journeyId) : q.is("journey_id", null);
    const rows = must(await q);
    return (rows[0]?.version_no ?? 0) + 1;
  },
  async create(input: { campaignId: string; journeyId: string | null; title: string; notes?: string; figmaUrl?: string; screens: NewScreen[]; onProgress?: (done: number) => void }) {
    const version = await this.nextVersion(input.campaignId, input.journeyId);
    const sub = must(await supabase.from("design_submissions").insert({
      campaign_id: input.campaignId, journey_id: input.journeyId, title: input.title, version_no: version, notes: input.notes ?? null,
      source: input.figmaUrl ? "figma" : "upload", figma_url: input.figmaUrl ?? null,
    }).select().single());
    let i = 0;
    for (const s of input.screens) {
      const ext = s.blob.type === "image/png" ? "png" : s.blob.type === "image/webp" ? "webp" : "jpg";
      const path = `${input.campaignId}/${sub.id}/${String(i).padStart(2, "0")}-${safeName(s.screenName)}.${ext}`;
      await storageService.upload("designs", path, s.blob);
      must(await supabase.from("design_assets").insert({
        submission_id: sub.id, campaign_id: input.campaignId, screen_name: s.screenName, screen_type: s.screenType,
        storage_path: path, mime_type: s.blob.type, width: s.width, height: s.height,
        original_width: s.originalWidth, original_height: s.originalHeight, content_hash: s.hash,
        source_file: s.sourceFile, page_number: s.pageNumber ?? null, sort_order: i,
      }));
      i++;
      input.onProgress?.(i);
    }
    // Older submissions for the same journey are superseded (kept, never overwritten).
    let q = supabase.from("design_submissions").update({ status: "superseded" }).eq("campaign_id", input.campaignId).neq("id", sub.id).in("status", ["submitted", "in_review", "changes_requested"]);
    q = input.journeyId ? q.eq("journey_id", input.journeyId) : q.is("journey_id", null);
    await q;
    const autoQueued = must(await supabase.rpc("finalize_design_submission", { p_submission: sub.id })) as number;
    if (autoQueued > 0) void connectorService.wake();
    return { submission: sub, autoQueued };
  },
  async setStatus(id: string, status: Tables<"design_submissions">["status"]) {
    must(await supabase.from("design_submissions").update({ status }).eq("id", id));
  },
  async assetUrl(asset: Pick<DesignAsset, "bucket" | "storage_path">) {
    return storageService.signedUrl(asset.bucket as "designs" | "captures", asset.storage_path);
  },
};
