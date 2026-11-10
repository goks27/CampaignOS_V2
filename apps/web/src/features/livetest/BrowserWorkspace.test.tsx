import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/toast";
import type { BrowserEvent, BrowserState } from "@/services/connector";
import { BrowserPane, InspectPanel } from "./BrowserWorkspace";
import { PRESET_FALLBACK, contentRect, filterEvents, keyInput, normalizeAddress, stateMessage, toFraction } from "./browserModel";
import type { Browser } from "./useBrowserSession";

const svc = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/services/tasks", () => ({ tasksService: { create: svc.create } }));

const base: BrowserState = { id: "s1", status: "ready", error: null, errorCode: null, url: "https://site.example/a", title: "A", loading: false, canGoBack: true, canGoForward: false, captcha: false, paused: false, device: "desktop", viewport: { width: 1000, height: 500 }, locked: false, lockedBy: null, startedAt: 1, campaignId: "c1", campaignName: "Gold", startUrl: "https://site.example/", frameSeq: 1, closedReason: null, counts: { events: 0, errors: 0, console: 0, network: 0 } };
const ev = (over: Partial<BrowserEvent>): BrowserEvent => ({ id: 1, at: "2026-11-06T10:00:00.000Z", url: "https://site.example/a", page: "https://site.example/a", category: "page-error", severity: "high", message: "Uncaught TypeError: x is undefined", ...over });

function fake(over: Partial<Browser> = {}): Browser {
  return { token: "tok", state: base, frame: "data:image/jpeg;base64,AAAA", events: [], consoleLog: [], network: [], reviewed: new Set<number>(), toggleReviewed: vi.fn(), connection: "live", opening: false, openError: null,
    open: vi.fn(), command: vi.fn().mockResolvedValue(null), send: vi.fn(), close: vi.fn(), shot: vi.fn().mockResolvedValue(null), ...over } as Browser;
}
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);
const pane = (b: Browser, extra: Partial<Parameters<typeof BrowserPane>[0]> = {}) => wrap(<BrowserPane browser={b} presets={PRESET_FALLBACK} offline={false} embedNote={null} testing={false} onCaptured={() => undefined} {...extra} />);

beforeEach(() => { vi.clearAllMocks(); svc.create.mockResolvedValue({ id: "t1" }); });

describe("browserModel", () => {
  it("maps a pointer to fractions of the picture and clamps outside it", () => {
    const r = { left: 100, top: 50, width: 400, height: 200 };
    expect(toFraction(r, 300, 150)).toEqual({ fx: 0.5, fy: 0.5 });
    expect(toFraction(r, 0, 9999)).toEqual({ fx: 0, fy: 1 });
  });
  it("finds the page inside a letterboxed box, so a click never lands on the bars", () => {
    const wide = contentRect({ left: 0, top: 0, width: 800, height: 400 }, 0.5); // a phone-shaped page in a wide box
    expect(wide).toEqual({ left: 300, top: 0, width: 200, height: 400 });
    const tall = contentRect({ left: 10, top: 10, width: 200, height: 600 }, 1); // a square page in a tall box
    expect(tall).toEqual({ left: 10, top: 210, width: 200, height: 200 });
    expect(contentRect({ left: 0, top: 0, width: 100, height: 50 }, 2)).toEqual({ left: 0, top: 0, width: 100, height: 50 });
  });
  it("offers phones and tablets only, iOS and Android, from the narrowest to the widest", () => {
    expect(PRESET_FALLBACK.every((p) => p.touch)).toBe(true);
    expect(PRESET_FALLBACK.some((p) => /desktop|laptop/i.test(p.id))).toBe(false);
    expect(PRESET_FALLBACK.some((p) => /iphone/.test(p.id)) && PRESET_FALLBACK.some((p) => /pixel|galaxy/.test(p.id)) && PRESET_FALLBACK.some((p) => /ipad|tab/.test(p.id))).toBe(true);
    expect(Math.min(...PRESET_FALLBACK.map((p) => p.width))).toBe(320);
  });
  it("turns keys into input and ignores shortcuts", () => {
    expect(keyInput({ key: "Enter" })).toEqual({ type: "key", key: "Enter" });
    expect(keyInput({ key: "a" })).toEqual({ type: "text", text: "a" });
    expect(keyInput({ key: "a", ctrlKey: true })).toEqual({ type: "key", key: "Control+a" });
    // copy, cut and paste use the dashboard's own clipboard, so they are not sent as keys
    for (const k of ["c", "x", "v"]) expect(keyInput({ key: k, ctrlKey: true })).toBeNull();
    expect(keyInput({ key: "r", ctrlKey: true })).toBeNull();
    expect(keyInput({ key: "F5" })).toBeNull();
  });
  it("accepts a bare host as https and refuses other schemes", () => {
    expect(normalizeAddress("example.com/x")).toBe("https://example.com/x");
    expect(normalizeAddress("javascript:alert(1)")).toBeNull();
    expect(normalizeAddress("file:///etc/passwd")).toBeNull();
    expect(normalizeAddress("two words")).toBeNull();
  });
  it("filters by category, hides notes and reviewed ones", () => {
    const list = [ev({ id: 1 }), ev({ id: 2, category: "network-failed", severity: "medium" }), ev({ id: 3, category: "blocked", severity: "info" }), ev({ id: 4, category: "capture", severity: "info" })];
    expect(filterEvents(list, "all", false, new Set(), false).map((e) => e.id)).toEqual([1, 2]);
    expect(filterEvents(list, "network", true, new Set(), false).map((e) => e.id)).toEqual([2, 3]);
    expect(filterEvents(list, "all", false, new Set([1]), true).map((e) => e.id)).toEqual([2]);
  });
  it("words each blank state", () => {
    expect(stateMessage(null, false, false)?.title).toBe("Enter a staging URL");
    expect(stateMessage(null, false, true)?.title).toMatch(/connector/);
    expect(stateMessage({ ...base, status: "launching" }, true, false)?.title).toMatch(/Starting/);
    expect(stateMessage({ ...base, status: "error", errorCode: "timeout", error: "slow" }, true, false)?.title).toBe("The page took too long");
    expect(stateMessage({ ...base, status: "error", errorCode: "unreachable", error: "dns" }, true, false)?.title).toBe("The site could not be reached");
    expect(stateMessage({ ...base, status: "disconnected" }, true, false)?.title).toMatch(/disconnected/);
    expect(stateMessage(base, true, false)).toBeNull();
  });
});

