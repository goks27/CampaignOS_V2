import * as React from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Role } from "@/lib/labels";

export type Me = {
  id: string;
  email: string;
  fullName: string;
  role: Role | null;
  workspaceId: string | null;
  workspaceName: string | null;
  deactivated: boolean;
};

type AuthCtx = {
  session: Session | null;
  loading: boolean;
  me: Me | null;
  isAdmin: boolean;
  isManager: boolean; // manager or admin
  canEdit: boolean; // same as isManager — campaign-level writes
  isViewer: boolean;
  signOut: () => Promise<void>;
};

const Ctx = React.createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [ready, setReady] = React.useState(false);
  const qc = useQueryClient();

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  const meQuery = useQuery({
    queryKey: ["me", uid],
    enabled: Boolean(uid),
    queryFn: async (): Promise<Me> => {
      const [{ data: profile }, { data: member }] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name").eq("id", uid!).maybeSingle(),
        supabase.from("workspace_members").select("role, workspace_id, deactivated_at, workspaces(name)").eq("user_id", uid!).maybeSingle(),
      ]);
      const ws = member?.workspaces as { name: string } | null | undefined;
      return {
        id: uid!,
        email: profile?.email ?? session?.user.email ?? "",
        fullName: profile?.full_name || session?.user.email || "",
        role: (member?.role as Role | undefined) ?? null,
        workspaceId: member?.workspace_id ?? null,
        workspaceName: ws?.name ?? null,
        deactivated: Boolean(member?.deactivated_at),
      };
    },
  });

  const value = React.useMemo<AuthCtx>(() => {
    const me = meQuery.data ?? null;
    const role = me?.deactivated ? null : me?.role ?? null;
    return {
      session,
      loading: !ready || (Boolean(uid) && meQuery.isLoading),
      me,
      isAdmin: role === "admin",
      isManager: role === "admin" || role === "manager",
      canEdit: role === "admin" || role === "manager",
      isViewer: role === "viewer",
      signOut: async () => {
        await supabase.auth.signOut();
        qc.clear();
      },
    };
  }, [session, ready, uid, meQuery.data, meQuery.isLoading, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
