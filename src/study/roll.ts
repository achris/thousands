import { BRANCHES, canDoActivity, dcForLevel, type BranchKind } from "../rules/index.js";
import { readState, type AcademiaState, type ActorLike } from "./academia.js";

/** The slice of a PF2e `Statistic` this module uses. */
export interface StatisticLike {
  slug: string;
  label: string;
  lore?: boolean;
  roll(args: { dc: number; label: string; extraRollOptions: string[] }): Promise<unknown>;
}

export type StudyActor = ActorLike & { name: string; skills: Record<string, StatisticLike> };

export type CheckChoice = { kind: BranchKind; slug: string; label: string };

/** Everything the flow needs from Foundry, so tests can stand in for it. */
export interface StudyUi {
  pick(choices: CheckChoice[]): Promise<CheckChoice | null>;
  warn(text: string): void;
  postSkip(actor: StudyActor, id: string): Promise<unknown>;
  newId(): string;
}

export const STUDY_OPTION = /^thousands:study:([\w-]+):(primary|secondary)$/;

/** Roll option that marks a check as a Study roll; PF2e carries it over to a rerolled message. */
export const studyOption = (id: string, kind: BranchKind) => `thousands:study:${id}:${kind}`;

/** Branch and skill pairs the character can roll, Lore skills included where the branch allows. */
export function studyChoices(actor: StudyActor, state: AcademiaState): CheckChoice[] {
  return (["primary", "secondary"] as const).flatMap((kind) => {
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

/** Runs Study for a character: pick, roll at the engine's DC, leave the result in chat. */
export async function startStudy(actor: StudyActor, ui: StudyUi): Promise<void> {
  const state = readState(actor);
  const choices = studyChoices(actor, state);
  if (!canDoActivity("study", state.rank) || choices.length === 0) {
    return ui.warn(`${actor.name} needs a branch feat and a rank that allows Study.`);
  }
  const id = ui.newId();
  if (state.flags.skipNext) {
    await ui.postSkip(actor, id);
    return;
  }
  const choice = await ui.pick(choices);
  const branch = choice && state.branches[choice.kind];
  const statistic = choice && actor.skills[choice.slug];
  if (!branch || !statistic) return;
  await statistic.roll({
    dc: dcForLevel(branch.level),
    label: `Study: ${BRANCHES[branch.id].label} (${statistic.label})`,
    extraRollOptions: [studyOption(id, choice.kind)],
  });
}
