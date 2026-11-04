import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const turn = vi.fn();
const audit = vi.fn(async () => true);
vi.mock("@/services/assistant", () => ({
  assistantService: { turn: (p: unknown) => turn(JSON.parse(JSON.stringify(p))), audit: (...a: unknown[]) => audit(...(a as [])) },
  ConnectorOffline: class ConnectorOffline extends Error {},
}));

const applyFn = vi.fn(async () => ({ summary: "Created thing", campaignId: "camp", link: "/things/1" }));
vi.mock("./tools", () => ({
  TOOL_SPECS: [],
  TOOL_BY_NAME: new Map<string, unknown>([
    ["list_things", { kind: "read", name: "list_things", run: vi.fn(async () => ({ rows: [1, 2] })) }],
    ["make_thing", { kind: "write", name: "make_thing", propose: (a: { title?: string }) => {
      if (!a.title) throw new Error("Invalid arguments: title: Required");
      return { title: "Make thing", fields: [{ label: "Title", value: a.title }], apply: applyFn };
    } }],
  ]),
}));

import { useAssistant } from "./useAssistant";
import { ConnectorOffline } from "@/services/assistant";

const lookup = { campaign: () => "C", person: () => "P" };
const setup = () => {
  const onChanged = vi.fn();
  const hook = renderHook(() => useAssistant({ lookup, context: () => ({ today: "2026-11-04" }), onChanged }));
  return { ...hook, onChanged };
};
const call = (id: string, tool: string, args: Record<string, unknown> = {}) => ({ id, tool, args });
const lastTranscript = () => turn.mock.calls.at(-1)![0].transcript as { type: string; [k: string]: unknown }[];

beforeEach(() => { turn.mockReset(); audit.mockClear(); applyFn.mockClear(); });

