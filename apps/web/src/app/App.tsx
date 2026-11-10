import * as React from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ToastProvider } from "@/components/toast";
import { supabaseConfigured } from "@/lib/supabase";
import { Spinner } from "@/components/ui";
import { LoadingRows } from "@/components/common";
import { AppShell } from "./AppShell";
import { LoginPage, AuthCallbackPage, ForgotPasswordPage, NoAccessPage, SetupNeededPage } from "@/features/auth/AuthPages";
import { NotFoundPage } from "./NotFoundPage";
import { legacyRoutes } from "./legacyRoutes";

// Every route loads when it is first opened, so the first screen downloads only what it needs.
const lazyPage = <T extends Record<string, React.ComponentType<never>>>(load: () => Promise<T>, name: keyof T) => React.lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType })));
const HomePage = lazyPage(() => import("@/features/home/HomePage"), "HomePage");
const InboxPage = lazyPage(() => import("@/features/inbox/InboxPage"), "InboxPage");
const CampaignsPage = lazyPage(() => import("@/features/campaigns/CampaignsPage"), "CampaignsPage");
const CampaignWorkspace = lazyPage(() => import("@/features/campaigns/CampaignWorkspace"), "CampaignWorkspace");
const SettingsPage = lazyPage(() => import("@/features/settings/SettingsPage"), "SettingsPage");
const PlaygroundPage = lazyPage(() => import("@/features/playground/PlaygroundPage"), "PlaygroundPage");
const LiveTestPage = lazyPage(() => import("@/features/livetest/LiveTestPage"), "LiveTestPage");

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: true } },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading, me } = useAuth();
  const loc = useLocation();
  if (loading) {
    return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  }
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!me?.role || me.deactivated || me.role === "worker") return <NoAccessPage />;
  return <>{children}</>;
}

export function App() {
  if (!supabaseConfigured) return <SetupNeededPage />;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <React.Suspense fallback={<div className="p-6"><LoadingRows rows={6} /></div>}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                <Route index element={<Navigate to="/home" replace />} />
                <Route path="home" element={<HomePage />} />
                <Route path="projects" element={<CampaignsPage />} />
                <Route path="inbox" element={<InboxPage />} />
                <Route path="campaigns/:id" element={<CampaignWorkspace />} />
                <Route path="campaigns/:id/:tab" element={<CampaignWorkspace />} />
                <Route path="playground" element={<PlaygroundPage />} />
                <Route path="live-test" element={<LiveTestPage />} />
                <Route path="settings" element={<SettingsPage />} />
                {legacyRoutes}
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
            </React.Suspense>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
