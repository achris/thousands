import { describe, expect, it } from "vitest";
import {
  AUTO_ADVANCE_CAP,
  AUTO_ADVANCE_MAX_CAP,
  BRANCHES,
  BRANCH_IDS,
  DC_BY_LEVEL,
  STUDENTS,
  STUDENT_IDS,
  adjustStudyDegree,
  applyStudyOutcome,
  autoAdvanceOnLevelUp,
  branchCap,
  canDoActivity,
  consumeSkip,
  cramCheckCount,
  cramEligibility,
  dcForLevel,
  researchDc,
  researchDegree,
  researchSkills,
  evenLevelsCrossed,
  resolveStarOnLevelUp,
  suppressesCramFatigue,
  type BranchKind,
  type BranchState,
  type DegreeOfSuccess,
} from "../../src/rules/index.js";

const st = (level: number, starred = false): BranchState => ({ level, starred });

describe("tables", () => {
  it("has every DC for levels 0 to 20", () => {
    const expected = [
      14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40,
    ];
    expect(DC_BY_LEVEL).toHaveLength(21);
    expected.forEach((dc, level) => expect(dcForLevel(level)).toBe(dc));
    expect(() => dcForLevel(21)).toThrow(RangeError);
    expect(() => dcForLevel(-1)).toThrow(RangeError);
  });

  it("describes all five branches", () => {
    expect(BRANCH_IDS).toHaveLength(5);
    for (const id of BRANCH_IDS) {
      expect(BRANCHES[id].skills.length).toBeGreaterThan(0);
      expect(BRANCHES[id].generalFeat).not.toBe("");
    }
    expect(BRANCHES.uzunjati.skills).toEqual(["crafting", "lore"]);
  });
});

describe("branchCap", () => {
  it("uses character level for primary", () => {
    expect(branchCap("primary", 5)).toBe(5);
    expect(branchCap("primary", 20)).toBe(20);
  });
  it("uses half character level rounded down for secondary", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((l) => branchCap("secondary", l))).toEqual([
      0, 1, 1, 2, 2, 3, 3,
    ]);
  });
  it("floors at 0 and caps at 20", () => {
    expect(branchCap("primary", 0)).toBe(0);
    expect(branchCap("primary", 25)).toBe(20);
  });
});

describe.each<[BranchKind, number]>([
  ["primary", 6],
  ["secondary", 7], // odd level: cap 3
])("applyStudyOutcome (%s, character level %i)", (kind, charLevel) => {
  const cap = branchCap(kind, charLevel);
  const run = (level: number, degree: DegreeOfSuccess) =>
    applyStudyOutcome(st(level), kind, charLevel, degree);

  it("applies full gains when well below the cap", () => {
    expect(run(cap - 3, "criticalSuccess")).toMatchObject({
      delta: 2,
      starred: false,
      state: st(cap - 1),
    });
    expect(run(cap - 3, "success")).toMatchObject({ delta: 1, starred: false, state: st(cap - 2) });
  });

  it("reaches the cap exactly without a star", () => {
    expect(run(cap - 2, "criticalSuccess")).toMatchObject({
      delta: 2,
      starred: false,
      state: st(cap),
    });
    expect(run(cap - 1, "success")).toMatchObject({ delta: 1, starred: false, state: st(cap) });
  });

  it("stars on a critical success one below the cap", () => {
    expect(run(cap - 1, "criticalSuccess")).toMatchObject({
      delta: 1,
      starred: true,
      state: st(cap, true),
    });
  });

  it("stars on any success at the cap", () => {
    expect(run(cap, "success")).toMatchObject({ delta: 0, starred: true, state: st(cap, true) });
    expect(run(cap, "criticalSuccess")).toMatchObject({
      delta: 0,
      starred: true,
      state: st(cap, true),
    });
  });

  it("changes nothing on failure, and flags a skip on critical failure", () => {
    for (const level of [cap - 1, cap]) {
      expect(run(level, "failure")).toEqual({
        state: st(level),
        delta: 0,
        starred: false,
        skipNext: false,
      });
      expect(run(level, "criticalFailure")).toEqual({
        state: st(level),
        delta: 0,
        starred: false,
        skipNext: true,
      });
    }
  });

  it("keeps an existing star", () => {
    expect(applyStudyOutcome(st(cap, true), kind, charLevel, "failure").state).toEqual(
      st(cap, true),
    );
  });
});

