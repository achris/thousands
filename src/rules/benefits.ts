import { MAX_BRANCH_LEVEL } from "./dc.js";

export type BenefitKind =
  | "additional-lore"
  | "steeped-in-history"
  | "dedicated-attendant"
  | "skill-feat"
  | "branch-influence"
  | "skill-increase"
  | "branch-feat"
  | "general-feat"
  | "make-your-own-luck"
  | "magical-paragon";

export type ProficiencyRank = 1 | 2 | 3 | 4;
export type ProficiencyLabel = "Trained" | "Expert" | "Master" | "Legendary";

export const PROFICIENCY_LABELS: Record<ProficiencyRank, ProficiencyLabel> = {
  1: "Trained",
  2: "Expert",
  3: "Master",
  4: "Legendary",
};

export interface BenefitInfo {
  level: number;
  kind: BenefitKind;
  label: string;
  page: number;
  bonus?: number;
  rank?: ProficiencyRank;
  featLevel?: number;
}

/** Table 2: Branch Benefits by Level (p. 63; details pp. 63-65). */
export const BENEFITS: readonly BenefitInfo[] = [
  { level: 1, kind: "additional-lore", label: "Additional Lore", page: 63 },
  { level: 2, kind: "steeped-in-history", label: "Steeped in History +1", bonus: 1, page: 64 },
  { level: 3, kind: "dedicated-attendant", label: "Dedicated Attendant", page: 64 },
  { level: 4, kind: "skill-feat", label: "Skill Feat (Trained)", rank: 1, page: 64 },
  { level: 5, kind: "branch-influence", label: "Branch Influence +1", bonus: 1, page: 64 },
  { level: 6, kind: "skill-increase", label: "Skill Increase (Expert)", rank: 2, page: 64 },
  { level: 7, kind: "branch-feat", label: "First Branch Feat", featLevel: 6, page: 64 },
  { level: 8, kind: "general-feat", label: "General Feat", featLevel: 1, page: 64 },
  { level: 9, kind: "skill-feat", label: "Skill Feat (Expert)", rank: 2, page: 64 },
  { level: 10, kind: "skill-increase", label: "Skill Increase (Master)", rank: 3, page: 64 },
  { level: 11, kind: "steeped-in-history", label: "Steeped in History +2", bonus: 2, page: 64 },
  { level: 12, kind: "branch-feat", label: "Second Branch Feat", featLevel: 10, page: 64 },
  { level: 13, kind: "branch-influence", label: "Branch Influence +2", bonus: 2, page: 64 },
  { level: 14, kind: "skill-increase", label: "Skill Increase (Master)", rank: 3, page: 64 },
  { level: 15, kind: "skill-feat", label: "Skill Feat (Master)", rank: 3, page: 64 },
  { level: 16, kind: "make-your-own-luck", label: "Make Your Own Luck", page: 65 },
  { level: 17, kind: "branch-influence", label: "Branch Influence +3", bonus: 3, page: 64 },
  { level: 18, kind: "skill-increase", label: "Skill Increase (Legendary)", rank: 4, page: 64 },
  { level: 19, kind: "skill-feat", label: "Skill Feat (Legendary)", rank: 4, page: 64 },
  { level: 20, kind: "magical-paragon", label: "Magical Paragon", page: 65 },
];

export function benefitAtLevel(branchLevel: number): BenefitInfo {
  if (!Number.isInteger(branchLevel) || branchLevel < 1 || branchLevel > MAX_BRANCH_LEVEL) {
    throw new RangeError(`Benefit level out of range: ${branchLevel}`);
  }
  return BENEFITS[branchLevel - 1] as BenefitInfo;
}

export function benefitsUnlocked(branchLevel: number): readonly BenefitInfo[] {
  if (!Number.isInteger(branchLevel) || branchLevel < 0 || branchLevel > MAX_BRANCH_LEVEL) {
    throw new RangeError(`Branch level out of range: ${branchLevel}`);
  }
  return BENEFITS.slice(0, branchLevel);
}
