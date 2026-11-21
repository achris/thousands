import { MODULE_ID } from "../constants.js";
import {
  ATTITUDES,
  ATTITUDE_LABELS,
  BRANCHES,
  DEFAULT_BEFRIEND_THRESHOLD,
  STUDENTS,
  STUDENT_IDS,
  dcForLevel,
  isAttitude,
  isBefriendThreshold,
  type Attitude,
  type BefriendChange,
  type BefriendThreshold,
  type StudentId,
} from "../rules/index.js";
import type { MessageLike } from "../study/chat.js";
import {
  applyBefriend,
  befriendEntryFromMessage,
  describeBefriendEntry,
  formatChange,
  readBefriendState,
  startBefriend,
  type BefriendActor,
  type BefriendPick,
  type BefriendUi,
} from "./tracker.js";

type Hook = (...args: never[]) => unknown;
type PickButton = { form: { elements: { namedItem(name: string): { value: string } | null } } };

declare const Hooks: { on(hook: string, callback: Hook): number };
declare const ChatMessage: {
  create(data: object): Promise<unknown>;
  getSpeaker(o?: { actor?: unknown; alias?: string }): object;
};
declare const game: {
  user: { isGM: boolean; character?: BefriendActor | null };
  actors?: Iterable<BefriendActor>;
  settings: {
    register(scope: string, key: string, config: object): void;
    get(scope: string, key: string): unknown;
  };
  modules: { get(id: string): { api?: Record<string, unknown> } | undefined };
};
declare const ui: { notifications: { warn(text: string): void } };
declare const canvas: { tokens?: { controlled: { actor?: BefriendActor | null }[] } };
declare const foundry: {
  utils: { randomID(): string; escapeHTML(text: string): string };
  applications: {
    api: { DialogV2: { wait(config: object): Promise<unknown> } };
    sidebar?: {
      tabs?: { ChatLog?: { CHAT_COMMANDS?: Record<string, { rgx: RegExp; fn: () => boolean }> } };
    };
  };
};

const BEFRIEND_COMMAND = /^\s*\/befriend\s*$/i;

export const BEFRIEND_SETTINGS = {
  befriendAllowRolls: {
    name: "Befriend: allow skill check rolls",
    hint: "When enabled, /befriend lets players and the GM roll a skill check to shift a student's attitude. When disabled, rolling is hidden and only GM-recorded standing changes are available.",
    type: Boolean,
    default: true,
  },
  befriendThreshold: {
    name: "Befriend: attitude required to befriend",
    hint: "Minimum attitude at which a Spire Dormitory student counts as befriended and grants their Classroom Advantage feat on Apply.",
    type: String,
    default: DEFAULT_BEFRIEND_THRESHOLD,
    choices: { helpful: "Helpful (default)", friendly: "Friendly" },
  },
} as const;

export const befriendAllowRolls = (): boolean =>
  (game.settings.get(MODULE_ID, "befriendAllowRolls") ?? true) === true;
export const befriendThreshold = (): BefriendThreshold => {
  const raw = game.settings.get(MODULE_ID, "befriendThreshold");
  return isBefriendThreshold(raw) ? raw : DEFAULT_BEFRIEND_THRESHOLD;
};

function parseDirectAction(action: string): BefriendChange | null {
  if (action === "delta:1" || action === "delta:2" || action === "delta:-1") {
    return { kind: "delta", steps: Number(action.slice(6)) };
  }
  if (action.startsWith("set:")) {
    const attitude = action.slice(4);
    if (isAttitude(attitude)) return { kind: "set", attitude };
  }
  return null;
}

export function renderStandingsRows(
  actors: readonly BefriendActor[],
  threshold: BefriendThreshold,
): string {
  const esc = (s: string) => foundry.utils.escapeHTML(s);
  if (actors.length > 1) {
    const states = actors.map((a) => ({ name: a.name, state: readBefriendState(a, threshold) }));
    return STUDENT_IDS.map((id) => {
      const cells = states
        .map(
          ({ name, state }) =>
            `${name}: ${ATTITUDE_LABELS[state[id].attitude]}${state[id].befriended ? " ★" : ""}`,
        )
        .join(", ");
      return `<tr><td><strong>${esc(STUDENTS[id].label)}</strong> <small>(${esc(BRANCHES[STUDENTS[id].branch].label)})</small></td><td colspan="2">${esc(cells)}</td></tr>`;
    }).join("");
  }
  const state = readBefriendState(actors[0]!, threshold);
  return STUDENT_IDS.map((id) => {
    const st = state[id];
    const badge = `${ATTITUDE_LABELS[st.attitude]}${st.befriended ? " ★" : ""}`;
    return `<tr><td><strong>${esc(STUDENTS[id].label)}</strong> <small>(${esc(BRANCHES[STUDENTS[id].branch].label)})</small></td><td class="thousands-attitude${st.befriended ? " is-befriended" : ""}">${esc(badge)}</td><td class="thousands-note">${st.notes.at(-1) ? esc(st.notes.at(-1)!) : "—"}</td></tr>`;
  }).join("");
}

