import { supabase, must, type Tables } from "./db";
import { storageService, safeName, validateFile } from "./storage";
import { brandMime, guessBrandKind, type BrandKind } from "@/lib/brand";

export type BrandAsset = Tables<"brand_assets">;

/** Logos, icons, brand guide, fonts and other files that come with a SOW. Stored only: no review reads them. RLS decides who can change them. */
export const brandAssetsService = {
  async list(campaignId: string): Promise<BrandAsset[]> {
    return must(await supabase.from("brand_assets").select("*").eq("campaign_id", campaignId).order("kind").order("created_at", { ascending: false }));
  },

  async upload(campaignId: string, file: File, kind?: BrandKind) {
    const problem = validateFile("brand", file);
    if (problem) throw new Error(problem);
    const mime = brandMime(file)!;
    // The extension decides the content type, so a font or an SVG is stored with the right one whatever the browser said.
    const blob = Object.assign(new Blob([file], { type: mime }), { name: file.name });
    const path = `${campaignId}/${crypto.randomUUID()}-${safeName(file.name)}`;
    await storageService.upload("brand", path, blob);
    try {
      return must(await supabase.from("brand_assets").insert({
        campaign_id: campaignId, kind: kind ?? guessBrandKind(file), file_name: file.name.slice(0, 200), storage_path: path, mime_type: mime, size_bytes: file.size,
      }).select().single());
    } catch (e) {
      await storageService.remove("brand", [path]).catch(() => undefined); // no orphaned file if the row was refused
      throw e;
    }
  },

  async update(id: string, patch: { kind?: BrandKind; file_name?: string }) {
    return must(await supabase.from("brand_assets").update(patch).eq("id", id).select().single());
  },

  async remove(asset: Pick<BrandAsset, "id" | "storage_path">) {
    must(await supabase.from("brand_assets").delete().eq("id", asset.id).select("id"));
    await storageService.remove("brand", [asset.storage_path]).catch(() => undefined);
  },

  /** Opening always downloads: a downloaded SVG never runs as a page. */
  downloadUrl(asset: Pick<BrandAsset, "storage_path" | "file_name">) {
    return storageService.signedUrl("brand", asset.storage_path, 600, { download: asset.file_name });
  },
};
