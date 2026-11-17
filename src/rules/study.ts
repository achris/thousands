import type { BranchKind } from "./branches.js";
import { MAX_BRANCH_LEVEL } from "./dc.js";

export type DegreeOfSuccess = "criticalSuccess" | "success" | "failure" | "criticalFailure";

export const RANKS = ["initiate", "attendant", "conversant", "lore-speaker"] as const;
export type Rank = (typeof RANKS)[number];
export type Activity = "study" | "cram" | "practical-research";

export interface BranchState {
  level: number;
  /** Set when an outcome exceeded the cap; resolved on the next level-up. */
  starred: boolean;
}

/** Flat check DC made each adventuring day after Cram. */
export const CRAM_FLAT_DC = 8;
/** Levels below the cap a branch must be for Cram to use it. */
export const CRAM_MIN_GAP = 2;
/** Default primary-branch cap under even-level auto-advance (10 even levels in 2–20). */
export const AUTO_ADVANCE_CAP = 10;
/** Maximum configurable cap for even-level auto-advance (the p. 64 sidebar's stated 11). */
export const AUTO_ADVANCE_MAX_CAP = 11;

const GAIN: Record<DegreeOfSuccess, number> = {
  criticalSuccess: 2,
  success: 1,
  failure: 0,
  criticalFailure: 0,
};

const RANKS_FOR: Record<Activity, readonly Rank[]> = {
  study: ["initiate", "attendant", "conversant"],
  cram: ["initiate", "attendant", "conversant"],
  "practical-research": ["conversant", "lore-speaker"],
};

/** Branch level cap: primary is the character level, secondary is half (rounded down). */
export function branchCap(kind: BranchKind, characterLevel: number): number {
  const base = kind === "primary" ? characterLevel : Math.floor(characterLevel / 2);
  return Math.max(0, Math.min(MAX_BRANCH_LEVEL, base));
}

export function canDoActivity(activity: Activity, rank: Rank): boolean {
  return RANKS_FOR[activity].includes(rank);
}

export interface StudyResult {
  state: BranchState;
  /** Levels actually gained. */
  delta: number;
  /** True when the outcome exceeded the cap and left the branch starred. */
  starred: boolean;
  /** True when the character must skip their next Study opportunity. */
  skipNext: boolean;
}

export function applyStudyOutcome(
  state: BranchState,
  kind: BranchKind,
  characterLevel: number,
  degree: DegreeOfSuccess,
): StudyResult {
  const cap = branchCap(kind, characterLevel);
  const gain = GAIN[degree];
  const delta = Math.max(0, Math.min(gain, cap - state.level));
  // At the absolute maximum there is nothing to carry over.
  const starred = gain > delta && cap < MAX_BRANCH_LEVEL;
  return {
    state: { level: state.level + delta, starred: state.starred || starred },
    delta,
    starred,
    skipNext: degree === "criticalFailure",
  };
}

/** On gaining a level, a starred branch rises to its new cap and loses the star. */
export function resolveStarOnLevelUp(
  state: BranchState,
  kind: BranchKind,
  newCharacterLevel: number,
): BranchState {
  if (!state.starred) return state;
  const cap = branchCap(kind, newCharacterLevel);
  return { level: Math.max(state.level, cap), starred: false };
}

/** Even character levels (2–20) crossed when rising from `previousCharacterLevel` to `newCharacterLevel`. */
export function evenLevelsCrossed(
  previousCharacterLevel: number,
  newCharacterLevel: number,
): number[] {
  const start = Math.max(1, Math.trunc(previousCharacterLevel)) + 1;
  const end = Math.min(MAX_BRANCH_LEVEL, Math.trunc(newCharacterLevel));
  const levels: number[] = [];
  for (let level = start; level <= end; level++) {
    if (level % 2 === 0) levels.push(level);
  }
  return levels;
}

/**
 * Variant rule (p. 64): on a character level increase, raises the primary branch
 * by 1 for each unapplied even character level crossed, up to `cap`.
 */
export function autoAdvanceOnLevelUp(
  state: BranchState,
  previousCharacterLevel: number,
  newCharacterLevel: number,
  cap: number = AUTO_ADVANCE_CAP,
  appliedEvenLevels: Iterable<number> = [],
): BranchState {
  const seen = new Set(appliedEvenLevels);
  const steps = evenLevelsCrossed(previousCharacterLevel, newCharacterLevel).filter(
    (level) => !seen.has(level),
  ).length;
  if (steps === 0) return state;
  const maxLevel = Math.max(0, Math.min(MAX_BRANCH_LEVEL, Math.trunc(cap)));
  const nextLevel = Math.max(state.level, Math.min(maxLevel, state.level + steps));
  return nextLevel === state.level ? state : { ...state, level: nextLevel };
}

export interface CramEligibility {
  eligible: boolean;
  /** Branches at least CRAM_MIN_GAP levels below their cap. */
  branches: BranchKind[];
}

export function cramEligibility(
  branches: Record<BranchKind, BranchState>,
  characterLevel: number,
  rank: Rank,
): CramEligibility {
  const kinds: BranchKind[] = ["primary", "secondary"];
  const open = canDoActivity("cram", rank)
    ? kinds.filter((k) => branchCap(k, characterLevel) - branches[k].level >= CRAM_MIN_GAP)
    : [];
  return { eligible: open.length > 0, branches: open };
}

/** Consumes a pending skip: the opportunity is lost and the flag clears. */
export function consumeSkip(skipNext: boolean): { skipped: boolean; skipNext: boolean } {
  return { skipped: skipNext, skipNext: false };
}
