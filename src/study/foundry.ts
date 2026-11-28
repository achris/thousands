import { MODULE_ID } from "../constants.js";
import {
  AUTO_ADVANCE_CAP,
  AUTO_ADVANCE_MAX_CAP,
  BRANCHES,
  CRAM_FLAT_DC,
  RANK_LABELS,
  RESEARCH_SITES,
  RESEARCH_SITE_IDS,
  isRank,
  isResearchSiteId,
  researchDc,
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
  PROMOTABLE_RANKS,
  applyPromote,
  defaultPromoteRank,
  describePromote,
  promoteEntryFromMessage,
  startPromote,
  type PromoteActor,
  type PromotePick,
  type PromoteUi,
} from "./promote.js";
import {
  fatigueOption,
  researchSkillChoices,
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
type PickButton = {
  form: { elements: { namedItem(name: string): { value: string; checked?: boolean } | null } };
};

export interface ActorUpdateChanges {
  system?: { details?: { level?: { value?: number } } };
}

declare const Hooks: { on(hook: string, callback: Hook): number };
declare const ChatMessage: {
  create(data: object): Promise<unknown>;
  getSpeaker(options: { actor?: unknown; alias?: string }): object;
};
declare const game: {
  user: {
    id?: string;
    isGM: boolean;
    isActiveGM?: boolean;
    character?: (StudyActor & { id?: string }) | null;
  };
  users?: { activeGM?: unknown };
  actors?: Iterable<StudyActor & { id?: string }> & {
    party?: { members?: Iterable<StudyActor & { id?: string }> } | null;
  };
  time?: { worldTime?: number };
  pf2e?: {
    Check?: {
      roll(check: unknown, context?: Record<string, unknown>): Promise<unknown>;
    };
    CheckModifier?: new (slug: string, statistic: { modifiers: never[] }) => unknown;
    Modifier?: new (data: object) => object;
  };
  settings: {
    register(scope: string, key: string, config: object): void;
    get(scope: string, key: string): unknown;
  };
  modules: { get(id: string): { api?: unknown } | undefined };
};
declare const ui: { notifications: { warn(text: string): void } };
declare const canvas: {
  tokens?: { controlled: { actor?: (StudyActor & { id?: string }) | null }[] };
};
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
const RESEARCH_COMMAND = /^\s*\/research\s*$/i;
const PROMOTE_COMMAND = /^\s*\/promote\s*$/i;
const previousLevels = new WeakMap<object, number>();
const lastFatigueRolls = new WeakMap<object, { flagsKey: string; worldTime: number | undefined }>();
const DEGREE_LABELS: Record<DegreeOfSuccess, string> = {
  criticalSuccess: "Critical Success",
  success: "Success",
  failure: "Failure",
  criticalFailure: "Critical Failure",
};

function runStudyCommand(): false {
  void study();
  return false;
}

function runResearchCommand(): false {
  void research();
  return false;
}

function runPromoteCommand(): false {
  void promote();
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
  autoRollCramFatigue: {
    name: "Auto-roll Cram fatigue check after rest",
    hint: "When enabled, resting for the night automatically rolls the DC 8 flat check against Cram fatigue and posts the roll card for the GM to Apply on a failure, instead of posting a chat prompt.",
    type: Boolean,
    default: false,
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

const foundryUi: StudyUi & ResearchUi & PromoteUi = {
  async pick(title, choices, allowed, notes) {
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
    const advantageHtml = notes?.length
      ? `<p>Classroom Advantage: ${foundry.utils.escapeHTML(notes.join(", "))}</p>`
      : "";
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title },
      content: `${advantageHtml}<label>Branch and skill <select name="check">${options.join("")}</select></label>`,
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
    const siteOpts = [
      `<option value="">Freeform (any skill)</option>`,
      ...RESEARCH_SITE_IDS.map((id) => {
        const { label, source, duration } = RESEARCH_SITES[id];
        return `<option value="${id}">${esc(`${label} (${source}; ${duration})`)}</option>`;
      }),
    ];
    /** Skill options and standard DC for the character, branch, and site now selected. */
    const choicesFor = (actor: StudyActor, kind: string, siteId: string) => {
      const { branches } = readState(actor);
      const branch =
        branches[kind === "secondary" ? "secondary" : "primary"] ??
        branches.primary ??
        branches.secondary;
      const site = isResearchSiteId(siteId) ? siteId : undefined;
      const skills = site
        ? branch
          ? researchSkillChoices(actor, branch.id, site)
          : []
        : actors.flatMap((a) => Object.values(a.skills));
      const options = new Map(skills.map((s) => [s.slug, s.label]));
      return {
        skills: [
          ...[...options].map(
            ([slug, label]) => `<option value="${esc(slug)}">${esc(label)}</option>`,
          ),
          `<option value="">(none)</option>`,
        ].join(""),
        dc: researchDc(branch?.level ?? 0, site),
      };
    };
    const initial = choicesFor(actors[0]!, "primary", "");
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
        `<label>Site <select name="site">${siteOpts.join("")}</select></label>`,
        `<label class="thousands-telepathy" style="display: none"><input type="checkbox" name="telepathy"> Has Telepathy</label>`,
        `<label>Branch <select name="kind">${kindOpts.join("")}</select></label>`,
        `<label>Skill <select name="skill">${initial.skills}</select></label>`,
        `<label>DC <input type="number" name="dc" value="${initial.dc}" min="1"></label>`,
        `<label>Outcome <select name="outcome">${outcomeOpts.join("")}</select></label>`,
        `<label>Reward note <input type="text" name="note"></label>`,
      ].join(""),
      render: (_event: unknown, dialog: { element?: HTMLElement }) => {
        const find = <T extends Element>(selector: string) =>
          dialog?.element?.querySelector<T>(selector);
        const actorEl = find<HTMLSelectElement>('select[name="actor"]');
        const siteEl = find<HTMLSelectElement>('select[name="site"]');
        const kindEl = find<HTMLSelectElement>('select[name="kind"]');
        const skillEl = find<HTMLSelectElement>('select[name="skill"]');
        const dcEl = find<HTMLInputElement>('input[name="dc"]');
        const telepathyEl = find<HTMLElement>(".thousands-telepathy");
        if (!actorEl || !siteEl || !kindEl || !skillEl || !dcEl || !telepathyEl) return;
        // A DC the GM typed is kept through later selection changes.
        let typedDc = false;
        dcEl.addEventListener("input", () => (typedDc = true));
        const sync = () => {
          const actor = actors[Number(actorEl.value)] ?? actors[0]!;
          const next = choicesFor(actor, kindEl.value, siteEl.value);
          const skill = skillEl.value;
          skillEl.innerHTML = next.skills;
          if ([...skillEl.options].some((o) => o.value === skill)) skillEl.value = skill;
          if (!typedDc) dcEl.value = String(next.dc);
          const site = isResearchSiteId(siteEl.value) ? RESEARCH_SITES[siteEl.value] : undefined;
          telepathyEl.style.display = site?.needsTelepathy ? "" : "none";
        };
        for (const el of [actorEl, siteEl, kindEl]) el.addEventListener("change", sync);
      },
      buttons: [
        {
          action: "research",
          label: "Practical Research",
          callback: (_event: unknown, b: PickButton): ResearchPick | null => {
            const actor = actors[Number(val(b, "actor"))];
            const kind = val(b, "kind") as BranchKind;
            if (!actor || (kind !== "primary" && kind !== "secondary")) return null;
            const rawSite = val(b, "site");
            const site = isResearchSiteId(rawSite) ? rawSite : undefined;
            const telepathy = !!b.form.elements.namedItem("telepathy")?.checked;
            const skill = val(b, "skill") || undefined;
            const dc = Number(val(b, "dc")) || undefined;
            const outcome = (val(b, "outcome") || undefined) as DegreeOfSuccess | undefined;
            const note = val(b, "note").trim() || undefined;
            return { actor, kind, site, telepathy, skill, dc, outcome, note };
          },
        },
      ],
      rejectClose: false,
    });
    return (result as ResearchPick | null) ?? null;
  },
  async pickPromote(actors, partyMembers) {
    const esc = (s: string) => foundry.utils.escapeHTML(s);
    const hasParty = partyMembers.length > 0;
    const first = actors[0] ?? partyMembers[0]!;
    const targetOpts = [
      ...actors.map(
        (a, i) =>
          `<option value="${i}">${esc(a.name)} (${esc(RANK_LABELS[readState(a).rank])})</option>`,
      ),
      ...(hasParty
        ? [`<option value="party">Whole party (${partyMembers.length} members)</option>`]
        : []),
    ];
    const defaultRank = defaultPromoteRank(actors.length > 0 ? [first] : partyMembers);
    const rankOpts = PROMOTABLE_RANKS.map(
      (r) =>
        `<option value="${r}"${r === defaultRank ? " selected" : ""}>${RANK_LABELS[r]}</option>`,
    );
    const showTargetSelect = actors.length > 1 || (actors.length === 1 && hasParty);
    const val = (b: PickButton, name: string) => b.form.elements.namedItem(name)?.value ?? "";
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Promote Academic Rank" },
      content: [
        ...(showTargetSelect
          ? [`<label>Target <select name="target">${targetOpts.join("")}</select></label>`]
          : [
              `<p class="thousands-character">Character: <strong>${esc(first.name)}</strong> (${esc(RANK_LABELS[readState(first).rank])})</p>`,
            ]),
        `<label>New rank <select name="rank">${rankOpts.join("")}</select></label>`,
      ].join(""),
      render: (_event: unknown, dialog: { element?: HTMLElement }) => {
        const targetEl = dialog?.element?.querySelector<HTMLSelectElement>('select[name="target"]');
        const rankEl = dialog?.element?.querySelector<HTMLSelectElement>('select[name="rank"]');
        if (!targetEl || !rankEl) return;
        targetEl.addEventListener("change", () => {
          const group =
            targetEl.value === "party"
              ? partyMembers
              : actors[Number(targetEl.value)]
                ? [actors[Number(targetEl.value)]!]
                : [];
          rankEl.value = defaultPromoteRank(group);
        });
      },
      buttons: [
        {
          action: "promote",
          label: "Promote",
          callback: (_event: unknown, b: PickButton): PromotePick | null => {
            const rank = val(b, "rank");
            if (!isRank(rank) || !PROMOTABLE_RANKS.includes(rank)) return null;
            const targetVal = showTargetSelect
              ? val(b, "target")
              : hasParty && actors.length === 0
                ? "party"
                : "0";
            const party = targetVal === "party";
            const actor = party ? undefined : (actors[Number(targetVal)] ?? first);
            return { actor, party, rank };
          },
        },
      ],
      rejectClose: false,
    });
    return (result as PromotePick | null) ?? null;
  },
  warn: (text) => ui.notifications.warn(text),
  postPromote: (actors, data) => {
    const esc = (s: string) => foundry.utils.escapeHTML(s);
    const who = actors.length > 1 ? "The party" : actors[0]!.name;
    const speaker =
      actors.length === 1
        ? ChatMessage.getSpeaker({ actor: actors[0] })
        : ChatMessage.getSpeaker({ alias: "Magaambya" });
    return ChatMessage.create({
      speaker,
      content: `<p>${esc(who)} advances to Academic Rank: ${esc(RANK_LABELS[data.rank])}.</p>`,
      flags: { [MODULE_ID]: { promote: data } },
    });
  },
  postSkip: (actor, id) =>
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${foundry.utils.escapeHTML(actor.name)} must skip this opportunity after a critical failure.</p>`,
      flags: { [MODULE_ID]: { skip: id } },
    }),
  postResearch: (actor, data) => {
    const branchId = readState(actor).branches[data.kind]?.id;
    const branchLabel = branchId ? BRANCHES[branchId].label : data.kind;
    const site = data.site
      ? ` at ${foundry.utils.escapeHTML(RESEARCH_SITES[data.site].label)}`
      : "";
    const checkParts = [data.check, data.dc ? `DC ${data.dc}` : ""].filter(Boolean).join(" ");
    const check = checkParts ? ` (${foundry.utils.escapeHTML(checkParts)})` : "";
    const note = data.note ? ` — ${foundry.utils.escapeHTML(data.note)}` : "";
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${foundry.utils.escapeHTML(actor.name)} completes Practical Research${site} for ${foundry.utils.escapeHTML(branchLabel)}${check}: ${DEGREE_LABELS[data.degree]}${note}.</p>`,
      flags: { [MODULE_ID]: { research: data } },
    });
  },
  circumstance: (label, value) =>
    new game.pf2e!.Modifier!({
      slug: "research-site",
      label,
      modifier: value,
      type: "circumstance",
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

const isCharacter = (a?: PromoteActor | null): a is PromoteActor =>
  !!a && (!a.type || a.type === "character");

/** Promotes Academic Rank (GM only) for the given actor, selected token, or world characters / active party. */
export async function promote(actor?: PromoteActor | null): Promise<void> {
  if (!game.user.isGM) {
    return ui.notifications.warn("Only the GM can promote academic rank.");
  }
  const controlled = canvas.tokens?.controlled.find((t) => isCharacter(t.actor))?.actor ?? null;
  const assigned = isCharacter(game.user.character) ? game.user.character : null;
  const selected = controlled ?? assigned;
  const candidates = actor
    ? isCharacter(actor)
      ? [actor]
      : []
    : [
        ...(selected ? [selected] : []),
        ...[...(game.actors ?? [])].filter((a) => isCharacter(a) && a !== selected),
      ];
  const partyMembers = actor ? [] : [...(game.actors?.party?.members ?? [])].filter(isCharacter);
  await startPromote(candidates, foundryUi, partyMembers);
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

/** Posts or auto-rolls the Cram daily flat check when a flagged character rests for the night. */
export async function promptCramFatigue(actor: StudyActor): Promise<void> {
  if (actor.type && actor.type !== "character") return;
  if (game.settings.get(MODULE_ID, "autoAdvance") === true) return;
  const state = readState(actor);
  if (!state.flags.cramFatigue) return;
  if (game.settings.get(MODULE_ID, "autoRollCramFatigue") === true) {
    if (!game.pf2e?.Check) return;
    const flagsKey = JSON.stringify(state.flags);
    const worldTime = game.time?.worldTime;
    const previous = lastFatigueRolls.get(actor);
    if (previous && previous.flagsKey === flagsKey && previous.worldTime === worldTime) return;
    lastFatigueRolls.set(actor, { flagsKey, worldTime });
    const id = foundry.utils.randomID();
    const check = game.pf2e.CheckModifier
      ? new game.pf2e.CheckModifier("flat-check", { modifiers: [] })
      : {
          slug: "flat-check",
          modifiers: [],
          totalModifier: 0,
          calculateTotal: () => undefined,
        };
    try {
      await game.pf2e.Check.roll(check, {
        actor,
        type: "flat-check",
        dc: { value: CRAM_FLAT_DC, visible: true },
        title: "Cram Fatigue: Flat Check",
        domains: ["flat-check"],
        options: new Set([fatigueOption(id)]),
        skipDialog: true,
        createMessage: true,
      });
    } catch (error) {
      lastFatigueRolls.delete(actor);
      throw error;
    }
    return;
  }
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

function resolvePromoteTargets(message: MessageLike, actorIds?: readonly string[]): PromoteActor[] {
  if (actorIds?.length) {
    const byId = new Map(
      [...(game.actors ?? [])].flatMap((a) => (a.id && isCharacter(a) ? [[a.id, a] as const] : [])),
    );
    return actorIds.flatMap((id) => byId.get(id) ?? []);
  }
  const actor = message.actor as PromoteActor | null | undefined;
  return isCharacter(actor) ? [actor] : [];
}

/** Adds the rank promotion result, and for the GM an Apply button, to a rendered Promote message. */
export function renderPromoteCard(message: MessageLike, html: HTMLElement, isGM: boolean): void {
  const entry = promoteEntryFromMessage(message);
  if (!entry) return;
  const targets = resolvePromoteTargets(message, entry.actorIds);
  if (targets.length === 0) return;
  const { text, done } = describePromote(targets, entry);
  const card = document.createElement("div");
  card.className = "thousands-study thousands-promote";
  card.append(Object.assign(document.createElement("p"), { textContent: `Academia: ${text}` }));
  if (isGM && !done) {
    const button = Object.assign(document.createElement("button"), { textContent: "Apply" });
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      for (const actor of targets) await applyPromote(actor, entry);
      await message.update({ [`flags.${MODULE_ID}.appliedAt`]: Date.now() });
    });
    card.append(button);
  }
  html.querySelector(".message-content")?.append(card);
}

/** Registers the rule settings, `/study`, `/research`, `/promote`, the macro API, and chat cards. Call on `init`. */
export function registerStudy(): void {
  for (const [key, setting] of Object.entries(STUDY_SETTINGS)) {
    game.settings.register(MODULE_ID, key, { ...setting, scope: "world", config: true });
  }
  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = {
      ...(module.api as Record<string, unknown> | undefined),
      study,
      research,
      promote,
    };
  }
  if (typeof foundry !== "undefined") {
    const commands = foundry.applications?.sidebar?.tabs?.ChatLog?.CHAT_COMMANDS;
    if (commands) {
      commands.study = { rgx: STUDY_COMMAND, fn: runStudyCommand };
      commands.research = { rgx: RESEARCH_COMMAND, fn: runResearchCommand };
      commands.promote = { rgx: PROMOTE_COMMAND, fn: runPromoteCommand };
    }
  }
  Hooks.on("chatMessage", (_log: unknown, text: string) => {
    const plain = text.trim().replace(/^<p>|<\/p>$/gi, "");
    if (STUDY_COMMAND.test(plain)) return runStudyCommand();
    if (RESEARCH_COMMAND.test(plain)) return runResearchCommand();
    if (PROMOTE_COMMAND.test(plain)) return runPromoteCommand();
    return true;
  });
  Hooks.on("renderChatMessageHTML", (message: MessageLike, html: HTMLElement) => {
    renderStudyCard(message, html, game.user.isGM);
    renderPromoteCard(message, html, game.user.isGM);
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
