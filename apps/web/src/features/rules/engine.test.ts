import { describe, expect, it } from "vitest";
import { EXAMPLE_SCENARIO, chiSquareP, ineligibleBecause, mulberry32, parseParticipantsCsv, referenceDraw, runScenario, type Participant, type Scenario } from "./engine";

const NOW = () => "2026-11-10T00:00:00.000Z";
const people: Participant[] = [
  { id: "p1", age: 25, region: "IN", consent: true, kyc: true, purchase: 500, entries: 1 },
  { id: "p2", age: 17, region: "IN", consent: true, kyc: true, purchase: 500, entries: 1 },
  { id: "p3", age: 18, region: "IN", consent: true, kyc: true, purchase: 500, entries: 4 },
  { id: "p4", age: 30, region: "US", consent: true, kyc: true, purchase: 500 },
  { id: "p5", age: 30, region: "IN", consent: false, kyc: true, purchase: 500 },
  { id: "p6", age: 30, region: "IN", consent: true, kyc: false, purchase: 500 },
  { id: "p7", age: 30, region: "IN", consent: true, kyc: true, purchase: 99 },
  { id: "p8", age: 30, region: "IN", consent: true, kyc: true, purchase: 500, excluded: true },
];
const base = (over: Partial<Scenario> = {}): Scenario => ({
  name: "t", participants: people, rules: { eligibility: { minAge: 18, regions: ["IN"], minPurchase: 100, requireConsent: true, requireKyc: true }, winners: { total: 2, perDay: 1 } },
  actual: { winners: [{ participantId: "p1", day: "d1" }, { participantId: "p3", day: "d2" }] }, ...over,
});
const check = (s: Scenario, id: string) => runScenario(s, NOW).checks.find((c) => c.id === id)!;

describe("eligibility", () => {
  it("explains each way of being ineligible, including the boundary age", () => {
    const r = base().rules.eligibility;
    expect(ineligibleBecause(people[0]!, r)).toBeNull();
    expect(ineligibleBecause(people[2]!, r)).toBeNull(); // exactly 18 is allowed
    expect(ineligibleBecause(people[1]!, r)).toMatch(/under 18/);
    expect(ineligibleBecause(people[3]!, r)).toMatch(/outside IN/);
    expect(ineligibleBecause(people[4]!, r)).toMatch(/consent/);
    expect(ineligibleBecause(people[5]!, r)).toMatch(/KYC/);
    expect(ineligibleBecause(people[6]!, r)).toMatch(/under the minimum 100/);
    expect(ineligibleBecause(people[7]!, r)).toMatch(/exclusion list/);
    expect(ineligibleBecause({ id: "x" }, r)).toMatch(/no age/);
  });
  it("passes when every winner is eligible", () => { expect(check(base(), "eligibility").status).toBe("passed"); });
  it("fails and names every ineligible winner", () => {
    const c = check(base({ actual: { winners: [{ participantId: "p2" }, { participantId: "p4" }, { participantId: "p1" }] } }), "eligibility");
    expect(c.status).toBe("failed");
    expect(c.details).toEqual(expect.arrayContaining([expect.stringContaining("p2 is under 18"), expect.stringContaining("p4 is in US")]));
  });
  it("fails for a winner who is not in the participant list", () => {
    expect(check(base({ actual: { winners: [{ participantId: "ghost" }] } }), "eligibility").status).toBe("failed");
  });
  it("fails when an excluded participant wins", () => {
    expect(check(base({ actual: { winners: [{ participantId: "p8" }] } }), "excluded")).toMatchObject({ status: "failed", actual: "Excluded and won: p8" });
  });
  it("claims nothing without participant data", () => {
    expect(check(base({ participants: undefined }), "eligibility").status).toBe("needs_verification");
  });
  it("respects the campaign dates", () => {
    const r = { from: "2026-11-01", to: "2026-11-30" };
    expect(ineligibleBecause({ id: "a", enteredAt: "2026-10-31" }, r)).toMatch(/before the start/);
    expect(ineligibleBecause({ id: "a", enteredAt: "2026-12-01" }, r)).toMatch(/after the end/);
    expect(ineligibleBecause({ id: "a", enteredAt: "2026-11-30" }, r)).toBeNull();
  });
});

