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
  it("has four items: Home, Campaigns, Inbox and Settings", () => {
    show();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Home", "Campaigns", "Inbox", "Settings"]);
    expect([...nav.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/home", "/projects", "/inbox", "/settings"]);
    for (const gone of ["Tasks", "Timeline", "Reports", "Team", "Playground"]) expect(nav).not.toHaveTextContent(gone);
  });

  it("the logo opens Home", () => {
    show();
    expect(screen.getByRole("link", { name: /go to home/i })).toHaveAttribute("href", "/home");
  });

  it("lists the campaigns underneath", () => {
    show();
    expect(screen.getByText("Gold Drop")).toBeInTheDocument();
  });

  it("shows how many are waiting on the Inbox item, and nothing when none are", () => {
    show();
    expect(screen.queryByLabelText(/waiting/)).toBeNull();
  });

  it("the Inbox item says how many are waiting", () => {
    waiting = 3;
    show();
    expect(screen.getByLabelText("3 waiting")).toHaveTextContent("3");
  });
});
