import { MODULE_ID } from "../constants.js";
import type { DegreeOfSuccess } from "../rules/index.js";
import { planStudy, readState, type ActorLike, type StudyEntry } from "./academia.js";
import { parseStudyOption } from "./roll.js";

export interface MessageLike {
  flags: Record<string, Record<string, unknown> | undefined>;
  actor?: ActorLike | null;
  update(data: Record<string, unknown>): Promise<unknown>;
}

/** Reads a Study or Cram entry from a PF2e check message, or from a "skipped" message. */
export function entryFromMessage(message: MessageLike): StudyEntry | null {
  const skip = message.flags[MODULE_ID]?.skip;
  if (typeof skip === "string") return { id: skip, activity: "study", degree: "skipped" };
  const context = message.flags.pf2e?.context as
    { options?: string[]; outcome?: DegreeOfSuccess | null } | undefined;
  const parsed = context?.options?.map(parseStudyOption).find((entry) => entry !== null);
  return parsed && context?.outcome ? { ...parsed, degree: context.outcome } : null;
}

/** The line shown on the card, and whether this exact result is already applied. */
export function describeEntry(actor: ActorLike, entry: StudyEntry) {
  const state = readState(actor);
  const previous = state.flags.applied?.[entry.id];
  if (previous?.degree === entry.degree) {
    return { text: `applied (+${previous.delta} branch level).`, done: true };
  }
  if (previous) return { text: "the result changed; Apply replaces the old one.", done: false };
  try {
    return { text: planStudy(state, entry).summary, done: false };
  } catch (error) {
    return { text: (error as Error).message, done: true };
  }
}
