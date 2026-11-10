import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/toast";
import { EXAMPLE_SCENARIO } from "./engine";

const svc = vi.hoisted(() => ({
  canEdit: { v: true }, scenarios: vi.fn(), runs: vi.fn(), save: vi.fn(), saveRun: vi.fn(), remove: vi.fn(), builds: vi.fn(), task: vi.fn(), api: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ canEdit: svc.canEdit.v }) }));
vi.mock("@/hooks/queries", () => ({ qk: { dev: (id: string) => ["dev", id] }, useSettings: () => ({ data: { allowed_domains: ["staging.example"] } }) }));
vi.mock("@/services/connector", () => ({ apiCheckService: { run: svc.api } }));
vi.mock("@/services/development", () => ({ developmentService: { submissions: svc.builds } }));
vi.mock("@/services/rules", () => ({ rulesService: { scenarios: svc.scenarios, runs: svc.runs, saveScenario: svc.save, saveRun: svc.saveRun, removeScenario: svc.remove } }));
vi.mock("@/services/tasks", () => ({ tasksService: { create: svc.task } }));

import { RulesLab, parseScenario } from "./RulesLab";

const campaign = { id: "c1", name: "Gold Drop" } as never;
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><RulesLab campaign={campaign} /></ToastProvider></QueryClientProvider>);
const editor = () => screen.getByLabelText("Scenario JSON") as HTMLTextAreaElement;
const setScenario = (s: unknown) => fireEvent.change(editor(), { target: { value: typeof s === "string" ? s : JSON.stringify(s) } });

beforeEach(() => {
  vi.clearAllMocks();
  svc.canEdit.v = true;
  svc.scenarios.mockResolvedValue([]); svc.runs.mockResolvedValue([]); svc.builds.mockResolvedValue([{ id: "b1", version_label: "v0.4" }]);
  svc.save.mockResolvedValue({ id: "s1", version: 1, name: "x", suite: "General", scenario: EXAMPLE_SCENARIO, accepted: true });
  svc.saveRun.mockResolvedValue({}); svc.task.mockResolvedValue({ id: "t1" });
});

describe("parseScenario", () => {
  it("explains what is wrong instead of failing silently", () => {
    expect(parseScenario("{nope")).toMatchObject({ error: expect.stringContaining("not valid JSON") });
    expect(parseScenario("[]")).toMatchObject({ error: "A scenario is a JSON object." });
    expect(parseScenario("{}")).toMatchObject({ error: "The scenario needs a name." });
    expect(parseScenario('{"name":"a"}')).toMatchObject({ error: expect.stringContaining("needs rules") });
    expect(parseScenario('{"name":"a","rules":{}}')).toMatchObject({ error: expect.stringContaining("actually did") });
    expect(parseScenario('{"name":"a","rules":{},"actual":{}}')).toHaveProperty("scenario");
  });
});

describe("Rules lab", () => {
  it("runs the example and shows a report with every check, deterministic and with no AI involved", async () => {
    show();
    fireEvent.click(screen.getByTestId("run-scenario"));
    const report = await screen.findByTestId("run-report");
    expect(report).toHaveAttribute("data-status", "passed");
    expect(screen.getByTestId("check-eligibility")).toHaveAttribute("data-status", "passed");
    expect(screen.getByTestId("check-unique_winners")).toBeInTheDocument();
  });

  it("records every run with the build it was run against", async () => {
    show();
    await screen.findByText(/Latest: v0.4/); // the builds have loaded
    fireEvent.click(screen.getByTestId("run-scenario"));
    await waitFor(() => expect(svc.saveRun).toHaveBeenCalledTimes(1));
    const arg = svc.saveRun.mock.calls[0]![0];
    expect(arg).toMatchObject({ campaignId: "c1", buildLabel: "v0.4" });
    expect(arg.result.status).toBe("passed");
  });

  it("reports a failure with expected and actual, and offers a Journey task for it", async () => {
    show();
    setScenario({ ...EXAMPLE_SCENARIO, actual: { winners: [{ participantId: "p2", day: "d1" }, { participantId: "p1", day: "d2" }] } });
    fireEvent.click(screen.getByTestId("run-scenario"));
    expect(await screen.findByTestId("run-report")).toHaveAttribute("data-status", "failed");
    const row = screen.getByTestId("check-eligibility");
    expect(row).toHaveAttribute("data-status", "failed");
    expect(row).toHaveTextContent("p2 is under 18");
    fireEvent.click(screen.getAllByRole("button", { name: /Create Journey task/ })[0]!); // failed checks are open by default
    await waitFor(() => expect(svc.task).toHaveBeenCalledTimes(1));
    expect(svc.task.mock.calls[0]![0].title).toMatch(/^Rule failed:/);
    expect(svc.task.mock.calls[0]![0].description).toMatch(/Found by a deterministic rule check/);
  });

  it("never says passed when something could not be verified: it says incomplete and lists what was not verified", async () => {
    show();
    setScenario({ ...EXAMPLE_SCENARIO, participants: undefined });
    fireEvent.click(screen.getByTestId("run-scenario"));
    const report = await screen.findByTestId("run-report");
    expect(report).toHaveAttribute("data-status", "incomplete");
    expect(screen.getByTestId("not-tested")).toHaveTextContent(/No participant data/);
    expect(report).not.toHaveTextContent(/^Passed/);
  });

  it("shows a JSON error and does not run or save anything", async () => {
    show();
    setScenario("{ broken");
    fireEvent.click(screen.getByTestId("run-scenario"));
    expect(await screen.findByTestId("scenario-error")).toHaveTextContent(/not valid JSON/);
    expect(screen.queryByTestId("run-report")).toBeNull();
    expect(svc.saveRun).not.toHaveBeenCalled();
  });

  it("saves a scenario to the campaign, and lists saved scenarios with the result of their last run", async () => {
    svc.scenarios.mockResolvedValue([{ id: "s1", suite: "Winners", name: "Daily cap", version: 2, accepted: true, scenario: EXAMPLE_SCENARIO }]);
    svc.runs.mockResolvedValue([{ id: "r1", scenario_id: "s1", status: "failed", ran_at: new Date().toISOString(), build_label: "v0.3", scenario_version: 2 }]);
    show();
    const item = await screen.findByTestId("scenario-s1");
    expect(item).toHaveTextContent("Daily cap");
    expect(item).toHaveTextContent(/Failed/);
    fireEvent.click(item);
    fireEvent.click(await screen.findByRole("button", { name: /Save changes/ }));
    await waitFor(() => expect(svc.save).toHaveBeenCalled());
    expect(svc.save.mock.calls[0]![0]).toMatchObject({ id: "s1", campaignId: "c1", suite: "Winners" });
  });

  it("lets a viewer run checks but not save, record or delete anything", async () => {
    svc.canEdit.v = false;
    show();
    expect(screen.queryByRole("button", { name: /Save scenario/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /New scenario/ })).toBeNull();
    fireEvent.click(screen.getByTestId("run-scenario"));
    await screen.findByTestId("run-report");
    expect(svc.saveRun).not.toHaveBeenCalled();
  });
});
