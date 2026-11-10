/**
 * Rules engine: deterministic checks of campaign mechanics (eligibility, unique codes, winner selection, caps, rewards, participation).
 * No AI and no network here. A scenario supplies the rules, the data it was run on, and what the system ACTUALLY did (winners picked,
 * codes redeemed, rewards given); the engine asserts the actual outcome against the rules and against any expected outcome.
 *
 * A check is Passed, Failed, Needs verification (the data to decide is missing, so nothing is claimed), or Not run (it does not apply).
 * A run is only "passed" when every check that applies passed and nothing needs verification: an untested rule is never counted as fine.
 */

export type Participant = {
  id: string; excluded?: boolean; region?: string; age?: number; purchase?: number; consent?: boolean; kyc?: boolean; enteredAt?: string; entries?: number;
  [k: string]: unknown;
};
export type Winner = { participantId: string; day?: string; reward?: string; tier?: string; code?: string; disbursementId?: string };
export type CodeRecord = { code: string; campaign?: string; expiresAt?: string; redeemed?: boolean };
export type Redemption = { code: string; participantId?: string; campaign?: string; at?: string };
export type Attempt = { name: string; input?: unknown; expected: string; actual: string };

export type Rules = {
  eligibility?: { minAge?: number; regions?: string[]; minPurchase?: number; requireConsent?: boolean; requireKyc?: boolean; from?: string; to?: string };
  winners?: { total?: number; perDay?: number; allowRepeat?: boolean };
  codes?: { pattern?: string; campaign?: string; asOf?: string };
  rewards?: { inventory?: Record<string, number>; byTier?: Record<string, string>; fallback?: string };
  participation?: { maxEntriesPerParticipant?: number };
  /** Ids of checks that must have run for the run to count as complete. */
  required?: CheckId[];
};
export type Scenario = {
  name: string;
  rules: Rules;
  participants?: Participant[];
  codes?: CodeRecord[];
  actual: { winners?: Winner[]; redemptions?: Redemption[]; attempts?: Attempt[]; draws?: string[][] };
  expected?: { winnerIds?: string[]; winnerCount?: number; rewards?: Record<string, string> };
  /** For a draw that claims to be seeded: Journey's reference draw with this seed must give the same winners. Optional, labelled as the reference. */
  seed?: number;
};

export type Status = "passed" | "failed" | "needs_verification" | "not_run" | "blocked";
export type CheckId =
  | "eligibility" | "excluded" | "unique_winners" | "winner_count" | "daily_cap" | "expected_winners" | "seeded_draw" | "draw_distribution"
  | "code_valid" | "code_duplicate" | "reward_mapping" | "reward_inventory" | "reward_duplicate" | "reward_fallback" | "participation_limit" | "attempts";
export type Check = { id: CheckId; title: string; category: "eligibility" | "winners" | "codes" | "rewards" | "participation" | "scenarios"; status: Status; expected: string; actual: string; details: string[] };
export type RunResult = { name: string; status: "passed" | "failed" | "incomplete"; checks: Check[]; counts: Record<Status, number>; notTested: string[]; ranAt: string };

const list = (xs: string[], n = 6) => (xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.join(", ")) || "none";
const mk = (id: CheckId, category: Check["category"], title: string, status: Status, expected: string, actual: string, details: string[] = []): Check => ({ id, category, title, status, expected, actual, details });
const notRun = (id: CheckId, category: Check["category"], title: string, why: string) => mk(id, category, title, "not_run", "", why);
const needs = (id: CheckId, category: Check["category"], title: string, why: string) => mk(id, category, title, "needs_verification", "", why);

