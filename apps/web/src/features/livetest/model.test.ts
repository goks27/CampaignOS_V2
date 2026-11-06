import { describe, expect, it } from "vitest";
import { autoRequest, bySeverity, loginProblem, looksLikeUrl, fromScenario, isActive, logText, newStep, placeholdersOf, problem, resultLine, stepSentence, toRequest, toScenario, type EditStep } from "./model";
import type { LiveTestState } from "@/services/connector";

const step = (over: Partial<EditStep>): EditStep => ({ ...newStep("click"), ...over });
const FLOW: EditStep[] = [
  step({ action: "fill", target: "Mobile number", value: "{{mobile}}" }), step({ action: "click", target: "Send OTP" }),
  step({ action: "ask", target: "Enter the OTP", value: "OTP", secret: true }), step({ action: "expect_text", target: "Welcome" }),
];

describe("placeholders", () => {
  it("finds the {{names}} the steps use", () => expect(placeholdersOf(FLOW)).toEqual(["mobile"]));
  it("forgets a name once the step no longer takes a value (the bug where an old {{mobile}} kept being asked for)", () => {
    const changed = FLOW.map((s) => (s.action === "fill" ? { ...s, action: "click" as const } : s));
    expect(placeholdersOf(changed)).toEqual([]);
  });
});

describe("problem (what is missing before Start)", () => {
  const inputs = { mobile: { value: "9876543210", secret: false } };
  it("is null when it can run", () => expect(problem("https://staging.example.com", FLOW, inputs)).toBeNull());
  it("asks for the URL, the targets, the field to fill and the values", () => {
    expect(problem("nope", FLOW, inputs)).toMatch(/staging URL/);
    expect(problem("ftp://x.test", FLOW, inputs)).toMatch(/https/);
    expect(problem("https://a.test", [step({ action: "click", target: " " })], {})).toMatch(/Step 1/);
    expect(problem("https://a.test", [step({ action: "ask", target: "OTP?", value: "" })], {})).toMatch(/which field/);
    expect(problem("https://a.test", FLOW, {})).toMatch(/\{\{mobile\}\}/);
  });
});

describe("toRequest", () => {
  it("sends only the inputs the steps use, a value only where the step takes one, and never trims a secret flag away", () => {
    const r = toRequest(" https://a.test ", "pixel-7", FLOW, { mobile: { value: "98", secret: false }, unused: { value: "x", secret: true } }, ["a.test"]);
    expect(r.url).toBe("https://a.test");
    expect(Object.keys(r.inputs)).toEqual(["mobile"]);
    expect(r.steps[1]).toEqual({ action: "click", target: "Send OTP" });
    expect(r.steps[2]).toEqual({ action: "ask", target: "Enter the OTP", value: "OTP", secret: true });
    expect(r.device).toBe("pixel-7");
  });
});

describe("scenarios", () => {
  it("loads a saved scenario into editable steps", () => {
    const e = fromScenario([{ action: "goto", target: "/register" }, { action: "fill", target: "Name", value: "{{username}}" }]);
    expect(e.map((s) => s.action)).toEqual(["goto", "fill"]);
    expect(new Set(e.map((s) => s.id)).size).toBe(2);
  });
  it("saves steps without the 'ask me' ones, and says how many were left out", () => {
    const { steps, dropped } = toScenario(FLOW);
    expect(dropped).toBe(1);
    expect(steps.map((s) => s.action)).toEqual(["fill", "click", "expect_text"]);
    expect(steps[0]).toEqual({ action: "fill", target: "Mobile number", value: "{{mobile}}" });
  });
});

