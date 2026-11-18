import { MODULE_ID } from "../constants.js";
import type { BranchKind, DegreeOfSuccess } from "../rules/index.js";
import { planStudy, readState, type ActorLike, type StudyEntry } from "./academia.js";
import { RESEARCH_NOTE_PREFIX, parseStudyOption, type ResearchFlag } from "./roll.js";

const DEGREES = new Set<DegreeOfSuccess>([
  "criticalSuccess",
  "success",
  "failure",
  "criticalFailure",
]);

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

export interface AutoAdvanceFlag {
  id: string;
  fromLevel?: number;
  level: number;
  cap?: number;
}

/** Reads a Study, Cram, Practical Research, Cram-fatigue, star-resolution, auto-advance, or skipped entry from a chat message. */
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
  const auto = mod?.autoAdvance as AutoAdvanceFlag | undefined;
  if (auto && typeof auto.id === "string" && typeof auto.level === "number") {
    return {
      id: auto.id,
      activity: "study",
      kind: "primary",
      degree: "auto",
      ...(typeof auto.fromLevel === "number" ? { fromLevel: auto.fromLevel } : {}),
      level: auto.level,
      ...(typeof auto.cap === "number" ? { cap: auto.cap } : {}),
    };
  }
  const research = mod?.research as ResearchFlag | undefined;
  if (
    research &&
    typeof research.id === "string" &&
    (research.kind === "primary" || research.kind === "secondary") &&
    DEGREES.has(research.degree)
  ) {
    const note = typeof research.note === "string" ? research.note.trim() : "";
    return {
      id: research.id,
      activity: "practical-research",
      kind: research.kind,
      degree: research.degree,
      ...(note ? { note } : {}),
    };
  }
  const context = message.flags.pf2e?.context as
    { options?: Iterable<string>; outcome?: DegreeOfSuccess | null } | undefined;
  const fatigue = mod?.fatigue;
  if (typeof fatigue === "string" && context?.outcome) {
    return { id: fatigue, activity: "fatigue", degree: context.outcome };
  }
  const options = context?.options ? [...context.options] : undefined;
  const parsed = options?.map(parseStudyOption).find((entry) => entry !== null);
  if (!parsed || !context?.outcome) return null;
  const rawNote = options
    ?.find((opt) => opt.startsWith(RESEARCH_NOTE_PREFIX))
    ?.slice(RESEARCH_NOTE_PREFIX.length);
  const note = rawNote ? decodeURIComponent(rawNote) : undefined;
  return { ...parsed, degree: context.outcome, ...(note ? { note } : {}) };
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
    const note = entry.note ? `; ${entry.note}` : "";
    return { text: `applied (+${previous.delta} branch level${note}).`, done: true };
  }
  if (previous) return { text: "the result changed; Apply replaces the old one.", done: false };
  try {
    const planned = planStudy(state, entry);
    return { text: planned.summary, done: entry.degree === "auto" && planned.record.delta === 0 };
  } catch (error) {
    return { text: (error as Error).message, done: true };
  }
}