/** Small seeded generator, so a draw can be repeated exactly. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Why someone is not eligible under the rules, or null when they are. */
export function ineligibleBecause(p: Participant, r: Rules["eligibility"] = {}): string | null {
  if (p.excluded) return "is on the exclusion list";
  if (r.minAge != null && (p.age == null || p.age < r.minAge)) return p.age == null ? "has no age on record" : `is under ${r.minAge}`;
  if (r.regions?.length && (!p.region || !r.regions.includes(p.region))) return `is in ${p.region ?? "an unknown region"}, outside ${r.regions.join(", ")}`;
  if (r.minPurchase != null && (p.purchase ?? 0) < r.minPurchase) return `spent ${p.purchase ?? 0}, under the minimum ${r.minPurchase}`;
  if (r.requireConsent && !p.consent) return "has not given consent";
  if (r.requireKyc && !p.kyc) return "has not completed KYC";
  if (p.enteredAt && r.from && p.enteredAt < r.from) return `entered ${p.enteredAt}, before the start ${r.from}`;
  if (p.enteredAt && r.to && p.enteredAt > r.to) return `entered ${p.enteredAt}, after the end ${r.to}`;
  return null;
}

/** The reference seeded draw: eligible people sorted by id, shuffled with the seed, first N. Only used when a scenario asks for it. */
export function referenceDraw(participants: Participant[], rules: Rules, seed: number, n: number): string[] {
  const pool = participants.filter((p) => !ineligibleBecause(p, rules.eligibility)).map((p) => p.id).sort();
  const rnd = mulberry32(seed);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
  return pool.slice(0, n);
}

