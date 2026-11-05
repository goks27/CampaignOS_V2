import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeviceReport } from "./DeviceReport";
import { siteNotes } from "@/lib/devices";

const jobs = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/services/jobs", () => ({ jobsService: jobs }));

const dev = (id: string, label: string, over = {}) => ({ id, label, family: "x", engine: "Chromium (emulated)", pages_tested: 4, pages_failed: 0, login: "ok", issues: 0, top_issues: [], ...over });
const notes = {
  pages_checked: 4, devices_tested: 3, login: { status: "ok" },
  devices: [dev("desktop", "Desktop 1440"), dev("iphone-15", "iPhone 15", { issues: 2, top_issues: ["Page scrolls sideways on small screens: /offers", "Small tap targets: /"] }), dev("ipad", "iPad", { pages_tested: 0, skipped: "not reached: the check ran out of time" })],
};
const job = (over = {}) => ({ id: "j1", review_type: "site_check", status: "completed", finished_at: "2026-11-05T10:00:00Z", result_summary: { notes }, ...over });
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><DeviceReport campaign={{ id: "c1" } as never} /></MemoryRouter></QueryClientProvider>);

beforeEach(() => vi.clearAllMocks());

describe("DeviceReport", () => {
  it("lists every device with its result, and opens the issues on a device when you click it", async () => {
    jobs.list.mockResolvedValue([job()]);
    show();
    expect(await screen.findByTestId("device-report")).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 devices have issues/)).toBeInTheDocument();
    expect(screen.getByTestId("device-desktop")).toHaveTextContent("No issues");
    expect(screen.getByTestId("device-iphone-15")).toHaveTextContent("2 issues");
    expect(screen.getByTestId("device-ipad")).toHaveTextContent("Not tested");
    expect(screen.queryByTestId("device-iphone-15-issues")).toBeNull();
    fireEvent.click(screen.getByTestId("device-iphone-15"));
    expect(screen.getByTestId("device-iphone-15-issues")).toHaveTextContent("Page scrolls sideways on small screens: /offers");
  });

  it("says plainly that these are emulated, not physical phones", async () => {
    jobs.list.mockResolvedValue([job()]);
    show();
    expect(await screen.findByText(/emulated devices/i)).toHaveTextContent(/not physical phones/);
  });

  it("explains what to add when the login asks for something that is not stored", async () => {
    jobs.list.mockResolvedValue([job({ result_summary: { notes: { ...notes, login: { status: "needs", needs: ["OTP"], message: "The login asks for OTP." } } } })]);
    show();
    expect(await screen.findByTestId("login-note")).toHaveTextContent(/“OTP = value”/);
  });

  it("shows nothing before there is a finished site check, or for an older one without devices", async () => {
    jobs.list.mockResolvedValue([job({ result_summary: { notes: { pages_checked: 3 } } }), job({ review_type: "sow_analysis" }), job({ status: "failed" })]);
    const { container } = show();
    await vi.waitFor(() => expect(jobs.list).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="device-report"]')).toBeNull();
  });

  it("siteNotes reads old results safely", () => {
    expect(siteNotes(null)).toBeNull();
    expect(siteNotes({ notes: { pages_checked: 2 } })).toBeNull();
    expect(siteNotes({ notes: notes })?.devices).toHaveLength(3);
  });
});
