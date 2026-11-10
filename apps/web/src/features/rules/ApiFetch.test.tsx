import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const svc = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/services/connector", () => ({ apiCheckService: { run: svc.run } }));

import { ApiFetch, pickPath, toWinners } from "./ApiFetch";

describe("reading winners from an API answer", () => {
  it("finds a path in the answer", () => {
    expect(pickPath({ data: { winners: [1, 2] } }, "data.winners")).toEqual([1, 2]);
    expect(pickPath({ a: [{ b: 3 }] }, "a[0].b")).toBe(3);
    expect(pickPath({}, "x.y")).toBeUndefined();
  });
  it("maps the usual field names and keeps day, reward, tier, code and disbursement id", () => {
    expect(toWinners([{ id: 7, date: "2026-11-10", reward: "gold", tier: "A", disbursement_id: "d1" }, { participant_id: "p2" }, "p3"])).toEqual([
      { participantId: "7", day: "2026-11-10", reward: "gold", tier: "A", code: undefined, disbursementId: "d1" },
      { participantId: "p2", day: undefined, reward: undefined, tier: undefined, code: undefined, disbursementId: undefined },
      { participantId: "p3", day: undefined, reward: undefined, tier: undefined, code: undefined, disbursementId: undefined },
    ]);
  });
  it("explains what is wrong with an answer it cannot use", () => {
    expect(toWinners({ not: "a list" })).toMatch(/not a list/);
    expect(toWinners([{ name: "x" }])).toMatch(/Item 1 has no participant id/);
  });
});

describe("the staging API panel", () => {
  const fill = (url = "https://staging.example/api/winners") => fireEvent.change(screen.getByPlaceholderText(/staging.example/), { target: { value: url } });
  beforeEach(() => { vi.clearAllMocks(); svc.run.mockResolvedValue({ result: "passed", status: 200, ms: 40, assertions: [], json: { winners: [{ id: "p1", reward: "gold" }, { id: "p3" }] } }); });

  it("will not call anything until you say it is staging", () => {
    render(<ApiFetch allowed={[]} onWinners={() => undefined} />);
    fill();
    expect(screen.getByTestId("api-call")).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByTestId("api-call")).toBeEnabled();
  });

  it("calls through the connector with the allowed domains and hands the winners over", async () => {
    const onWinners = vi.fn();
    render(<ApiFetch allowed={["staging.example"]} onWinners={onWinners} />);
    fill();
    fireEvent.change(screen.getByLabelText("Headers"), { target: { value: "X-Api-Key: abc123" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("api-call"));
    await waitFor(() => expect(onWinners).toHaveBeenCalled());
    expect(svc.run).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", url: "https://staging.example/api/winners", headers: { "X-Api-Key": "abc123" }, secret_headers: ["X-Api-Key"] }), ["staging.example"]);
    expect(onWinners.mock.calls[0]![0].map((w: { participantId: string }) => w.participantId)).toEqual(["p1", "p3"]);
    expect(await screen.findByTestId("api-ok")).toHaveTextContent("HTTP 200");
  });

  it("says why when the address is refused, and uses nothing", async () => {
    svc.run.mockResolvedValue({ result: "blocked", error: "That address was not called: it points at a private address.", assertions: [] });
    const onWinners = vi.fn();
    render(<ApiFetch allowed={[]} onWinners={onWinners} />);
    fill("http://10.0.0.5/api");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("api-call"));
    expect(await screen.findByTestId("api-problem")).toHaveTextContent(/private address/);
    expect(onWinners).not.toHaveBeenCalled();
  });

  it("rejects a header line it cannot read, and a body that is not JSON", async () => {
    render(<ApiFetch allowed={[]} onWinners={() => undefined} />);
    fill();
    fireEvent.change(screen.getByLabelText("Headers"), { target: { value: "oops no colon" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("api-call"));
    expect(await screen.findByTestId("api-problem")).toHaveTextContent(/Name: value/);
    expect(svc.run).not.toHaveBeenCalled();
  });
});