const foundryBefriendUi: BefriendUi = {
  async pickBefriend({ actors, isGM, allowRolls, threshold }) {
    const esc = (s: string) => foundry.utils.escapeHTML(s);
    const first = actors[0]!;
    const standingsHtml = `<div class="thousands-befriend-standings"><table class="thousands-standings"><thead><tr><th>Student</th><th>Attitude</th><th>Latest note</th></tr></thead><tbody>${renderStandingsRows([first], threshold)}</tbody></table></div>`;
    if (!isGM && !allowRolls) {
      await foundry.applications.api.DialogV2.wait({
        window: { title: `Spire Dormitory Standings — ${first.name}` },
        content: `${standingsHtml}<p class="thousands-hint">Skill check rolls for befriending are disabled by GM settings.</p>`,
        buttons: [{ action: "close", label: "Close" }],
        rejectClose: false,
      });
      return null;
    }
    const actorOpts = [
      ...actors.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`),
      ...(isGM && actors.length > 1
        ? [`<option value="party">Whole party (all characters)</option>`]
        : []),
    ];
    const studentOpts = STUDENT_IDS.map(
      (id) =>
        `<option value="${id}">${esc(STUDENTS[id].label)} (${esc(BRANCHES[STUDENTS[id].branch].label)})</option>`,
    );
    const skills = new Map(
      actors.flatMap((a) => Object.values(a.skills).map((s) => [s.slug, s.label] as const)),
    );
    const defaultSkill = skills.has("diplomacy") ? "diplomacy" : ([...skills.keys()][0] ?? "");
    const skillOpts = [...skills].map(
      ([slug, label]) =>
        `<option value="${esc(slug)}"${slug === defaultSkill ? " selected" : ""}>${esc(label)}</option>`,
    );
    const actionOpts = [
      ...(allowRolls ? [`<option value="roll">Roll skill check</option>`] : []),
      `<option value="delta:1">Improve (+1 step)</option>`,
      `<option value="delta:2">Greatly improve (+2 steps)</option>`,
      `<option value="delta:-1">Worsen (-1 step)</option>`,
      ...([...ATTITUDES].reverse() as Attitude[]).map(
        (a) => `<option value="set:${a}">Set to ${ATTITUDE_LABELS[a]}</option>`,
      ),
    ];
    const val = (b: PickButton, name: string) => b.form.elements.namedItem(name)?.value ?? "";
    const content = [
      standingsHtml,
      ...(isGM && actors.length > 1
        ? [`<label>Character <select name="target">${actorOpts.join("")}</select></label>`]
        : []),
      `<label>Student <select name="student">${studentOpts.join("")}</select></label>`,
      ...(isGM
        ? [`<label>Action <select name="action">${actionOpts.join("")}</select></label>`]
        : []),
      ...(allowRolls
        ? [
            `<div class="thousands-roll-fields"><label>Skill <select name="skill">${skillOpts.join("")}</select></label><label>DC <input type="number" name="dc" value="${dcForLevel(first.level)}" min="1"></label></div>`,
          ]
        : []),
      `<label>Note <input type="text" name="note" placeholder="Optional favor or roleplay note"></label>`,
    ].join("");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Befriend Spire Dormitory Student" },
      content,
      render: (_event: unknown, dialog: { element?: HTMLElement }) => {
        const root = dialog?.element;
        if (!root) return;
        const targetEl = root.querySelector<HTMLSelectElement>('select[name="target"]');
        const actionEl = root.querySelector<HTMLSelectElement>('select[name="action"]');
        const rollFields = root.querySelector<HTMLElement>(".thousands-roll-fields");
        const tbody = root.querySelector<HTMLElement>(".thousands-standings tbody");
        const sync = () => {
          const isParty = targetEl?.value === "party";
          const rollOpt = actionEl?.querySelector<HTMLOptionElement>('option[value="roll"]');
          if (rollOpt) {
            rollOpt.disabled = isParty;
            if (isParty && actionEl?.value === "roll") actionEl.value = "delta:1";
          }
          if (rollFields && actionEl)
            rollFields.style.display = actionEl.value === "roll" ? "" : "none";
          if (tbody && targetEl) {
            const idx = Number(targetEl.value);
            tbody.innerHTML = isParty
              ? renderStandingsRows(actors, threshold)
              : actors[idx]
                ? renderStandingsRows([actors[idx]!], threshold)
                : tbody.innerHTML;
          }
        };
        targetEl?.addEventListener("change", sync);
        actionEl?.addEventListener("change", sync);
        sync();
      },
      buttons: [
        {
          action: "submit",
          label: isGM ? (allowRolls ? "Roll / Record" : "Record") : "Roll Check",
          callback: (_event: unknown, b: PickButton): BefriendPick | null => {
            const student = val(b, "student") as StudentId;
            if (!(student in STUDENTS)) return null;
            const note = val(b, "note").trim() || undefined;
            const targetVal = isGM && actors.length > 1 ? val(b, "target") : "0";
            const party = targetVal === "party";
            const actor = party ? undefined : (actors[Number(targetVal)] ?? first);
            const action = isGM ? val(b, "action") : "roll";
            if (action === "roll") {
              if (!actor) {
                ui.notifications.warn(
                  "Select a specific character to roll a check, or choose a direct adjustment for the whole party.",
                );
                return null;
              }
              return {
                mode: "roll",
                actor,
                student,
                skill: val(b, "skill"),
                dc: Number(val(b, "dc")) || undefined,
                note,
              };
            }
            const change = parseDirectAction(action);
            return change ? { mode: "direct", actor, party, student, change, note } : null;
          },
        },
      ],
      rejectClose: false,
    });
    return (result as BefriendPick | null) ?? null;
  },
  warn: (text) => ui.notifications.warn(text),
  postBefriend: (actors, data) => {
    const esc = (s: string) => foundry.utils.escapeHTML(s);
    const who = actors.length > 1 ? "The party" : actors[0]!.name;
    const note = data.note ? ` — ${esc(data.note)}` : "";
    const speaker =
      actors.length === 1
        ? ChatMessage.getSpeaker({ actor: actors[0] })
        : ChatMessage.getSpeaker({ alias: "Spire Dormitory" });
    return ChatMessage.create({
      speaker,
      content: `<p>${esc(who)} updates standing with ${esc(STUDENTS[data.student].label)} (${esc(formatChange(data.change))})${note}.</p>`,
      flags: { [MODULE_ID]: { befriend: data } },
    });
  },
  newId: () => foundry.utils.randomID(),
};

const isCharacter = (a?: BefriendActor | null): a is BefriendActor =>
  !!a && (!a.type || a.type === "character");

export async function befriend(actor?: BefriendActor | null): Promise<void> {
  const isGM = game.user.isGM;
  const controlled = canvas.tokens?.controlled.find((t) => isCharacter(t.actor))?.actor ?? null;
  const assigned = isCharacter(game.user.character) ? game.user.character : null;
  const selected = controlled ?? assigned;
  const candidates = actor
    ? isCharacter(actor)
      ? [actor]
      : []
    : isGM
      ? [
          ...(selected ? [selected] : []),
          ...[...(game.actors ?? [])].filter((a) => isCharacter(a) && a !== selected),
        ]
      : selected
        ? [selected]
        : [];
  await startBefriend(candidates, foundryBefriendUi, {
    isGM,
    allowRolls: befriendAllowRolls(),
    threshold: befriendThreshold(),
  });
}

function resolveTargets(message: MessageLike, actorIds?: readonly string[]): BefriendActor[] {
  if (actorIds?.length) {
    const byId = new Map(
      [...(game.actors ?? [])].flatMap((a) =>
        a.id && isCharacter(a) ? [[a.id, a] as const] : [],
      ),
    );
    return actorIds.flatMap((id) => byId.get(id) ?? []);
  }
  const actor = message.actor as BefriendActor | null | undefined;
  return isCharacter(actor) ? [actor] : [];
}

export function renderBefriendCard(message: MessageLike, html: HTMLElement, isGM: boolean): void {
  const entry = befriendEntryFromMessage(message);
  if (!entry) return;
  const targets = resolveTargets(message, entry.actorIds);
  if (targets.length === 0) return;
  const threshold = befriendThreshold();
  const { text, done } = describeBefriendEntry(targets, entry, threshold);
  const card = document.createElement("div");
  card.className = "thousands-study thousands-befriend";
  card.append(Object.assign(document.createElement("p"), { textContent: `Befriending: ${text}` }));
  if (isGM && !done) {
    const button = Object.assign(document.createElement("button"), { textContent: "Apply" });
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      for (const actor of targets) await applyBefriend(actor, entry, threshold);
      await message.update({ [`flags.${MODULE_ID}.appliedAt`]: Date.now() });
    });
    card.append(button);
  }
  html.querySelector(".message-content")?.append(card);
}

const runBefriendCommand = (): false => {
  void befriend();
  return false;
};

export function registerBefriend(): void {
  for (const [key, setting] of Object.entries(BEFRIEND_SETTINGS)) {
    game.settings.register(MODULE_ID, key, { ...setting, scope: "world", config: true });
  }
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = { ...module.api, befriend };
  const commands =
    typeof foundry !== "undefined"
      ? foundry.applications?.sidebar?.tabs?.ChatLog?.CHAT_COMMANDS
      : undefined;
  if (commands) commands.befriend = { rgx: BEFRIEND_COMMAND, fn: runBefriendCommand };
  Hooks.on("chatMessage", (_log: unknown, text: string) =>
    BEFRIEND_COMMAND.test(text.trim().replace(/^<p>|<\/p>$/gi, "")) ? runBefriendCommand() : true,
  );
  Hooks.on("renderChatMessageHTML", (message: MessageLike, html: HTMLElement) =>
    renderBefriendCard(message, html, game.user.isGM),
  );
}
