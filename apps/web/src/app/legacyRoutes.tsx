import { Navigate, Route, useLocation } from "react-router-dom";

/** Sends an old address to its new home and keeps what was in the query (a task id, a campaign filter) and the hash. */
export function Redirect({ to, add }: { to: string; add?: Record<string, string> }) {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  for (const [k, v] of Object.entries(add ?? {})) params.set(k, v);
  const q = params.toString();
  return <Navigate to={`${to}${q ? `?${q}` : ""}${hash}`} replace />;
}

/** Every address from before the simplification, and where it lands now. Nothing is a dead link. */
export const legacyRoutes = (
  <>
    <Route path="campaigns" element={<Navigate to="/projects" replace />} />
    <Route path="tasks" element={<Redirect to="/inbox" add={{ type: "tasks" }} />} />
    <Route path="reviews" element={<Redirect to="/inbox" add={{ type: "findings" }} />} />
    <Route path="timeline" element={<Navigate to="/home#upcoming" replace />} />
    <Route path="reports" element={<Navigate to="/home#portfolio" replace />} />
    <Route path="team" element={<Navigate to="/settings?tab=team" replace />} />
    <Route path="live" element={<Navigate to="/live-test" replace />} />
  </>
);
