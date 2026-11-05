/** Brand assets that come with a SOW: what kind a file is, its content type, and which kinds a picture can be shown for. Pure, so it is easy to test. */
export const BRAND_KINDS = ["logo", "icon", "brand_guide", "font", "imagery", "other"] as const;
export type BrandKind = (typeof BRAND_KINDS)[number];
export const BRAND_KIND_LABEL: Record<BrandKind, string> = { logo: "Logo", icon: "Icon", brand_guide: "Brand guide", font: "Font", imagery: "Imagery", other: "Other" };

const EXT_MIME: Record<string, string> = {
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", ico: "image/x-icon",
  pdf: "application/pdf", zip: "application/zip", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", eot: "application/vnd.ms-fontobject",
  ai: "application/vnd.adobe.illustrator", eps: "application/postscript",
};
export const BRAND_EXTENSIONS = Object.keys(EXT_MIME);
export const BRAND_ACCEPT = BRAND_EXTENSIONS.map((e) => `.${e}`).join(",");

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");

/** Browsers often report fonts and vector files with no type or a generic one, so the extension decides. */
export function brandMime(file: { name?: string; type?: string }): string | null {
  const byExt = EXT_MIME[ext(file.name ?? "")];
  if (byExt) return byExt;
  return file.type && Object.values(EXT_MIME).includes(file.type) ? file.type : null;
}

/** A sensible first label; the person can change it. */
export function guessBrandKind(file: { name?: string; type?: string }): BrandKind {
  const name = (file.name ?? "").toLowerCase(), mime = brandMime(file), e = ext(name);
  if (mime?.startsWith("font/") || e === "eot") return "font";
  if (/logo|wordmark|brandmark|logotype/.test(name)) return "logo";
  if (/icon|favicon/.test(name) || e === "ico") return "icon";
  if (mime === "application/pdf" || /guideline|brand[-_ ]?guide|style[-_ ]?guide|brandbook/.test(name)) return "brand_guide";
  if (mime?.startsWith("image/")) return "imagery";
  return "other";
}

/** Pictures can be shown as a thumbnail. SVG is shown through <img> only, where its scripts cannot run. */
export const isPicture = (mime: string | null | undefined) => Boolean(mime && /^image\/(svg\+xml|png|jpeg|webp|gif|x-icon)$/.test(mime));
