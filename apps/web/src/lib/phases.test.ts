import { describe, expect, it } from "vitest";
import { phaseDone, phaseIndex, phaseOf, PHASES } from "./phases";
import { STAGES } from "@/lib/labels";

describe("phases", () => {
  it("maps every one of the seven stages to a phase, in order", () => {
    expect(STAGES.map(phaseOf)).toEqual(["Plan", "Build", "Build", "Review", "Review", "Launch", "Launch"]);
    const idx = STAGES.map(phaseIndex);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx); // phases never go backwards as stages advance
    expect(PHASES).toHaveLength(4);
  });
  it("marks earlier phases done, and everything done once completed", () => {
    expect([0, 1, 2, 3].map((i) => phaseDone("design", i))).toEqual([true, false, false, false]);
    expect([0, 1, 2, 3].map((i) => phaseDone("client_uat", i))).toEqual([true, true, false, false]);
    expect([0, 1, 2, 3].map((i) => phaseDone("completed", i))).toEqual([true, true, true, true]);
  });
});
