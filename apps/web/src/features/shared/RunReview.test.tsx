import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const svc = vi.hoisted(() => ({ review: vi.fn(), wake: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/services/progress", () => ({ progressService: { review: svc.review } }));
vi.mock("@/services/jobs", () => ({ jobsService: { enqueue: vi.fn() } }));
vi.mock("@/services/connector", () => ({ connectorService: { wake: svc.wake } }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ success: svc.success, error: svc.error }), friendly: (e: unknown) => String(e) }));
vi.mock("@/hooks/queries", () => ({ qk: { connector: ["connector"] }, useWorkerState: () => ({ data: { state: "online" } }) }));

import { ReviewActionButton } from "./RunReview";

const show = (action: "check_sow" | "review_designs" | "test_build" = "review_designs") => render(<QueryClientProvider client={new QueryClient()}><ReviewActionButton campaignId="c1" action={action} source={{ design_submission_id: "s1" }} /></QueryClientProvider>);
beforeEach(() => { vi.clearAllMocks(); svc.wake.mockResolvedValue(true); });

describe("the three review actions", () => {
  it("are named for what the person wants: Check SOW, Review designs, Test build", () => {
    for (const [a, label] of [["check_sow", "Check SOW"], ["review_designs", "Review designs"], ["test_build", "Test build"]] as const) {
      const { unmount } = show(a);
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
      unmount();
    }
  });

  it("queues every check that applies in one call, wakes the connector and names what started", async () => {
    svc.review.mockResolvedValue([{ type: "sow_vs_design", status: "queued", job_id: "j1" }, { type: "design_consistency", status: "queued", job_id: "j2" }]);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Review designs" }));
    await waitFor(() => expect(svc.success).toHaveBeenCalled());
    expect(svc.review).toHaveBeenCalledWith("c1", "review_designs", { design_submission_id: "s1" }, false);
    expect(svc.wake).toHaveBeenCalled();
    expect(svc.success.mock.calls[0]![0]).toMatch(/SOW vs design, design consistency started/);
  });

  it("says why a check was skipped instead of failing silently", async () => {
    svc.review.mockResolvedValue([{ type: "sow_vs_design", status: "skipped", reason: "Accept some requirements first." }, { type: "design_consistency", status: "queued", job_id: "j2" }]);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Review designs" }));
    await waitFor(() => expect(svc.success).toHaveBeenCalled());
    expect(svc.success.mock.calls[0]![0]).toMatch(/Skipped: SOW vs design: Accept some requirements first\./);
  });

  it("when nothing could run, says so and why (an error, not a success)", async () => {
    svc.review.mockResolvedValue([{ type: "functional_qa", status: "skipped", reason: "No test scenarios yet." }]);
    show("test_build");
    fireEvent.click(screen.getByRole("button", { name: "Test build" }));
    await waitFor(() => expect(svc.error).toHaveBeenCalled());
    expect(svc.error.mock.calls[0]![0]).toMatch(/nothing to run yet.*No test scenarios yet\./);
    expect(svc.success).not.toHaveBeenCalled();
    expect(svc.wake).not.toHaveBeenCalled();
  });

  it("asks before running identical content again, and runs it again when you agree", async () => {
    svc.review.mockResolvedValueOnce([{ type: "sow_vs_design", status: "skipped", reason: "This exact content was already checked." }])
      .mockResolvedValueOnce([{ type: "sow_vs_design", status: "queued", job_id: "j9" }]);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Review designs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Run again" }));
    await waitFor(() => expect(svc.review).toHaveBeenCalledTimes(2));
    expect(svc.review.mock.calls[1]![3]).toBe(true);
  });

  it("says the connector is not running when it cannot be reached, and that the check is queued", async () => {
    svc.wake.mockResolvedValue(false);
    svc.review.mockResolvedValue([{ type: "sow_analysis", status: "queued", job_id: "j1" }]);
    show("check_sow");
    fireEvent.click(screen.getByRole("button", { name: "Check SOW" }));
    await waitFor(() => expect(svc.success).toHaveBeenCalled());
    expect(svc.success.mock.calls[0]![0]).toMatch(/queued\. The Claude connector is not running/);
  });
});