describe("star resolution", () => {
  it("sets a star then resolves it to the new cap on level-up", () => {
    const starred = applyStudyOutcome(st(5), "primary", 5, "criticalSuccess").state;
    expect(starred).toEqual(st(5, true));
    expect(resolveStarOnLevelUp(starred, "primary", 6)).toEqual(st(6));
  });
  it("uses the secondary cap, which only rises on even levels", () => {
    const starred = st(2, true);
    expect(resolveStarOnLevelUp(starred, "secondary", 5)).toEqual(st(2));
    expect(resolveStarOnLevelUp(starred, "secondary", 6)).toEqual(st(3));
  });
  it("leaves unstarred branches alone", () => {
    const s = st(3);
    expect(resolveStarOnLevelUp(s, "primary", 9)).toBe(s);
  });
  it("does not star at the absolute maximum", () => {
    expect(applyStudyOutcome(st(20), "primary", 20, "success").state).toEqual(st(20));
  });
});

describe("even-level auto-advance", () => {
  it("lists even character levels crossed between previous and new levels", () => {
    expect(evenLevelsCrossed(1, 2)).toEqual([2]);
    expect(evenLevelsCrossed(2, 3)).toEqual([]);
    expect(evenLevelsCrossed(1, 6)).toEqual([2, 4, 6]);
    expect(evenLevelsCrossed(1, 5)).toEqual([2, 4]);
    expect(evenLevelsCrossed(6, 6)).toEqual([]);
    expect(evenLevelsCrossed(6, 4)).toEqual([]);
    expect(evenLevelsCrossed(0, 2)).toEqual([2]);
    expect(evenLevelsCrossed(1, 20)).toHaveLength(AUTO_ADVANCE_CAP);
    expect(evenLevelsCrossed(18, 25)).toEqual([20]);
  });

  it("raises the primary branch on even levels, ignores odd/unchanged/falling levels, and handles multi-level jumps", () => {
    expect(autoAdvanceOnLevelUp(st(0), 1, 2)).toEqual(st(1));
    const odd = st(1);
    expect(autoAdvanceOnLevelUp(odd, 2, 3)).toBe(odd);
    expect(autoAdvanceOnLevelUp(odd, 3, 3)).toBe(odd);
    expect(autoAdvanceOnLevelUp(odd, 4, 2)).toBe(odd);
    expect(autoAdvanceOnLevelUp(st(0), 1, 6)).toEqual(st(3));
    expect(autoAdvanceOnLevelUp(st(1), 2, 7)).toEqual(st(3));
  });

  it("enforces the default cap of 10 and optional cap of 11, and skips already-applied even levels", () => {
    let fromZero = st(0);
    for (let lvl = 2; lvl <= 20; lvl++) {
      fromZero = autoAdvanceOnLevelUp(fromZero, lvl - 1, lvl);
    }
    expect(fromZero).toEqual(st(AUTO_ADVANCE_CAP));

    expect(autoAdvanceOnLevelUp(st(9), 16, 20, AUTO_ADVANCE_CAP)).toEqual(st(10));
    expect(autoAdvanceOnLevelUp(st(10), 18, 20, AUTO_ADVANCE_CAP)).toEqual(st(10));
    expect(autoAdvanceOnLevelUp(st(9), 16, 20, AUTO_ADVANCE_MAX_CAP)).toEqual(st(11));
    expect(autoAdvanceOnLevelUp(st(10), 18, 20, AUTO_ADVANCE_MAX_CAP)).toEqual(st(11));
    expect(autoAdvanceOnLevelUp(st(11), 18, 20, AUTO_ADVANCE_MAX_CAP)).toEqual(st(11));
    expect(autoAdvanceOnLevelUp(st(1), 1, 4, AUTO_ADVANCE_CAP, [2])).toEqual(st(2));
    expect(autoAdvanceOnLevelUp(st(1), 1, 2, AUTO_ADVANCE_CAP, [2])).toEqual(st(1));
  });
});

describe("cramEligibility", () => {
  const branches = (p: number, s: number) => ({ primary: st(p), secondary: st(s) });

  it("is ineligible at 0 and 1 below the cap, eligible at 2", () => {
    // character level 8: caps 8 / 4
    expect(cramEligibility(branches(8, 4), 8, "attendant")).toEqual({
      eligible: false,
      branches: [],
    });
    expect(cramEligibility(branches(7, 3), 8, "attendant")).toEqual({
      eligible: false,
      branches: [],
    });
    expect(cramEligibility(branches(6, 4), 8, "attendant")).toEqual({
      eligible: true,
      branches: ["primary"],
    });
    expect(cramEligibility(branches(8, 2), 8, "attendant")).toEqual({
      eligible: true,
      branches: ["secondary"],
    });
    expect(cramEligibility(branches(0, 0), 8, "attendant").branches).toEqual([
      "primary",
      "secondary",
    ]);
  });
  it("respects rank", () => {
    expect(cramEligibility(branches(0, 0), 8, "lore-speaker").eligible).toBe(false);
  });
});

