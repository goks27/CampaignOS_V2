import * as React from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ToastProvider } from "@/components/toast";
import { supabaseConfigured } from "@/lib/supabase";
import { Spinner } from "@/components/ui";
import { AppShell } from "./AppShell";
import { LoginPage, AuthCallbackPage, ForgotPasswordPage, NoAccessPage, SetupNeededPage } from "@/features/auth/AuthPages";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { CampaignsPage } from "@/features/campaigns/CampaignsPage";
import { CampaignWorkspace } from "@/features/campaigns/CampaignWorkspace";
import { TasksPage } from "@/features/tasks/TasksPage";
import { ReviewsPage } from "@/features/reviews/ReviewsPage";
import { TeamPage } from "@/features/team/TeamPage";
import { TimelinePage } from "@/features/timeline/TimelinePage";
import { ReportsPage } from "@/features/reports/ReportsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { PlaygroundPage } from "@/features/playground/PlaygroundPage";
import { ImportPage } from "@/features/import/ImportPage";
import { NotFoundPage } from "./NotFoundPage";

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
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                <Route index element={<DashboardPage />} />
                <Route path="campaigns" element={<CampaignsPage />} />
                <Route path="campaigns/:id" element={<CampaignWorkspace />} />
                <Route path="campaigns/:id/:tab" element={<CampaignWorkspace />} />
                <Route path="tasks" element={<TasksPage />} />
                <Route path="reviews" element={<ReviewsPage />} />
                <Route path="team" element={<TeamPage />} />
                <Route path="timeline" element={<TimelinePage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="playground" element={<PlaygroundPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="import" element={<ImportPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
