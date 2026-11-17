import { MODULE_ID } from "../constants.js";
import {
  AUTO_ADVANCE_CAP,
  AUTO_ADVANCE_MAX_CAP,
  BRANCHES,
  CRAM_FLAT_DC,
  dcForLevel,
  resolveStarOnLevelUp,
  type BranchKind,
  type DegreeOfSuccess,
} from "../rules/index.js";
import {
  applyStudy,
  planStudy,
  readState,
  type StudyActivity,
  type StudyEntry,
} from "./academia.js";
import { describeEntry, entryFromMessage, type MessageLike } from "./chat.js";
import {
  fatigueOption,
  startResearch,
  startStudy,
  type CheckChoice,
  type ResearchPick,
  type ResearchUi,
  type StudyActor,
  type StudySetting,
  type StudyUi,
} from "./roll.js";

type Hook = (...args: never[]) => unknown;
type PickButton = { form: { elements: { namedItem(name: string): { value: string } | null } } };

export interface ActorUpdateChanges {
  system?: { details?: { level?: { value?: number } } };
}

declare const Hooks: { on(hook: string, callback: Hook): number };
declare const ChatMessage: {
  create(data: object): Promise<unknown>;
  getSpeaker(options: { actor: unknown }): object;
};
declare const game: {
  user: { id?: string; isGM: boolean; character?: StudyActor | null };
  actors?: Iterable<StudyActor>;
  settings: {
    register(scope: string, key: string, config: object): void;
    get(scope: string, key: string): unknown;
  };
  modules: { get(id: string): { api?: unknown } | undefined };
};
declare const ui: { notifications: { warn(text: string): void } };
declare const canvas: { tokens?: { controlled: { actor?: StudyActor | null }[] } };
declare const foundry: {
  utils: { randomID(): string; escapeHTML(text: string): string };
  applications: {
    api: { DialogV2: { wait(config: object): Promise<unknown> } };
    sidebar?: {
      tabs?: {
        ChatLog?: {
          CHAT_COMMANDS?: Record<string, { rgx: RegExp; fn: (...args: unknown[]) => boolean }>;
        };
      };
    };
  };
};

const STUDY_COMMAND = /^\s*\/study(?:\s+(research))?\s*$/i;
const previousLevels = new WeakMap<object, number>();
const DEGREE_LABELS: Record<DegreeOfSuccess, string> = {
  criticalSuccess: "Critical Success",
  success: "Success",
  failure: "Failure",
  criticalFailure: "Critical Failure",
};

function runStudyCommand(_log?: unknown, text?: unknown, _data?: unknown, match?: unknown): false {
  const sub =
    (Array.isArray(match) ? (match[1] as string | undefined) : undefined) ??
    (typeof text === "string" ? STUDY_COMMAND.exec(text)?.[1] : undefined);
  void (sub ? research() : study());
  return false;
}

export const STUDY_SETTINGS = {
  cramStrict: {
    name: "Cram: each check needs an eligible branch",
    hint: "When enabled, both Cram checks must use a branch at least 2 levels below its cap after accounting for the first check. When disabled, having one eligible branch at the start is enough.",
    type: Boolean,
    default: true,
  },
  skipAppliesToCram: {
    name: "Critical-failure skip consumes Cram",
    hint: "When enabled, a pending skip after a critical failure skips the next Study or Cram opportunity. When disabled, only Study is blocked and Cram remains available.",
    type: Boolean,
    default: true,
  },
  autoAdvance: {
    name: "Auto-advance primary branch on even levels",
    hint: "Replaces Study and Cram with the variant rule that raises each character's primary branch by 1 at every even character level, up to the configured cap.",
    type: Boolean,
    default: false,
  },
  autoAdvanceCap: {
    name: "Auto-advance primary branch cap",
    hint: "Maximum primary branch level granted by even-level auto-advance. Gaining 1 level at each of the 10 even character levels from 2 through 20 reaches 10, whereas the adventure sidebar prints a cap of 11 at level 20; set to 11 to allow that extra level.",
    type: Number,
    default: AUTO_ADVANCE_CAP,
    range: { min: AUTO_ADVANCE_CAP, max: AUTO_ADVANCE_MAX_CAP, step: 1 },
  },
} as const;