describe("rank gating and skips", () => {
  it("gates each activity by rank", () => {
    for (const a of ["study", "cram"] as const) {
      expect(
        ["initiate", "attendant", "conversant"].map((r) => canDoActivity(a, r as never)),
      ).toEqual([true, true, true]);
      expect(canDoActivity(a, "lore-speaker")).toBe(false);
    }
    expect(canDoActivity("practical-research", "initiate")).toBe(false);
    expect(canDoActivity("practical-research", "attendant")).toBe(false);
    expect(canDoActivity("practical-research", "conversant")).toBe(true);
    expect(canDoActivity("practical-research", "lore-speaker")).toBe(true);
  });
  it("consumes a pending skip once", () => {
    expect(consumeSkip(true)).toEqual({ skipped: true, skipNext: false });
    expect(consumeSkip(false)).toEqual({ skipped: false, skipNext: false });
  });
});

describe("classroom advantages", () => {
  // prettier-ignore
  it("applies degree shifts, Cram fatigue immunity, and 3-check Cram only for matching student, branch, and activity", () => {
    expect(STUDENT_IDS).toHaveLength(9);
    for (const id of STUDENT_IDS) expect(BRANCH_IDS).toContain(STUDENTS[id].branch);
    for (const [id, branch, act] of [["anchor-root", "rain-scribes", "study"], ["noxolo", "uzunjati", "study"], ["ignaci-canterells", "emerald-boughs", "cram"]] as const) {
      expect(adjustStudyDegree("criticalFailure", act, branch, [id])).toEqual({ degree: "failure", student: id });
      expect(adjustStudyDegree("criticalFailure", act === "study" ? "cram" : "study", branch, [id])).toEqual({ degree: "criticalFailure" });
      expect(applyStudyOutcome(st(2), "primary", 6, "criticalFailure", { activity: act, branchId: branch, advantages: [id] })).toEqual({ state: st(2), delta: 0, starred: false, skipNext: false, advantage: id });
    }
    for (const [id, branch] of [["esi-djana", "tempest-sun-mages"], ["tzeniwe", "emerald-boughs"]] as const) {
      expect(adjustStudyDegree("success", "study", branch, [id])).toEqual({ degree: "criticalSuccess", student: id });
      expect(adjustStudyDegree("success", "cram", branch, [id])).toEqual({ degree: "success" });
      expect(applyStudyOutcome(st(2), "primary", 6, "success", { activity: "study", branchId: branch, advantages: [id] })).toEqual({ state: st(4), delta: 2, starred: false, skipNext: false, advantage: id });
    }
    expect(suppressesCramFatigue("cram", "cascade-bearers", ["chizire"])).toBe("chizire");
    expect(suppressesCramFatigue("cram", "uzunjati", ["okoro-obiyo"])).toBe("okoro-obiyo");
    expect(suppressesCramFatigue("cram", "uzunjati", ["chizire"])).toBeUndefined();
    expect([cramCheckCount("rain-scribes", ["haibram-thodja"]), cramCheckCount("rain-scribes"), cramCheckCount("uzunjati", ["haibram-thodja"])]).toEqual([3, 2, 2]);
  });
});

describe("practical research sites", () => {
  it("adds site skills, Very Hard DC, and the telepathy degree shift", () => {
    expect(researchSkills("uzunjati", "bloodsalt")).toEqual(["crafting", "lore", "diplomacy"]);
    expect(researchSkills("cascade-bearers", "hall-of-reason")).toContain("occultism");
    expect([researchDc(10), researchDc(10, "osibu"), researchDc(10, "hall-of-reason")]).toEqual([27, 27, 32]); // prettier-ignore
    expect(researchDegree("criticalSuccess", "hall-of-reason", false)).toBe("success");
    expect(researchDegree("criticalSuccess", "hall-of-reason", true)).toBe("criticalSuccess");
    expect(researchDegree("success", "osibu", false)).toBe("success");
  });
});
