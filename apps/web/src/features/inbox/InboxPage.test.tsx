import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const svc = vi.hoisted(() => ({
  manager: { v: true },
  review: { data: [] as unknown[], isLoading: false },
  tasks: vi.fn(), feedback: vi.fn(), clarify: vi.fn(), runs: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ me: { id: "me" }, isManager: svc.manager.v }) }));
vi.mock("./useInbox", () => ({ useAwaitingReview: () => svc.review }));
vi.mock("@/services/tasks", () => ({ tasksService: { list: svc.tasks } }));
vi.mock("@/services/delivery", () => ({ deliveryService: { openFeedback: svc.feedback } }));
vi.mock("@/services/requirements", () => ({ requirementsService: { needingClarification: svc.clarify } }));
vi.mock("@/services/connector", () => ({ liveTestService: { runs: svc.runs } }));
vi.mock("@/app/Notifications", () => ({ useNotificationActions: () => ({ data: [], unread: [], markAll: vi.fn(), open: vi.fn() }) }));
vi.mock("@/features/reviews/ReviewsPage", () => ({ ReviewsPage: () => <div>FINDINGS-REVIEW</div> }));
vi.mock("@/features/tasks/TasksPage", () => ({ TasksPage: () => <div>TASKS-LIST-AND-BOARD</div> }));

import { InboxPage } from "./InboxPage";

const show = (path = "/inbox") => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><InboxPage /></MemoryRouter></QueryClientProvider>);
beforeEach(() => {
  vi.clearAllMocks();
  svc.manager.v = true;
  svc.review = { data: [{ id: "f1", review_type: "sow_vs_design", ref: "F-1", title: "Button is cut off", campaign_id: "c1", campaigns: { name: "Gold Drop" }, severity: "high", status: "awaiting_review", created_at: "2026-11-06T10:00:00Z" }, { id: "f2", review_type: "site_check", ref: "F-2", title: "Wrong font", campaign_id: "c2", campaigns: { name: "Diwali" }, severity: "low", status: "awaiting_review", created_at: "2026-11-05T10:00:00Z" }], isLoading: false };
  svc.tasks.mockResolvedValue([{ id: "t1", title: "Fix the OTP field", campaign_id: "c1", campaigns: { name: "Gold Drop" }, assignee_id: "me", status: "todo", due_date: null, created_at: "2026-11-06T09:00:00Z", updated_at: "2026-11-06T11:00:00Z" }]);
  svc.feedback.mockResolvedValue([{ id: "b1", campaign_id: "c1", summary: "Logo is too small", channel: "email", created_at: "2026-11-06T12:00:00Z", campaigns: { name: "Gold Drop" } }]);
  svc.clarify.mockResolvedValue([]);
  svc.runs.mockResolvedValue([]);
});

describe("the one Inbox", () => {
  it("lists everything waiting on you in one list, newest first", async () => {
    show();
    const list = await screen.findByTestId("inbox-list");
    expect([...list.querySelectorAll("a")].map((a) => a.getAttribute("data-kind"))).toEqual(["feedback", "tasks", "findings", "findings"]);
  });

  it("filters by type, with a count on each", async () => {
    show();
    await screen.findByTestId("inbox-list");
    expect(screen.getByTestId("type-findings")).toHaveTextContent("2");
    fireEvent.click(screen.getByTestId("type-feedback"));
    const list = await screen.findByTestId("inbox-list");
    expect(list.querySelectorAll("a")).toHaveLength(1);
    expect(list).toHaveTextContent("Logo is too small");
  });

  it("labels each finding as an AI suggestion or something observed, so an AI guess is never shown as confirmed", async () => {
    show();
    const list = await screen.findByTestId("inbox-list");
    expect([...list.querySelectorAll("[data-testid=evidence]")].map((e) => e.textContent)).toEqual(["AI SUGGESTION", "OBSERVED"]);
  });

  it("filters by campaign", async () => {
    show();
    await screen.findByTestId("inbox-list");
    fireEvent.change(screen.getByLabelText("Campaign"), { target: { value: "c2" } });
    const list = await screen.findByTestId("inbox-list");
    expect(list.querySelectorAll("a")).toHaveLength(1);
    expect(list).toHaveTextContent("Wrong font");
  });

  it("opens the three-column findings review under the Findings type, and tasks keep their list and board", () => {
    const a = show("/inbox?type=findings");
    expect(screen.getByText("FINDINGS-REVIEW")).toBeInTheDocument();
    a.unmount();
    show("/inbox?type=tasks");
    expect(screen.getByText("TASKS-LIST-AND-BOARD")).toBeInTheDocument();
  });

  it("shows a team member only what is theirs: no findings, feedback or questions", async () => {
    svc.manager.v = false;
    show();
    const list = await screen.findByTestId("inbox-list");
    expect([...list.querySelectorAll("a")].map((a) => a.getAttribute("data-kind"))).toEqual(["tasks"]);
    expect(screen.queryByTestId("type-findings")).toBeNull();
    expect(screen.queryByTestId("type-feedback")).toBeNull();
  });

  it("says what goes here when nothing is waiting", async () => {
    svc.review = { data: [], isLoading: false }; svc.tasks.mockResolvedValue([]); svc.feedback.mockResolvedValue([]);
    show();
    expect(await screen.findByTestId("inbox-empty")).toHaveTextContent(/Nothing is waiting on you/);
  });
});
