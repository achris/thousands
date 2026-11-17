import { MODULE_ID } from "../constants.js";
import { ACADEMIA_FEATS, type PF2eFeatSource } from "../feats/index.js";
import {
  AUTO_ADVANCE_CAP,
  BRANCHES,
  BRANCH_IDS,
  CRAM_FLAT_DC,
  MAX_BRANCH_LEVEL,
  RANKS,
  applyStudyOutcome,
  autoAdvanceOnLevelUp,
  evenLevelsCrossed,
  resolveStarOnLevelUp,
  type BranchId,
  type BranchKind,
  type BranchState,
  type DegreeOfSuccess,
  type Rank,
} from "../rules/index.js";

export type AppliedDegree = DegreeOfSuccess | "skipped" | "starred" | "auto";

/** What an applied result changed, kept so a second Apply or a reroll cannot stack. */
export interface AppliedRecord {
  degree: AppliedDegree;
  delta: number;
  star: boolean;
  skip: boolean;
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
  increaseCondition?(slug: "fatigued"): Promise<unknown>;
  decreaseCondition?(slug: "fatigued"): Promise<unknown>;
}

export interface AcademiaState {
  rank: Rank;
  characterLevel: number;
  branches: Partial<Record<BranchKind, BranchState & { id: BranchId }>>;
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
}

/** Works out what applying an entry would change, without touching the actor. */
export function planStudy(state: AcademiaState, entry: StudyEntry) {
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
  const result = applyStudyOutcome(branch, entry.kind, state.characterLevel, entry.degree);
  const star = result.starred && !branch.starred;
  const feats: PF2eFeatSource[] = [];
  for (let level = branch.level + 1; level <= result.state.level; level++) {
    feats.push(featFor(levelOption(branch.id, level)));
  }
  if (star) feats.push(featFor(starOption(branch.id)));
  const cram = entry.activity === "cram";
  const study = entry.activity === "study";
  const notes = [
    `${BRANCHES[branch.id].label} ${branch.level} → ${result.state.level}`,
    ...(star ? ["starred for the next level-up"] : []),
    ...(result.skipNext ? ["must skip the next Study opportunity"] : []),
    ...(cram
      ? [`DC ${CRAM_FLAT_DC} flat check against fatigue each day until the next Study`]
      : []),
    ...(cramFatigue && study ? ["clears Cram fatigue"] : []),
    ...(entry.note ? [entry.note] : []),
  ];
  return {
    record: { degree: entry.degree, delta: result.delta, star, skip: result.skipNext },
    feats,
    flags: { ...auto, skipNext: skipNext || result.skipNext, cramFatigue: cram || (cramFatigue && !study) },
    summary: `${notes.join("; ")}.`,
  };
}

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
  const sources = feats.map((feat) => structuredClone(feat));
  if (sources.length > 0) await actor.createEmbeddedDocuments("Item", sources);
  const applied = { ...state.flags.applied, [entry.id]: record };
  await actor.setFlag(MODULE_ID, "study", { ...flags, applied });
  return true;
}
