import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/toast";
import { LiveTest } from "./LiveTestPage";

const svc = vi.hoisted(() => ({
  connector: { value: { busy: false } as { busy: boolean } | null },
  development: { submissions: vi.fn(), environments: vi.fn(), testCases: vi.fn(), saveTestCase: vi.fn() },
  live: { state: vi.fn(), runs: vi.fn(), start: vi.fn(), answer: vi.fn(), stop: vi.fn(), shot: vi.fn() },
  browser: { open: vi.fn(), embeddable: vi.fn(), presets: vi.fn(), command: vi.fn(), log: vi.fn(), shot: vi.fn(), input: vi.fn(), streamUrl: () => "http://127.0.0.1:4317/browser/stream?token=t" },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ isAdmin: true, me: { workspaceId: "w1" } }) }));
vi.mock("@/services/settings", () => ({ settingsService: { update: vi.fn().mockResolvedValue({}) } }));
vi.mock("@/services/development", () => ({ developmentService: svc.development }));
vi.mock("@/services/liveSessions", () => ({ liveSessionsService: { list: vi.fn().mockResolvedValue([]), save: vi.fn(), remove: vi.fn() } }));
vi.mock("@/services/connector", () => ({ connectorService: { liveFrame: vi.fn().mockResolvedValue(null), live: vi.fn().mockResolvedValue({ active: true, where: { url: "https://staging.gold.example/register", device: "iPhone 15", pageNo: 2, pageTotal: 6 } }) }, liveTestService: svc.live, browserService: svc.browser }));
vi.mock("@/hooks/queries", () => ({
  qk: { dev: (id: string) => ["dev", id] },
  useConnectorStatus: () => ({ data: svc.connector.value }),
  useSettings: () => ({ data: { allowed_domains: ["settings.example"] } }),
  useCampaigns: () => ({ data: [{ id: "c1", name: "Gold Drop" }, { id: "c2", name: "Other" }] }),
}));

const campaign = { id: "c1", name: "Gold Drop" } as never;
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><LiveTest campaign={campaign} /></ToastProvider></QueryClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  svc.connector.value = { busy: false };
  svc.live.state.mockResolvedValue({ status: "idle" });
  svc.live.runs.mockResolvedValue([]);
  svc.live.start.mockResolvedValue(undefined);
  svc.browser.open.mockResolvedValue({ token: "tok", state: { status: "launching", device: "desktop", url: "https://thedigitalapps.com/bector-food", title: "", loading: true, canGoBack: false, canGoForward: false, captcha: false, paused: false, locked: false, lockedBy: null, viewport: { width: 1440, height: 900 }, counts: { events: 0, errors: 0, console: 0, network: 0 }, error: null, errorCode: null, closedReason: null } });
  svc.browser.embeddable.mockResolvedValue({ embeddable: false, reason: "The site blocks embedding (X-Frame-Options: DENY)." });
  svc.browser.presets.mockResolvedValue(null);
  svc.browser.log.mockResolvedValue(null);
  svc.browser.command.mockResolvedValue({});
  svc.development.submissions.mockResolvedValue([{ id: "b2", version_label: "v0.4", staging_url: "https://staging.gold.example/register" }, { id: "b1", version_label: "v0.3", staging_url: "https://old.gold.example/" }]);
  svc.development.environments.mockResolvedValue([{ id: "e1", base_url: "https://env.gold.example", allowed_domains: ["cdn.gold.example"] }]);
  svc.development.testCases.mockResolvedValue([{ id: "t1", title: "Register with OTP", steps: [{ action: "fill", target: "Mobile number", value: "{{mobile}}" }, { action: "click", target: "Send OTP" }] }]);
});

