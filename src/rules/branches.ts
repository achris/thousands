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

// prettier-ignore
export const STUDENT_IDS = [
  "anchor-root", "chizire", "esi-djana", "haibram-thodja", "ignaci-canterells",
  "mariama-keitana", "noxolo", "okoro-obiyo", "tzeniwe",
] as const;
export type StudentId = (typeof STUDENT_IDS)[number];

export type ClassroomAdvantageEffect =
  "downgrade-crit-failure" | "upgrade-success" | "no-cram-fatigue" | "extra-cram-check" | "reroll";

export interface StudentInfo {
  label: string;
  branch: BranchId;
  activity: "study" | "cram";
  effect: ClassroomAdvantageEffect;
  unlocks: readonly string[];
  page: number;
}

// prettier-ignore
export const STUDENTS: Record<StudentId, StudentInfo> = {
  "anchor-root": { label: "Anchor Root", branch: "rain-scribes", activity: "study", effect: "downgrade-crit-failure", unlocks: ["rhythm-bone"], page: 67 },
  chizire: { label: "Chizire", branch: "cascade-bearers", activity: "cram", effect: "no-cram-fatigue", unlocks: ["verminous-lure"], page: 68 },
  "esi-djana": { label: "Esi Djana", branch: "tempest-sun-mages", activity: "study", effect: "upgrade-success", unlocks: ["impeccable-flow"], page: 68 },
  "haibram-thodja": { label: "Haibram Thodja", branch: "rain-scribes", activity: "cram", effect: "extra-cram-check", unlocks: ["airburst"], page: 69 },
  "ignaci-canterells": { label: "Ignaci Canterells", branch: "emerald-boughs", activity: "cram", effect: "downgrade-crit-failure", unlocks: ["forgetful-ink"], page: 69 },
  "mariama-keitana": { label: "Mariama Keitana", branch: "cascade-bearers", activity: "study", effect: "reroll", unlocks: ["lesson-of-calamity", "stumbling-curse"], page: 70 },
  noxolo: { label: "Noxolo", branch: "uzunjati", activity: "study", effect: "downgrade-crit-failure", unlocks: ["grave-impressions"], page: 70 },
  "okoro-obiyo": { label: "Okoro Obiyo", branch: "uzunjati", activity: "cram", effect: "no-cram-fatigue", unlocks: ["mind-games"], page: 71 },
  tzeniwe: { label: "Tzeniwe", branch: "emerald-boughs", activity: "study", effect: "upgrade-success", unlocks: ["friendfetch"], page: 71 },
};
