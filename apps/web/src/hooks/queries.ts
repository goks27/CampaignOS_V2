import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { campaignsService } from "@/services/campaigns";
import { teamService, type Profile } from "@/services/team";
import { jobsService } from "@/services/jobs";
import { connectorService } from "@/services/connector";
import { notificationsService } from "@/services/activity";
import { settingsService } from "@/services/settings";
import { useAuth } from "@/lib/auth";

export const qk = {
  campaigns: ["campaigns"] as const,
  campaign: (id: string) => ["campaign", id] as const,
  profiles: ["profiles"] as const,
  members: ["members"] as const,
  tasks: (scope: string) => ["tasks", scope] as const,
  activity: (scope: string) => ["activity", scope] as const,
  summary: ["summary"] as const,
  worker: ["worker"] as const,
  connector: ["connector"] as const,
  jobs: (scope: string) => ["jobs", scope] as const,
  findings: (scope: string) => ["findings", scope] as const,
  requirements: (id: string) => ["requirements", id] as const,
  checks: (id: string) => ["checks", id] as const,
  sow: (id: string) => ["sow", id] as const,
  designs: (id: string) => ["designs", id] as const,
  dev: (id: string) => ["dev", id] as const,
  delivery: (kind: string, id: string) => ["delivery", kind, id] as const,
  settings: ["settings"] as const,
  notifications: ["notifications"] as const,
  clients: ["clients"] as const,
};

export function useCampaigns() {
  return useQuery({ queryKey: qk.campaigns, queryFn: campaignsService.list });
}

export function useCampaign(id: string | undefined) {
  return useQuery({ queryKey: qk.campaign(id ?? ""), queryFn: () => campaignsService.get(id!), enabled: Boolean(id) });
}

export function useProfiles() {
  const q = useQuery({ queryKey: qk.profiles, queryFn: teamService.profiles, staleTime: 5 * 60_000 });
  const map = React.useMemo(() => new Map<string, Profile>((q.data ?? []).map((p) => [p.id, p])), [q.data]);
  return { ...q, map, name: (id?: string | null) => (id ? map.get(id)?.full_name || map.get(id)?.email || "Unknown" : "—") };
}

/** Members with a human role, for owner/assignee pickers. */
export function usePeople() {
  const q = useQuery({ queryKey: qk.members, queryFn: teamService.members, staleTime: 60_000 });
  const people = React.useMemo(
    () => (q.data ?? []).filter((m) => m.role !== "worker" && !m.deactivated_at && m.profiles)
      .map((m) => ({ id: m.user_id, name: m.profiles!.full_name || m.profiles!.email, role: m.role })),
    [q.data]);
  return { ...q, people };
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: settingsService.get, staleTime: 60_000 });
}

/**
 * One app-wide Realtime subscription. Mounted once in the shell; hooks below only read the cache.
 * (Creating the same channel from several components crashes supabase-js.)
 */
export function useRealtimeBridge() {
  const qc = useQueryClient();
  const { me } = useAuth();
  React.useEffect(() => {
    if (!me) return;
    const ch = supabase.channel(`app-${me.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_status" }, () => qc.invalidateQueries({ queryKey: qk.worker }))
      .on("postgres_changes", { event: "*", schema: "public", table: "review_jobs" }, () => {
        void qc.invalidateQueries({ queryKey: qk.worker });
        void qc.invalidateQueries({ queryKey: ["jobs"] });
        void qc.invalidateQueries({ queryKey: ["sow"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${me.id}` }, () => {
        void qc.invalidateQueries({ queryKey: qk.notifications });
        void qc.invalidateQueries({ queryKey: ["findings"] });
        void qc.invalidateQueries({ queryKey: ["requirements"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc, me]);
}

/** Worker status; re-checked every 30 s so "offline" appears even without a new heartbeat. */
export function useWorkerState() {
  const { session } = useAuth();
  return useQuery({ queryKey: qk.worker, queryFn: jobsService.workerState, refetchInterval: 30_000, enabled: Boolean(session) });
}

/** Is the Claude connector (`npm run claude`) running on this PC? Null data means not reachable. */
export function useConnectorStatus() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.connector, queryFn: connectorService.status, enabled: Boolean(session),
    refetchInterval: (q) => (q.state.data?.busy ? 4_000 : 10_000), retry: false,
  });
}

export function useNotifications() {
  const { me } = useAuth();
  return useQuery({ queryKey: qk.notifications, queryFn: notificationsService.list, enabled: Boolean(me), refetchInterval: 60_000 });
}
