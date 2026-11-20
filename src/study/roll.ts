import {
  BRANCHES,
  MAX_BRANCH_LEVEL,
  STUDENTS,
  applyStudyOutcome,
  canDoActivity,
  cramCheckCount,
  cramEligibility,
  dcForLevel,
  type BranchId,
  type BranchKind,
  type DegreeOfSuccess,
} from "../rules/index.js";
import {
  readState,
  type AcademiaState,
  type ActorLike,
  type StudyActivity,
  type StudyEntry,
} from "./academia.js";

/** The slice of a PF2e `Statistic` this module uses. */
export interface StatisticLike {
  slug: string;
  label: string;
  lore?: boolean;
  roll(args: {
    dc: number;
    label: string;
    traits: string[];
    extraRollOptions: string[];
    callback?: (roll: unknown, outcome: DegreeOfSuccess | null | undefined) => void;
  }): Promise<unknown>;
}

export type StudyActor = ActorLike & { name: string; skills: Record<string, StatisticLike> };

export type CheckChoice = { kind: BranchKind; slug: string; label: string };
export type AllowedActivities = Partial<Record<StudyActivity, boolean>>;
export type StudySetting = "cramStrict" | "skipAppliesToCram" | "autoAdvance";

/** Everything the flow needs from Foundry, so tests can stand in for it. */
export interface StudyUi {
  /** Shows the picker with one button per key of `allowed`, disabled where false. */
  pick(
    title: string,
    choices: CheckChoice[],
    allowed: AllowedActivities,
    notes?: readonly string[],
  ): Promise<{ activity: StudyActivity; choice: CheckChoice } | null>;
  warn(text: string): void;
  postSkip(actor: StudyActor, id: string): Promise<unknown>;
  setting(key: StudySetting): boolean;
  newId(): string;
}

const KINDS: BranchKind[] = ["primary", "secondary"];
export const STUDY_OPTION =
  /^thousands:study:([\w-]+):(?:(fatigue)|(?:(study|cram|practical-research):)?(primary|secondary))$/;
export const RESEARCH_NOTE_PREFIX = "thousands:research-note:";

/** Roll option that marks a check as a Study, Cram, or Practical Research roll; PF2e carries it over to rerolls. */
export const studyOption = (id: string, activity: StudyActivity, kind: BranchKind) =>
  `thousands:study:${id}:${activity}:${kind}`;

/** Roll option naming the branch of a `/study` check for PF2e predicates (such as Mariama's RollTwice). */
export const studyBranchOption = (branchId: BranchId) => `study-check:branch:${branchId}`;

/** Roll option that carries an optional Practical Research unique-reward note on a check roll. */
export const researchNoteOption = (note: string) =>
  `${RESEARCH_NOTE_PREFIX}${encodeURIComponent(note)}`;

/** Roll option that marks a flat check as a Cram daily fatigue roll. */
export const fatigueOption = (id: string) => `thousands:study:${id}:fatigue`;

export interface ResearchFlag {
  id: string;
  kind: BranchKind;
  degree: DegreeOfSuccess;
  check?: string;
  dc?: number;
  note?: string;
}

export interface ResearchPick {
  actor: StudyActor;
  kind: BranchKind;
  skill?: string;
  dc?: number;
  outcome?: DegreeOfSuccess;
  note?: string;
}

export interface ResearchUi {
  pickResearch(actors: readonly StudyActor[]): Promise<ResearchPick | null>;
  warn(text: string): void;
  postResearch(actor: StudyActor, data: ResearchFlag): Promise<unknown>;
  newId(): string;
}

export function parseStudyOption(option: string): Omit<StudyEntry, "degree"> | null {
  const match = STUDY_OPTION.exec(option);
  if (!match) return null;
  if (match[2] === "fatigue") return { id: match[1]!, activity: "fatigue" };
  return {
    id: match[1]!,
    activity: (match[3] ?? "study") as StudyActivity,
    kind: match[4] as BranchKind,
  };
}

