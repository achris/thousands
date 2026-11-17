import { MODULE_ID } from "../constants.js";
import {
  AUTO_ADVANCE_CAP,
  AUTO_ADVANCE_MAX_CAP,
  BRANCHES,
  CRAM_FLAT_DC,
  resolveStarOnLevelUp,
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
  startStudy,
  type CheckChoice,
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
          CHAT_COMMANDS?: Record<string, { rgx: RegExp; fn: () => boolean }>;
        };
      };
    };
  };
};

const STUDY_COMMAND = /^\s*\/study\s*$/i;
const previousLevels = new WeakMap<object, number>();

function runStudyCommand(): false {
  void study();
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

const foundryUi: StudyUi = {
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
  warn: (text) => ui.notifications.warn(text),
  postSkip: (actor, id) =>
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${foundry.utils.escapeHTML(actor.name)} must skip this Study opportunity after a critical failure.</p>`,
      flags: { [MODULE_ID]: { skip: id } },
    }),
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
  if (module) module.api = { study };
  if (typeof foundry !== "undefined") {
    const commands = foundry.applications?.sidebar?.tabs?.ChatLog?.CHAT_COMMANDS;
    if (commands) commands.study = { rgx: STUDY_COMMAND, fn: runStudyCommand };
  }
  Hooks.on("chatMessage", (_log: unknown, text: string) => {
    const plain = text.trim().replace(/^<p>|<\/p>$/gi, "");
    return STUDY_COMMAND.test(plain) ? runStudyCommand() : true;
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
