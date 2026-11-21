import { MODULE_ID } from "../constants.js";
import { PF2E_UNLOCK_UUIDS } from "../feats/index.js";
import {
  ATTITUDE_LABELS,
  DEFAULT_ATTITUDE,
  DEFAULT_BEFRIEND_THRESHOLD,
  STUDENTS,
  STUDENT_IDS,
  applyBefriendChange,
  attitudeIndex,
  dcForLevel,
  degreeToSteps,
  isAttitude,
  isBefriended,
  type Attitude,
  type BefriendChange,
  type BefriendThreshold,
  type DegreeOfSuccess,
  type StudentId,
} from "../rules/index.js";
import { advantageOption, featFor, ownedItem, type ActorLike } from "../study/academia.js";
import type { MessageLike } from "../study/chat.js";
import type { StudyActor } from "../study/roll.js";

export type BefriendActor = StudyActor & { id?: string };
export interface StudentStanding {
  attitude: Attitude;
  notes?: string[];
}
export interface AppliedBefriend {
  key: string;
  previous: Attitude;
  next: Attitude;
  grantedFeat: boolean;
  removedFeat: boolean;
  note?: string;
}
/** Stored under `flags.thousands.befriend` on each character actor. */
export interface BefriendFlags {
  students?: Partial<Record<StudentId, StudentStanding>>;
  applied?: Record<string, AppliedBefriend>;
}
export interface BefriendFlag {
  id: string;
  student: StudentId;
  change: BefriendChange;
  note?: string;
  actorIds?: string[];
}
export interface BefriendEntry extends BefriendFlag {
  key: string;
}
export type BefriendPick =
  | {
      mode: "roll";
      actor: BefriendActor;
      student: StudentId;
      skill: string;
      dc?: number;
      note?: string;
    }
  | {
      mode: "direct";
      actor?: BefriendActor;
      party?: boolean;
      student: StudentId;
      change: BefriendChange;
      note?: string;
    };
export interface BefriendUi {
  pickBefriend(args: {
    actors: readonly BefriendActor[];
    isGM: boolean;
    allowRolls: boolean;
    threshold: BefriendThreshold;
  }): Promise<BefriendPick | null>;
  warn(text: string): void;
  postBefriend(actors: readonly BefriendActor[], data: BefriendFlag): Promise<unknown>;
  newId(): string;
}
export interface StudentStatus {
  id: StudentId;
  attitude: Attitude;
  befriended: boolean;
  ownsFeat: boolean;
  notes: readonly string[];
}

export const MAX_STUDENT_NOTES = 10;
export const BEFRIEND_OPTION = /^thousands:befriend:([\w-]+):([\w-]+)$/;
export const BEFRIEND_NOTE_PREFIX = "thousands:befriend-note:";
export const befriendOption = (id: string, student: StudentId) =>
  `thousands:befriend:${id}:${student}`;
export const befriendNoteOption = (note: string) =>
  `${BEFRIEND_NOTE_PREFIX}${encodeURIComponent(note)}`;

const isStudentId = (v: unknown): v is StudentId =>
  typeof v === "string" && (STUDENT_IDS as readonly string[]).includes(v);

export function parseBefriendOption(option: string): { id: string; student: StudentId } | null {
  const m = BEFRIEND_OPTION.exec(option);
  return m && isStudentId(m[2]) ? { id: m[1]!, student: m[2] } : null;
}

export const changeKey = (c: BefriendChange) =>
  c.kind === "set" ? `set:${c.attitude}` : `delta:${c.steps}`;
export const formatChange = (c: BefriendChange) =>
  c.kind === "set"
    ? `set to ${ATTITUDE_LABELS[c.attitude]}`
    : c.steps === 0
      ? "no change"
      : `${c.steps > 0 ? "+" : ""}${c.steps} ${Math.abs(c.steps) === 1 ? "step" : "steps"}`;

const readFlags = (actor: ActorLike): BefriendFlags => {
  const raw = actor.getFlag(MODULE_ID, "befriend");
  return raw && typeof raw === "object" ? (raw as BefriendFlags) : {};
};

export function readBefriendState(
  actor: ActorLike,
  threshold: BefriendThreshold = DEFAULT_BEFRIEND_THRESHOLD,
): Record<StudentId, StudentStatus> {
  const flags = readFlags(actor);
  const out = {} as Record<StudentId, StudentStatus>;
  for (const id of STUDENT_IDS) {
    const ownsFeat = !!ownedItem(actor, advantageOption(id));
    const stored = flags.students?.[id];
    const attitude = isAttitude(stored?.attitude)
      ? stored.attitude
      : ownsFeat
        ? threshold
        : DEFAULT_ATTITUDE;
    const notes = Array.isArray(stored?.notes)
      ? stored.notes.filter((n) => typeof n === "string")
      : [];
    out[id] = { id, attitude, befriended: isBefriended(attitude, threshold), ownsFeat, notes };
  }
  return out;
}

