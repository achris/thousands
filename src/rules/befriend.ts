import type { DegreeOfSuccess } from "./study.js";

/** PF2e NPC attitudes in ascending order (CRB p. 246; Kindled Magic pp. 13, 67). */
export const ATTITUDES = ["hostile", "unfriendly", "indifferent", "friendly", "helpful"] as const;
export type Attitude = (typeof ATTITUDES)[number];
export type BefriendThreshold = "friendly" | "helpful";

export const DEFAULT_ATTITUDE: Attitude = "indifferent";
export const DEFAULT_BEFRIEND_THRESHOLD: BefriendThreshold = "helpful";

// prettier-ignore
export const ATTITUDE_LABELS: Record<Attitude, string> = {
  hostile: "Hostile", unfriendly: "Unfriendly", indifferent: "Indifferent", friendly: "Friendly", helpful: "Helpful",
};

export type BefriendChange = { kind: "delta"; steps: number } | { kind: "set"; attitude: Attitude };

// prettier-ignore
const DEGREE_STEPS: Record<DegreeOfSuccess, number> = {
  criticalSuccess: 2, success: 1, failure: 0, criticalFailure: -1,
};

export const isAttitude = (value: unknown): value is Attitude =>
  typeof value === "string" && (ATTITUDES as readonly string[]).includes(value);

export const isBefriendThreshold = (value: unknown): value is BefriendThreshold =>
  value === "friendly" || value === "helpful";

export const attitudeIndex = (attitude: Attitude): number => ATTITUDES.indexOf(attitude);

export const shiftAttitude = (current: Attitude, steps: number): Attitude =>
  ATTITUDES[Math.max(0, Math.min(ATTITUDES.length - 1, attitudeIndex(current) + steps))]!;

export const degreeToSteps = (degree: DegreeOfSuccess): number => DEGREE_STEPS[degree];

export const isBefriended = (
  attitude: Attitude,
  threshold: BefriendThreshold = DEFAULT_BEFRIEND_THRESHOLD,
): boolean => attitudeIndex(attitude) >= attitudeIndex(threshold);

export const applyBefriendChange = (current: Attitude, change: BefriendChange): Attitude =>
  change.kind === "set" ? change.attitude : shiftAttitude(current, change.steps);
