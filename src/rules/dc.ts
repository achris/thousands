export const MAX_BRANCH_LEVEL = 20;

/** Level-based DCs, indexed by branch level 0-20. */
export const DC_BY_LEVEL: readonly number[] = [
  14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40,
];

/** DC for a Study check against a branch at the given branch level. */
export function dcForLevel(branchLevel: number): number {
  if (!Number.isInteger(branchLevel) || branchLevel < 0 || branchLevel > MAX_BRANCH_LEVEL) {
    throw new RangeError(`Branch level out of range: ${branchLevel}`);
  }
  return DC_BY_LEVEL[branchLevel] as number;
}
