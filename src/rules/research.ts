import { BRANCHES, type BranchId } from "./branches.js";
import { dcForLevel } from "./dc.js";
import type { DegreeOfSuccess } from "./study.js";

export const RESEARCH_SITE_IDS = [
  "bloodsalt",
  "vacant-eye",
  "mzali-necropolis",
  "osibu",
  "red-star-doorway",
  "hall-of-reason",
  "endless-table",
] as const;
export type ResearchSiteId = (typeof RESEARCH_SITE_IDS)[number];

/** How one Practical Research site differs from freeform research. */
export interface ResearchSite {
  label: string;
  source: string;
  /** Time spent on each check. */
  duration: string;
  /** Skills allowed in addition to the branch's own. */
  bonusSkills: readonly string[];
  dcAdjustment?: number;
  /** Researchers without telepathy get a result one degree of success worse. */
  needsTelepathy?: boolean;
  /** Any branch may rise to the maximum level, whatever the character level. */
  uncapped?: boolean;
  /** Personal Treasure Points awarded by each degree of success. */
  treasure?: Partial<Record<DegreeOfSuccess, number>>;
  critSuccess?: string;
  /** Consequence shown and recorded on a critical failure. */
  critFailure?: string;
  /** True when a critical failure also sets the pending Study / Practical Research skip. */
  skipNext?: boolean;
  /** Condition gained on a critical failure. */
  condition?: { slug: "doomed" | "drained"; value: number };
  /** Cumulative circumstance penalty each critical failure adds to later checks here. */
  penalty?: number;
}

export const MAX_TREASURE_POINTS = 4;

export const RESEARCH_SITES: Record<ResearchSiteId, ResearchSite> = {
  bloodsalt: {
    label: "Bloodsalt",
    source: "Book 3 p. 23",
    duration: "1 month",
    bonusSkills: ["diplomacy"],
    critSuccess: "unlocks the Bloodsalt Dragon Disciple feats",
    critFailure: "spends the next month recovering (no Practical Research or Rebuild Kiutu)",
    skipNext: true,
  },
  "vacant-eye": {
    label: "Prison of the Vacant Eye",
    source: "Book 3 p. 51",
    duration: "1 month",
    bonusSkills: ["nature", "society"],
    critFailure: "cannot research at this site for 1 year",
  },
  "mzali-necropolis": {
    label: "Mzali Necropolis",
    source: "Book 4 p. 15",
    duration: "1 month",
    bonusSkills: ["religion"],
    critFailure: "doomed 1 for 1 month and permanently barred from this site",
    condition: { slug: "doomed", value: 1 },
  },
  osibu: {
    label: "Osibu",
    source: "Book 4 pp. 52–53",
    duration: "1 month",
    bonusSkills: ["diplomacy", "society"],
    treasure: { criticalSuccess: 2, success: 1, failure: 1 },
    critFailure: "barred from this site until after 1 month serving the city",
  },
  "red-star-doorway": {
    label: "Red Star Doorway",
    source: "Book 5 p. 22",
    duration: "1 week",
    bonusSkills: ["occultism"],
    critSuccess: "Mpondo's attitude improves by 1 step",
    critFailure: "must spend 1 week repairing the site before researching here again",
  },
  "hall-of-reason": {
    label: "Hall of Reason",
    source: "Book 5 pp. 42–43",
    duration: "1 week",
    bonusSkills: ["occultism"],
    dcAdjustment: 5,
    needsTelepathy: true,
    critSuccess: "learns the Akitonian language",
    critFailure: "drained 2 and barred from this site for 1 week",
    condition: { slug: "drained", value: 2 },
  },
  "endless-table": {
    label: "The Endless Table",
    source: "Book 6 p. 28",
    duration: "1 day",
    bonusSkills: ["nature"],
    uncapped: true,
    penalty: -2,
  },
};

export const isResearchSiteId = (value: unknown): value is ResearchSiteId =>
  typeof value === "string" && (RESEARCH_SITE_IDS as readonly string[]).includes(value);

export function researchDc(branchLevel: number, site?: ResearchSiteId): number {
  return dcForLevel(branchLevel) + ((site && RESEARCH_SITES[site].dcAdjustment) || 0);
}

export function researchSkills(branchId: BranchId, site: ResearchSiteId): string[] {
  return [...new Set([...BRANCHES[branchId].skills, ...RESEARCH_SITES[site].bonusSkills])];
}

const WORSE: Record<DegreeOfSuccess, DegreeOfSuccess> = {
  criticalSuccess: "success",
  success: "failure",
  failure: "criticalFailure",
  criticalFailure: "criticalFailure",
};

/** The degree a site actually grants, given whether the researcher has telepathy. */
export function researchDegree(
  degree: DegreeOfSuccess,
  site: ResearchSiteId,
  telepathy: boolean,
): DegreeOfSuccess {
  return RESEARCH_SITES[site].needsTelepathy && !telepathy ? WORSE[degree] : degree;
}

export interface SiteResult {
  site?: ResearchSiteId;
  /** The degree after any site adjustment. */
  result?: DegreeOfSuccess;
}

/** A character's standing at a site, derived from applied results so that rerolls never stack. */
export function siteTally(applied: Iterable<SiteResult>, site: ResearchSiteId) {
  const info = RESEARCH_SITES[site];
  let treasure = 0;
  let penalty = 0;
  for (const { site: at, result } of applied) {
    if (at !== site || !result) continue;
    treasure += info.treasure?.[result] ?? 0;
    if (result === "criticalFailure") penalty += info.penalty ?? 0;
  }
  return { treasure: Math.min(MAX_TREASURE_POINTS, treasure), penalty };
}
