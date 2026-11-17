import { MODULE_ID } from "../constants.js";
import type { BranchKind, DegreeOfSuccess } from "../rules/index.js";
import { planStudy, readState, type ActorLike, type StudyEntry } from "./academia.js";
import { parseStudyOption } from "./roll.js";

export interface MessageLike {
  flags: Record<string, Record<string, unknown> | undefined>;
  actor?: ActorLike | null;
  update(data: Record<string, unknown>): Promise<unknown>;
}

export interface StarFlag {
  id: string;
  kind: BranchKind;
  level: number;
}

/** Reads a Study, Cram, Cram-fatigue, star-resolution, or skipped entry from a chat message. */
export function entryFromMessage(message: MessageLike): StudyEntry | null {
  const mod = message.flags[MODULE_ID];
  const skip = mod?.skip;
  if (typeof skip === "string") return { id: skip, activity: "study", degree: "skipped" };
  const star = mod?.star as StarFlag | undefined;
  if (
    star &&
    typeof star.id === "string" &&
    (star.kind === "primary" || star.kind === "secondary") &&
    typeof star.level === "number"
  ) {
    return {
      id: star.id,
      activity: "study",
      kind: star.kind,
      degree: "starred",
      level: star.level,
    };
  }
  const context = message.flags.pf2e?.context as
    { options?: string[]; outcome?: DegreeOfSuccess | null } | undefined;
  const fatigue = mod?.fatigue;
  if (typeof fatigue === "string" && context?.outcome) {
    return { id: fatigue, activity: "fatigue", degree: context.outcome };
  }
  const parsed = context?.options?.map(parseStudyOption).find((entry) => entry !== null);
  return parsed && context?.outcome ? { ...parsed, degree: context.outcome } : null;
}

/** The line shown on the card, and whether this exact result is already applied. */
export function describeEntry(actor: ActorLike, entry: StudyEntry) {
  const state = readState(actor);
  const previous = state.flags.applied?.[entry.id];
  if (previous?.degree === entry.degree) {
    if (entry.activity === "fatigue") {
      const failed = previous.degree === "failure" || previous.degree === "criticalFailure";
      return { text: failed ? "applied (fatigued)." : "applied (no fatigue).", done: true };
    }
    return { text: `applied (+${previous.delta} branch level).`, done: true };
  }
  if (previous) return { text: "the result changed; Apply replaces the old one.", done: false };
  try {
    return { text: planStudy(state, entry).summary, done: false };
  } catch (error) {
    return { text: (error as Error).message, done: true };
  }
}