export function befriendEntryFromMessage(message: MessageLike): BefriendEntry | null {
  const d = message.flags[MODULE_ID]?.befriend as BefriendFlag | undefined;
  if (d && typeof d.id === "string" && isStudentId(d.student) && d.change) {
    const ok =
      (d.change.kind === "set" && isAttitude(d.change.attitude)) ||
      (d.change.kind === "delta" && Number.isInteger(d.change.steps));
    if (ok) {
      const note = typeof d.note === "string" ? d.note.trim() : "";
      const actorIds = Array.isArray(d.actorIds)
        ? d.actorIds.filter((x): x is string => typeof x === "string")
        : [];
      return {
        id: d.id,
        student: d.student,
        change: d.change,
        key: changeKey(d.change),
        ...(note ? { note } : {}),
        ...(actorIds.length ? { actorIds } : {}),
      };
    }
  }
  const ctx = message.flags.pf2e?.context as
    { options?: Iterable<string>; outcome?: DegreeOfSuccess | null } | undefined;
  const opts = ctx?.options ? [...ctx.options] : undefined;
  const parsed = opts?.map(parseBefriendOption).find((e) => e !== null);
  if (!parsed || !ctx?.outcome) return null;
  const rawNote = opts
    ?.find((o) => o.startsWith(BEFRIEND_NOTE_PREFIX))
    ?.slice(BEFRIEND_NOTE_PREFIX.length);
  const note = rawNote ? decodeURIComponent(rawNote).trim() : "";
  return {
    id: parsed.id,
    student: parsed.student,
    change: { kind: "delta", steps: degreeToSteps(ctx.outcome) },
    key: ctx.outcome,
    ...(note ? { note } : {}),
  };
}

export function planBefriend(
  actor: ActorLike,
  entry: BefriendEntry,
  threshold: BefriendThreshold = DEFAULT_BEFRIEND_THRESHOLD,
) {
  const st = readBefriendState(actor, threshold)[entry.student];
  const next = applyBefriendChange(st.attitude, entry.change);
  const grantFeat = isBefriended(next, threshold) && !st.ownsFeat;
  const removeFeat =
    attitudeIndex(next) < attitudeIndex(st.attitude) &&
    !isBefriended(next, threshold) &&
    st.ownsFeat;
  const student = STUDENTS[entry.student];
  const unlocks = student.unlocks
    .map((u) => PF2E_UNLOCK_UUIDS[u as keyof typeof PF2E_UNLOCK_UUIDS]?.label ?? u)
    .join(" and ");
  const shift =
    next === st.attitude
      ? `${student.label} remains ${ATTITUDE_LABELS[next]}`
      : `${student.label}: ${ATTITUDE_LABELS[st.attitude]} → ${ATTITUDE_LABELS[next]}`;
  const parts = [
    shift,
    ...(grantFeat ? [`grants Classroom Advantage: ${student.label} (unlocks ${unlocks})`] : []),
    ...(removeFeat ? [`removes Classroom Advantage: ${student.label}`] : []),
    ...(entry.note ? [entry.note] : []),
  ];
  return { previous: st.attitude, next, grantFeat, removeFeat, summary: `${parts.join("; ")}.` };
}

