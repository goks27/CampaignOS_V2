import { describe, expect, it } from "vitest";
import { fromScenario, isActive, logText, newStep, placeholdersOf, problem, toRequest, toScenario, type EditStep } from "./model";
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