describe("winner selection constraints", () => {
  it("detects a winner selected twice", () => {
    const c = check(base({ actual: { winners: [{ participantId: "p1" }, { participantId: "p1" }] } }), "unique_winners");
    expect(c).toMatchObject({ status: "failed" });
    expect(c.actual).toMatch(/p1 \(2 times\)/);
  });
  it("detects too many winners, and accepts exactly the limit", () => {
    expect(check(base({ actual: { winners: [{ participantId: "p1" }, { participantId: "p3" }, { participantId: "p5" }] } }), "winner_count").status).toBe("failed");
    expect(check(base(), "winner_count").status).toBe("passed");
  });
  it("detects the daily cap being exceeded", () => {
    const c = check(base({ actual: { winners: [{ participantId: "p1", day: "d1" }, { participantId: "p3", day: "d1" }] } }), "daily_cap");
    expect(c).toMatchObject({ status: "failed", actual: "Over the cap on d1: 2" });
  });
  it("needs verification when winners have no day", () => {
    expect(check(base({ actual: { winners: [{ participantId: "p1" }] } }), "daily_cap").status).toBe("needs_verification");
  });
  it("compares the actual winners with the expected winners, showing who is missing and who is unexpected", () => {
    const c = check(base({ expected: { winnerIds: ["p1", "p5"] } }), "expected_winners");
    expect(c.status).toBe("failed");
    expect(c.details).toEqual(["p5 should have won", "p3 should not have won"]);
  });
  it("can allow repeat winners when the rules do", () => {
    const s = base({ actual: { winners: [{ participantId: "p1" }, { participantId: "p1" }] } });
    s.rules.winners = { allowRepeat: true };
    expect(check(s, "unique_winners").status).toBe("not_run");
  });
});

