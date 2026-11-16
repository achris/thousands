import { MODULE_ID } from "../constants.js";
import { applyStudy, type StudyActivity } from "./academia.js";
import { describeEntry, entryFromMessage, type MessageLike } from "./chat.js";
import {
  startStudy,
  type CheckChoice,
  type StudyActor,
  type StudySetting,
  type StudyUi,
} from "./roll.js";

type Hook = (...args: never[]) => unknown;
type PickButton = { form: { elements: { namedItem(name: string): { value: string } | null } } };

declare const Hooks: { on(hook: string, callback: Hook): number };
declare const ChatMessage: {
  create(data: object): Promise<unknown>;
  getSpeaker(options: { actor: unknown }): object;
};
declare const game: {
  user: { isGM: boolean; character?: StudyActor | null };
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

function runStudyCommand(): false {
  void study();
  return false;
}

export const STUDY_SETTINGS: Record<StudySetting, { name: string; hint: string }> = {
  cramStrict: {
    name: "Cram: each check needs an eligible branch",
    hint: "When enabled, both Cram checks must use a branch at least 2 levels below its cap after accounting for the first check. When disabled, having one eligible branch at the start is enough.",
  },
  skipAppliesToCram: {
    name: "Critical-failure skip consumes Cram",
    hint: "When enabled, a pending skip after a critical failure skips the next Study or Cram opportunity. When disabled, only Study is blocked and Cram remains available.",
  },
};

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
  setting: (key) => game.settings.get(MODULE_ID, key) !== false,
  newId: () => foundry.utils.randomID(),
};

/** Starts Study for the given actor, the selected token's actor, or the user's character. */
export async function study(actor?: StudyActor | null): Promise<void> {
  const target = actor ?? canvas.tokens?.controlled[0]?.actor ?? game.user.character;
  if (!target) return ui.notifications.warn("Select a token or assign a character to Study.");
  await startStudy(target, foundryUi);
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
  for (const [key, { name, hint }] of Object.entries(STUDY_SETTINGS)) {
    const config = { name, hint, scope: "world", config: true, type: Boolean, default: true };
    game.settings.register(MODULE_ID, key, config);
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
}