/** Branch and skill pairs the character can roll, Lore skills included where the branch allows. */
export function studyChoices(
  actor: StudyActor,
  state: AcademiaState,
  kinds: readonly BranchKind[] = KINDS,
): CheckChoice[] {
  return kinds.flatMap((kind) => {
    const branch = state.branches[kind];
    if (!branch) return [];
    const info = BRANCHES[branch.id];
    const lores = Object.values(actor.skills).filter((s) => s.lore);
    return info.skills
      .flatMap((slug) => (slug === "lore" ? lores : [actor.skills[slug]]))
      .flatMap((s) => s ?? [])
      .map(({ slug, label }) => ({
        kind,
        slug,
        label: `${info.label} ${branch.level}: ${label} (DC ${dcForLevel(branch.level)})`,
      }));
  });
}

/** Branches Cram may use right now: at least two levels below their cap. */
export function cramKinds(state: AcademiaState): BranchKind[] {
  const at = (k: BranchKind) => state.branches[k] ?? { level: MAX_BRANCH_LEVEL, starred: false };
  const branches = { primary: at("primary"), secondary: at("secondary") };
  return cramEligibility(branches, state.characterLevel, state.rank).branches;
}

async function rollStudy(
  actor: StudyActor,
  state: AcademiaState,
  activity: StudyActivity,
  id: string,
  choice: CheckChoice,
): Promise<DegreeOfSuccess | null> {
  const branch = state.branches[choice.kind];
  const statistic = actor.skills[choice.slug];
  if (!branch || !statistic) return null;
  let degree: DegreeOfSuccess | null = null;
  await statistic.roll({
    dc: dcForLevel(branch.level),
    label: `${activity === "cram" ? "Cram" : "Study"}: ${BRANCHES[branch.id].label} (${statistic.label})`,
    traits: ["downtime"],
    extraRollOptions: [
      studyOption(id, activity, choice.kind),
      studyBranchOption(branch.id),
      "downtime",
    ],
    callback: (_roll, outcome) => {
      degree = outcome ?? null;
    },
  });
  return degree;
}

function activeAdvantageNotes(state: AcademiaState): string[] {
  const branchIds = new Set(KINDS.flatMap((k) => state.branches[k]?.id ?? []));
  return (state.advantages ?? [])
    .filter((id) => branchIds.has(STUDENTS[id].branch))
    .map((id) => `${STUDENTS[id].label} (${BRANCHES[STUDENTS[id].branch].label})`);
}

/** Runs Study or Cram for a character: pick, roll at the engine's DC, leave the result in chat. */
export async function startStudy(actor: StudyActor, ui: StudyUi): Promise<void> {
  if (ui.setting("autoAdvance")) {
    return ui.warn(
      "Study and Cram are disabled while automatic even-level branch advancement is enabled.",
    );
  }
  const state = readState(actor);
  const choices = studyChoices(actor, state);
  if (!canDoActivity("study", state.rank) || choices.length === 0) {
    return ui.warn(`${actor.name} needs a branch feat and a rank that allows Study.`);
  }
  const skip = !!state.flags.skipNext;
  const allowed: AllowedActivities = {
    study: !skip,
    cram: cramKinds(state).length > 0 && !(skip && ui.setting("skipAppliesToCram")),
  };
  const id = ui.newId();
  if (!allowed.study && !allowed.cram) {
    await ui.postSkip(actor, id);
    return;
  }
  const notes = activeAdvantageNotes(state);
  const first = await ui.pick("Study", choices, allowed, notes);
  if (!first || !allowed[first.activity]) return;
  if (first.activity === "study") {
    await rollStudy(actor, state, "study", id, first.choice);
    return;
  }
  // Cram is two Study checks (or three in Rain-Scribes with Haibram Thodja), priced sequentially.
  let current = state;
  let totalChecks = 2;
  for (let n = 1; n <= totalChecks; n++) {
    const baseOpen = ui.setting("cramStrict") ? cramKinds(current) : KINDS;
    const open =
      n === 3 ? baseOpen.filter((k) => current.branches[k]?.id === "rain-scribes") : baseOpen;
    const options = studyChoices(actor, current, open);
    if (n > 1 && options.length === 0) {
      const msg =
        n === 2
          ? "No branch is still 2 levels below its cap, so Cram ends after one check."
          : "Rain-Scribes is no longer 2 levels below its cap, so Cram ends after two checks.";
      return ui.warn(msg);
    }
    const title = n === 2 ? "Cram: second check" : "Cram: third check";
    const choice =
      n === 1 ? first.choice : (await ui.pick(title, options, { cram: true }, notes))?.choice;
    if (!choice) return;
    if (!open.includes(choice.kind)) {
      return ui.warn("Cram needs a branch at least 2 levels below its cap.");
    }
    const branch = current.branches[choice.kind];
    if (!branch) return;
    if (cramCheckCount(branch.id, current.advantages) > totalChecks) {
      totalChecks = cramCheckCount(branch.id, current.advantages);
    }
    const degree = await rollStudy(actor, current, "cram", `${id}-${n}`, choice);
    if (!degree) return;
    const next = applyStudyOutcome(branch, choice.kind, current.characterLevel, degree, {
      activity: "cram",
      branchId: branch.id,
      advantages: current.advantages,
    }).state;
    current = {
      ...current,
      branches: { ...current.branches, [choice.kind]: { ...branch, ...next } },
    };
  }
}