describe("BrowserPane", () => {
  it("relays a click as fractions of the picture, so zoom does not matter", () => {
    const b = fake();
    pane(b);
    const img = screen.getByTestId("picture");
    img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 250, right: 500, bottom: 250, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(img, { clientX: 250, clientY: 125 });
    expect(b.send).toHaveBeenCalledWith({ type: "click", fx: 0.5, fy: 0.5, count: 1 });
  });

  it("types into the page and keeps the browser's own shortcuts out of it", () => {
    const b = fake();
    pane(b);
    const vp = screen.getByTestId("viewport");
    fireEvent.keyDown(vp, { key: "h" });
    fireEvent.keyDown(vp, { key: "Enter" });
    fireEvent.keyDown(vp, { key: "r", ctrlKey: true });
    expect(b.send).toHaveBeenNthCalledWith(1, { type: "text", text: "h" });
    expect(b.send).toHaveBeenNthCalledWith(2, { type: "key", key: "Enter" });
    expect(b.send).toHaveBeenCalledTimes(2);
  });

  it("drives back, refresh, an address and a screen size", async () => {
    const b = fake();
    pane(b);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
    const addr = screen.getByLabelText("Address");
    fireEvent.change(addr, { target: { value: "other.example/page" } });
    fireEvent.submit(addr.closest("form")!);
    fireEvent.change(screen.getByLabelText("Screen size"), { target: { value: "pixel-7" } });
    await waitFor(() => expect(b.command).toHaveBeenCalledTimes(4));
    expect(b.command).toHaveBeenCalledWith({ type: "back" });
    expect(b.command).toHaveBeenCalledWith({ type: "reload" });
    expect(b.command).toHaveBeenCalledWith({ type: "navigate", url: "https://other.example/page" });
    expect(b.command).toHaveBeenCalledWith({ type: "device", device: "pixel-7" });
  });

  it("refuses an address that is not http(s) before it reaches the connector", () => {
    const b = fake();
    pane(b);
    const addr = screen.getByLabelText("Address");
    fireEvent.change(addr, { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(addr.closest("form")!);
    expect(screen.getByTestId("pane-problem")).toHaveTextContent(/full web address/);
    expect(b.command).not.toHaveBeenCalled();
  });

  it("turns input off while a test runs in the browser, and says so", () => {
    const b = fake({ state: { ...base, locked: true, lockedBy: "a Live test is running" } });
    pane(b);
    expect(screen.getByTestId("locked")).toHaveTextContent(/clicking and typing are off/);
    const img = screen.getByTestId("picture");
    fireEvent.click(img, { clientX: 10, clientY: 10 });
    expect(b.send).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
  });

  it("lists hosts the guard refused, and lets an admin allow one", async () => {
    const onAllowHost = vi.fn().mockResolvedValue(undefined);
    pane(fake({ events: [ev({ id: 9, category: "blocked", severity: "info", url: "https://cdn.example.com/a.png", message: "Not loaded" }), ev({ id: 10, category: "blocked", severity: "info", url: "https://cdn.example.com/b.png", message: "Not loaded" })] }), { onAllowHost });
    expect(screen.getByTestId("blocked-hosts")).toHaveTextContent("cdn.example.com");
    fireEvent.click(screen.getByTestId("allow-cdn.example.com"));
    await waitFor(() => expect(onAllowHost).toHaveBeenCalledWith("cdn.example.com"));
  });

  it("only names the hosts when the person cannot change Settings", () => {
    pane(fake({ events: [ev({ id: 9, category: "blocked", severity: "info", url: "https://cdn.example.com/a.png", message: "Not loaded" })] }));
    expect(screen.getByTestId("blocked-hosts")).toHaveTextContent(/Ask an admin/);
    expect(screen.queryByRole("button", { name: /Allow cdn/ })).toBeNull();
  });

  it("says a Chrome window is open when the session is a visible one", () => {
    pane(fake({ state: { ...base, headed: true } }));
    expect(screen.getByTestId("headed")).toHaveTextContent(/Use that window/);
  });

  it("shows a CAPTCHA notice and the lost-connection banner", () => {
    pane(fake({ state: { ...base, captcha: true }, connection: "lost" }));
    expect(screen.getByTestId("captcha")).toHaveTextContent(/never bypassed/);
    expect(screen.getByTestId("lost")).toBeInTheDocument();
  });

  it.each([
    [{ status: "launching" as const }, null, "Starting the browser"],
    [{ status: "error" as const, errorCode: "unreachable", error: "dns failed" }, null, "The site could not be reached"],
    [{ status: "error" as const, errorCode: "timeout", error: "too slow" }, null, "The page took too long"],
    [{ status: "disconnected" as const, error: "crashed" }, null, "The browser disconnected"],
  ])("with no picture and %j it says %s", (s, frame, title) => {
    pane(fake({ state: { ...base, ...s }, frame }));
    expect(screen.getByTestId("pane-message")).toHaveTextContent(title);
  });

  it("says when the connector is not running, and when there is no URL yet", () => {
    pane(fake({ token: null, state: null, frame: null }), { offline: true });
    expect(screen.getByTestId("pane-message")).toHaveTextContent("The connector is not running");
  });
  it("lets you type an address into the bar before any preview is open, and opens it", () => {
    const onOpenAddress = vi.fn();
    pane(fake({ token: null, state: null, frame: null }), { onOpenAddress });
    const addr = screen.getByLabelText("Address");
    expect(addr).not.toBeDisabled();
    fireEvent.change(addr, { target: { value: "staging.example.com/play" } });
    fireEvent.submit(addr.closest("form")!);
    expect(onOpenAddress).toHaveBeenCalledWith("https://staging.example.com/play");
  });

  it("says where the keyboard goes once the page is clicked", () => {
    pane(fake());
    expect(screen.getByTestId("focus-hint")).toHaveTextContent("Click the page, then type");
    fireEvent.focus(screen.getByTestId("viewport"));
    expect(screen.getByTestId("focus-hint")).toHaveTextContent("Typing goes to the page");
  });

  it("explains the empty state before any URL", () => {
    pane(fake({ token: null, state: null, frame: null }));
    expect(screen.getByTestId("pane-message")).toHaveTextContent("Enter a staging URL");
  });
});

describe("InspectPanel", () => {
  const events = [ev({ id: 1, message: "Uncaught TypeError: x is undefined", shotRef: 1, hasShot: true }), ev({ id: 2, category: "network-failed", severity: "medium", message: "Request failed: GET /api/otp (net::ERR_FAILED)", url: "https://site.example/api/otp", method: "GET" }), ev({ id: 3, category: "http-error", severity: "low", message: "HTTP 404 for GET /missing.png", status: 404 })];

  it("lists problems newest first and filters by category", () => {
    wrap(<InspectPanel browser={fake({ events })} run={null} campaignId="c1" device="Desktop" />);
    const items = screen.getByTestId("errors-list").querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("HTTP 404");
    fireEvent.change(screen.getByLabelText("Filter by category"), { target: { value: "network" } });
    expect(screen.getByTestId("errors-list").querySelectorAll("li")).toHaveLength(1);
    expect(screen.getByTestId("errors-list")).toHaveTextContent("ERR_FAILED");
  });

  it("opens one problem with its details, the screenshot, and a note that a 4xx is not always a bug", async () => {
    const shot = vi.fn().mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    URL.createObjectURL = vi.fn(() => "blob:shot"); URL.revokeObjectURL = vi.fn();
    wrap(<InspectPanel browser={fake({ events, shot })} run={null} campaignId="c1" device="Desktop" />);
    fireEvent.click(screen.getByTestId("ev-1"));
    expect(await screen.findByTestId("evidence")).toHaveAttribute("src", "blob:shot");
    expect(shot).toHaveBeenCalledWith(1);
    expect(screen.getByTestId("event-detail")).toHaveTextContent("https://site.example/a");
    fireEvent.click(screen.getByTestId("ev-3"));
    expect(screen.getByTestId("event-detail")).toHaveTextContent(/not always a bug/);
  });

  it("marks a problem reviewed, and can hide the reviewed ones", () => {
    const toggleReviewed = vi.fn();
    const { rerender } = wrap(<InspectPanel browser={fake({ events, toggleReviewed })} run={null} campaignId="c1" device="Desktop" />);
    fireEvent.click(screen.getByTestId("ev-1"));
    fireEvent.click(screen.getByTestId("mark-reviewed"));
    expect(toggleReviewed).toHaveBeenCalledWith(1);
    rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><InspectPanel browser={fake({ events, toggleReviewed, reviewed: new Set([1]) })} run={null} campaignId="c1" device="Desktop" /></ToastProvider></QueryClientProvider>);
    expect(screen.getByTestId("ev-1")).toHaveAttribute("data-reviewed", "true");
    fireEvent.click(screen.getByLabelText("Hide reviewed"));
    expect(screen.queryByTestId("ev-1")).toBeNull();
  });

  it("turns a problem into a Journey task in the campaign, with the page and the device, and says the device is emulated", async () => {
    wrap(<InspectPanel browser={fake({ events })} run={null} campaignId="c1" device="iPhone" />);
    fireEvent.click(screen.getByTestId("ev-2"));
    fireEvent.click(screen.getByTestId("make-task"));
    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    const t = svc.create.mock.calls[0]![0];
    expect(t).toMatchObject({ campaign_id: "c1", priority: "medium" });
    expect(t.title).toContain("Request failed");
    expect(t.description).toContain("https://site.example/a");
    expect(t.description).toContain("iPhone (emulated in Chromium, not a physical device)");
  });

  it("cannot make a task without a campaign", () => {
    wrap(<InspectPanel browser={fake({ events })} run={null} campaignId="" device="Desktop" />);
    fireEvent.click(screen.getByTestId("ev-1"));
    expect(screen.getByTestId("make-task")).toBeDisabled();
  });

  it("shows the console and the network, and filters the network to failures", () => {
    wrap(<InspectPanel browser={fake({ consoleLog: [{ id: 5, at: "2026-11-06T10:00:01.000Z", type: "error", text: "boom" }], network: [{ id: 6, at: "2026-11-06T10:00:01.000Z", method: "GET", url: "https://site.example/ok.js", status: 200, ms: 12, failed: false }, { id: 7, at: "2026-11-06T10:00:02.000Z", method: "GET", url: "https://site.example/bad", status: 500, failed: false }] })} run={null} campaignId="c1" device="Desktop" />);
    fireEvent.click(screen.getByRole("tab", { name: /Console/ }));
    expect(screen.getByTestId("console-list")).toHaveTextContent("error: boom");
    fireEvent.click(screen.getByRole("tab", { name: /Network/ }));
    expect(screen.getByTestId("network-list").querySelectorAll("li")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Network filter"), { target: { value: "failed" } });
    expect(screen.getByTestId("network-list").querySelectorAll("li")).toHaveLength(1);
    expect(screen.getByTestId("network-list")).toHaveTextContent("/bad");
  });

  it("shows the steps of a test and the findings of the all-device run", () => {
    const run = { mode: "auto", runId: "r", status: "passed", url: "u", device: "", deviceLabel: "", campaignId: "", campaignName: "", startedAt: 1, finishedAt: 2, console: [], failed: [], prompt: null, error: null,
      steps: [{ i: 1, action: "click", target: "Send OTP", value: "", status: "passed", note: "", hasShot: false, secret: false }],
      auto: { devices: [], pages: 1, login: null, summary: null, findings: [{ title: "Page scrolls sideways", severity: "medium", description: "d", page: "/", seen: "Seen on iPhone 15", fix: "" }] } } as never;
    wrap(<InspectPanel browser={fake()} run={run} campaignId="c1" device="Desktop" />);
    fireEvent.click(screen.getByRole("tab", { name: /Steps/ }));
    expect(screen.getByTestId("inspect-steps")).toHaveTextContent("Send OTP");
    fireEvent.click(screen.getByRole("tab", { name: /Findings/ }));
    expect(screen.getByTestId("inspect-findings")).toHaveTextContent("Seen on iPhone 15");
  });
});
