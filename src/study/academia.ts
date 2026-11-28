import { MODULE_ID } from "../constants.js";
import { ACADEMIA_FEATS, type PF2eFeatSource } from "../feats/index.js";
import {
  AUTO_ADVANCE_CAP,
  BRANCHES,
  BRANCH_IDS,
  CRAM_FLAT_DC,
  MAX_BRANCH_LEVEL,
  MAX_TREASURE_POINTS,
  RANKS,
  RESEARCH_SITES,
  STUDENTS,
  STUDENT_IDS,
  applyStudyOutcome,
  autoAdvanceOnLevelUp,
  evenLevelsCrossed,
  researchDegree,
  resolveStarOnLevelUp,
  siteTally,
  suppressesCramFatigue,
  type BranchId,
  type BranchKind,
  type BranchState,
  type DegreeOfSuccess,
  type Rank,
  type ResearchSiteId,
  type SiteResult,
  type StudentId,
} from "../rules/index.js";

export type AppliedDegree = DegreeOfSuccess | "skipped" | "starred" | "auto";

/** What an applied result changed, kept so a second Apply or a reroll cannot stack. */
export interface AppliedRecord extends SiteResult {
  degree: AppliedDegree;
  delta: number;
  star: boolean;
  skip: boolean;
  /** Condition value before and after a site's critical failure raised it. */
  condition?: { slug: "doomed" | "drained"; from: number; to: number };
}

/** Stored under `flags.thousands.study`; everything else about a character lives in its feats. */
export type StudyFlags = {
  skipNext?: boolean;
  cramFatigue?: boolean;
  autoLevels?: number[];
  applied?: Record<string, AppliedRecord>;
};

export type ItemLike = { id: string; system: { slug?: string | null } };

export interface ActorLike {
  type?: string;
  level: number;
  items: Iterable<ItemLike>;
  getFlag(scope: string, key: string): unknown;
  setFlag(scope: string, key: string, value: unknown): Promise<unknown>;
  createEmbeddedDocuments(type: "Item", sources: object[]): Promise<unknown>;
  deleteEmbeddedDocuments(type: "Item", ids: string[]): Promise<unknown>;
  increaseCondition?(
    slug: "fatigued" | "doomed" | "drained",
    options?: { value: number; max: number },
  ): Promise<unknown>;
  decreaseCondition?(slug: "fatigued" | "doomed" | "drained"): Promise<unknown>;
  getCondition?(slug: "doomed" | "drained"): { value: number | null } | null;
}

export interface AcademiaState {
  rank: Rank;
  characterLevel: number;
  branches: Partial<Record<BranchKind, BranchState & { id: BranchId }>>;
  advantages?: readonly StudentId[];
  flags: StudyFlags;
}

/** Each academia feat carries one `academia:*` roll option naming what it stands for. */
const FEAT_BY_OPTION = new Map<string, PF2eFeatSource>();
for (const feat of ACADEMIA_FEATS) {
  const rule = feat.system.rules.find((r) => String(r.option).startsWith("academia:"));
  if (rule) FEAT_BY_OPTION.set(String(rule.option), feat);
}

export const levelOption = (id: BranchId, level: number) => `academia:branch:${id}:level:${level}`;
export const starOption = (id: BranchId) => `academia:starred:${id}`;
export const advantageOption = (id: StudentId) => `academia:classroom-advantage:${id}`;

export function featFor(option: string): PF2eFeatSource {
  const feat = FEAT_BY_OPTION.get(option);
  if (!feat) throw new Error(`No academia feat for ${option}`);
  return feat;
}

/** The actor's owned item for an academia option, if any. */
export function ownedItem(actor: ActorLike, option: string): ItemLike | undefined {
  const slug = FEAT_BY_OPTION.get(option)?.system.slug;
  return slug ? [...actor.items].find((i) => i.system.slug === slug) : undefined;
}

export function readState(actor: ActorLike): AcademiaState {
  const owns = (option: string) => !!ownedItem(actor, option);
  const branches: AcademiaState["branches"] = {};
  for (const kind of ["primary", "secondary"] as const) {
    const id = BRANCH_IDS.find((b) => owns(`academia:branch:${kind}:${b}`));
    if (!id) continue;
    let level = MAX_BRANCH_LEVEL;
    while (level > 0 && !owns(levelOption(id, level))) level--;
    branches[kind] = { id, level, starred: owns(starOption(id)) };
  }
  return {
    rank: [...RANKS].reverse().find((r) => owns(`academia:rank:${r}`)) ?? "initiate",
    characterLevel: actor.level,
    branches,
    advantages: STUDENT_IDS.filter((id) => owns(advantageOption(id))),
    flags: (actor.getFlag(MODULE_ID, "study") as StudyFlags | undefined) ?? {},
  };
}

export type StudyActivity = "study" | "cram" | "practical-research";

