import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Rail } from "./Rail";

let waiting = 0;
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ me: { id: "u1", fullName: "Gokul S", role: "manager", workspaceName: "Octech" }, signOut: vi.fn(), isManager: true }) }));
vi.mock("@/hooks/queries", () => ({ useCampaigns: () => ({ data: [{ id: "c1", name: "Gold Drop", status: "active" }] }) }));
vi.mock("@/features/inbox/useInbox", () => ({ useInboxCount: () => waiting }));

const show = () => render(<MemoryRouter><Rail onSearch={() => undefined} collapsed={false} onToggle={() => undefined} recent={[]} /></MemoryRouter>);
beforeEach(() => { waiting = 0; });

describe("the sidebar", () => {
  it("keeps Projects as the main item, with Playground and Live test, and no Home, Tasks or Inbox", () => {
    show();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Projects", "Playground", "Live test"]);
    expect(screen.queryByText("Home")).toBeNull();
    expect(screen.queryByText("Tasks")).toBeNull();
    expect(screen.queryByText("My Inbox")).toBeNull();
  });

  it("the logo opens Projects", () => {
    show();
    expect(screen.getByRole("link", { name: /go to projects/i })).toHaveAttribute("href", "/projects");
  });

  it("lists the campaigns underneath", () => {
    show();
    expect(screen.getByText("Gold Drop")).toBeInTheDocument();
  });

  it("shows a dot on the avatar only when something is waiting in the inbox", () => {
    show();
    expect(screen.queryByTestId("inbox-dot")).toBeNull();
  });

  it("the dot says how many are waiting", () => {
    waiting = 3;
    show();
    expect(screen.getByTestId("inbox-dot")).toHaveAttribute("aria-label", "3 waiting in your inbox");
  });
});