describe("Live test inside a campaign", () => {
  it("starts from the campaign's latest build, with nothing to look up", async () => {
    show();
    await waitFor(() => expect(screen.getByLabelText("Staging URL")).toHaveValue("https://staging.gold.example/register"));
  });

  it("does not ask which campaign: the scenarios are its own and there is no campaign picker", async () => {
    show();
    expect(await screen.findByText("Start from a saved scenario")).toBeInTheDocument();
    expect(screen.queryByText("Campaign (optional)")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Live test" })).toBeNull(); // the Development section supplies the title
    await screen.findByRole("option", { name: "Register with OTP" });
    fireEvent.change(screen.getByLabelText("Start from a saved scenario"), { target: { value: "t1" } });
    await waitFor(() => expect(screen.getByLabelText("Step 1 Value")).toHaveValue("{{mobile}}"));
    expect(await screen.findByLabelText("{{mobile}}")).toBeInTheDocument();
  });

  it("lets you switch to an older build", async () => {
    show();
    await waitFor(() => expect(screen.getByLabelText("Staging URL")).toHaveValue("https://staging.gold.example/register"));
    fireEvent.change(screen.getByLabelText("Staging build"), { target: { value: "https://old.gold.example/" } });
    expect(screen.getByLabelText("Staging URL")).toHaveValue("https://old.gold.example/");
  });

  it("sends the campaign's allowed domains with the run, together with the ones from Settings", async () => {
    show();
    await waitFor(() => expect(screen.getByLabelText("Staging URL")).toHaveValue("https://staging.gold.example/register"));
    await screen.findByRole("option", { name: "Register with OTP" });
    fireEvent.change(screen.getByLabelText("Start from a saved scenario"), { target: { value: "t1" } });
    fireEvent.change(await screen.findByLabelText("{{mobile}}"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: /Run my steps/ }));
    await waitFor(() => expect(svc.live.start).toHaveBeenCalled());
    const req = svc.live.start.mock.calls[0]![0];
    expect(req.url).toBe("https://staging.gold.example/register");
    expect(req.allowed_domains).toEqual(expect.arrayContaining(["settings.example", "cdn.gold.example"]));
    expect(req.steps[0]).toMatchObject({ action: "fill", target: "Mobile number", value: "{{mobile}}" });
  });
});