/** One Study, Cram, Practical Research, Cram-fatigue, star-resolution, auto-advance, or skipped entry from a chat message. */
export interface StudyEntry {
  id: string;
  activity: StudyActivity | "fatigue";
  kind?: BranchKind;
  degree: AppliedDegree;
  fromLevel?: number;
  level?: number;
  cap?: number;
  note?: string;
  /** Practical Research site preset. */
  site?: ResearchSiteId;
  /** False when a site needs telepathy and the researcher lacks it. */
  telepathy?: boolean;
}

/** Chat-card lines for a result at a Practical Research site. */
export function siteNotes(state: AcademiaState, entry: StudyEntry, outcome: Required<SiteResult>) {
  const { site, result } = outcome;
  const info = RESEARCH_SITES[site];
  const others = Object.entries(state.flags.applied ?? {}).flatMap(([id, r]) =>
    id === entry.id ? [] : [r],
  );
  const before = siteTally(others, site);
  const applied = state.flags.applied?.[entry.id]?.degree === entry.degree;
  const after = siteTally([...others, outcome], site);
  const consequence = {
    criticalSuccess: info.critSuccess,
    success: undefined,
    failure: undefined,
    criticalFailure: info.critFailure,
  }[result];
  return [
    ...(result !== entry.degree ? ["no telepathy: result is one degree worse"] : []),
    ...(consequence ? [consequence] : []),
    ...(info.treasure
      ? [
          `Treasure Points ${applied ? "" : `${before.treasure} → `}${after.treasure} (max ${MAX_TREASURE_POINTS})`,
        ]
      : []),
    ...(after.penalty
      ? [`${after.penalty} circumstance penalty to later research at ${info.label}`]
      : []),
  ];
}

/** Works out what applying an entry would change, without touching the actor. */
export function planStudy(
  state: AcademiaState,
  entry: StudyEntry,
): { record: AppliedRecord; feats: PF2eFeatSource[]; flags: StudyFlags; summary: string } {
  const { skipNext = false, cramFatigue = false } = state.flags;
  const auto = state.flags.autoLevels ? { autoLevels: state.flags.autoLevels } : {};
  if (entry.degree === "skipped") {
    return {
      record: { degree: "skipped" as const, delta: 0, star: false, skip: false },
      feats: [] as PF2eFeatSource[],
      flags: { ...auto, skipNext: false, cramFatigue },
      summary: "this opportunity is skipped and the pending skip is cleared.",
    };
  }
  if (entry.activity === "fatigue") {
    const failed = entry.degree === "failure" || entry.degree === "criticalFailure";
    return {
      record: { degree: entry.degree, delta: 0, star: false, skip: false },
      feats: [] as PF2eFeatSource[],
      flags: { ...auto, skipNext, cramFatigue },
      summary: failed ? "fatigued for the day after Cram." : "avoids Cram fatigue for the day.",
    };
  }
  const branch = entry.kind && state.branches[entry.kind];
  if (!entry.kind || !branch) throw new Error(`The character has no ${entry.kind} branch feat.`);
  if (entry.degree === "starred") {
    const next = resolveStarOnLevelUp(branch, entry.kind, entry.level ?? state.characterLevel);
    const delta = Math.max(0, next.level - branch.level);
    const feats: PF2eFeatSource[] = [];
    for (let level = branch.level + 1; level <= next.level; level++) {
      feats.push(featFor(levelOption(branch.id, level)));
    }
    return {
      record: { degree: "starred" as const, delta, star: false, skip: false },
      feats,
      flags: { ...auto, skipNext, cramFatigue },
      summary: `${BRANCHES[branch.id].label} ${branch.level} → ${next.level} (star resolved on level-up).`,
    };
  }
  if (entry.degree === "auto") {
    const toLevel = entry.level ?? state.characterLevel;
    const fromLevel = entry.fromLevel ?? toLevel - 1;
    const cap = entry.cap ?? AUTO_ADVANCE_CAP;
    const next = autoAdvanceOnLevelUp(branch, fromLevel, toLevel, cap, state.flags.autoLevels);
    const delta = Math.max(0, next.level - branch.level);
    const feats: PF2eFeatSource[] = [];
    for (let level = branch.level + 1; level <= next.level; level++) {
      feats.push(featFor(levelOption(branch.id, level)));
    }
    const autoLevels = [
      ...new Set([...(state.flags.autoLevels ?? []), ...evenLevelsCrossed(fromLevel, toLevel)]),
    ];
    return {
      record: { degree: "auto" as const, delta, star: false, skip: false },
      feats,
      flags: {
        skipNext,
        cramFatigue,
        ...(autoLevels.length > 0 ? { autoLevels } : {}),
      },
      summary: `${BRANCHES[branch.id].label} ${branch.level} → ${next.level} (auto-advanced at level ${toLevel}).`,
    };
  }
  const advantages = state.advantages ?? [];
  const { site } = entry;
  const outcome = site && {
    site,
    result: researchDegree(entry.degree, site, entry.telepathy ?? true),
  };
  const degree = outcome ? outcome.result : entry.degree;
  const result = applyStudyOutcome(branch, entry.kind, state.characterLevel, degree, {
    activity: entry.activity,
    branchId: branch.id,
    advantages,
    ...(site ? { site } : {}),
  });
  const star = result.starred && !branch.starred;
  const feats: PF2eFeatSource[] = [];
  for (let level = branch.level + 1; level <= result.state.level; level++) {
    feats.push(featFor(levelOption(branch.id, level)));
  }
  if (star) feats.push(featFor(starOption(branch.id)));
  const cram = entry.activity === "cram";
  const study = entry.activity === "study";
  const fatigueStudent = suppressesCramFatigue(entry.activity, branch.id, advantages);
  const inflictsCramFatigue = cram && !fatigueStudent;
  const advNote = result.advantage
    ? `Classroom Advantage (${STUDENTS[result.advantage].label}): ${
        entry.degree === "criticalFailure"
          ? "critical failure treated as failure"
          : "success upgraded to critical success"
      }`
    : undefined;
  const notes = [
    `${BRANCHES[branch.id].label} ${branch.level} → ${result.state.level}`,
    ...(advNote ? [advNote] : []),
    ...(star ? ["starred for the next level-up"] : []),
    ...(result.skipNext ? ["must skip the next Study opportunity"] : []),
    ...(inflictsCramFatigue
      ? [`DC ${CRAM_FLAT_DC} flat check against fatigue each day until the next Study`]
      : []),
    ...(cram && fatigueStudent
      ? [`Classroom Advantage (${STUDENTS[fatigueStudent].label}): avoids Cram fatigue`]
      : []),
    ...(cramFatigue && study ? ["clears Cram fatigue"] : []),
    ...(outcome ? siteNotes(state, entry, outcome) : []),
    ...(entry.note ? [entry.note] : []),
  ];
  return {
    record: {
      degree: entry.degree,
      delta: result.delta,
      star,
      skip: result.skipNext,
      ...outcome,
    },
    feats,
    flags: {
      ...auto,
      skipNext: skipNext || result.skipNext,
      cramFatigue: inflictsCramFatigue || (cramFatigue && !study),
    },
    summary: `${notes.join("; ")}.`,
  };
}

