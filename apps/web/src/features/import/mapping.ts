import type { ImportRow } from "@/services/settings";
import { STAGES, STAGE_LABEL, type Stage, type CampaignStatus, type Priority } from "@/lib/labels";

export const TARGET_FIELDS: { key: keyof ImportRow; label: string; required?: boolean; aliases: string[] }[] = [
  { key: "name", label: "Campaign name", required: true, aliases: ["name", "campaign", "campaign name", "title", "project"] },
  { key: "client", label: "Client", aliases: ["client", "brand", "customer", "account"] },
  { key: "description", label: "Description", aliases: ["description", "summary", "brief", "about"] },
  { key: "stage", label: "Stage", aliases: ["stage", "phase", "current stage"] },
  { key: "status", label: "Status", aliases: ["status", "state"] },
  { key: "priority", label: "Priority", aliases: ["priority", "importance"] },
  { key: "start_date", label: "Start date", aliases: ["start", "start date", "kickoff", "created", "dates"] },
  { key: "target_launch_date", label: "Target launch date", aliases: ["launch", "launch date", "target launch", "go live", "go-live", "due", "due date", "deadline", "end date"] },
  { key: "staging_url", label: "Staging URL", aliases: ["staging", "staging url", "uat url", "preview url"] },
  { key: "production_url", label: "Production URL", aliases: ["production", "production url", "live url", "url", "website"] },
  { key: "journeys", label: "Journeys", aliases: ["journeys", "journey", "flows", "schemes"] },
  { key: "notes", label: "Notes", aliases: ["notes", "comments", "remarks"] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Best-guess mapping of CSV headers to Journ campaign fields. Each header is used at most once. */
export function autoMap(headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const f of TARGET_FIELDS) {
    const exact = headers.find((h) => !used.has(h) && f.aliases.includes(norm(h)));
    const loose = exact ?? headers.find((h) => !used.has(h) && f.aliases.some((a) => norm(h).includes(a) && a.length > 3));
    if (loose) { out[f.key] = loose; used.add(loose); }
  }
  return out;
}

export function toStage(v: string): Stage | "" {
  const n = norm(v);
  if (!n) return "";
  const direct = STAGES.find((s) => norm(STAGE_LABEL[s]) === n || s.replace(/_/g, " ") === n);
  if (direct) return direct;
  if (/brief|plan|kick|scop/.test(n)) return "brief_planning";
  if (/design|creative|wire/.test(n)) return "design";
  if (/dev|build/.test(n)) return "development";
  if (/qa|test/.test(n) && !/uat/.test(n)) return "internal_qa";
  if (/uat|client review|approval/.test(n)) return "client_uat";
  if (/deploy|launch|live/.test(n)) return "live_deployment";
  if (/done|complete|closed/.test(n)) return "completed";
  return "";
}

export function toStatus(v: string): CampaignStatus | "" {
  const n = norm(v);
  if (!n) return "";
  if (/hold|pause|block/.test(n)) return "on_hold";
  if (/archiv|cancel/.test(n)) return "archived";
  if (/done|complete|closed|live/.test(n)) return "completed";
  return "active";
}

export function toPriority(v: string): Priority | "" {
  const n = norm(v);
  if (!n) return "";
  if (/crit|urgent|p0/.test(n)) return "critical";
  if (/high|p1/.test(n)) return "high";
  if (/low|p3/.test(n)) return "low";
  return "medium";
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Accepts ISO dates, Notion dates ("November 3, 2026"), ranges ("Nov 1, 2026 → Nov 30, 2026") and dd/mm/yyyy. */
export function toDate(v: string, pick: "start" | "end" = "start"): string {
  if (!v?.trim()) return "";
  const parts = v.split(/→|->| to /).map((s) => s.trim()).filter(Boolean);
  const s = (pick === "end" ? parts[parts.length - 1] : parts[0]) ?? "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`; // day first (India)
  m = s.match(/^([A-Za-z]{3,})\.? (\d{1,2}),? (\d{4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2}) ([A-Za-z]{3,}),? (\d{4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  return "";
}

function cleanUrl(v: string) {
  const s = v.trim();
  if (!s) return "";
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try { return new URL(withScheme).toString(); } catch { return ""; }
}

/** Notion exports relations as "Name (https://www.notion.so/...)"; strip the link. */
function stripNotion(v: string) {
  return v.replace(/\s*\(https?:\/\/www\.notion\.so\/[^)]+\)/g, "").trim();
}

export function mapRow(raw: Record<string, string>, mapping: Record<string, string>): ImportRow {
  const get = (k: keyof ImportRow) => (mapping[k] ? stripNotion(raw[mapping[k]!] ?? "") : "");
  const dateField = mapping.start_date && mapping.start_date === mapping.target_launch_date;
  return {
    name: get("name"),
    client: get("client"),
    description: get("description"),
    stage: toStage(get("stage")),
    status: toStatus(get("status")),
    priority: toPriority(get("priority")),
    start_date: toDate(get("start_date"), "start"),
    target_launch_date: toDate(get("target_launch_date"), dateField ? "end" : "start"),
    staging_url: cleanUrl(get("staging_url")),
    production_url: cleanUrl(get("production_url")),
    journeys: get("journeys").split(/[,;]/).map((s) => s.trim()).filter(Boolean).join("; "),
    notes: get("notes"),
  };
}
