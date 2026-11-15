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
  /** Display name of the branch. */
  label: string;
  /** PF2e skill slugs; "lore" stands for any Lore skill. */
  skills: readonly string[];
  /** What kind of Lore the branch is tied to (a note, not a skill slug). */
  loreNote: string;
  /** PF2e slug of the branch's associated general feat. */
  generalFeat: string;
  /** PF2e slug of the branch's 6th-level Magaambyan Attendant archetype feat (granted at branch level 7). */
  branchFeat6: string;
  /** PF2e slug of the branch's 10th-level Magaambyan Attendant archetype feat (granted at branch level 12). */
  branchFeat10: string;
}

export const BRANCHES: Record<BranchId, BranchInfo> = {
  "cascade-bearers": {
    label: "Cascade Bearers",
    skills: ["arcana", "occultism", "religion"],
    loreNote: "Academia Lore",
    generalFeat: "canny-acumen",
    branchFeat6: "cascade-bearers-flexibility",
    branchFeat10: "cascade-bearers-spellcasting",
  },
  "emerald-boughs": {
    label: "Emerald Boughs",
    skills: ["deception", "diplomacy", "society"],
    loreNote: "a specific settlement",
    generalFeat: "adopted-ancestry",
    branchFeat6: "emerald-boughs-accustomation",
    branchFeat10: "emerald-boughs-hideaway",
  },
  "rain-scribes": {
    label: "Rain-Scribes",
    skills: ["medicine", "nature", "survival"],
    loreNote: "a specific terrain",
    generalFeat: "fleet",
    branchFeat6: "rain-scribe-sustenance",
    branchFeat10: "rain-scribe-mobility",
  },
  "tempest-sun-mages": {
    label: "Tempest-Sun Mages",
    skills: ["intimidation", "performance"],
    loreNote: "Warfare Lore",
    generalFeat: "toughness",
    branchFeat6: "tempest-sun-redirection",
    branchFeat10: "tempest-sun-shielding",
  },
  uzunjati: {
    label: "Uzunjati",
    skills: ["crafting", "lore"],
    loreNote: "any Lore",
    generalFeat: "incredible-initiative",
    branchFeat6: "uzunjati-storytelling",
    branchFeat10: "uzunjati-recollection",
  },
};