describe("seeded selection", () => {
  const pool: Participant[] = Array.from({ length: 20 }, (_, i) => ({ id: `u${String(i).padStart(2, "0")}`, age: 30, region: "IN", consent: true }));
  it("the same seed gives the same draw, a different seed a different one", () => {
    const rules = { eligibility: { minAge: 18 } };
    expect(referenceDraw(pool, rules, 7, 5)).toEqual(referenceDraw(pool, rules, 7, 5));
    expect(referenceDraw(pool, rules, 7, 5)).not.toEqual(referenceDraw(pool, rules, 8, 5));
    expect(new Set(referenceDraw(pool, rules, 7, 5)).size).toBe(5);
  });
  it("only ever draws eligible participants", () => {
    const drawn = referenceDraw([...pool, { id: "kid", age: 9, region: "IN" }], { eligibility: { minAge: 18 } }, 1, 21);
    expect(drawn).not.toContain("kid");
  });
  it("passes when the system repeats the reference draw and fails when it does not", () => {
    const rules = { eligibility: { minAge: 18 } };
    const ref = referenceDraw(pool, rules, 42, 3);
    const ok: Scenario = { name: "s", rules, participants: pool, seed: 42, actual: { winners: ref.map((participantId) => ({ participantId })) } };
    expect(check(ok, "seeded_draw").status).toBe("passed");
    expect(check({ ...ok, actual: { winners: [{ participantId: "u00" }, { participantId: "u01" }, { participantId: "u02" }] } }, "seeded_draw").status).toBe("failed");
  });
  it("is a deterministic generator", () => {
    const a = mulberry32(5), b = mulberry32(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("accepts a fair spread of many draws and rejects a rigged one", () => {
    const eligible = pool.map((p) => p.id);
    const rnd = mulberry32(99);
    const fair = Array.from({ length: 400 }, () => [eligible[Math.floor(rnd() * eligible.length)]!]);
    const rules = { eligibility: { minAge: 18 } };
    expect(check({ name: "f", rules, participants: pool, actual: { draws: fair } }, "draw_distribution").status).toBe("passed");
    const rigged = Array.from({ length: 400 }, (_, i) => [i % 4 === 0 ? "u00" : eligible[Math.floor(rnd() * eligible.length)]!]);
    expect(check({ name: "r", rules, participants: pool, actual: { draws: rigged } }, "draw_distribution").status).toBe("failed");
  });
  it("will not judge fairness from too few draws", () => {
    expect(check({ name: "x", rules: {}, participants: pool, actual: { draws: [["u00"], ["u01"]] } }, "draw_distribution").status).toBe("needs_verification");
  });
  it("chi-square p-values behave", () => {
    expect(chiSquareP(0, 10)).toBeGreaterThan(0.99);
    expect(chiSquareP(60, 10)).toBeLessThan(0.001);
  });
});

describe("unique codes", () => {
  const codes = [{ code: "GD-0001" }, { code: "GD-0002", expiresAt: "2026-11-01" }, { code: "OT-0003", campaign: "other" }];
  const s = (reds: { code: string }[]): Scenario => ({ name: "c", rules: { codes: { pattern: "^GD-\\d{4}$", campaign: "gold", asOf: "2026-11-10" } }, codes, actual: { redemptions: reds } });
  it("passes valid codes", () => { expect(check(s([{ code: "GD-0001" }]), "code_valid").status).toBe("passed"); });
  it("flags a wrong format, an unknown code, an expired code and a code of another campaign", () => {
    const c = check(s([{ code: "BAD" }, { code: "GD-9999" }, { code: "GD-0002" }, { code: "OT-0003" }]), "code_valid");
    expect(c.status).toBe("failed");
    expect(c.details).toEqual(expect.arrayContaining(["BAD has the wrong format", "GD-9999 is not a code of this campaign", expect.stringContaining("GD-0002 had expired"), expect.stringContaining("OT-0003")]));
  });
  it("catches a code redeemed twice", () => {
    expect(check(s([{ code: "GD-0001" }, { code: "GD-0001" }]), "code_duplicate")).toMatchObject({ status: "failed", actual: "Redeemed more than once: GD-0001 (2 times)" });
  });
  it("needs verification when nothing says what a valid code looks like", () => {
    expect(check({ name: "c", rules: {}, actual: { redemptions: [{ code: "X" }] } }, "code_valid").status).toBe("needs_verification");
  });
});

describe("rewards", () => {
  const rules = { rewards: { inventory: { gold: 1, voucher: 2 }, byTier: { A: "gold", B: "voucher" }, fallback: "voucher" } };
  const s = (winners: Scenario["actual"]["winners"]): Scenario => ({ name: "r", rules, actual: { winners } });
  it("passes the expected reward for each tier", () => {
    expect(check(s([{ participantId: "a", tier: "A", reward: "gold" }, { participantId: "b", tier: "B", reward: "voucher" }]), "reward_mapping").status).toBe("passed");
  });
  it("detects an incorrect reward allocation", () => {
    const c = check(s([{ participantId: "a", tier: "A", reward: "voucher" }]), "reward_mapping");
    expect(c).toMatchObject({ status: "failed" });
    expect(c.details[0]).toBe("a got voucher, expected gold");
  });
  it("detects a reward given beyond its stock", () => {
    const c = check(s([{ participantId: "a", reward: "gold" }, { participantId: "b", reward: "gold" }]), "reward_inventory");
    expect(c).toMatchObject({ status: "failed", actual: "Over stock: gold: 2 given, 1 in stock" });
  });
  it("checks the fallback once a reward is out of stock", () => {
    const good = check(s([{ participantId: "a", tier: "A", reward: "gold" }, { participantId: "b", tier: "A", reward: "voucher" }]), "reward_fallback");
    expect(good.status).toBe("passed");
    const bad = check(s([{ participantId: "a", tier: "A", reward: "gold" }, { participantId: "b", tier: "A", reward: "gold" }]), "reward_fallback");
    expect(bad.status).toBe("failed");
    expect(bad.details[0]).toMatch(/b got gold; gold was out of stock so voucher was expected/);
  });
  it("detects a reward disbursed twice, and says it cannot check without disbursement ids", () => {
    expect(check(s([{ participantId: "a", disbursementId: "d1" }, { participantId: "b", disbursementId: "d1" }]), "reward_duplicate").status).toBe("failed");
    expect(check(s([{ participantId: "a" }]), "reward_duplicate").status).toBe("needs_verification");
  });
});

describe("participation and cases", () => {
  it("fails a participant over the entry limit and accepts the limit itself", () => {
    const sc = base(); sc.rules.participation = { maxEntriesPerParticipant: 3 };
    expect(check(sc, "participation_limit")).toMatchObject({ status: "failed", actual: "Over the limit: p3: 4" });
    sc.rules.participation = { maxEntriesPerParticipant: 4 };
    expect(check(sc, "participation_limit").status).toBe("passed");
  });
  it("compares each case with what was expected (invalid input, failed API, duplicates)", () => {
    const sc: Scenario = { name: "a", rules: {}, actual: { attempts: [{ name: "empty code", expected: "rejected", actual: "rejected" }, { name: "API timeout", expected: "retry then fail gracefully", actual: "500 page" }] } };
    const c = check(sc, "attempts");
    expect(c.status).toBe("failed");
    expect(c.details).toEqual(["API timeout: expected retry then fail gracefully, got 500 page"]);
  });
});

describe("a run never claims more than was tested", () => {
  it("is passed only when every check that applies passed and nothing needs verification", () => {
    const r = runScenario(EXAMPLE_SCENARIO, NOW);
    expect(r.counts.failed).toBe(0);
    expect(r.status).toBe("passed");
  });
  it("is failed as soon as one check fails", () => {
    const sc: Scenario = { ...EXAMPLE_SCENARIO, actual: { winners: [{ participantId: "p2", day: "2026-11-10" }, { participantId: "p3", day: "2026-11-11" }] } };
    expect(runScenario(sc, NOW).status).toBe("failed");
  });
  it("is incomplete, not passed, when something could not be verified", () => {
    const sc: Scenario = { ...EXAMPLE_SCENARIO, participants: undefined };
    const r = runScenario(sc, NOW);
    expect(r.status).toBe("incomplete");
    expect(r.notTested.join(" ")).toMatch(/No participant data/);
  });
  it("is incomplete when a required check did not run", () => {
    const sc: Scenario = { name: "x", rules: { required: ["eligibility", "unique_winners"] }, actual: { winners: [{ participantId: "p1" }] } };
    const r = runScenario(sc, NOW);
    expect(r.status).toBe("incomplete");
    expect(r.notTested).toContain('Required check "eligibility" did not run');
  });
  it("is incomplete, never passed, when nothing was checked at all", () => {
    expect(runScenario({ name: "empty", rules: {}, actual: {} }, NOW).status).toBe("incomplete");
  });
});

describe("participants from CSV", () => {
  it("reads numbers and yes/no values and keeps other text", () => {
    const p = parseParticipantsCsv("id,age,region,consent,excluded,purchase\np1,25,IN,yes,no,500\np2,17,US,true,1,");
    expect(p).toEqual([{ id: "p1", age: 25, region: "IN", consent: true, excluded: false, purchase: 500 }, { id: "p2", age: 17, region: "US", consent: true, excluded: true }]);
  });
  it("needs an id column", () => { expect(() => parseParticipantsCsv("name,age\nx,1")).toThrow(/id/); });
});