const foundryUi: StudyUi & ResearchUi = {
  async pick(title, choices, allowed) {
    const options = choices.map(
      (c, i) => `<option value="${i}">${foundry.utils.escapeHTML(c.label)}</option>`,
    );
    const picked = (button: PickButton): CheckChoice | undefined =>
      choices[Number(button.form.elements.namedItem("check")?.value)];
    const buttons = (["study", "cram"] as const)
      .filter((activity) => activity in allowed)
      .map((activity) => ({
        action: activity,
        label: activity === "study" ? "Study" : "Cram",
        disabled: !allowed[activity],
        callback: (_event: unknown, button: PickButton) => ({ activity, choice: picked(button) }),
      }));
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title },
      content: `<label>Branch and skill <select name="check">${options.join("")}</select></label>`,
      buttons,
      rejectClose: false,
    });
    const answer = result as { activity: StudyActivity; choice?: CheckChoice } | null;
    return answer?.choice ? { activity: answer.activity, choice: answer.choice } : null;
  },
  async pickResearch(actors) {
    const esc = (s: string) => foundry.utils.escapeHTML(s);
    const actorOpts = actors.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`);
    const state = readState(actors[0]!);
    const kindOpts = (["primary", "secondary"] as const)
      .filter((k) => actors.length > 1 || state.branches[k])
      .map((k) => {
        const b = state.branches[k];
        const label = actors.length === 1 && b ? `${k} (${BRANCHES[b.id].label} ${b.level})` : k;
        return `<option value="${k}">${esc(label)}</option>`;
      });
    const skills = new Map(
      actors.flatMap((a) => Object.values(a.skills).map((s) => [s.slug, s.label] as const)),
    );
    const skillOpts = [
      ...[...skills].map(([slug, label]) => `<option value="${esc(slug)}">${esc(label)}</option>`),
      `<option value="">(none)</option>`,
    ];
    const defaultDc = dcForLevel(
      state.branches.primary?.level ?? state.branches.secondary?.level ?? 0,
    );
    const outcomeOpts = [
      `<option value="">Roll check</option>`,
      ...(Object.entries(DEGREE_LABELS) as [DegreeOfSuccess, string][]).map(
        ([deg, label]) => `<option value="${deg}">${label}</option>`,
      ),
    ];
    const val = (b: PickButton, name: string) => b.form.elements.namedItem(name)?.value ?? "";
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Practical Research" },
      content: [
        `<label>Character <select name="actor">${actorOpts.join("")}</select></label>`,
        `<label>Branch <select name="kind">${kindOpts.join("")}</select></label>`,
        `<label>Skill <select name="skill">${skillOpts.join("")}</select></label>`,
        `<label>DC <input type="number" name="dc" value="${defaultDc}" min="1"></label>`,
        `<label>Outcome <select name="outcome">${outcomeOpts.join("")}</select></label>`,
        `<label>Reward note <input type="text" name="note"></label>`,
      ].join(""),
      buttons: [
        {
          action: "research",
          label: "Practical Research",
          callback: (_event: unknown, b: PickButton): ResearchPick | null => {
            const actor = actors[Number(val(b, "actor"))];
            const kind = val(b, "kind") as BranchKind;
            if (!actor || (kind !== "primary" && kind !== "secondary")) return null;
            const skill = val(b, "skill") || undefined;
            const dc = Number(val(b, "dc")) || undefined;
            const outcome = (val(b, "outcome") || undefined) as DegreeOfSuccess | undefined;
            const note = val(b, "note").trim() || undefined;
            return { actor, kind, skill, dc, outcome, note };
          },
        },
      ],
      rejectClose: false,
    });
    return (result as ResearchPick | null) ?? null;
  },
  warn: (text) => ui.notifications.warn(text),
  postSkip: (actor, id) =>
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${foundry.utils.escapeHTML(actor.name)} must skip this Study opportunity after a critical failure.</p>`,
      flags: { [MODULE_ID]: { skip: id } },
    }),
  postResearch: (actor, data) => {
    const branchId = readState(actor).branches[data.kind]?.id;
    const branchLabel = branchId ? BRANCHES[branchId].label : data.kind;
    const checkParts = [data.check, data.dc ? `DC ${data.dc}` : ""].filter(Boolean).join(" ");
    const check = checkParts ? ` (${foundry.utils.escapeHTML(checkParts)})` : "";
    const note = data.note ? ` — ${foundry.utils.escapeHTML(data.note)}` : "";
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${foundry.utils.escapeHTML(actor.name)} completes Practical Research for ${foundry.utils.escapeHTML(branchLabel)}${check}: ${DEGREE_LABELS[data.degree]}${note}.</p>`,
      flags: { [MODULE_ID]: { research: data } },
    });
  },
  setting: (key: StudySetting) =>
    (game.settings.get(MODULE_ID, key) ?? STUDY_SETTINGS[key].default) === true,
  newId: () => foundry.utils.randomID(),
};

/** Starts Study for the given actor, the selected token's actor, or the user's character. */
export async function study(actor?: StudyActor | null): Promise<void> {
  const target = actor ?? canvas.tokens?.controlled[0]?.actor ?? game.user.character;
  if (!target) return ui.notifications.warn("Select a token or assign a character to Study.");
  await startStudy(target, foundryUi);
}

/** Starts Practical Research (GM only) for the given actor, selected token, or world characters. */
export async function research(actor?: StudyActor | null): Promise<void> {
  if (!game.user.isGM) {
    return ui.notifications.warn("Only the GM can record Practical Research.");
  }
  const selected = canvas.tokens?.controlled[0]?.actor ?? game.user.character ?? null;
  const candidates = actor
    ? [actor]
    : [
        ...(selected ? [selected] : []),
        ...[...(game.actors ?? [])].filter(
          (a) => (!a.type || a.type === "character") && a !== selected,
        ),
      ];
  if (candidates.length === 0) {
    return ui.notifications.warn("Select a token or assign a character for Practical Research.");
  }
  await startResearch(candidates, foundryUi);
}

/** On a character level increase, posts a GM-applied card for auto-advance or each resolved star. */
export async function resolveActorLevelUp(
  actor: StudyActor,
  changed: ActorUpdateChanges,
  userId?: string,
): Promise<void> {
  if (userId && game.user.id && userId !== game.user.id) return;
  if (actor.type && actor.type !== "character") return;
  const newLevel = changed.system?.details?.level?.value;
  if (typeof newLevel !== "number") return;
  const prevLevel = actor.level === newLevel ? previousLevels.get(actor) : actor.level;
  if (actor.level === newLevel) previousLevels.set(actor, newLevel);
  if (prevLevel !== undefined && newLevel <= prevLevel) return;

  const state = readState(actor);
  if (game.settings.get(MODULE_ID, "autoAdvance") === true) {
    const branch = state.branches.primary;
    if (!branch) return;
    const fromLevel = prevLevel ?? newLevel - 1;
    const rawCap = game.settings.get(MODULE_ID, "autoAdvanceCap");
    const cap = typeof rawCap === "number" ? rawCap : AUTO_ADVANCE_CAP;
    const entry: StudyEntry = {
      id: foundry.utils.randomID(),
      activity: "study",
      kind: "primary",
      degree: "auto",
      fromLevel,
      level: newLevel,
      cap,
    };
    if (planStudy(state, entry).record.delta <= 0) return;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${foundry.utils.escapeHTML(actor.name)} reaches level ${newLevel} and auto-advances the ${foundry.utils.escapeHTML(BRANCHES[branch.id].label)} primary branch.</p>`,
      flags: { [MODULE_ID]: { autoAdvance: { id: entry.id, fromLevel, level: newLevel, cap } } },
    });
    return;
  }
  for (const kind of ["primary", "secondary"] as const) {
    const branch = state.branches[kind];
    if (!branch?.starred) continue;
    const next = resolveStarOnLevelUp(branch, kind, newLevel);
    if (next.level <= branch.level) continue;
    const id = foundry.utils.randomID();
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${foundry.utils.escapeHTML(actor.name)} reaches level ${newLevel} and resolves the ${foundry.utils.escapeHTML(BRANCHES[branch.id].label)} branch star.</p>`,
      flags: { [MODULE_ID]: { star: { id, kind, level: newLevel } } },
    });
  }
}

/** Posts the Cram daily flat-check prompt when a flagged character rests for the night. */
export async function promptCramFatigue(actor: StudyActor): Promise<void> {
  if (actor.type && actor.type !== "character") return;
  if (game.settings.get(MODULE_ID, "autoAdvance") === true) return;
  const state = readState(actor);
  if (!state.flags.cramFatigue) return;
  const id = foundry.utils.randomID();
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${foundry.utils.escapeHTML(actor.name)} must attempt a @Check[flat|dc:${CRAM_FLAT_DC}|options:${fatigueOption(id)}] flat check against Cram fatigue.</p>`,
    flags: { [MODULE_ID]: { fatigue: id } },
  });
}