function validateResearchActor(actor: StudyActor, ui: ResearchUi): AcademiaState | null {
  const state = readState(actor);
  if (!canDoActivity("practical-research", state.rank)) {
    ui.warn(
      `${actor.name} must hold Conversant or Lore-Speaker rank for Practical Research (current rank: ${state.rank}).`,
    );
    return null;
  }
  if (!state.branches.primary && !state.branches.secondary) {
    ui.warn(`${actor.name} needs a branch feat for Practical Research.`);
    return null;
  }
  return state;
}

/** Runs Practical Research: GM picks character, branch, check (skill+DC or direct outcome), and optional reward note. */
export async function startResearch(
  actors: StudyActor | readonly StudyActor[],
  ui: ResearchUi,
): Promise<void> {
  const list = Array.isArray(actors) ? (actors as readonly StudyActor[]) : [actors as StudyActor];
  if (list.length === 0) {
    return ui.warn("Select a token or assign a character for Practical Research.");
  }
  if (list.length === 1 && !validateResearchActor(list[0]!, ui)) return;
  const picked = await ui.pickResearch(list);
  if (!picked) return;
  const state = validateResearchActor(picked.actor, ui);
  if (!state) return;
  const branch = state.branches[picked.kind];
  if (!branch) {
    return ui.warn(`${picked.actor.name} has no ${picked.kind} branch feat.`);
  }
  const note = picked.note?.trim() || undefined;
  const id = ui.newId();
  const dc =
    picked.dc !== undefined && Number.isFinite(picked.dc) && picked.dc > 0 ? picked.dc : undefined;
  if (picked.outcome) {
    const check = (picked.skill && picked.actor.skills[picked.skill]?.label) || picked.skill;
    await ui.postResearch(picked.actor, {
      id,
      kind: picked.kind,
      degree: picked.outcome,
      ...(check ? { check } : {}),
      ...(dc !== undefined ? { dc } : {}),
      ...(note ? { note } : {}),
    });
    return;
  }
  const statistic = picked.skill ? picked.actor.skills[picked.skill] : undefined;
  if (!statistic) {
    return ui.warn("Choose a skill to roll or select an outcome to record.");
  }
  await statistic.roll({
    dc: dc ?? dcForLevel(branch.level),
    label: `Practical Research: ${BRANCHES[branch.id].label} (${statistic.label})`,
    traits: ["downtime"],
    extraRollOptions: [
      studyOption(id, "practical-research", picked.kind),
      ...(note ? [researchNoteOption(note)] : []),
      "downtime",
    ],
  });
}