describe("useAssistant", () => {
  it("reads data on its own, then answers", async () => {
    turn.mockResolvedValueOnce({ reply: "", calls: [call("a", "list_things")] }).mockResolvedValueOnce({ reply: "There are 2 things.", calls: [] });
    const { result } = setup();
    await act(async () => { await result.current.send("how many things?"); });
    expect(turn).toHaveBeenCalledTimes(2);
    expect(lastTranscript().map((e) => e.type)).toEqual(["user", "calls", "results"]);
    expect(result.current.items.map((i) => i.kind)).toEqual(["user", "lookup", "assistant"]);
    expect(result.current.items[1]).toMatchObject({ kind: "lookup", status: "done" });
  });

  it("shows a write as a Confirm card and does nothing until confirmed", async () => {
    turn.mockResolvedValueOnce({ reply: "I'll create it.", calls: [call("w1", "make_thing", { title: "T" })] });
    const { result, onChanged } = setup();
    await act(async () => { await result.current.send("make a thing"); });
    const p = result.current.items.find((i) => i.kind === "proposal")!;
    expect(p).toMatchObject({ status: "pending", card: { title: "Make thing" } });
    expect(applyFn).not.toHaveBeenCalled();
    expect(turn).toHaveBeenCalledTimes(1); // it waits for the user, no further model call

    await act(async () => { await result.current.confirm(p.id); });
    expect(applyFn).toHaveBeenCalledOnce();
    expect(result.current.items.find((i) => i.id === p.id)).toMatchObject({ status: "applied", link: "/things/1" });
    expect(onChanged).toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith("camp", "make_thing", "Created thing", { title: "T" });

    turn.mockResolvedValueOnce({ reply: "Done.", calls: [] });
    await act(async () => { await result.current.send("thanks"); });
    expect(lastTranscript().find((e) => e.type === "outcomes")).toMatchObject({ outcomes: [{ id: "w1", status: "applied" }] });
  });

  it("skipping a card tells Claude it was skipped and applies nothing", async () => {
    turn.mockResolvedValueOnce({ reply: "", calls: [call("w1", "make_thing", { title: "T" })] });
    const { result } = setup();
    await act(async () => { await result.current.send("x"); });
    act(() => result.current.skip(result.current.items.find((i) => i.kind === "proposal")!.id));
    expect(applyFn).not.toHaveBeenCalled();
    turn.mockResolvedValueOnce({ reply: "Ok.", calls: [] });
    await act(async () => { await result.current.send("next"); });
    expect(lastTranscript().find((e) => e.type === "outcomes")).toMatchObject({ outcomes: [{ status: "skipped" }] });
  });

  it("moving on without confirming counts as skipped", async () => {
    turn.mockResolvedValueOnce({ reply: "", calls: [call("w1", "make_thing", { title: "T" })] });
    const { result } = setup();
    await act(async () => { await result.current.send("x"); });
    turn.mockResolvedValueOnce({ reply: "Sure.", calls: [] });
    await act(async () => { await result.current.send("never mind, something else"); });
    expect(applyFn).not.toHaveBeenCalled();
    expect(result.current.items.find((i) => i.kind === "proposal")).toMatchObject({ status: "skipped" });
  });

  it("never shows changes proposed in the same step as a read", async () => {
    turn.mockResolvedValueOnce({ reply: "", calls: [call("a", "list_things"), call("w1", "make_thing", { title: "T" })] })
      .mockResolvedValueOnce({ reply: "Looked first.", calls: [] });
    const { result } = setup();
    await act(async () => { await result.current.send("x"); });
    expect(result.current.items.some((i) => i.kind === "proposal")).toBe(false);
    const results = lastTranscript().find((e) => e.type === "results") as unknown as { results: { id: string; ok: boolean; error?: string }[] };
    expect(results.results.find((r) => r.id === "w1")).toMatchObject({ ok: false });
  });

  it("an invalid proposal is reported back to Claude so it can fix it", async () => {
    turn.mockResolvedValueOnce({ reply: "", calls: [call("w1", "make_thing", {})] }).mockResolvedValueOnce({ reply: "Sorry, retrying.", calls: [] });
    const { result } = setup();
    await act(async () => { await result.current.send("x"); });
    expect(result.current.items.some((i) => i.kind === "proposal")).toBe(false);
    expect(lastTranscript().at(-1)).toMatchObject({ type: "outcomes", outcomes: [{ id: "w1", status: "failed" }] });
  });

  it("a failing change is shown as failed and never as applied", async () => {
    applyFn.mockRejectedValueOnce(new Error("row-level security policy"));
    turn.mockResolvedValueOnce({ reply: "", calls: [call("w1", "make_thing", { title: "T" })] });
    const { result, onChanged } = setup();
    await act(async () => { await result.current.send("x"); });
    await act(async () => { await result.current.confirm(result.current.items.find((i) => i.kind === "proposal")!.id); });
    expect(result.current.items.find((i) => i.kind === "proposal")).toMatchObject({ status: "failed" });
    expect(onChanged).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("stops a model that keeps looking things up", async () => {
    turn.mockResolvedValue({ reply: "", calls: [call("a", "list_things")] });
    const { result } = setup();
    await act(async () => { await result.current.send("x"); });
    expect(turn).toHaveBeenCalledTimes(6);
    expect(result.current.items.at(-1)).toMatchObject({ kind: "error" });
  });

  it("says so when the connector is not running", async () => {
    turn.mockRejectedValueOnce(new ConnectorOffline());
    const { result } = setup();
    await act(async () => { await result.current.send("x"); });
    expect(result.current.items.at(-1)).toMatchObject({ kind: "error", offline: true });
    expect(result.current.busy).toBe(false);
  });

  it("flags a missing audit log without hiding the applied change", async () => {
    audit.mockResolvedValueOnce(false);
    turn.mockResolvedValueOnce({ reply: "", calls: [call("w1", "make_thing", { title: "T" })] });
    const { result } = setup();
    await act(async () => { await result.current.send("x"); });
    await act(async () => { await result.current.confirm(result.current.items.find((i) => i.kind === "proposal")!.id); });
    expect(result.current.auditMissing).toBe(true);
    expect(result.current.items.find((i) => i.kind === "proposal")).toMatchObject({ status: "applied" });
  });
});