const conditionValue = (actor: ActorLike, slug: "doomed" | "drained") =>
  actor.getCondition?.(slug)?.value ?? 0;

/** Applies an entry once; a different result for the same entry (a reroll) replaces the old one. */
export async function applyStudy(actor: ActorLike, entry: StudyEntry): Promise<boolean> {
  let state = readState(actor);
  const previous = state.flags.applied?.[entry.id];
  if (previous?.degree === entry.degree) return false;
  if (entry.degree === "starred" && entry.kind && !state.branches[entry.kind]?.starred)
    return false;
  if (previous) {
    if (
      entry.activity === "fatigue" &&
      (previous.degree === "failure" || previous.degree === "criticalFailure")
    ) {
      await actor.decreaseCondition?.("fatigued");
    }
    if (previous.condition) {
      const { slug, from, to } = previous.condition;
      for (let n = Math.min(conditionValue(actor, slug), to) - from; n > 0; n--) {
        await actor.decreaseCondition?.(slug);
      }
    }
    const branch = entry.kind && state.branches[entry.kind];
    const options = branch
      ? Array.from({ length: previous.delta }, (_, i) => levelOption(branch.id, branch.level - i))
      : [];
    if (branch && previous.star) options.push(starOption(branch.id));
    const ids = options.flatMap((option) => ownedItem(actor, option)?.id ?? []);
    if (ids.length > 0) await actor.deleteEmbeddedDocuments("Item", ids);
    state = readState(actor);
    if (previous.skip) state.flags = { ...state.flags, skipNext: false };
  }
  const { feats, flags, record } = planStudy(state, entry);
  if (entry.degree === "auto" && record.delta === 0) return false;
  if (entry.degree === "starred" && entry.kind) {
    const branch = state.branches[entry.kind];
    const starId = branch && ownedItem(actor, starOption(branch.id))?.id;
    if (starId) await actor.deleteEmbeddedDocuments("Item", [starId]);
  }
  if (
    entry.activity === "fatigue" &&
    (entry.degree === "failure" || entry.degree === "criticalFailure")
  ) {
    await actor.increaseCondition?.("fatigued");
  }
  const condition =
    record.site && record.result === "criticalFailure"
      ? RESEARCH_SITES[record.site].condition
      : undefined;
  if (condition) {
    const { slug, value } = condition;
    const from = conditionValue(actor, slug);
    if (from < value) {
      await actor.increaseCondition?.(slug, { value, max: value });
      record.condition = { slug, from, to: conditionValue(actor, slug) };
    }
  }
  const sources = feats.map((feat) => structuredClone(feat));
  if (sources.length > 0) await actor.createEmbeddedDocuments("Item", sources);
  const applied = { ...state.flags.applied, [entry.id]: record };
  await actor.setFlag(MODULE_ID, "study", { ...flags, applied });
  return true;
}