export async function applyBefriend(
  actor: ActorLike,
  entry: BefriendEntry,
  threshold: BefriendThreshold = DEFAULT_BEFRIEND_THRESHOLD,
): Promise<boolean> {
  const flags = readFlags(actor);
  const prev = flags.applied?.[entry.id];
  if (prev?.key === entry.key) return false;
  const option = advantageOption(entry.student);
  if (prev) {
    const students = { ...(flags.students ?? {}) };
    const notes = [...(students[entry.student]?.notes ?? [])];
    if (prev.note) {
      const idx = notes.lastIndexOf(prev.note);
      if (idx >= 0) notes.splice(idx, 1);
    }
    students[entry.student] = { attitude: prev.previous, notes };
    if (prev.grantedFeat) {
      const owned = ownedItem(actor, option);
      if (owned) await actor.deleteEmbeddedDocuments("Item", [owned.id]);
    } else if (prev.removedFeat && !ownedItem(actor, option)) {
      await actor.createEmbeddedDocuments("Item", [structuredClone(featFor(option))]);
    }
    await actor.setFlag(MODULE_ID, "befriend", { ...flags, students });
  }
  const planned = planBefriend(actor, entry, threshold);
  if (planned.grantFeat)
    await actor.createEmbeddedDocuments("Item", [structuredClone(featFor(option))]);
  else if (planned.removeFeat) {
    const owned = ownedItem(actor, option);
    if (owned) await actor.deleteEmbeddedDocuments("Item", [owned.id]);
  }
  const cur = readFlags(actor);
  const students = { ...(cur.students ?? {}) };
  const notes = [
    ...(students[entry.student]?.notes ?? []),
    ...(entry.note ? [entry.note] : []),
  ].slice(-MAX_STUDENT_NOTES);
  students[entry.student] = { attitude: planned.next, notes };
  const applied = {
    ...(cur.applied ?? {}),
    [entry.id]: {
      key: entry.key,
      previous: planned.previous,
      next: planned.next,
      grantedFeat: planned.grantFeat,
      removedFeat: planned.removeFeat,
      note: entry.note ?? "",
    },
  };
  await actor.setFlag(MODULE_ID, "befriend", { students, applied });
  return true;
}

export function describeBefriendEntry(
  actors: readonly BefriendActor[],
  entry: BefriendEntry,
  threshold: BefriendThreshold = DEFAULT_BEFRIEND_THRESHOLD,
): { text: string; done: boolean } {
  if (actors.length === 0) return { text: "no matching character found.", done: true };
  const recs = actors.map((actor) => ({ actor, applied: readFlags(actor).applied?.[entry.id] }));
  if (recs.every((r) => r.applied?.key === entry.key)) {
    const label = STUDENTS[entry.student].label;
    if (recs.length === 1) {
      const r = recs[0]!.applied!;
      const feat = r.grantedFeat
        ? "; Classroom Advantage granted"
        : r.removedFeat
          ? "; Classroom Advantage removed"
          : "";
      return { text: `applied (${label}: ${ATTITUDE_LABELS[r.next]}${feat}).`, done: true };
    }
    return {
      text: `applied (${label} — ${recs.map((r) => `${r.actor.name}: ${ATTITUDE_LABELS[r.applied!.next]}`).join(", ")}).`,
      done: true,
    };
  }
  if (recs.some((r) => r.applied && r.applied.key !== entry.key)) {
    return { text: "the result changed; Apply replaces the old one.", done: false };
  }
  if (actors.length === 1)
    return { text: planBefriend(actors[0]!, entry, threshold).summary, done: false };
  return {
    text: `${actors.map((a) => `${a.name}: ${planBefriend(a, entry, threshold).summary.replace(/\.$/, "")}`).join(" | ")}.`,
    done: false,
  };
}

export async function startBefriend(
  actors: readonly BefriendActor[],
  ui: BefriendUi,
  options: { isGM: boolean; allowRolls: boolean; threshold: BefriendThreshold },
): Promise<void> {
  if (actors.length === 0)
    return ui.warn("Select a token or assign a character to track befriending.");
  const picked = await ui.pickBefriend({ actors, ...options });
  if (!picked) return;
  const note = picked.note?.trim() || undefined;
  const id = ui.newId();
  if (picked.mode === "roll") {
    if (!options.allowRolls)
      return ui.warn("Rolling befriending checks is disabled in module settings.");
    const stat = picked.actor.skills[picked.skill];
    if (!stat) return ui.warn("Choose a skill to roll.");
    const dc =
      picked.dc && Number.isFinite(picked.dc) && picked.dc > 0
        ? picked.dc
        : dcForLevel(picked.actor.level);
    await stat.roll({
      dc,
      label: `Befriend: ${STUDENTS[picked.student].label} (${stat.label})`,
      traits: ["downtime"],
      extraRollOptions: [
        befriendOption(id, picked.student),
        ...(note ? [befriendNoteOption(note)] : []),
        "downtime",
      ],
    });
    return;
  }
  if (!options.isGM) return ui.warn("Only the GM can record direct befriending adjustments.");
  const targets = picked.party ? [...actors] : picked.actor ? [picked.actor] : [];
  if (targets.length === 0) return ui.warn("Choose a character or the whole party.");
  const actorIds = picked.party ? targets.flatMap((a) => (a.id ? [a.id] : [])) : undefined;
  await ui.postBefriend(targets, {
    id,
    student: picked.student,
    change: picked.change,
    ...(note ? { note } : {}),
    ...(actorIds?.length ? { actorIds } : {}),
  });
}