/** Chi-square p-value (Wilson-Hilferty). Enough to tell a fair draw from a rigged one with plenty of samples. */
export function chiSquareP(stat: number, df: number): number {
  if (df <= 0) return 1;
  const z = (Math.cbrt(stat / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  const erf = (x: number) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
  return 0.5 * (1 - erf(z / Math.SQRT2));
}

export function runScenario(s: Scenario, now = () => new Date().toISOString()): RunResult {
  const checks: Check[] = [];
  const winners = s.actual.winners;
  const byId = new Map((s.participants ?? []).map((p) => [p.id, p]));
  const rules = s.rules ?? {};

  // ---- eligibility
  if (!winners) {
    for (const [id, t] of [["eligibility", "Every winner is eligible"], ["excluded", "No excluded participant won"]] as const) checks.push(notRun(id, "eligibility", t, "No winners were supplied."));
  } else if (!s.participants?.length) {
    checks.push(needs("eligibility", "eligibility", "Every winner is eligible", "No participant data was supplied, so eligibility cannot be checked."));
    checks.push(needs("excluded", "eligibility", "No excluded participant won", "No participant data was supplied."));
  } else {
    const unknown = winners.filter((w) => !byId.has(w.participantId)).map((w) => w.participantId);
    const bad = winners.flatMap((w) => { const p = byId.get(w.participantId); const why = p ? ineligibleBecause(p, rules.eligibility) : null; return why ? [`${w.participantId} ${why}`] : []; });
    checks.push(mk("eligibility", "eligibility", "Every winner is eligible", bad.length || unknown.length ? "failed" : "passed", "All winners meet the eligibility rules", bad.length ? `${bad.length} ineligible: ${list(bad)}` : unknown.length ? `${unknown.length} winners are not in the participant list: ${list(unknown)}` : `${winners.length} of ${winners.length} eligible`, [...bad, ...unknown.map((u) => `${u} is not a known participant`)]));
    const excluded = winners.filter((w) => byId.get(w.participantId)?.excluded).map((w) => w.participantId);
    checks.push(mk("excluded", "eligibility", "No excluded participant won", excluded.length ? "failed" : "passed", "No excluded participant is a winner", excluded.length ? `Excluded and won: ${list(excluded)}` : "None won", excluded));
  }

  // ---- winners: uniqueness, counts, caps
  if (!winners) {
    for (const [id, t] of [["unique_winners", "Nobody wins twice"], ["winner_count", "Winner count is within the limit"], ["daily_cap", "Daily winner cap is respected"]] as const) checks.push(notRun(id, "winners", t, "No winners were supplied."));
  } else {
    const counts = new Map<string, number>();
    for (const w of winners) counts.set(w.participantId, (counts.get(w.participantId) ?? 0) + 1);
    const dup = [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} (${n} times)`);
    checks.push(rules.winners?.allowRepeat
      ? notRun("unique_winners", "winners", "Nobody wins twice", "Repeat winners are allowed by the rules.")
      : mk("unique_winners", "winners", "Nobody wins twice", dup.length ? "failed" : "passed", "Each participant wins at most once", dup.length ? `Won more than once: ${list(dup)}` : "All winners are different", dup));
    const total = rules.winners?.total;
    checks.push(total == null ? notRun("winner_count", "winners", "Winner count is within the limit", "No winner limit is set in the rules.")
      : mk("winner_count", "winners", "Winner count is within the limit", winners.length > total ? "failed" : "passed", `At most ${total} winners`, `${winners.length} winners`));
    const perDay = rules.winners?.perDay;
    if (perDay == null) checks.push(notRun("daily_cap", "winners", "Daily winner cap is respected", "No daily cap is set in the rules."));
    else if (winners.some((w) => !w.day)) checks.push(needs("daily_cap", "winners", "Daily winner cap is respected", "Some winners have no day, so the daily cap cannot be checked."));
    else {
      const days = new Map<string, number>();
      for (const w of winners) days.set(w.day!, (days.get(w.day!) ?? 0) + 1);
      const over = [...days.entries()].filter(([, n]) => n > perDay).map(([d, n]) => `${d}: ${n}`);
      checks.push(mk("daily_cap", "winners", "Daily winner cap is respected", over.length ? "failed" : "passed", `At most ${perDay} winners a day`, over.length ? `Over the cap on ${list(over)}` : `Busiest day: ${Math.max(0, ...days.values())}`, over));
    }
  }

  // ---- expected winners, seeded reference, distribution
  if (s.expected?.winnerIds && winners) {
    const want = new Set(s.expected.winnerIds), got = new Set(winners.map((w) => w.participantId));
    const missing = [...want].filter((x) => !got.has(x)), extra = [...got].filter((x) => !want.has(x));
    checks.push(mk("expected_winners", "winners", "Winners match the expected winners", missing.length || extra.length ? "failed" : "passed", `Winners: ${list([...want])}`, missing.length || extra.length ? `Missing: ${list(missing)}. Unexpected: ${list(extra)}` : "Same winners", [...missing.map((m) => `${m} should have won`), ...extra.map((e) => `${e} should not have won`)]));
  } else if (s.expected?.winnerCount != null && winners) {
    checks.push(mk("expected_winners", "winners", "Winner count matches the expected count", winners.length === s.expected.winnerCount ? "passed" : "failed", `${s.expected.winnerCount} winners`, `${winners.length} winners`));
  } else checks.push(notRun("expected_winners", "winners", "Winners match the expected winners", "No expected winners were given."));

  if (s.seed != null && winners && s.participants?.length) {
    const ref = referenceDraw(s.participants, rules, s.seed, winners.length);
    const got = winners.map((w) => w.participantId);
    const same = ref.length === got.length && ref.every((x, i) => x === got[i]);
    checks.push(mk("seeded_draw", "winners", "A seeded draw repeats exactly (Journey's reference draw)", same ? "passed" : "failed", `Seed ${s.seed} gives ${list(ref)}`, `Got ${list(got)}`, same ? [] : ["This check only applies if the system uses the same method: eligible ids sorted, shuffled with the seed. Otherwise rely on the constraint checks."]));
  } else checks.push(notRun("seeded_draw", "winners", "A seeded draw repeats exactly (Journey's reference draw)", "No seed was given."));

  const draws = s.actual.draws;
  if (!draws?.length) checks.push(notRun("draw_distribution", "winners", "Selection is spread fairly across eligible participants", "No repeated draws were supplied."));
  else {
    const pool = (s.participants ?? []).filter((p) => !ineligibleBecause(p, rules.eligibility)).map((p) => p.id);
    const picks = draws.flat();
    const expectedEach = picks.length / (pool.length || 1);
    if (pool.length < 2 || expectedEach < 5) checks.push(needs("draw_distribution", "winners", "Selection is spread fairly across eligible participants", `Too few draws to judge fairness (about ${expectedEach.toFixed(1)} picks per person; at least 5 are needed).`));
    else {
      const tally = new Map(pool.map((id) => [id, 0]));
      let outside = 0;
      for (const id of picks) { if (tally.has(id)) tally.set(id, tally.get(id)! + 1); else outside++; }
      const stat = [...tally.values()].reduce((a, c) => a + (c - expectedEach) ** 2 / expectedEach, 0);
      const p = chiSquareP(stat, pool.length - 1);
      checks.push(mk("draw_distribution", "winners", "Selection is spread fairly across eligible participants", outside || p < 0.001 ? "failed" : "passed", "Every eligible participant is about equally likely (chi-square, p at least 0.001)", outside ? `${outside} picks were not eligible participants` : `p = ${p.toFixed(4)} over ${draws.length} draws`, outside ? [`${outside} picks outside the eligible pool`] : []));
    }
  }

  // ---- codes
  const reds = s.actual.redemptions;
  if (!reds) { checks.push(notRun("code_valid", "codes", "Every redeemed code is valid", "No redemptions were supplied.")); checks.push(notRun("code_duplicate", "codes", "No code is redeemed twice", "No redemptions were supplied.")); }
  else {
    const known = new Map((s.codes ?? []).map((c) => [c.code, c]));
    const re = rules.codes?.pattern ? new RegExp(rules.codes.pattern) : null;
    const asOf = rules.codes?.asOf ?? now().slice(0, 10);
    const problems = reds.flatMap((r) => {
      const out: string[] = [];
      if (re && !re.test(r.code)) out.push(`${r.code} has the wrong format`);
      if (s.codes) {
        const c = known.get(r.code);
        if (!c) out.push(`${r.code} is not a code of this campaign`);
        else {
          if (c.expiresAt && c.expiresAt < asOf) out.push(`${r.code} had expired (${c.expiresAt})`);
          if (rules.codes?.campaign && c.campaign && c.campaign !== rules.codes.campaign) out.push(`${r.code} belongs to ${c.campaign}`);
        }
      }
      return out;
    });
    const canJudge = Boolean(re) || Boolean(s.codes);
    checks.push(canJudge ? mk("code_valid", "codes", "Every redeemed code is valid", problems.length ? "failed" : "passed", "Only valid, unexpired codes of this campaign are redeemed", problems.length ? `${problems.length} problems: ${list(problems)}` : `${reds.length} redemptions valid`, problems)
      : needs("code_valid", "codes", "Every redeemed code is valid", "Neither a code format nor the list of valid codes was supplied."));
    const seen = new Map<string, number>();
    for (const r of reds) seen.set(r.code, (seen.get(r.code) ?? 0) + 1);
    const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([c, n]) => `${c} (${n} times)`);
    checks.push(mk("code_duplicate", "codes", "No code is redeemed twice", dup.length ? "failed" : "passed", "Each code is redeemed at most once", dup.length ? `Redeemed more than once: ${list(dup)}` : "No duplicates", dup));
  }

  // ---- rewards
  if (!winners) for (const [id, t] of [["reward_mapping", "Each winner gets the expected reward"], ["reward_inventory", "Rewards stay within stock"], ["reward_duplicate", "No reward is given twice"], ["reward_fallback", "An exhausted reward falls back correctly"]] as const) checks.push(notRun(id, "rewards", t, "No winners were supplied."));
  else {
    const exp = s.expected?.rewards ?? (rules.rewards?.byTier ? Object.fromEntries(winners.filter((w) => w.tier && rules.rewards!.byTier![w.tier]).map((w) => [w.participantId, rules.rewards!.byTier![w.tier!]!])) : null);
    if (!exp || !Object.keys(exp).length) checks.push(notRun("reward_mapping", "rewards", "Each winner gets the expected reward", "No expected rewards or tier mapping were given."));
    else {
      const wrong = winners.filter((w) => exp[w.participantId] != null && w.reward !== exp[w.participantId]).map((w) => `${w.participantId} got ${w.reward ?? "nothing"}, expected ${exp[w.participantId]}`);
      checks.push(mk("reward_mapping", "rewards", "Each winner gets the expected reward", wrong.length ? "failed" : "passed", "Reward matches the expected reward", wrong.length ? `Wrong: ${list(wrong)}` : "All rewards match", wrong));
    }
    const inv = rules.rewards?.inventory;
    if (!inv) { checks.push(notRun("reward_inventory", "rewards", "Rewards stay within stock", "No reward inventory was given.")); checks.push(notRun("reward_fallback", "rewards", "An exhausted reward falls back correctly", "No reward inventory was given.")); }
    else {
      const given = new Map<string, number>();
      for (const w of winners) if (w.reward) given.set(w.reward, (given.get(w.reward) ?? 0) + 1);
      const over = [...given.entries()].filter(([r, n]) => n > (inv[r] ?? 0)).map(([r, n]) => `${r}: ${n} given, ${inv[r] ?? 0} in stock`);
      checks.push(mk("reward_inventory", "rewards", "Rewards stay within stock", over.length ? "failed" : "passed", "No reward is given more often than its stock", over.length ? `Over stock: ${list(over)}` : "Within stock", over));
      const fb = rules.rewards?.fallback;
      if (!fb) checks.push(notRun("reward_fallback", "rewards", "An exhausted reward falls back correctly", "No fallback reward is set."));
      else {
        const remaining = { ...inv }; const bad: string[] = [];
        for (const w of winners) {
          const want = exp?.[w.participantId];
          if (!want || want === fb) continue;
          if ((remaining[want] ?? 0) > 0) { remaining[want]!--; if (w.reward !== want) bad.push(`${w.participantId} got ${w.reward ?? "nothing"} while ${want} was in stock`); }
          else if (w.reward !== fb) bad.push(`${w.participantId} got ${w.reward ?? "nothing"}; ${want} was out of stock so ${fb} was expected`);
        }
        checks.push(mk("reward_fallback", "rewards", "An exhausted reward falls back correctly", bad.length ? "failed" : "passed", `When a reward runs out the winner gets ${fb}`, bad.length ? list(bad) : "Fallback used correctly", bad));
      }
    }
    const ids = winners.map((w) => w.disbursementId).filter((x): x is string => Boolean(x));
    if (!ids.length) checks.push(needs("reward_duplicate", "rewards", "No reward is given twice", "No disbursement ids were supplied, so duplicate disbursement cannot be checked."));
    else {
      const c = new Map<string, number>(); for (const i of ids) c.set(i, (c.get(i) ?? 0) + 1);
      const dup = [...c.entries()].filter(([, n]) => n > 1).map(([i, n]) => `${i} (${n} times)`);
      checks.push(mk("reward_duplicate", "rewards", "No reward is given twice", dup.length ? "failed" : "passed", "Each disbursement happens once", dup.length ? `Repeated: ${list(dup)}` : "No repeats", dup));
    }
  }

  // ---- participation
  const max = rules.participation?.maxEntriesPerParticipant;
  if (max == null) checks.push(notRun("participation_limit", "participation", "Participation limit is respected", "No participation limit is set."));
  else if (!s.participants?.some((p) => p.entries != null)) checks.push(needs("participation_limit", "participation", "Participation limit is respected", "No entry counts were supplied."));
  else {
    const over = s.participants.filter((p) => (p.entries ?? 0) > max).map((p) => `${p.id}: ${p.entries}`);
    checks.push(mk("participation_limit", "participation", "Participation limit is respected", over.length ? "failed" : "passed", `At most ${max} entries each`, over.length ? `Over the limit: ${list(over)}` : "Within the limit", over));
  }

  // ---- expected versus actual, case by case (boundaries, invalid input, API failures, duplicates)
  const att = s.actual.attempts;
  if (!att?.length) checks.push(notRun("attempts", "scenarios", "Each case ended as expected", "No cases were supplied."));
  else {
    const wrong = att.filter((a) => a.expected !== a.actual).map((a) => `${a.name}: expected ${a.expected}, got ${a.actual}`);
    checks.push(mk("attempts", "scenarios", "Each case ended as expected", wrong.length ? "failed" : "passed", `${att.length} cases end as expected`, wrong.length ? `${wrong.length} differ: ${list(wrong)}` : `${att.length} of ${att.length} as expected`, wrong));
  }

  const counts: Record<Status, number> = { passed: 0, failed: 0, needs_verification: 0, not_run: 0, blocked: 0 };
  for (const c of checks) counts[c.status]++;
  const required = rules.required ?? [];
  const missing = required.filter((id) => checks.find((c) => c.id === id)?.status !== "passed" && checks.find((c) => c.id === id)?.status !== "failed");
  const notTested = [...checks.filter((c) => c.status === "needs_verification").map((c) => `${c.title}: ${c.actual}`), ...missing.map((id) => `Required check "${id}" did not run`)];
  const status: RunResult["status"] = counts.failed ? "failed" : counts.needs_verification || missing.length || !counts.passed ? "incomplete" : "passed";
  return { name: s.name, status, checks, counts, notTested, ranAt: now() };
}

/** Participants from CSV text: a header row, then one person per row. Numbers and yes/no values are converted. */
export function parseParticipantsCsv(text: string): Participant[] {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
  if (rows.length < 2) return [];
  const head = rows[0]!.map((h) => h.toLowerCase());
  if (!head.includes("id")) throw new Error("The first column must be called id.");
  return rows.slice(1).map((r) => {
    const p: Participant = { id: "" };
    head.forEach((h, i) => {
      const v = r[i] ?? "";
      if (v === "") return;
      if (/^(true|yes|y|1)$/i.test(v) && ["excluded", "consent", "kyc"].includes(h)) p[h] = true;
      else if (/^(false|no|n|0)$/i.test(v) && ["excluded", "consent", "kyc"].includes(h)) p[h] = false;
      else if (["age", "purchase", "entries"].includes(h) && !Number.isNaN(Number(v))) p[h] = Number(v);
      else p[h] = v;
    });
    return p;
  });
}

/** A starting point people can edit. Not tied to any real campaign. */
export const EXAMPLE_SCENARIO: Scenario = {
  name: "Lucky draw: example",
  rules: { eligibility: { minAge: 18, regions: ["IN"], requireConsent: true }, winners: { total: 2, perDay: 1 }, participation: { maxEntriesPerParticipant: 3 }, rewards: { inventory: { gold: 1, voucher: 5 }, byTier: { A: "gold", B: "voucher" }, fallback: "voucher" }, required: ["eligibility", "unique_winners", "winner_count"] },
  participants: [
    { id: "p1", age: 25, region: "IN", consent: true, entries: 1 }, { id: "p2", age: 17, region: "IN", consent: true, entries: 1 },
    { id: "p3", age: 30, region: "IN", consent: true, entries: 2 }, { id: "p4", age: 40, region: "IN", consent: false, entries: 1 },
  ],
  actual: { winners: [{ participantId: "p1", day: "2026-11-10", tier: "A", reward: "gold", disbursementId: "d1" }, { participantId: "p3", day: "2026-11-11", tier: "B", reward: "voucher", disbursementId: "d2" }] },
  expected: { winnerCount: 2 },
};