describe("the automatic run", () => {
  const url = () => screen.getByLabelText("Staging URL");
  const pasteInto = (el: HTMLElement, text: string) => fireEvent.paste(el, { clipboardData: { getData: () => text } });

  it("does not start by itself when the page opens, even though the URL is filled in", async () => {
    show();
    await waitFor(() => expect(url()).toHaveValue("https://staging.gold.example/register"));
    await new Promise((r) => setTimeout(r, 150));
    expect(svc.live.start).not.toHaveBeenCalled();
  });

  it("opens the preview straight away when a web address is pasted, and does not start a test by itself", async () => {
    show();
    await waitFor(() => expect(url()).toHaveValue("https://staging.gold.example/register"));
    pasteInto(url(), "https://thedigitalapps.com/bector-food");
    await waitFor(() => expect(svc.browser.open).toHaveBeenCalledTimes(1));
    expect(svc.browser.open.mock.calls[0]![0]).toMatchObject({ url: "https://thedigitalapps.com/bector-food", device: "desktop", campaign: { id: "c1", name: "Gold Drop" } });
    expect(svc.browser.open.mock.calls[0]![0].allowed).toEqual(expect.arrayContaining(["settings.example", "cdn.gold.example"]));
    expect(svc.live.start).not.toHaveBeenCalled();
  });

  it("runs the all-device test from its own button: every device, nothing to choose", async () => {
    show();
    await waitFor(() => expect(url()).toHaveValue("https://staging.gold.example/register"));
    fireEvent.change(url(), { target: { value: "https://thedigitalapps.com/bector-food" } });
    fireEvent.click(screen.getByRole("button", { name: /Run test on every device/ }));
    await waitFor(() => expect(svc.live.start).toHaveBeenCalledTimes(1));
    const req = svc.live.start.mock.calls[0]![0];
    expect(req).toMatchObject({ mode: "auto", url: "https://thedigitalapps.com/bector-food", campaign_id: "c1", campaign_name: "Gold Drop" });
    expect(req.allowed_domains).toEqual(expect.arrayContaining(["settings.example", "cdn.gold.example"]));
    expect(req.credentials).toBeUndefined();
    expect(req.device).toBeUndefined(); // no device or OS is picked: the connector runs them all
    expect(req.steps).toBeUndefined();
  });

  it("opens a real Chrome window on this PC from its own button", async () => {
    show();
    await waitFor(() => expect(url()).toHaveValue("https://staging.gold.example/register"));
    fireEvent.click(screen.getByTestId("open-window"));
    await waitFor(() => expect(svc.browser.open).toHaveBeenCalledTimes(1));
    expect(svc.browser.open.mock.calls[0]![0]).toMatchObject({ url: "https://staging.gold.example/register", window: true });
  });

  it("typing a half-finished address does not open anything, but Enter does once it is a real URL", async () => {
    show();
    await waitFor(() => expect(url()).toHaveValue("https://staging.gold.example/register"));
    fireEvent.change(url(), { target: { value: "https://sta" } });
    expect(screen.getByTestId("start-hint")).toHaveTextContent(/staging URL/);
    fireEvent.submit(url().closest("form")!);
    expect(svc.browser.open).not.toHaveBeenCalled();
    fireEvent.change(url(), { target: { value: "https://staging.gold.example/" } });
    fireEvent.submit(url().closest("form")!);
    await waitFor(() => expect(svc.browser.open).toHaveBeenCalledTimes(1));
    expect(svc.live.start).not.toHaveBeenCalled();
  });

  it("sends the login details given up front, and only when both are filled in", async () => {
    show();
    await waitFor(() => expect(url()).toHaveValue("https://staging.gold.example/register"));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "98765" } });
    expect(screen.getByTestId("start-hint")).toHaveTextContent("both the username and the password");
    expect(screen.getByRole("button", { name: /Run test on every device/ })).toBeDisabled();
    pasteInto(url(), "https://staging.gold.example/");
    expect(svc.live.start).not.toHaveBeenCalled(); // a half-filled login does not start by itself
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText("Details the page asks for"), { target: { value: "OTP = 123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Run test on every device/ }));
    await waitFor(() => expect(svc.live.start).toHaveBeenCalledTimes(1));
    expect(svc.live.start.mock.calls[0]![0].credentials).toEqual({ username: "98765", password: "pw", extra: "OTP = 123456" });
  });

  it("will not start while the connector is off or a review is running, and says why", async () => {
    svc.connector.value = null;
    const { unmount } = show();
    await waitFor(() => expect(url()).toHaveValue("https://staging.gold.example/register"));
    expect(screen.getByRole("button", { name: /Run test on every device/ })).toBeDisabled();
    expect(screen.getByTestId("start-hint")).toHaveTextContent(/connector is not running/);
    pasteInto(url(), "https://staging.gold.example/");
    expect(svc.live.start).not.toHaveBeenCalled();
    expect(svc.browser.open).not.toHaveBeenCalled();
    unmount();
    svc.connector.value = { busy: true };
    show();
    expect(await screen.findByTestId("start-hint")).toHaveTextContent(/review is running/);
  });

  it("keeps the step editor tucked away under advanced", async () => {
    show();
    expect(await screen.findByTestId("own-steps")).not.toHaveAttribute("open");
  });
});