/** Adds the academia result, and for the GM an Apply button, to a rendered Study message. */
function renderStudyCard(message: MessageLike, html: HTMLElement, isGM: boolean): void {
  const entry = entryFromMessage(message);
  const actor = message.actor;
  if (!entry || !actor) return;
  const { text, done } = describeEntry(actor, entry);
  const card = document.createElement("div");
  card.className = "thousands-study";
  card.append(Object.assign(document.createElement("p"), { textContent: `Academia: ${text}` }));
  if (isGM && !done) {
    const button = Object.assign(document.createElement("button"), { textContent: "Apply" });
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      await applyStudy(actor, entry);
      // Touching the message re-renders the card for everyone.
      await message.update({ [`flags.${MODULE_ID}.appliedAt`]: Date.now() });
    });
    card.append(button);
  }
  html.querySelector(".message-content")?.append(card);
}

/** Registers the rule settings, `/study`, the macro API, and the chat card. Call on `init`. */
export function registerStudy(): void {
  for (const [key, setting] of Object.entries(STUDY_SETTINGS)) {
    game.settings.register(MODULE_ID, key, { ...setting, scope: "world", config: true });
  }
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = { study, research };
  if (typeof foundry !== "undefined") {
    const commands = foundry.applications?.sidebar?.tabs?.ChatLog?.CHAT_COMMANDS;
    if (commands) commands.study = { rgx: STUDY_COMMAND, fn: runStudyCommand };
  }
  Hooks.on("chatMessage", (_log: unknown, text: string) => {
    const plain = text.trim().replace(/^<p>|<\/p>$/gi, "");
    const match = STUDY_COMMAND.exec(plain);
    return match ? runStudyCommand(_log, plain, undefined, match) : true;
  });
  Hooks.on("renderChatMessageHTML", (message: MessageLike, html: HTMLElement) => {
    renderStudyCard(message, html, game.user.isGM);
  });
  Hooks.on("preUpdateActor", (actor: StudyActor) => {
    previousLevels.set(actor, actor.level);
  });
  Hooks.on(
    "updateActor",
    (actor: StudyActor, changed: ActorUpdateChanges, _options: unknown, userId?: string) => {
      void resolveActorLevelUp(actor, changed, userId);
    },
  );
  Hooks.on("pf2e.restForTheNight", (actor: StudyActor) => {
    void promptCramFatigue(actor);
  });
}
