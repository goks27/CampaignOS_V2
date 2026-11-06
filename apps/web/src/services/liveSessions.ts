import { supabase, must, type Tables } from "./db";
import type { BrowserEvent } from "./connector";

export type SavedSession = Tables<"live_test_sessions">;
/** What is kept of a problem. Screenshots are not stored: they stay on the PC that ran the preview until the connector restarts. */
export type SavedEvent = Pick<BrowserEvent, "id" | "at" | "page" | "url" | "category" | "severity" | "message" | "status" | "method" | "evidence"> & { reviewed: boolean };

const MAX_EVENTS = 300;
const clip = (s: string | undefined, n: number) => (s ? s.slice(0, n) : undefined);

/** The record of a Live test preview that someone chose to keep, for the campaign. RLS decides who can save and delete. */
export const liveSessionsService = {
  async list(campaignId: string): Promise<SavedSession[]> {
    return must(await supabase.from("live_test_sessions").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(30));
  },
  async save(input: { campaignId: string; buildLabel?: string; url: string; device: string; sessionRef?: string; startedAt: number; events: BrowserEvent[]; reviewed: Set<number>; counts: Record<string, number>; notes?: string }) {
    const kept: SavedEvent[] = input.events.filter((e) => e.category !== "capture").slice(-MAX_EVENTS).map((e) => ({
      id: e.id, at: e.at, page: clip(e.page, 500) ?? "", url: clip(e.url, 500) ?? "", category: e.category, severity: e.severity, message: clip(e.message, 600) ?? "", status: e.status, method: e.method, evidence: clip(e.evidence, 500), reviewed: input.reviewed.has(e.id),
    }));
    return must(await supabase.from("live_test_sessions").insert({
      campaign_id: input.campaignId, build_label: input.buildLabel?.slice(0, 200) ?? null, url: input.url.slice(0, 2000), device: input.device.slice(0, 40), session_ref: input.sessionRef?.slice(0, 80) ?? null,
      started_at: new Date(input.startedAt).toISOString(), events: kept as never, counts: input.counts as never, notes: input.notes?.slice(0, 4000) ?? null,
    }).select().single());
  },
  async remove(id: string) { must(await supabase.from("live_test_sessions").delete().eq("id", id)); },
};
