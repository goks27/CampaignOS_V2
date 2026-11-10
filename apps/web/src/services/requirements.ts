import { supabase, must, type Tables, type Insert, type Update } from "./db";
import { storageService, safeName } from "./storage";
import { sha256Hex } from "@/lib/utils";
import { toPdf } from "@/lib/toPdf";
import { connectorService } from "./connector";

export type Requirement = Tables<"requirements">;
export type SowVersion = Tables<"sow_versions">;
export type SowDocument = Tables<"sow_documents"> & { sow_versions: SowVersion[] };
export type SowPage = Tables<"sow_pages">;
export type RequirementCheck = Tables<"requirement_checks">;

export const sowService = {
  async list(campaignId: string): Promise<SowDocument[]> {
    const docs = must(await supabase.from("sow_documents").select("*, sow_versions(*)").eq("campaign_id", campaignId).order("created_at")) as unknown as SowDocument[];
    return docs.map((d) => ({ ...d, sow_versions: [...d.sow_versions].sort((a, b) => b.version_no - a.version_no) }));
  },
  /** Uploads a PDF as a new document or a new version of an existing one. Earlier versions are kept. */
  async upload(campaignId: string, original: File, documentId?: string, title?: string) {
    // Any allowed format is converted to PDF here (in the browser) so the worker can analyse it.
    // The hash is of the ORIGINAL bytes: converted PDFs embed a creation date and would never match.
    const hash = await sha256Hex(await original.arrayBuffer());
    const { file, converted } = await toPdf(original);
    // Upload first, then create rows, so a failed upload never leaves an empty document behind.
    const isNew = !documentId;
    const docId = documentId ?? crypto.randomUUID();
    const prev = isNew ? [] : must(await supabase.from("sow_versions").select("version_no, content_hash").eq("sow_document_id", docId).order("version_no", { ascending: false }).limit(1));
    if (prev[0]?.content_hash === hash) throw new Error("This file is identical to the latest version. Nothing to upload.");
    const versionNo = (prev[0]?.version_no ?? 0) + 1;
    const path = `${campaignId}/${docId}/v${versionNo}-${safeName(file.name)}`;
    await storageService.upload("sow", path, file);
    // Keep the original next to the converted PDF.
    if (converted) await storageService.upload("sow", `${campaignId}/${docId}/v${versionNo}-original-${safeName(original.name)}`, original);
    if (isNew) {
      must(await supabase.from("sow_documents").insert({ id: docId, campaign_id: campaignId, title: title || original.name.replace(/\.[a-z0-9]{2,5}$/i, "") }));
    }
    const version = must(await supabase.from("sow_versions").insert({
      sow_document_id: docId, campaign_id: campaignId, version_no: versionNo, storage_path: path,
      file_name: converted ? `${original.name} (converted to PDF)` : original.name, size_bytes: file.size, content_hash: hash,
    }).select().single());
    const autoQueued = must(await supabase.rpc("finalize_sow_version", { p_version: version.id })) as number;
    if (autoQueued > 0) void connectorService.wake(); // start right away if the Claude connector is running
    return { version, autoQueued, converted };
  },
  async pages(versionId: string): Promise<SowPage[]> {
    return must(await supabase.from("sow_pages").select("*").eq("sow_version_id", versionId).order("page_no"));
  },
};

export const requirementsService = {
  async list(campaignId: string): Promise<Requirement[]> {
    return must(await supabase.from("requirements").select("*").eq("campaign_id", campaignId).order("ref"));
  },
  async get(id: string): Promise<Requirement> {
    return must(await supabase.from("requirements").select("*").eq("id", id).single());
  },
  async create(input: Insert<"requirements">) {
    return must(await supabase.from("requirements").insert({ ...input, ref: "", origin: "manual" }).select().single());
  },
  async update(id: string, patch: Update<"requirements">) {
    return must(await supabase.from("requirements").update(patch).eq("id", id).select().single());
  },
  /** Requirements a manager has to clarify, across every campaign the person can see. */
  async needingClarification() {
    return must(await supabase.from("requirements").select("id, ref, title, campaign_id, updated_at, campaigns(name)").eq("status", "needs_clarification").order("updated_at", { ascending: false }).limit(50)) as unknown as { id: string; ref: string; title: string; campaign_id: string; updated_at: string; campaigns: { name: string } | null }[];
  },
  async setStatus(ids: string[], status: Requirement["status"]) {
    must(await supabase.from("requirements").update({ status }).in("id", ids));
  },
  async checks(campaignId: string): Promise<RequirementCheck[]> {
    return must(await supabase.from("requirement_checks").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: false }));
  },
};
