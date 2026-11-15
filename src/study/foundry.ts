import { MODULE_ID } from "../constants.js";
import { applyStudy } from "./academia.js";
import { describeEntry, entryFromMessage, type MessageLike } from "./chat.js";
import { startStudy, type StudyActor, type StudyUi } from "./roll.js";

type Hook = (...args: never[]) => unknown;
type PickButton = { form: { elements: { namedItem(name: string): { value: string } | null } } };

declare const Hooks: { on(hook: string, callback: Hook): number };
declare const ChatMessage: {
  create(data: object): Promise<unknown>;
  getSpeaker(options: { actor: unknown }): object;
};
declare const game: {
  user: { isGM: boolean; character?: StudyActor | null };
  modules: { get(id: string): { api?: unknown } | undefined };
};
declare const ui: { notifications: { warn(text: string): void } };
declare const canvas: { tokens?: { controlled: { actor?: StudyActor | null }[] } };
declare const foundry: {
  utils: { randomID(): string; escapeHTML(text: string): string };
  applications: { api: { DialogV2: { prompt(config: object): Promise<unknown> } } };
};

const foundryUi: StudyUi = {
  async pick(choices) {
    const options = choices.map(
      (c, i) => `<option value="${i}">${foundry.utils.escapeHTML(c.label)}</option>`,
    );
    const index = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Study" },
      content: `<label>Branch and skill <select name="check">${options.join("")}</select></label>`,
      ok: {
        label: "Roll",
        callback: (_event: unknown, button: PickButton) =>
          Number(button.form.elements.namedItem("check")?.value),
      },
      rejectClose: false,
    });
    return typeof index === "number" ? (choices[index] ?? null) : null;
  },
  warn: (text) => ui.notifications.warn(text),
  postSkip: (actor, id) =>
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${foundry.utils.escapeHTML(actor.name)} must skip this Study opportunity after a critical failure.</p>`,
      flags: { [MODULE_ID]: { skip: id } },
    }),
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

/** Registers the `/study` chat command, the macro API, and the chat card. Call on `init`. */
export function registerStudy(): void {
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = { study };
  Hooks.on("chatMessage", (_log: unknown, text: string) => {
    if (!/^\/study\s*$/i.test(text.trim())) return true;
    void study();
    return false;
  });
  Hooks.on("renderChatMessageHTML", (message: MessageLike, html: HTMLElement) => {
    renderStudyCard(message, html, game.user.isGM);
  });
}
