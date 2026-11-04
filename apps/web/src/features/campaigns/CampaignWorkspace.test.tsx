import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/queries", () => ({ useCampaign: () => ({ data: { id: "c1", name: "Gold Drop" }, isLoading: false, error: null, refetch: vi.fn() }) }));
vi.mock("@/features/canvas/CanvasHome", () => ({ CampaignCanvas: () => <div>CANVAS</div> }));
vi.mock("./tabs/RequirementsTab", () => ({ RequirementsTab: () => <div>REQUIREMENTS</div> }));
vi.mock("./tabs/DesignsTab", () => ({ DesignsTab: () => <div>DESIGNS</div> }));
vi.mock("./tabs/DevelopmentTab", () => ({ DevelopmentTab: ({ part }: { part: string }) => <div>DEVELOPMENT-{part}</div> }));
vi.mock("./tabs/AiReviewsTab", () => ({ AiReviewsTab: () => <div>AIREVIEWS</div> }));
vi.mock("./tabs/ApprovalsTab", () => ({ ApprovalsTab: () => <div>APPROVALS</div> }));
vi.mock("./tabs/DocumentsTab", () => ({ DocumentsTab: () => <div>DOCUMENTS</div> }));
vi.mock("./tabs/CampaignTasksTab", () => ({ CampaignTasksTab: () => <div>ISSUES</div> }));
vi.mock("./tabs/ActivityTab", () => ({ ActivityTab: () => <div>ACTIVITY</div> }));

import { CampaignWorkspace } from "./CampaignWorkspace";

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }
const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path="campaigns/:id" element={<CampaignWorkspace />} /><Route path="campaigns/:id/:tab" element={<CampaignWorkspace />} /></Routes>
    <Where />
  </MemoryRouter>,
);

describe("CampaignWorkspace", () => {
  it("opens on the canvas, with all eight sections one click away and the current one marked", () => {
    at("/campaigns/c1");
    expect(screen.getByText("CANVAS")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Campaign sections" });
    expect(nav.querySelectorAll("a")).toHaveLength(8);
    expect(nav.querySelector("[aria-current=page]")?.textContent).toBe("Canvas");
  });

  it("shows each section's content", () => {
    at("/campaigns/c1/requirements");
    expect(screen.getByText("REQUIREMENTS")).toBeInTheDocument();
    expect(screen.getByText("DOCUMENTS")).toBeInTheDocument(); // documents now live under Requirements
  });

  it("splits development into the build and the testing views", () => {
    const { unmount } = at("/campaigns/c1/development");
    expect(screen.getByText("DEVELOPMENT-build")).toBeInTheDocument();
    unmount();
    at("/campaigns/c1/testing");
    expect(screen.getByText("DEVELOPMENT-testing")).toBeInTheDocument();
  });

  it.each([
    ["/campaigns/c1/overview", "/campaigns/c1"], ["/campaigns/c1/journeys", "/campaigns/c1"], ["/campaigns/c1/ai-reviews", "/campaigns/c1/review"],
    ["/campaigns/c1/approvals", "/campaigns/c1/review"], ["/campaigns/c1/documents", "/campaigns/c1/requirements"], ["/campaigns/c1/tasks", "/campaigns/c1/issues"],
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
