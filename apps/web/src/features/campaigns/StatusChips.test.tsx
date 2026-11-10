import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/toast";

const svc = vi.hoisted(() => ({ update: vi.fn(), canEdit: { v: true } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ canEdit: svc.canEdit.v }) }));
vi.mock("@/services/campaigns", () => ({ campaignsService: { update: svc.update } }));

import { StatusChips } from "./StatusChips";

const c = { id: "c1", health: "on_track", design_status: "in_review", development_status: "not_started", qa_status: "not_started", uat_status: "not_started" } as never;
const show = () => render(<QueryClientProvider client={new QueryClient()}><ToastProvider><StatusChips c={c} /></ToastProvider></QueryClientProvider>);
beforeEach(() => { vi.clearAllMocks(); svc.canEdit.v = true; svc.update.mockResolvedValue({}); });

describe("the status chips in the campaign header", () => {
  it("show health and the four delivery statuses as they are set", () => {
    show();
    const chips = screen.getByTestId("status-chips");
    for (const t of ["Health", "Design", "Development", "QA", "UAT"]) expect(chips).toHaveTextContent(t);
    expect(screen.getByRole("button", { name: /^Design: In review/ })).toBeInTheDocument();
  });

  it("change a status with one click on the chip and one on the new value", async () => {
    show();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Development: Not started/ }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /In progress/ }));
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith("c1", { development_status: "in_progress" }));
  });

  it("stay manual and read-only for a person who cannot edit", () => {
    svc.canEdit.v = false;
    show();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByTestId("status-chips")).toHaveTextContent("In review");
  });
});