describe("the test browser panel", () => {
  const url = () => screen.getByLabelText("Staging URL");
  const pasteInto = (el: HTMLElement, text: string) => fireEvent.paste(el, { clipboardData: { getData: () => text } });
  const run = (over: Record<string, unknown> = {}) => ({ mode: "auto", runId: "r1", status: "running", url: "https://staging.gold.example/register", device: "All devices", deviceLabel: "All devices", campaignId: "c1", campaignName: "Gold Drop", startedAt: 1000, finishedAt: null,
    steps: [{ i: 0, action: "progress", target: "iPhone 15: page 2 of 6", value: "", status: "running", note: "", hasShot: false, secret: false }], console: [], failed: [], prompt: null, error: null,
    auto: { devices: [], findings: [], pages: 0, login: null, summary: null, errors: [] }, ...over });

  it("shows the browser starting the instant a URL is pasted, before the first picture arrives, and explains how the page is shown", async () => {
    show();
    await waitFor(() => expect(url()).toHaveValue("https://staging.gold.example/register"));
    expect(await screen.findByTestId("pane-message")).toHaveTextContent("Enter a staging URL");
    pasteInto(url(), "https://thedigitalapps.com/bector-food");
    await waitFor(() => expect(screen.getByLabelText("Address")).toHaveValue("https://thedigitalapps.com/bector-food"));
    expect(screen.getByTestId("pane-message")).toHaveTextContent("Starting the browser");
    expect(await screen.findByTestId("embed-note")).toHaveTextContent(/blocks embedding.*live picture/);
  });

  it("puts the inspection panel next to the browser, empty at first, with all five tabs", async () => {
    show();
    expect(await screen.findByTestId("inspect")).toBeInTheDocument();
    for (const t of ["Errors", "Console", "Network", "Steps", "Findings"]) expect(screen.getByRole("tab", { name: new RegExp(t) })).toBeInTheDocument();
    expect(screen.getByTestId("errors-empty")).toHaveTextContent(/appear here/);
  });

  it("lists errors while the test runs, newest first, with the device and page, and says which device and page the browser is on", async () => {
    const errors = [
      { device: "Desktop 1440", page: "/", severity: "medium", title: "Broken image: gone.png" },
      { device: "iPhone 15", page: "/offers", severity: "medium", title: "Page scrolls sideways on small screens (iPhone 15)" },
      { device: "iPhone 15", page: "/offers", severity: "low", title: "Small tap targets: /offers" },
    ];
    svc.live.runs.mockResolvedValue([{ runId: "r1", status: "running", url: "https://staging.gold.example/register", deviceLabel: "All devices", campaignId: "c1", campaignName: "Gold Drop", startedAt: 1000, finishedAt: null, passed: 0, total: 1 }]);
    svc.live.state.mockResolvedValue(run({ auto: { devices: [], findings: [], pages: 0, login: null, summary: null, errors } }));
    show();
    const list = await screen.findByTestId("errors-list");
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Small tap targets: /offers"); // newest first
    expect(items[0]).toHaveTextContent("iPhone 15 · /offers");
    expect(screen.getByTestId("errors-count")).toHaveTextContent("3");
    expect(screen.getByTestId("browser-bar")).toHaveTextContent("https://staging.gold.example/register");
    await waitFor(() => expect(screen.getByTestId("browser-where")).toHaveTextContent("iPhone 15 · page 2 of 6"));
    expect(screen.queryByTestId("errors-empty")).toBeNull();
  });

  it("says plainly when a finished run found no errors", async () => {
    svc.live.runs.mockResolvedValue([{ runId: "r1", status: "passed", url: "https://staging.gold.example/register", deviceLabel: "All devices", campaignId: "c1", campaignName: "Gold Drop", startedAt: 1000, finishedAt: 9000, passed: 1, total: 1 }]);
    svc.live.state.mockResolvedValue(run({ status: "passed", finishedAt: 9000, auto: { devices: [], findings: [], pages: 3, login: null, summary: { tone: "green", text: "No issues on any of 7 devices." }, errors: [] } }));
    show();
    await waitFor(() => expect(screen.getByTestId("errors-empty")).toHaveTextContent("No errors were found."));
  });

  it("for a run of your own steps, lists the console errors and failed requests there", async () => {
    svc.live.runs.mockResolvedValue([{ runId: "r2", status: "failed", url: "https://staging.gold.example/register", deviceLabel: "Desktop 1440", campaignId: "c1", campaignName: "Gold Drop", startedAt: 1000, finishedAt: 5000, passed: 1, total: 2 }]);
    svc.live.state.mockResolvedValue({ mode: "script", auto: null, runId: "r2", status: "failed", url: "https://staging.gold.example/register", device: "desktop", deviceLabel: "Desktop 1440", campaignId: "c1", campaignName: "Gold Drop", startedAt: 1000, finishedAt: 5000,
      steps: [], console: [{ type: "error", text: "Uncaught TypeError: x is undefined" }], failed: [{ url: "https://staging.gold.example/api/otp", status: 500 }], prompt: null, error: null });
    show();
    const list = await screen.findByTestId("errors-list");
    expect(list).toHaveTextContent("Uncaught TypeError: x is undefined");
    expect(list).toHaveTextContent("500 https://staging.gold.example/api/otp");
  });
});
