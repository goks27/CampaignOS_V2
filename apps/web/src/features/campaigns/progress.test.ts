import { describe, expect, it } from "vitest";
import { nextAction } from "./progress";

const n = (key: string, step: string, count = 0) => ({ key, step, count }) as never;

describe("nextAction: the one next thing to do", () => {
  it("says it in words and points at where to do it", () => {
    expect(nextAction("c1", n("upload_sow", "requirements"))).toMatchObject({ label: "Upload the SOW", to: "/campaigns/c1/requirements" });
    expect(nextAction("c1", n("verify_requirements", "requirements", 12))).toMatchObject({ label: "Verify 12 draft requirements", to: "/campaigns/c1/requirements" });
    expect(nextAction("c1", n("submit_designs", "design"))).toMatchObject({ label: "Submit designs", to: "/campaigns/c1/design" });
    expect(nextAction("c1", n("review_findings", "inbox", 5))).toMatchObject({ label: "Review 5 findings", to: "/inbox?type=findings&campaign=c1" });
    expect(nextAction("c1", n("submit_build", "build"))).toMatchObject({ label: "Submit a staging build", to: "/campaigns/c1/build" });
    expect(nextAction("c1", n("record_approval", "launch"))).toMatchObject({ label: "Record client approval", to: "/campaigns/c1/launch" });
    expect(nextAction("c1", n("plan_deployment", "launch"))).toMatchObject({ label: "Plan the production deployment", to: "/campaigns/c1/launch" });
  });
  it("uses the singular for one item and mentions open client feedback", () => {
    expect(nextAction("c1", n("verify_requirements", "requirements", 1))?.label).toBe("Verify 1 draft requirement");
    expect(nextAction("c1", n("review_findings", "inbox", 1))?.label).toBe("Review 1 finding");
    expect(nextAction("c1", n("record_approval", "launch", 2))?.label).toBe("Record client approval (2 open feedback items)");
  });
  it("is null when nothing is waiting", () => { expect(nextAction("c1", null)).toBeNull(); });
});
