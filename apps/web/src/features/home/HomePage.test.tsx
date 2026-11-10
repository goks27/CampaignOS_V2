import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const svc = vi.hoisted(() => ({ home: vi.fn() }));
vi.mock("@/services/progress", () => ({ progressService: { home: svc.home } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ me: { fullName: "Gokul S" } }) }));
vi.mock("@/features/reports/PortfolioReport", () => ({ PortfolioReport: () => <div>PORTFOLIO</div> }));

import { HomePage } from "./HomePage";

const summary = (over: Record<string, unknown> = {}) => ({
  metrics: { active: 5, at_risk: 1, blocked: 0, findings_awaiting: 7, critical_open: 2, overdue_tasks: 3, launching_soon: 1 },
  attention: [{ campaign_id: "c1", name: "Gold Drop", kind: "at_risk", count: 4 }, { campaign_id: "c2", name: "Diwali", kind: "findings", count: 3 }],
  upcoming: [{ campaign_id: "c1", name: "Gold Drop", target_launch_date: "2026-11-20", health: "at_risk" }], ...over,
});
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><HomePage /></MemoryRouter></QueryClientProvider>);
beforeEach(() => { vi.clearAllMocks(); svc.home.mockResolvedValue(summary()); });

describe("Home", () => {
  it("fills metrics, what needs attention and upcoming launches from one request", async () => {
    show();
    const metrics = await screen.findByTestId("metrics");
    expect(metrics).toHaveTextContent("Active campaigns");
    expect(metrics).toHaveTextContent("Findings to review");
    expect(svc.home).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("attention")).toHaveTextContent("Gold Drop");
    expect(screen.getByTestId("attention")).toHaveTextContent("At risk");
    expect(screen.getByTestId("upcoming")).toHaveTextContent("Gold Drop");
    expect(screen.getByText("PORTFOLIO")).toBeInTheDocument();
  });

  it("sends a campaign with findings to the Inbox, filtered to it, and the others to the campaign", async () => {
    show();
    const list = await screen.findByTestId("attention");
    const hrefs = [...list.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/campaigns/c1", "/inbox?type=findings&campaign=c2"]);
  });

  it("says what goes in each empty list and offers nothing fake", async () => {
    svc.home.mockResolvedValue(summary({ attention: [], upcoming: [] }));
    show();
    expect(await screen.findByTestId("attention-empty")).toHaveTextContent(/blocked, at risk or have findings/);
    expect(screen.getByTestId("upcoming-empty")).toHaveTextContent(/Add a target launch date/);
  });

  it("links to the quick check and the live test, which have no sidebar item", async () => {
    show();
    await screen.findByTestId("metrics");
    expect(screen.getByRole("link", { name: /Quick check/ })).toHaveAttribute("href", "/playground");
    expect(screen.getByRole("link", { name: /Live test/ })).toHaveAttribute("href", "/live-test");
  });
});