describe("run state", () => {
  const run = (over = {}): Extract<LiveTestState, { status: "running" | "passed" }> => ({ runId: "r", status: "passed", url: "https://a.test", device: "desktop", deviceLabel: "Desktop 1440", startedAt: 1000, finishedAt: 4000, steps: [], console: [], failed: [], prompt: null, error: null, ...over }) as never;
  it("is active until it has finished", () => {
    expect(isActive(null)).toBe(false);
    expect(isActive({ status: "idle" })).toBe(false);
    expect(isActive(run({ status: "running", finishedAt: null }))).toBe(true);
    expect(isActive(run())).toBe(false);
  });
  it("writes a log that never contains a typed value", () => {
    const text = logText(run({ steps: [
      { i: 0, action: "goto", target: "https://a.test", value: "", status: "passed", note: "Open the page", hasShot: true, secret: false },
      { i: 1, action: "fill", target: "Mobile number", value: "{{mobile}}", status: "passed", note: "", hasShot: true, secret: false },
      { i: 3, action: "ask", target: "Enter the OTP", value: "OTP", status: "passed", note: "You typed a value (hidden).", hasShot: false, secret: true },
    ], failed: [{ url: "https://a.test/x.js", status: 404 }], console: [{ type: "error", text: "boom" }] }));
    expect(text).toMatch(/Mobile number = \{\{mobile\}\}/);
    expect(text).toMatch(/ask Enter the OTP {2}\(You typed a value \(hidden\)\.\)/);
    expect(text).toMatch(/404 https:\/\/a\.test\/x\.js/);
    expect(text).not.toMatch(/OTP =/);
  });
});

describe("step sentences", () => {
  const st = (over: Partial<import("@/services/connector").LiveTestStep>): import("@/services/connector").LiveTestStep => ({ i: 1, action: "click", target: "Send OTP", value: "", status: "passed", note: "", hasShot: true, secret: false, ...over });
  it("read the way a tester would say them", () => {
    expect(stepSentence(st({ i: 0, action: "goto", target: "http://localhost:8765/register" }))).toBe("Open http://localhost:8765/register");
    expect(stepSentence(st({ action: "click", target: "Send OTP" }))).toBe("Click “Send OTP”");
    expect(stepSentence(st({ action: "fill", target: "Mobile number", value: "{{mobile}}" }))).toBe("Type “{{mobile}}” into “Mobile number”");
    expect(stepSentence(st({ action: "ask", target: "Enter the OTP you received", value: "otp", secret: true }))).toBe("Ask you: Enter the OTP you received");
    expect(stepSentence(st({ action: "expect_text", target: "OTP verified" }))).toBe("Expect “OTP verified” to be visible");
    expect(stepSentence(st({ action: "expect_url", target: "/success" }))).toBe("Expect the address to contain “/success”");
  });
  it("never print a hidden value", () => {
    expect(stepSentence(st({ action: "fill", target: "PIN", value: "{{pin}}", secret: true }))).toBe("Type a hidden value into “PIN”");
  });
});

describe("result line", () => {
  const run = (over: Record<string, unknown>) => ({ runId: "r", status: "passed", url: "https://a.test", device: "desktop", deviceLabel: "Desktop 1440", campaignId: "", campaignName: "", startedAt: 1, finishedAt: 2, console: [], failed: [], prompt: null, error: null, steps: [], ...over }) as never as Parameters<typeof resultLine>[0];
  const steps = (...s: string[]) => s.map((status, i) => ({ i, action: i === 0 ? "goto" : "click", target: "x", value: "", status, note: status === "failed" ? "“Verify” did not appear within 15 seconds." : "", hasShot: true, secret: false }));
  it("counts your steps, not the one that opens the page", () => {
    expect(resultLine(run({ steps: steps("passed", "passed", "passed", "passed", "passed", "passed") }))).toEqual({ tone: "green", text: "All 5 steps passed." });
    expect(resultLine(run({ steps: steps("passed", "passed") })).text).toBe("All 1 step passed.");
  });
  it("names the step that failed and why", () => {
    const r = resultLine(run({ status: "failed", steps: steps("passed", "passed", "failed", "skipped") }));
    expect(r.tone).toBe("red");
    expect(r.text).toBe("Step 2 failed: “Verify” did not appear within 15 seconds.");
  });
  it("says so when the page itself did not open, was blocked, stopped or is still going", () => {
    expect(resultLine(run({ status: "failed", steps: steps("failed") })).text).toMatch(/^The page did not open/);
    expect(resultLine(run({ status: "blocked", steps: steps("failed") })).tone).toBe("amber");
    expect(resultLine(run({ status: "stopped", steps: steps("passed", "failed") })).text).toBe("Stopped.");
    expect(resultLine(run({ status: "running", finishedAt: null, steps: steps("passed", "running", "pending") }))).toEqual({ tone: "blue", text: "Running step 1 of 2…" });
  });
});

