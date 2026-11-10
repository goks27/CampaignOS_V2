import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

const svc = vi.hoisted(() => ({ progress: vi.fn() }));
vi.mock("@/hooks/queries", () => ({ useCampaign: () => ({ data: { id: "c1", name: "Gold Drop" }, isLoading: false, error: null, refetch: vi.fn() }) }));
vi.mock("@/services/progress", () => ({ progressService: { campaign: svc.progress } }));
vi.mock("@/features/canvas/CanvasHome", () => ({ CampaignCanvas: () => <div>CANVAS</div> }));
vi.mock("@/features/health/HealthCheck", () => ({ HealthCheck: () => <div>HEALTH-CHECK</div> }));
vi.mock("@/features/rules/RulesLab", () => ({ RulesLab: () => <div>RULES-LAB</div> }));
vi.mock("@/features/shared/JobsTable", () => ({ JobsTable: () => <div>JOBS</div> }));
vi.mock("./tabs/RequirementsTab", () => ({ RequirementsTab: () => <div>REQUIREMENTS</div> }));
vi.mock("./tabs/DesignsTab", () => ({ DesignsTab: () => <div>DESIGNS</div> }));
vi.mock("./tabs/DevelopmentTab", () => ({ DevelopmentTab: () => <div>BUILD-AND-TEST</div> }));
vi.mock("./tabs/ApprovalsTab", () => ({ ApprovalsTab: () => <div>APPROVALS</div> }));
vi.mock("./tabs/DocumentsTab", () => ({ DocumentsTab: () => <div>DOCUMENTS</div> }));
vi.mock("./tabs/CampaignTasksTab", () => ({ CampaignTasksTab: () => <div>TASKS-PANEL</div> }));
vi.mock("./tabs/ActivityTab", () => ({ ActivityTab: () => <div>ACTIVITY-PANEL</div> }));

import { CampaignWorkspace } from "./CampaignWorkspace";

const progress = (over: Record<string, unknown> = {}) => ({
  steps: [{ id: "brief", state: "done", open: 0 }, { id: "requirements", state: "current", open: 12 }, { id: "design", state: "not_started", open: 0 }, { id: "build", state: "not_started", open: 0 }, { id: "launch", state: "not_started", open: 0 }],
  next: { key: "verify_requirements", step: "requirements", count: 12 }, counts: {}, ...over,
});

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }
const at = (path: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="campaigns/:id" element={<CampaignWorkspace />} /><Route path="campaigns/:id/:tab" element={<CampaignWorkspace />} /></Routes>
      <Where />
    </MemoryRouter>
  </QueryClientProvider>,
);
beforeEach(() => { vi.clearAllMocks(); svc.progress.mockResolvedValue(progress()); });

describe("CampaignWorkspace as a five-step journey", () => {
  it("opens on the brief (the canvas) with the five steps in order and the current one marked", async () => {
    at("/campaigns/c1");
    expect(screen.getByText("CANVAS")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Campaign steps" });
    expect([...nav.querySelectorAll("a")].map((a) => a.textContent?.replace(/\d+$/, "").replace(/^\d/, ""))).toEqual(["Brief", "Requirements", "Design", "Build & test", "Launch"]);
    expect(nav.querySelector("[aria-current=step]")?.textContent).toContain("Brief");
  });

  it("marks each step done, in progress or not started, and counts what is open in it", async () => {
    at("/campaigns/c1");
    const nav = screen.getByRole("navigation", { name: "Campaign steps" });
    await screen.findByLabelText("12 open");
    const states = [...nav.querySelectorAll("a")].map((a) => a.getAttribute("data-state"));
    expect(states).toEqual(["done", "current", "not_started", "not_started", "not_started"]);
  });

  it("shows the one next thing to do, computed from the data, with one button", async () => {
    at("/campaigns/c1");
    expect(await screen.findByText("Verify 12 draft requirements")).toBeInTheDocument();
    const card = screen.getByTestId("next-step");
    expect(card.querySelectorAll("a")).toHaveLength(1);
    expect(card.querySelector("a")?.getAttribute("href")).toBe("/campaigns/c1/requirements");
  });

  it("says plainly when nothing is waiting", async () => {
    svc.progress.mockResolvedValue(progress({ next: null }));
    at("/campaigns/c1");
    expect(await screen.findByText(/Nothing is waiting/)).toBeInTheDocument();
  });

  it("each step shows its content: requirements with documents, design, build and test with its review jobs, launch", () => {
    const { unmount } = at("/campaigns/c1/requirements");
    expect(screen.getByText("REQUIREMENTS")).toBeInTheDocument();
    expect(screen.getByText("DOCUMENTS")).toBeInTheDocument();
    unmount();
    const b = at("/campaigns/c1/design"); expect(screen.getByText("DESIGNS")).toBeInTheDocument(); b.unmount();
    const c = at("/campaigns/c1/build"); expect(screen.getByText("BUILD-AND-TEST")).toBeInTheDocument(); expect(screen.getByText("RULES-LAB")).toBeInTheDocument(); expect(screen.getByText("JOBS")).toBeInTheDocument(); c.unmount();
    at("/campaigns/c1/launch"); expect(screen.getByText("APPROVALS")).toBeInTheDocument(); expect(screen.getByText("HEALTH-CHECK")).toBeInTheDocument();
  });

  it("keeps Tasks and Activity in a side panel that opens and closes from any step", () => {
    at("/campaigns/c1/design");
    expect(screen.queryByTestId("side-panel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Tasks/ }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("TASKS-PANEL");
    expect(screen.getByText("DESIGNS")).toBeInTheDocument(); // the step stays visible beside it
    fireEvent.click(screen.getByRole("button", { name: /Activity/ }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("ACTIVITY-PANEL");
    fireEvent.click(screen.getByRole("button", { name: "Close the side panel" }));
    expect(screen.queryByTestId("side-panel")).toBeNull();
  });

  it.each([
    ["/campaigns/c1/overview", "/campaigns/c1"], ["/campaigns/c1/journeys", "/campaigns/c1"], ["/campaigns/c1/canvas", "/campaigns/c1"],
    ["/campaigns/c1/designs", "/campaigns/c1/design"], ["/campaigns/c1/documents", "/campaigns/c1/requirements"],
    ["/campaigns/c1/development", "/campaigns/c1/build"], ["/campaigns/c1/testing", "/campaigns/c1/build"], ["/campaigns/c1/ai-reviews", "/campaigns/c1/build"],
    ["/campaigns/c1/approvals", "/campaigns/c1/launch"], ["/campaigns/c1/review", "/campaigns/c1/launch"],
    ["/campaigns/c1/tasks", "/campaigns/c1?side=tasks"], ["/campaigns/c1/issues", "/campaigns/c1?side=tasks"], ["/campaigns/c1/activity", "/campaigns/c1?side=activity"],
    ["/campaigns/c1/nonsense", "/campaigns/c1"],
  ])("old address %s still works and lands on %s", (from, to) => {
    at(from);
    expect(screen.getByTestId("where").textContent).toBe(to);
  });

  it("keeps the chosen journey when an old address is redirected", () => {
    at("/campaigns/c1/overview?j=j2");
    expect(screen.getByTestId("where").textContent).toBe("/campaigns/c1?j=j2");
  });
});
