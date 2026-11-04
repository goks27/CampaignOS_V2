import type { PostgrestError } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
export { supabase } from "@/lib/supabase";

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Insert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type Update<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];

/** Throws Supabase errors so TanStack Query surfaces them; returns data otherwise. */
export function must<R extends { data: unknown; error: PostgrestError | null }>(res: R): NonNullable<R["data"]> {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<R["data"]>;
}

/** For maybeSingle(): returns null when no row matched. */
export function mustMaybe<T>(res: { data: T | null; error: PostgrestError | null }): T | null {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}