describe("the automatic run", () => {
  it("recognises a pasted web address, and only that", () => {
    expect(looksLikeUrl("https://thedigitalapps.com/bector-food")).toBe(true);
    expect(looksLikeUrl("  http://staging.example.com  ")).toBe(true);
    expect(looksLikeUrl("thedigitalapps.com")).toBe(false);
    expect(looksLikeUrl("https://sta")).toBe(false);
    expect(looksLikeUrl("hello world")).toBe(false);
    expect(looksLikeUrl("javascript:alert(1)")).toBe(false);
    expect(looksLikeUrl("")).toBe(false);
  });
  it("builds the request: a URL, and a login only when there is one", () => {
    const none = autoRequest(" https://a.test/ ", { username: "", password: "", extra: "" }, ["a.test"]);
    expect(none).toEqual({ mode: "auto", url: "https://a.test/", allowed_domains: ["a.test"] });
    const withLogin = autoRequest("https://a.test/", { username: " u ", password: "p", extra: "OTP = 1" }, [], { id: "c", name: "Gold" });
    expect(withLogin.credentials).toEqual({ username: "u", password: "p", extra: "OTP = 1" });
    expect(withLogin).toMatchObject({ campaign_id: "c", campaign_name: "Gold" });
  });
  it("wants both login fields or neither", () => {
    expect(loginProblem({ username: "", password: "", extra: "" })).toBeNull();
    expect(loginProblem({ username: "u", password: "p", extra: "" })).toBeNull();
    expect(loginProblem({ username: "u", password: "", extra: "" })).toMatch(/both/);
    expect(loginProblem({ username: "", password: "p", extra: "" })).toMatch(/both/);
  });
  it("lists findings worst first", () => {
    expect(bySeverity([{ severity: "low" }, { severity: "high" }, { severity: "informational" }, { severity: "medium" }]).map((f) => f.severity)).toEqual(["high", "medium", "low", "informational"]);
  });
  it("sums an automatic run up from its own summary, and from progress while it runs", () => {
    const run = (over: Record<string, unknown>) => ({ mode: "auto", runId: "r", status: "passed", url: "https://a.test", device: "All devices", deviceLabel: "All devices", campaignId: "", campaignName: "", startedAt: 1, finishedAt: 2, console: [], failed: [], prompt: null, error: null, steps: [], auto: { devices: [], findings: [], pages: 3, login: null, summary: { tone: "red", text: "2 issues found. 3 of 7 devices affected." } }, ...over }) as never as Parameters<typeof resultLine>[0];
    expect(resultLine(run({}))).toEqual({ tone: "red", text: "2 issues found. 3 of 7 devices affected." });
    expect(resultLine(run({ finishedAt: null, status: "running", steps: [{ i: 0, action: "progress", target: "iPhone 15: page 2 of 5: /offers", value: "", status: "running", note: "", hasShot: false, secret: false }] }))).toEqual({ tone: "blue", text: "iPhone 15: page 2 of 5: /offers" });
    expect(resultLine(run({ status: "stopped" })).text).toBe("Stopped.");
    expect(resultLine(run({ status: "failed", error: "Could not reach the site" })).text).toBe("Could not reach the site");
  });
  it("writes a log with devices and findings and no login detail", () => {
    const text = logText({ mode: "auto", runId: "r", status: "failed", url: "https://a.test", device: "All devices", deviceLabel: "All devices", campaignId: "", campaignName: "", startedAt: 1, finishedAt: 5001, console: [], failed: [], prompt: null, error: null, steps: [],
      auto: { devices: [{ id: "iphone-15", label: "iPhone 15", family: "iPhone", engine: "Chromium (emulated)", pages_tested: 4, pages_failed: 0, login: "ok", issues: 1, top_issues: ["Page scrolls sideways"] }], findings: [{ title: "Page scrolls sideways (iPhone 15)", severity: "medium", description: "", page: "", seen: "Seen on 1 page", fix: "" }], pages: 4, login: { status: "ok" }, summary: { tone: "red", text: "1 issue found. 1 of 1 devices affected." } } } as never);
    expect(text).toMatch(/iPhone 15: 4 pages, 1 issue \(Page scrolls sideways\)/);
    expect(text).toMatch(/\[medium\] Page scrolls sideways \(iPhone 15\)/);
  });
});
