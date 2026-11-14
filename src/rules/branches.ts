export const BRANCH_IDS = [
  "cascade-bearers",
  "emerald-boughs",
  "rain-scribes",
  "tempest-sun-mages",
  "uzunjati",
] as const;
export type BranchId = (typeof BRANCH_IDS)[number];

/** Whether a branch is the character's primary or secondary branch. */
export type BranchKind = "primary" | "secondary";

export interface BranchInfo {
  /** PF2e skill slugs; "lore" stands for any Lore skill. */
  skills: readonly string[];
  /** What kind of Lore the branch is tied to (a note, not a skill slug). */
  loreNote: string;
  /** PF2e slug of the branch's associated general feat. */
  generalFeat: string;
}

export const BRANCHES: Record<BranchId, BranchInfo> = {
  "cascade-bearers": {
    skills: ["arcana", "occultism", "religion"],
    loreNote: "Academia Lore",
    generalFeat: "canny-acumen",
  },
  "emerald-boughs": {
    skills: ["deception", "diplomacy", "society"],
    loreNote: "a specific settlement",
    generalFeat: "adopted-ancestry",
  },
  "rain-scribes": {
    skills: ["medicine", "nature", "survival"],
    loreNote: "a specific terrain",
    generalFeat: "fleet",
  },
  "tempest-sun-mages": {
    skills: ["intimidation", "performance"],
    loreNote: "Warfare Lore",
    generalFeat: "toughness",
  },
  uzunjati: {
    skills: ["crafting", "lore"],
    loreNote: "any Lore",
    generalFeat: "incredible-initiative",
  },
};
