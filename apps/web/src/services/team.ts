import { supabase, must, type Tables } from "./db";
import type { Role } from "@/lib/labels";

export type Profile = Tables<"profiles">;
export type Member = Tables<"workspace_members"> & { profiles: Profile | null };

export const teamService = {
  async members(): Promise<Member[]> {
    return must(await supabase.from("workspace_members").select("*, profiles(*)").order("created_at")) as unknown as Member[];
  },
  async profiles(): Promise<Profile[]> {
    return must(await supabase.from("profiles").select("*").order("full_name"));
  },
  async setRole(userId: string, role: Role) {
    must(await supabase.rpc("set_member_role", { p_user: userId, p_role: role }));
  },
  async setActive(userId: string, active: boolean) {
    must(await supabase.rpc("set_member_active", { p_user: userId, p_active: active }));
  },
  async updateMyName(id: string, fullName: string) {
    must(await supabase.from("profiles").update({ full_name: fullName }).eq("id", id));
  },
};
