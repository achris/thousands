import {
  BRANCHES,
  MAX_BRANCH_LEVEL,
  applyStudyOutcome,
  canDoActivity,
  cramEligibility,
  dcForLevel,
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
export type StudySetting = "cramStrict" | "skipAppliesToCram";

/** Everything the flow needs from Foundry, so tests can stand in for it. */
export interface StudyUi {
  /** Shows the picker with one button per key of `allowed`, disabled where false. */
  pick(
    title: string,
    choices: CheckChoice[],
    allowed: AllowedActivities,
  ): Promise<{ activity: StudyActivity; choice: CheckChoice } | null>;
  warn(text: string): void;
  postSkip(actor: StudyActor, id: string): Promise<unknown>;
  setting(key: StudySetting): boolean;
  newId(): string;
}

const KINDS: BranchKind[] = ["primary", "secondary"];
export const STUDY_OPTION = /^thousands:study:([\w-]+):(?:(study|cram):)?(primary|secondary)$/;

/** Roll option that marks a check as a Study or Cram roll; PF2e carries it over to rerolls. */
export const studyOption = (id: string, activity: StudyActivity, kind: BranchKind) =>
  `thousands:study:${id}:${activity}:${kind}`;

export function parseStudyOption(option: string): Omit<StudyEntry, "degree"> | null {
  const match = STUDY_OPTION.exec(option);
  if (!match) return null;
  return {
    id: match[1]!,
    activity: (match[2] ?? "study") as StudyActivity,
    kind: match[3] as BranchKind,
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
    extraRollOptions: [studyOption(id, activity, choice.kind), "downtime"],
    callback: (_roll, outcome) => {
      degree = outcome ?? null;
    },
  });
  return degree;
}

/** Runs Study or Cram for a character: pick, roll at the engine's DC, leave the result in chat. */
export async function startStudy(actor: StudyActor, ui: StudyUi): Promise<void> {
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
  const first = await ui.pick("Study", choices, allowed);
  if (!first || !allowed[first.activity]) return;
  if (first.activity === "study") {
    await rollStudy(actor, state, "study", id, first.choice);
    return;
  }
  // Cram is two Study checks; the second is picked after the first so it sees that result.
  let current = state;
  for (const n of [1, 2] as const) {
    const open = ui.setting("cramStrict") ? cramKinds(current) : KINDS;
    const options = studyChoices(actor, current, open);
    if (n === 2 && options.length === 0) {
      return ui.warn("No branch is still 2 levels below its cap, so Cram ends after one check.");
    }
    const choice =
      n === 1
        ? first.choice
        : (await ui.pick("Cram: second check", options, { cram: true }))?.choice;
    if (!choice) return;
    if (!open.includes(choice.kind)) {
      return ui.warn("Cram needs a branch at least 2 levels below its cap.");
    }
    const degree = await rollStudy(actor, current, "cram", `${id}-${n}`, choice);
    const branch = current.branches[choice.kind];
    if (!degree || !branch) return;
    const next = applyStudyOutcome(branch, choice.kind, current.characterLevel, degree).state;
    current = {
      ...current,
      branches: { ...current.branches, [choice.kind]: { ...branch, ...next } },
    };
  }
}
