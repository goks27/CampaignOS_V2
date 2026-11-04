import { supabase } from "./db";

export type Bucket = "sow" | "designs" | "captures" | "documents";

// Wide allowlist for documents and SOWs: office files, text, images, archives. Executables and scripts stay blocked.
// Only PDFs are analysed by the AI worker for now; other formats are stored.
export const DOC_TYPES = [
  "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain", "text/csv", "text/markdown",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip", "application/x-zip-compressed", "application/rtf",
];
const EXT_FALLBACK = /\.(pdf|docx?|xlsx?|pptx?|txt|csv|md|rtf|zip|png|jpe?g|webp|gif)$/i;

export const BUCKET_RULES: Record<Bucket, { maxBytes: number; types: string[] }> = {
  sow: { maxBytes: 25 * 1024 * 1024, types: DOC_TYPES },
  designs: { maxBytes: 10 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"] },
  captures: { maxBytes: 10 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"] },
  documents: { maxBytes: 25 * 1024 * 1024, types: DOC_TYPES },
};

export function validateFile(bucket: Bucket, file: Blob & { name?: string }): string | null {
  const rule = BUCKET_RULES[bucket];
  const wide = bucket === "sow" || bucket === "documents";
  if (!rule.types.includes(file.type) && !(wide && !file.type && EXT_FALLBACK.test(file.name ?? ""))) return `${file.name ?? "File"}: ${file.type || "unknown type"} is not allowed here.`;
  if (file.size > rule.maxBytes) return `${file.name ?? "File"} is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${rule.maxBytes / 1048576} MB.`;
  return null;
}

export function safeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-").replace(/-+/g, "-").slice(-80);
}

export const storageService = {
  async upload(bucket: Bucket, path: string, file: Blob) {
    const problem = validateFile(bucket, file);
    if (problem) throw new Error(problem);
    const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(error.message);
    return path;
  },
  async signedUrl(bucket: Bucket, path: string, expiresIn = 3600) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
  async remove(bucket: Bucket, paths: string[]) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) throw new Error(error.message);
  },
};
