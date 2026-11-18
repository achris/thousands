import { afterEach, describe, expect, it, vi } from "vitest";
import type { DegreeOfSuccess, Rank } from "../src/rules/index.js";
import { describeEntry, entryFromMessage, type MessageLike } from "../src/study/chat.js";
import {
  STUDY_SETTINGS,
  promptCramFatigue,
  registerStudy,
  research,
  resolveActorLevelUp,
  study,
} from "../src/study/foundry.js";
import {
  fatigueOption,
  researchNoteOption,
  startResearch,
  startStudy,
  studyOption,
  type AllowedActivities,
  type ResearchFlag,
  type ResearchPick,
  type StatisticLike,
  type StudySetting,
  type StudyUi,
} from "../src/study/roll.js";
import {
  applyStudy,
  type ActorLike,
  featFor,
  levelOption,
  planStudy,
  readState,
  starOption,
  type StudyActivity,
  type StudyEntry,
  type StudyFlags,
} from "../src/study/academia.js";

afterEach(() => vi.unstubAllGlobals());

/** A level 6 Uzunjati primary and Cascade Bearers secondary at the given branch levels. */
function makeActor(top: number, secondaryTop = 0, rank?: Rank) {
  const options = ["academia:branch:primary:uzunjati", "academia:branch:secondary:cascade-bearers"];
  if (rank) options.push(`academia:rank:${rank}`);
  for (let n = 1; n <= top; n++) options.push(levelOption("uzunjati", n));
  for (let n = 1; n <= secondaryTop; n++) options.push(levelOption("cascade-bearers", n));
  let next = 0;
  const outcomes: DegreeOfSuccess[] = [];
  const skill = (slug: string, lore = false): [string, StatisticLike] => [
    slug,
    {
      slug,
      label: slug,
      lore,
      roll: vi.fn(async ({ callback }) => callback?.(null, outcomes.shift() ?? "success")),
    },
  ];
  const actor = {
    name: "Tester",
    level: 6,
    outcomes,
    flag: {} as StudyFlags,
    items: options.map((option) => ({
      id: `i${next++}`,
      system: { slug: featFor(option).system.slug },
    })),
    skills: Object.fromEntries([skill("arcana"), skill("crafting"), skill("herbalism-lore", true)]),
    getFlag: () => actor.flag,
    setFlag: async (_scope: string, _key: string, value: unknown) => {
      actor.flag = value as StudyFlags;
    },
    createEmbeddedDocuments: vi.fn(async (_type: "Item", sources: object[]) => {
      for (const source of sources as { system: { slug: string } }[]) {
        actor.items.push({ id: `i${next++}`, system: { slug: source.system.slug } });
      }
    }),
    deleteEmbeddedDocuments: async (_type: "Item", ids: string[]) => {
      actor.items = actor.items.filter((item) => !ids.includes(item.id));
    },
    increaseCondition: vi.fn(async () => undefined),
    decreaseCondition: vi.fn(async () => undefined),
  };
  return actor;
}

function makeUi(
  picks: [StudyActivity, string][],
  settings: Partial<Record<StudySetting, boolean>> = {},
) {
  const ui = {
    seen: [] as { labels: string[]; allowed: AllowedActivities }[],
    warn: vi.fn(),
    postSkip: vi.fn(async () => undefined),
    setting: (key: StudySetting) => settings[key] ?? STUDY_SETTINGS[key].default,
    newId: () => "abc",
    pick: (async (_title, choices, allowed) => {
      ui.seen.push({ labels: choices.map((c) => `${c.kind}:${c.slug}`), allowed });
      const [activity, slug] = picks.shift() ?? ["study", ""];
      const choice = choices.find((c) => c.slug === slug);
      return choice ? { activity, choice } : null;
    }) as StudyUi["pick"],
  };
  return ui;
}

type Degree = StudyEntry["degree"];
const entry = (degree: Degree, extra: Partial<StudyEntry> = {}): StudyEntry => ({
  id: "abc",
  activity: "study",
  kind: "primary",
  degree,
  ...extra,
});
const primaryLevel = (actor: ActorLike) => readState(actor).branches.primary?.level;

describe("starting Study", () => {
  it("rolls the chosen skill at the DC for the branch level and tags the roll", async () => {
    const actor = makeActor(2);
    const ui = makeUi([["study", "herbalism-lore"]]);
    await startStudy(actor, ui);
    expect(ui.seen[0]?.labels).toEqual([
      "primary:crafting",
      "primary:herbalism-lore",
      "secondary:arcana",
    ]);
    expect(actor.skills["herbalism-lore"]?.roll).toHaveBeenCalledWith(
      expect.objectContaining({
        dc: 16,
        traits: ["downtime"],
        extraRollOptions: ["thousands:study:abc:study:primary", "downtime"],
      }),
    );
  });

  it("offers Cram only when eligible by branch gap and rank, and rejects an ineligible branch", async () => {
    const nearCap = makeActor(5, 2);
    const nearUi = makeUi([["cram", "crafting"]]);
    await startStudy(nearCap, nearUi);
    expect(nearUi.seen[0]?.allowed).toEqual({ study: true, cram: false });
    expect(nearCap.skills.crafting?.roll).not.toHaveBeenCalled();

    const loreSpeaker = makeActor(0, 0, "lore-speaker");
    const rankUi = makeUi([["cram", "crafting"]]);
    await startStudy(loreSpeaker, rankUi);
    expect(rankUi.seen).toHaveLength(0);
    expect(rankUi.warn).toHaveBeenCalledOnce();

    const oneOpen = makeActor(2, 2);
    const wrongUi = makeUi([["cram", "arcana"]]);
    await startStudy(oneOpen, wrongUi);
    expect(wrongUi.seen[0]?.allowed).toEqual({ study: true, cram: true });
    expect(wrongUi.warn).toHaveBeenCalledOnce();
    expect(oneOpen.skills.arcana?.roll).not.toHaveBeenCalled();
  });

  it("runs Cram as two checks, pricing the second from the level the first would reach", async () => {
    const actor = makeActor(2, 2);
    actor.outcomes.push("criticalSuccess", "success");
    const ui = makeUi([
      ["cram", "crafting"],
      ["cram", "crafting"],
    ]);
    await startStudy(actor, ui);
    expect(ui.seen[1]?.labels).toEqual(["primary:crafting", "primary:herbalism-lore"]);
    const calls = vi.mocked(actor.skills.crafting!.roll).mock.calls.map(([args]) => args);
    expect(calls.map((c) => c.dc)).toEqual([16, 19]);
    expect(calls.map((c) => c.traits)).toEqual([["downtime"], ["downtime"]]);
    expect(calls.map((c) => c.extraRollOptions)).toEqual([
      [studyOption("abc-1", "cram", "primary"), "downtime"],
      [studyOption("abc-2", "cram", "primary"), "downtime"],
    ]);
  });

  it("honours cramStrict on and off for the second Cram check", async () => {
    const strict = makeActor(4, 3);
    strict.outcomes.push("success");
    const strictUi = makeUi([["cram", "crafting"]], { cramStrict: true });
    await startStudy(strict, strictUi);
    expect(strict.skills.crafting?.roll).toHaveBeenCalledTimes(1);
    expect(strictUi.warn).toHaveBeenCalledOnce();

    const loose = makeActor(4, 3);
    const looseUi = makeUi([["cram", "crafting"], ["cram", "arcana"]], { cramStrict: false }); // prettier-ignore
    await startStudy(loose, looseUi);
    expect(loose.skills.arcana?.roll).toHaveBeenCalledWith(expect.objectContaining({ dc: 18 }));
  });

  it("posts a skipped opportunity instead of rolling while a skip is pending", async () => {
    const actor = makeActor(2);
    actor.flag = { skipNext: true };
    const ui = makeUi([["cram", "crafting"]], { skipAppliesToCram: true });
    await startStudy(actor, ui);
    expect(ui.postSkip).toHaveBeenCalledWith(actor, "abc");
    expect(actor.skills.crafting?.roll).not.toHaveBeenCalled();

    const looseUi = makeUi([["cram", "crafting"], ["cram", "crafting"]], { skipAppliesToCram: false }); // prettier-ignore
    await startStudy(actor, looseUi);
    expect(looseUi.seen[0]?.allowed).toEqual({ study: false, cram: true });
    expect(actor.skills.crafting?.roll).toHaveBeenCalledTimes(2);
    await applyStudy(actor, entry("success", { id: "abc-1", activity: "cram" }));
    expect(actor.flag.skipNext).toBe(true);
    await applyStudy(actor, { id: "abc", activity: "study", degree: "skipped" });
    expect(actor.flag.skipNext).toBe(false);
  });

  it("registers world settings with auto-advance off by default and cap 10–11", () => {
    const register = vi.fn();
    vi.stubGlobal("game", {
      user: { isGM: true },
      settings: { register, get: () => undefined },
      modules: { get: () => ({}) },
    });
    vi.stubGlobal("Hooks", { on: vi.fn() });
    registerStudy();
    expect(register).toHaveBeenCalledTimes(5);
    for (const key of ["cramStrict", "skipAppliesToCram"]) {
      expect(register).toHaveBeenCalledWith(
        "thousands",
        key,
        expect.objectContaining({ scope: "world", config: true, type: Boolean, default: true }),
      );
    }
    for (const key of ["autoRollCramFatigue", "autoAdvance"]) {
      expect(register).toHaveBeenCalledWith(
        "thousands",
        key,
        expect.objectContaining({ scope: "world", config: true, type: Boolean, default: false }),
      );
    }
    expect(register).toHaveBeenCalledWith(
      "thousands",
      "autoAdvanceCap",
      expect.objectContaining({
        scope: "world",
        config: true,
        type: Number,
        default: 10,
        range: { min: 10, max: 11, step: 1 },
      }),
    );
  });

  it("blocks Study and Cram with a warning while auto-advance is enabled", async () => {
    const actor = makeActor(2);
    const ui = makeUi([["study", "crafting"]], { autoAdvance: true });
    await startStudy(actor, ui);
    expect(ui.seen).toHaveLength(0);
    expect(ui.warn).toHaveBeenCalledWith(
      "Study and Cram are disabled while automatic even-level branch advancement is enabled.",
    );
    expect(actor.skills.crafting?.roll).not.toHaveBeenCalled();
  });

  it("handles /study from Foundry v14 ProseMirror chat input and opens the Study dialog", async () => {
    const actor = makeActor(2);
    const hooks: Record<string, ((...args: unknown[]) => unknown)[]> = {};
    const CHAT_COMMANDS: Record<string, { rgx: RegExp; fn: () => boolean }> = {};
    const wait = vi.fn(
      async (config: {
        buttons: {
          action: string;
          callback: (
            e: unknown,
            b: { form: { elements: { namedItem(n: string): { value: string } } } },
          ) => unknown;
        }[];
      }) => {
        const studyBtn = config.buttons.find((b) => b.action === "study")!;
        return studyBtn.callback(null, {
          form: { elements: { namedItem: () => ({ value: "0" }) } },
        });
      },
    );
    vi.stubGlobal("game", {
      user: { isGM: true, character: actor },
      settings: { register: vi.fn(), get: () => undefined },
      modules: { get: () => ({}) },
    });
    vi.stubGlobal("canvas", { tokens: { controlled: [] } });
    vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
    vi.stubGlobal("foundry", {
      utils: { randomID: () => "id1", escapeHTML: (s: string) => s },
      applications: {
        api: { DialogV2: { wait } },
        sidebar: { tabs: { ChatLog: { CHAT_COMMANDS } } },
      },
    });
    vi.stubGlobal("Hooks", {
      on: (name: string, fn: (...args: unknown[]) => unknown) => {
        (hooks[name] ??= []).push(fn);
      },
    });

    registerStudy();

    // Foundry v14 ChatLog#processMessage passes ProseMirror's "<p>...</p>" HTML to chatMessage hooks
    // and strips outer <p> tags in ChatLog.parse before matching CHAT_COMMANDS.
    const chatHook = hooks.chatMessage?.[0];
    for (const nonMatch of ["<p>/roll 1d20</p>", "<p>/study extra</p>", "/studying", "<p>hi</p>"]) {
      expect(chatHook?.({}, nonMatch), nonMatch).toBe(true);
    }
    expect(wait).not.toHaveBeenCalled();

    for (const match of ["<p>/study</p>", "/STUDY", "  /study  ", "<P> /Study </P>"]) {
      expect(chatHook?.({}, match), match).toBe(false);
    }
    await vi.waitFor(() => expect(actor.skills.crafting?.roll).toHaveBeenCalledTimes(4));
    expect(wait).toHaveBeenCalledTimes(4);
    expect(vi.mocked(wait).mock.calls[0]?.[0]).toMatchObject({
      window: { title: "Study" },
      buttons: [
        expect.objectContaining({ action: "study", label: "Study", disabled: false }),
        expect.objectContaining({ action: "cram", label: "Cram", disabled: false }),
      ],
    });

    const cmd = CHAT_COMMANDS.study;
    expect(cmd).toBeDefined();
    for (const raw of ["<p>/study</p>", " /STUDY "]) {
      expect(cmd?.rgx.test(raw.replace(/^<p>|<\/p>$/gi, ""))).toBe(true);
    }
    expect(cmd?.fn()).toBe(false);
    await vi.waitFor(() => expect(actor.skills.crafting?.roll).toHaveBeenCalledTimes(5));
  });

  it("resolves study() target from explicit actor, then controlled token, then assigned character, then warns", async () => {
    const explicit = makeActor(1);
    const tokenActor = makeActor(2);
    const charActor = makeActor(3);
    const warn = vi.fn();
    const createChat = vi.fn(async () => undefined);
    const mod: { api?: { study?: typeof study } } = {};

    vi.stubGlobal("game", {
      user: { isGM: true, character: charActor },
      settings: { register: vi.fn(), get: () => undefined },
      modules: { get: () => mod },
    });
    vi.stubGlobal("canvas", { tokens: { controlled: [{ actor: tokenActor }] } });
    vi.stubGlobal("ui", { notifications: { warn } });
    vi.stubGlobal("ChatMessage", { create: createChat, getSpeaker: () => ({ alias: "Tester" }) });
    vi.stubGlobal("foundry", {
      utils: { randomID: () => "skip-id", escapeHTML: (s: string) => s },
      applications: { api: { DialogV2: { wait: vi.fn(async () => null) } } },
    });
    vi.stubGlobal("Hooks", { on: vi.fn() });

    registerStudy();
    expect(mod.api?.study).toBe(study);

    // 1. Explicit actor wins over token and character, and posts skip chat message when skip is pending.
    explicit.flag = { skipNext: true };
    await study(explicit);
    expect(createChat).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "<p>Tester must skip this Study opportunity after a critical failure.</p>",
        flags: { thousands: { skip: "skip-id" } },
      }),
    );

    // 2. Controlled token wins over user.character.
    tokenActor.flag = { skipNext: true };
    await study();
    expect(createChat).toHaveBeenCalledTimes(2);

    // 3. Assigned character used when no token is controlled.
    vi.stubGlobal("canvas", { tokens: { controlled: [] } });
    charActor.flag = { skipNext: true };
    await study();
    expect(createChat).toHaveBeenCalledTimes(3);

    // 4. Warns when neither a token nor a character is available.
    vi.stubGlobal("game", {
      user: { isGM: true, character: null },
      settings: { register: vi.fn(), get: () => undefined },
      modules: { get: () => mod },
    });
    await study();
    expect(warn).toHaveBeenCalledWith("Select a token or assign a character to Study.");
  });
});

describe("applying a result", () => {
  // prettier-ignore
  it.each<[string, number, Degree, Partial<StudyEntry>, StudyFlags, number, boolean, [number, boolean, StudyFlags, string]]>([
    ["primary criticalSuccess (+2)", 2, "criticalSuccess", {}, {}, 6, false, [2, false, { skipNext: false, cramFatigue: false }, "Uzunjati 2 → 4."]],
    ["primary success (+1)", 2, "success", {}, {}, 6, false, [1, false, { skipNext: false, cramFatigue: false }, "Uzunjati 2 → 3."]],
    ["primary failure (+0)", 2, "failure", {}, {}, 6, false, [0, false, { skipNext: false, cramFatigue: false }, "Uzunjati 2 → 2."]],
    ["primary criticalFailure (skip)", 2, "criticalFailure", {}, {}, 6, false, [0, false, { skipNext: true, cramFatigue: false }, "Uzunjati 2 → 2; must skip the next Study opportunity."]],
    ["criticalSuccess 1 below cap stars", 5, "criticalSuccess", {}, {}, 6, false, [1, true, { skipNext: false, cramFatigue: false }, "Uzunjati 5 → 6; starred for the next level-up."]],
    ["secondary success at cap stars", 2, "success", { kind: "secondary" }, {}, 6, false, [0, true, { skipNext: false, cramFatigue: false }, "Cascade Bearers 3 → 3; starred for the next level-up."]],
    ["already-starred at cap no duplicate star", 6, "success", {}, {}, 6, true, [0, false, { skipNext: false, cramFatigue: false }, "Uzunjati 6 → 6."]],
    ["level 20 cap does not star", 20, "criticalSuccess", {}, {}, 20, false, [0, false, { skipNext: false, cramFatigue: false }, "Uzunjati 20 → 20."]],
    ["Cram sets cramFatigue", 2, "success", { activity: "cram" }, {}, 6, false, [1, false, { skipNext: false, cramFatigue: true }, "Uzunjati 2 → 3; DC 8 flat check against fatigue each day until the next Study."]],
    ["Study clears cramFatigue", 2, "success", {}, { cramFatigue: true }, 6, false, [1, false, { skipNext: false, cramFatigue: false }, "Uzunjati 2 → 3; clears Cram fatigue."]],
    ["skipped clears skipNext and keeps cramFatigue", 2, "skipped", {}, { skipNext: true, cramFatigue: true }, 6, false, [0, false, { skipNext: false, cramFatigue: true }, "this opportunity is skipped and the pending skip is cleared."]],
  ])("plans and describes %s", (_label, top, degree, extra, flags, charLevel, starred, [delta, star, nextFlags, text]) => {
    const actor = makeActor(top, 3);
    actor.level = charLevel;
    actor.flag = flags;
    if (starred) {
      actor.items.push({ id: "star", system: { slug: featFor(starOption("uzunjati")).system.slug } });
    }
    const e = entry(degree, extra);
    const planned = planStudy(readState(actor), e);
    expect(planned.record).toEqual({ degree, delta, star, skip: degree === "criticalFailure" });
    expect(planned.flags).toEqual(nextFlags);
    expect(planned.summary).toBe(text);
    expect(describeEntry(actor, e)).toEqual({ text, done: false });
  });

  it("handles missing branch feats, multiple rank feats, and unknown feat options", () => {
    const actor = makeActor(0, 0, "initiate");
    actor.items.push({
      id: "r2",
      system: { slug: featFor("academia:rank:conversant").system.slug },
    });
    expect(readState(actor).rank).toBe("conversant");
    actor.items = [];
    expect(readState(actor).rank).toBe("initiate");
    expect(describeEntry(actor, entry("success"))).toEqual({
      text: "The character has no primary branch feat.",
      done: true,
    });
    expect(() => featFor("academia:nonexistent")).toThrow(/No academia feat/);
  });
  it("grants one benefit feat per level gained, per outcome", async () => {
    const gained = async (degree: DegreeOfSuccess) => {
      const actor = makeActor(2);
      await applyStudy(actor, entry(degree));
      return { level: primaryLevel(actor), skip: actor.flag.skipNext };
    };
    expect(await gained("criticalSuccess")).toEqual({ level: 4, skip: false });
    expect(await gained("success")).toEqual({ level: 3, skip: false });
    expect(await gained("failure")).toEqual({ level: 2, skip: false });
    expect(await gained("criticalFailure")).toEqual({ level: 2, skip: true });
  });

  it("stops at the cap and grants the branch star for the excess", async () => {
    const actor = makeActor(5);
    await applyStudy(actor, entry("criticalSuccess"));
    expect(readState(actor).branches.primary).toEqual({ id: "uzunjati", level: 6, starred: true });
    expect(
      actor.items.some((i) => i.system.slug === featFor(starOption("uzunjati")).system.slug),
    ).toBe(true);
  });

  it("does nothing when the same result is applied twice across both Cram rolls", async () => {
    const actor = makeActor(1);
    const first = entry("criticalSuccess", { id: "abc-1", activity: "cram" });
    const second = entry("success", { id: "abc-2", activity: "cram" });
    expect(await applyStudy(actor, first)).toBe(true);
    expect(await applyStudy(actor, second)).toBe(true);
    expect(primaryLevel(actor)).toBe(4);
    expect(describeEntry(actor, first).done).toBe(true);
    expect(describeEntry(actor, second).done).toBe(true);
    expect(await applyStudy(actor, first)).toBe(false);
    expect(await applyStudy(actor, second)).toBe(false);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(2);
    expect(primaryLevel(actor)).toBe(4);

    const rerolled = entry("criticalSuccess", { id: "abc-2", activity: "cram" });
    expect(describeEntry(actor, rerolled).done).toBe(false);
    expect(await applyStudy(actor, rerolled)).toBe(true);
    expect(primaryLevel(actor)).toBe(5);
    expect(await applyStudy(actor, first)).toBe(false);
  });

  it("replaces an applied result when a reroll changes the outcome", async () => {
    const actor = makeActor(2);
    await applyStudy(actor, entry("success"));
    expect(describeEntry(actor, entry("criticalSuccess")).done).toBe(false);
    await applyStudy(actor, entry("criticalSuccess"));
    expect(primaryLevel(actor)).toBe(4);
    await applyStudy(actor, entry("criticalFailure"));
    expect(primaryLevel(actor)).toBe(2);
    expect(actor.flag.skipNext).toBe(true);
    await applyStudy(actor, entry("failure"));
    expect(actor.flag.skipNext).toBe(false);
  });

  it("sets cramFatigue on Cram, keeps it across a skip, and clears it on the next Study", async () => {
    const actor = makeActor(2);
    expect(describeEntry(actor, entry("success", { id: "c-1", activity: "cram" })).text).toContain(
      "DC 8 flat check against fatigue",
    );
    await applyStudy(actor, entry("criticalFailure", { id: "c-1", activity: "cram" }));
    await applyStudy(actor, entry("success", { id: "c-2", activity: "cram" }));
    expect(actor.flag).toMatchObject({ cramFatigue: true, skipNext: true });
    await applyStudy(actor, { id: "skip-1", activity: "study", degree: "skipped" });
    expect(actor.flag).toMatchObject({ cramFatigue: true, skipNext: false });
    await applyStudy(actor, entry("failure", { id: "later" }));
    expect(actor.flag.cramFatigue).toBe(false);
  });
});

describe("reading a result from chat", () => {
  it("takes the entry from the roll option and the outcome a reroll leaves behind", () => {
    const message = (outcome: string | null, options: string[]) => ({
      flags: { pf2e: { context: { options, outcome } } },
      update: async () => undefined,
    });
    const rerolled = message("failure", ["check:reroll", "thousands:study:abc-2:cram:secondary"]);
    expect(entryFromMessage(rerolled)).toEqual({
      id: "abc-2",
      activity: "cram",
      kind: "secondary",
      degree: "failure",
    });
    expect(entryFromMessage(message("success", ["thousands:study:old:primary"]))).toEqual({
      id: "old",
      activity: "study",
      kind: "primary",
      degree: "success",
    });
    expect(entryFromMessage(message("success", ["check:statistic:arcana"]))).toBeNull();
    const skipped = { ...rerolled, flags: { thousands: { skip: "x" } } };
    expect(entryFromMessage(skipped)).toEqual({ id: "x", activity: "study", degree: "skipped" });
  });

  it("renders the chat card for each outcome, shows Apply to the GM only, and applies on click", async () => {
    type FakeEl = {
      tag: string;
      className: string;
      textContent: string;
      type: string;
      disabled: boolean;
      children: FakeEl[];
      onClick?: () => Promise<void>;
      append(...nodes: FakeEl[]): void;
      addEventListener(event: string, fn: () => Promise<void>): void;
      querySelector(sel: string): FakeEl | null;
    };
    const createEl = (tag: string): FakeEl => {
      const el: FakeEl = {
        tag,
        className: "",
        textContent: "",
        type: "",
        disabled: false,
        children: [],
        append: (...nodes) => el.children.push(...nodes),
        addEventListener: (_e, fn) => (el.onClick = fn),
        querySelector: () => el.children.find((c) => c.className === "message-content") ?? null,
      };
      return el;
    };

    let renderHook: ((message: MessageLike, html: HTMLElement) => void) | undefined;
    const user = { isGM: false };
    vi.stubGlobal("document", { createElement: createEl });
    vi.stubGlobal("game", {
      user,
      settings: { register: vi.fn(), get: () => true },
      modules: { get: () => ({}) },
    });
    vi.stubGlobal("Hooks", {
      on: (name: string, fn: (...args: unknown[]) => unknown) => {
        if (name === "renderChatMessageHTML") renderHook = fn as typeof renderHook;
      },
    });
    registerStudy();

    const actor = makeActor(2);
    const makeMsg = (outcome: DegreeOfSuccess, id = "m1", activity: StudyActivity = "study") => ({
      actor,
      flags: { pf2e: { context: { options: [studyOption(id, activity, "primary")], outcome } } },
      update: vi.fn(async () => undefined),
    });
    const render = (message: MessageLike) => {
      const rootEl = createEl("li");
      const content = Object.assign(createEl("div"), { className: "message-content" });
      rootEl.append(content);
      renderHook?.(message, rootEl as never);
      return content.children[0];
    };

    expect(render({ flags: {}, update: async () => undefined })).toBeUndefined();

    for (const [deg, text] of [
      ["criticalSuccess", "Academia: Uzunjati 2 → 4."],
      ["success", "Academia: Uzunjati 2 → 3."],
      ["failure", "Academia: Uzunjati 2 → 2."],
      ["criticalFailure", "Academia: Uzunjati 2 → 2; must skip the next Study opportunity."],
    ] as const) {
      const card = render(makeMsg(deg));
      expect(card?.className).toBe("thousands-study");
      expect(card?.children.map((c) => c.textContent)).toEqual([text]);
    }

    user.isGM = true;
    const msg = makeMsg("criticalSuccess");
    const card = render(msg)!;
    const button = card.children.find((c) => c.tag === "button")!;
    expect([button.textContent, button.type]).toEqual(["Apply", "button"]);

    await button.onClick?.();
    expect(button.disabled).toBe(true);
    expect(primaryLevel(actor)).toBe(4);
    expect(msg.update).toHaveBeenCalledWith({ "flags.thousands.appliedAt": expect.any(Number) });

    expect(render(msg)?.children.map((c) => c.textContent)).toEqual([
      "Academia: applied (+2 branch level).",
    ]);
    expect(render(makeMsg("success"))?.children.map((c) => c.textContent)).toEqual([
      "Academia: the result changed; Apply replaces the old one.",
      "Apply",
    ]);
  });
});

describe("automatic triggers", () => {
  it("fires star resolution only on a level increase and applies idempotently", async () => {
    const actor = makeActor(5, 2);
    actor.level = 5;
    await applyStudy(actor, entry("criticalSuccess", { id: "s-pri" }));
    await applyStudy(actor, entry("success", { id: "s-sec", kind: "secondary" }));
    expect(readState(actor).branches).toEqual({
      primary: { id: "uzunjati", level: 5, starred: true },
      secondary: { id: "cascade-bearers", level: 2, starred: true },
    });

    const created: { content: string; flags: Record<string, Record<string, unknown>> }[] = [];
    const hooks: Record<string, ((...args: unknown[]) => unknown)[]> = {};
    let nextId = 1;
    vi.stubGlobal("game", {
      user: { id: "u1", isGM: true },
      settings: { register: vi.fn(), get: () => undefined },
      modules: { get: () => ({}) },
    });
    vi.stubGlobal("ChatMessage", {
      create: vi.fn(async (data: (typeof created)[number]) => created.push(data)),
      getSpeaker: () => ({ alias: "Tester" }),
    });
    vi.stubGlobal("foundry", {
      utils: { randomID: () => `lvl-${nextId++}`, escapeHTML: (s: string) => s },
    });
    vi.stubGlobal("Hooks", {
      on: (name: string, fn: (...args: unknown[]) => unknown) => {
        (hooks[name] ??= []).push(fn);
      },
    });
    registerStudy();

    const updateLevel = async (level: number, userId = "u1") => {
      hooks.preUpdateActor?.[0]?.(actor);
      actor.level = level;
      await resolveActorLevelUp(
        actor,
        { system: { details: { level: { value: level } } } },
        userId,
      );
    };

    // Unchanged level, lower level, non-level update, other user, or non-character do not fire.
    await resolveActorLevelUp(actor, {});
    await updateLevel(5);
    await updateLevel(4);
    await updateLevel(5);
    await resolveActorLevelUp(actor, { system: { details: { level: { value: 6 } } } }, "other");
    await resolveActorLevelUp(
      { ...actor, type: "npc", level: 6 },
      { system: { details: { level: { value: 6 } } } },
    );
    expect(created).toHaveLength(0);

    // Odd level-up (4 -> 5 on a fresh starred secondary at cap 2) resolves primary only, not secondary.
    const oddActor = makeActor(4, 2);
    oddActor.level = 4;
    await applyStudy(oddActor, entry("criticalSuccess", { id: "o-sec", kind: "secondary" }));
    expect(readState(oddActor).branches.secondary).toEqual({
      id: "cascade-bearers",
      level: 2,
      starred: true,
    });
    hooks.preUpdateActor?.[0]?.(oddActor);
    oddActor.level = 5;
    await resolveActorLevelUp(oddActor, { system: { details: { level: { value: 5 } } } });
    expect(created).toHaveLength(0);

    // Even level-up (5 -> 6) resolves both starred primary (5 -> 6) and secondary (2 -> 3).
    hooks.updateActor?.[0]?.(actor, { system: { details: { level: { value: 6 } } } }, {}, "u1");
    await vi.waitFor(() => expect(created).toHaveLength(2));
    expect(created[0]?.content).toContain("reaches level 6 and resolves the Uzunjati branch star");
    expect(created[1]?.content).toContain(
      "reaches level 6 and resolves the Cascade Bearers branch star",
    );

    const priEntry = entryFromMessage({
      flags: created[0]!.flags,
      update: async () => undefined,
    })!;
    const secEntry = entryFromMessage({
      flags: created[1]!.flags,
      update: async () => undefined,
    })!;
    expect(describeEntry(actor, priEntry)).toEqual({
      text: "Uzunjati 5 → 6 (star resolved on level-up).",
      done: false,
    });
    expect(describeEntry(actor, secEntry)).toEqual({
      text: "Cascade Bearers 2 → 3 (star resolved on level-up).",
      done: false,
    });

    expect(await applyStudy(actor, priEntry)).toBe(true);
    expect(await applyStudy(actor, secEntry)).toBe(true);
    expect(readState(actor).branches).toEqual({
      primary: { id: "uzunjati", level: 6, starred: false },
      secondary: { id: "cascade-bearers", level: 3, starred: false },
    });
    expect(describeEntry(actor, priEntry)).toEqual({
      text: "applied (+1 branch level).",
      done: true,
    });

    // Applying a second time (or with a new entry id after the star is gone) is a no-op.
    expect(await applyStudy(actor, priEntry)).toBe(false);
    expect(await applyStudy(actor, { ...priEntry, id: "other-id" })).toBe(false);
    expect(readState(actor).branches.primary).toEqual({
      id: "uzunjati",
      level: 6,
      starred: false,
    });
  });

  it("auto-advances the primary branch on even levels when enabled, handles multi-level jumps, enforces the cap, and applies idempotently", async () => {
    const actor = makeActor(0, 0);
    actor.level = 1;

    const created: { content: string; flags: Record<string, Record<string, unknown>> }[] = [];
    const hooks: Record<string, ((...args: unknown[]) => unknown)[]> = {};
    const settings: Record<string, unknown> = { autoAdvance: false, autoAdvanceCap: 10 };
    let nextId = 1;
    vi.stubGlobal("game", {
      user: { id: "u1", isGM: true },
      settings: { register: vi.fn(), get: (_scope: string, key: string) => settings[key] },
      modules: { get: () => ({}) },
    });
    vi.stubGlobal("ChatMessage", {
      create: vi.fn(async (data: (typeof created)[number]) => created.push(data)),
      getSpeaker: () => ({ alias: "Tester" }),
    });
    vi.stubGlobal("foundry", {
      utils: { randomID: () => `auto-${nextId++}`, escapeHTML: (s: string) => s },
    });
    vi.stubGlobal("Hooks", {
      on: (name: string, fn: (...args: unknown[]) => unknown) => {
        (hooks[name] ??= []).push(fn);
      },
    });
    registerStudy();

    const updateLevel = async (level: number, userId = "u1") => {
      hooks.preUpdateActor?.[0]?.(actor);
      actor.level = level;
      await resolveActorLevelUp(
        actor,
        { system: { details: { level: { value: level } } } },
        userId,
      );
    };

    // Does not fire while autoAdvance is off (default).
    await updateLevel(2);
    expect(created).toHaveLength(0);

    // Enable auto-advance and reset actor to level 1.
    settings.autoAdvance = true;
    actor.level = 1;

    // Even level-up (1 -> 2) posts a card and advances primary 0 -> 1 on Apply; secondary stays at 0.
    await updateLevel(2);
    expect(created).toHaveLength(1);
    expect(created[0]?.content).toContain(
      "reaches level 2 and auto-advances the Uzunjati primary branch",
    );
    const lvl2Entry = entryFromMessage({
      flags: created[0]!.flags,
      update: async () => undefined,
    })!;
    expect(describeEntry(actor, lvl2Entry)).toEqual({
      text: "Uzunjati 0 → 1 (auto-advanced at level 2).",
      done: false,
    });
    expect(await applyStudy(actor, lvl2Entry)).toBe(true);
    expect(readState(actor).branches).toEqual({
      primary: { id: "uzunjati", level: 1, starred: false },
      secondary: { id: "cascade-bearers", level: 0, starred: false },
    });
    expect(describeEntry(actor, lvl2Entry)).toEqual({
      text: "applied (+1 branch level).",
      done: true,
    });

    // Idempotent: re-applying the same entry, a new entry id for level 2, or falling and returning to 2 is a no-op.
    expect(await applyStudy(actor, lvl2Entry)).toBe(false);
    expect(await applyStudy(actor, { ...lvl2Entry, id: "dup-id" })).toBe(false);
    expect(describeEntry(actor, { ...lvl2Entry, id: "dup-id" }).done).toBe(true);
    await updateLevel(1);
    await updateLevel(2);
    expect(created).toHaveLength(1);

    // Odd level-up (2 -> 3), unchanged level, lower level, other user, or missing primary branch do not fire.
    await updateLevel(3);
    await updateLevel(3);
    await resolveActorLevelUp(actor, { system: { details: { level: { value: 4 } } } }, "other");
    expect(created).toHaveLength(1);

    // Multi-level jump (3 -> 7 crosses even levels 4 and 6) advances primary by 2 (1 -> 3).
    await updateLevel(7);
    expect(created).toHaveLength(2);
    const jumpEntry = entryFromMessage({
      flags: created[1]!.flags,
      update: async () => undefined,
    })!;
    expect(describeEntry(actor, jumpEntry)).toEqual({
      text: "Uzunjati 1 → 3 (auto-advanced at level 7).",
      done: false,
    });
    expect(await applyStudy(actor, jumpEntry)).toBe(true);
    expect(primaryLevel(actor)).toBe(3);

    // Cap enforcement: jumping from 7 to 20 with branch at 9 and default cap 10 stops at 10, then cap 11 allows 11.
    const capActor = makeActor(9, 0);
    capActor.level = 16;
    hooks.preUpdateActor?.[0]?.(capActor);
    capActor.level = 20;
    await resolveActorLevelUp(capActor, { system: { details: { level: { value: 20 } } } });
    expect(created).toHaveLength(3);
    const cap10Entry = entryFromMessage({
      flags: created[2]!.flags,
      update: async () => undefined,
    })!;
    expect(describeEntry(capActor, cap10Entry)).toEqual({
      text: "Uzunjati 9 → 10 (auto-advanced at level 20).",
      done: false,
    });
    expect(await applyStudy(capActor, cap10Entry)).toBe(true);
    expect(primaryLevel(capActor)).toBe(10);

    // At cap 10, another even level does not post a card; raising autoAdvanceCap to 11 allows 10 -> 11.
    capActor.level = 18;
    hooks.preUpdateActor?.[0]?.(capActor);
    capActor.level = 20;
    await resolveActorLevelUp(capActor, { system: { details: { level: { value: 20 } } } });
    expect(created).toHaveLength(3);

    settings.autoAdvanceCap = 11;
    const cap11Actor = makeActor(10, 0);
    cap11Actor.level = 18;
    hooks.preUpdateActor?.[0]?.(cap11Actor);
    cap11Actor.level = 20;
    await resolveActorLevelUp(cap11Actor, { system: { details: { level: { value: 20 } } } });
    expect(created).toHaveLength(4);
    const cap11Entry = entryFromMessage({
      flags: created[3]!.flags,
      update: async () => undefined,
    })!;
    expect(await applyStudy(cap11Actor, cap11Entry)).toBe(true);
    expect(primaryLevel(cap11Actor)).toBe(11);
  });

  it("prompts the DC 8 flat check on Rest for the Night only for flagged characters and applies idempotently", async () => {
    const unflagged = makeActor(2);
    const flagged = makeActor(2);
    await applyStudy(flagged, entry("success", { id: "c-1", activity: "cram" }));
    expect(flagged.flag.cramFatigue).toBe(true);

    const created: { content: string; flags: Record<string, Record<string, unknown>> }[] = [];
    const hooks: Record<string, ((...args: unknown[]) => unknown)[]> = {};
    vi.stubGlobal("game", {
      user: { isGM: true },
      settings: { register: vi.fn(), get: () => undefined },
      modules: { get: () => ({}) },
    });
    vi.stubGlobal("ChatMessage", {
      create: vi.fn(async (data: (typeof created)[number]) => created.push(data)),
      getSpeaker: () => ({ alias: "Tester" }),
    });
    vi.stubGlobal("foundry", {
      utils: { randomID: () => "fat-1", escapeHTML: (s: string) => s },
    });
    vi.stubGlobal("Hooks", {
      on: (name: string, fn: (...args: unknown[]) => unknown) => {
        (hooks[name] ??= []).push(fn);
      },
    });
    registerStudy();

    await promptCramFatigue(unflagged);
    await promptCramFatigue({ ...flagged, type: "npc" });
    expect(created).toHaveLength(0);

    hooks["pf2e.restForTheNight"]?.[0]?.(flagged);
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.content).toContain(`@Check[flat|dc:8|options:${fatigueOption("fat-1")}]`);
    expect(
      entryFromMessage({ flags: created[0]!.flags, update: async () => undefined }),
    ).toBeNull();

    // Flat check roll message carries the fatigue option (or message flag) and outcome.
    const failMsg: MessageLike = {
      actor: flagged,
      flags: { pf2e: { context: { options: [fatigueOption("fat-1")], outcome: "failure" } } },
      update: async () => undefined,
    };
    const failEntry = entryFromMessage(failMsg)!;
    expect(failEntry).toEqual({ id: "fat-1", activity: "fatigue", degree: "failure" });
    expect(describeEntry(flagged, failEntry)).toEqual({
      text: "fatigued for the day after Cram.",
      done: false,
    });

    expect(await applyStudy(flagged, failEntry)).toBe(true);
    expect(flagged.increaseCondition).toHaveBeenCalledTimes(1);
    expect(flagged.increaseCondition).toHaveBeenCalledWith("fatigued");
    expect(flagged.flag.cramFatigue).toBe(true);
    expect(describeEntry(flagged, failEntry)).toEqual({
      text: "applied (fatigued).",
      done: true,
    });

    // Idempotent on second apply.
    expect(await applyStudy(flagged, failEntry)).toBe(false);
    expect(flagged.increaseCondition).toHaveBeenCalledTimes(1);

    // Reroll to success replaces the failed outcome and removes Fatigued.
    const successEntry = entryFromMessage({
      flags: { thousands: { fatigue: "fat-1" }, pf2e: { context: { outcome: "success" } } },
      update: async () => undefined,
    })!;
    expect(describeEntry(flagged, successEntry)).toEqual({
      text: "the result changed; Apply replaces the old one.",
      done: false,
    });
    expect(await applyStudy(flagged, successEntry)).toBe(true);
    expect(flagged.decreaseCondition).toHaveBeenCalledWith("fatigued");
    expect(describeEntry(flagged, successEntry)).toEqual({
      text: "applied (no fatigue).",
      done: true,
    });
    expect(await applyStudy(flagged, successEntry)).toBe(false);
  });

  it("auto-rolls the DC 8 Cram fatigue flat check after Rest for the Night when enabled, only on the active GM client, without duplicates, and leaves Apply to the GM", async () => {
    const unflagged = makeActor(2);
    const flagged = makeActor(2);
    await applyStudy(flagged, entry("success", { id: "c-1", activity: "cram" }));
    expect(flagged.flag.cramFatigue).toBe(true);

    const created: { content: string; flags: Record<string, Record<string, unknown>> }[] = [];
    const hooks: Record<string, ((...args: unknown[]) => unknown)[]> = {};
    const settings: Record<string, unknown> = {
      autoRollCramFatigue: false,
      autoAdvance: false,
    };
    const user: { isGM: boolean; isActiveGM?: boolean } = { isGM: true, isActiveGM: true };
    const users: { activeGM?: unknown } = { activeGM: user };
    const time = { worldTime: 100 };
    const checkRoll = vi.fn(async () => undefined);
    const CheckModifier = vi.fn(function (
      this: { slug: string; modifiers: never[] },
      slug: string,
      stat: { modifiers: never[] },
    ) {
      this.slug = slug;
      this.modifiers = stat.modifiers;
    });
    let nextId = 1;

    vi.stubGlobal("game", {
      user,
      users,
      time,
      pf2e: { Check: { roll: checkRoll }, CheckModifier },
      settings: { register: vi.fn(), get: (_scope: string, key: string) => settings[key] },
      modules: { get: () => ({}) },
    });
    vi.stubGlobal("ChatMessage", {
      create: vi.fn(async (data: (typeof created)[number]) => created.push(data)),
      getSpeaker: () => ({ alias: "Tester" }),
    });
    vi.stubGlobal("foundry", {
      utils: { randomID: () => `auto-fat-${nextId++}`, escapeHTML: (s: string) => s },
    });
    vi.stubGlobal("Hooks", {
      on: (name: string, fn: (...args: unknown[]) => unknown) => {
        (hooks[name] ??= []).push(fn);
      },
    });
    registerStudy();

    // Off: keeps the chat prompt unchanged and does not auto-roll.
    await promptCramFatigue(flagged);
    expect(created).toHaveLength(1);
    expect(created[0]?.content).toContain(
      `@Check[flat|dc:8|options:${fatigueOption("auto-fat-1")}]`,
    );
    expect(checkRoll).not.toHaveBeenCalled();

    // On, but auto-advance enabled: neither prompts nor rolls.
    settings.autoRollCramFatigue = true;
    settings.autoAdvance = true;
    await promptCramFatigue(flagged);
    expect(created).toHaveLength(1);
    expect(checkRoll).not.toHaveBeenCalled();
    settings.autoAdvance = false;

    // Non-GM player or secondary non-active GM client: does not roll.
    user.isGM = false;
    await promptCramFatigue(flagged);
    user.isGM = true;
    user.isActiveGM = false;
    await promptCramFatigue(flagged);
    delete user.isActiveGM;
    users.activeGM = { isGM: true };
    await promptCramFatigue(flagged);
    expect(checkRoll).not.toHaveBeenCalled();

    // Active GM client: ignores unflagged characters and NPCs, rolls once for flagged character, and ignores duplicate hook calls.
    users.activeGM = user;
    await promptCramFatigue(unflagged);
    await promptCramFatigue({ ...flagged, type: "npc" });
    expect(checkRoll).not.toHaveBeenCalled();

    hooks["pf2e.restForTheNight"]?.[0]?.(flagged);
    hooks["pf2e.restForTheNight"]?.[0]?.(flagged);
    await vi.waitFor(() => expect(checkRoll).toHaveBeenCalledTimes(1));
    await promptCramFatigue(flagged);
    expect(checkRoll).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(flagged.increaseCondition).not.toHaveBeenCalled();

    expect(CheckModifier).toHaveBeenCalledWith("flat-check", { modifiers: [] });
    const [, rollContext] = vi.mocked(checkRoll).mock.calls[0] as unknown as [
      unknown,
      {
        actor: unknown;
        type: string;
        dc: { value: number; visible: boolean };
        options: Set<string>;
        skipDialog: boolean;
        createMessage: boolean;
      },
    ];
    expect(rollContext).toMatchObject({
      actor: flagged,
      type: "flat-check",
      dc: { value: 8, visible: true },
      skipDialog: true,
      createMessage: true,
    });
    expect([...rollContext.options]).toEqual([fatigueOption("auto-fat-2")]);

    // Roll card produced by Check.roll feeds the existing GM Apply flow on failure without auto-applying Fatigued.
    const rolledMsg: MessageLike = {
      actor: flagged,
      flags: { pf2e: { context: { options: rollContext.options, outcome: "failure" } } },
      update: async () => undefined,
    };
    const failEntry = entryFromMessage(rolledMsg)!;
    expect(failEntry).toEqual({ id: "auto-fat-2", activity: "fatigue", degree: "failure" });
    expect(describeEntry(flagged, failEntry)).toEqual({
      text: "fatigued for the day after Cram.",
      done: false,
    });
    expect(flagged.increaseCondition).not.toHaveBeenCalled();
    expect(await applyStudy(flagged, failEntry)).toBe(true);
    expect(flagged.increaseCondition).toHaveBeenCalledTimes(1);
    expect(flagged.increaseCondition).toHaveBeenCalledWith("fatigued");

    // Next night's rest (after applying or advancing worldTime) rolls a fresh check once.
    await promptCramFatigue(flagged);
    await promptCramFatigue(flagged);
    expect(checkRoll).toHaveBeenCalledTimes(2);
    time.worldTime += 86_400;
    await promptCramFatigue(flagged);
    expect(checkRoll).toHaveBeenCalledTimes(3);
  });
});

describe("Practical Research", () => {
  function makeResearchUi(
    pickResult: (Omit<ResearchPick, "actor"> & { actor?: ReturnType<typeof makeActor> }) | null,
  ) {
    const ui = {
      posted: [] as ResearchFlag[],
      warn: vi.fn(),
      newId: () => "pr-1",
      pickResearch: vi.fn(async (actors: readonly ReturnType<typeof makeActor>[]) =>
        pickResult ? { actor: pickResult.actor ?? actors[0]!, ...pickResult } : null,
      ),
      postResearch: vi.fn(async (_actor: unknown, data: ResearchFlag) => {
        ui.posted.push(data);
      }),
    };
    return ui;
  }

  it("enforces the Conversant / Lore-Speaker rank gate and branch requirement", async () => {
    for (const rank of ["initiate", "attendant"] as const) {
      const ui = makeResearchUi({ kind: "primary", outcome: "success" });
      await startResearch(makeActor(2, 1, rank), ui);
      expect(ui.pickResearch).not.toHaveBeenCalled();
      expect(ui.warn).toHaveBeenCalledWith(
        `Tester must hold Conversant or Lore-Speaker rank for Practical Research (current rank: ${rank}).`,
      );
    }

    const initiate = makeActor(2, 1, "initiate");
    const multiUi = makeResearchUi({ actor: initiate, kind: "primary", outcome: "success" });
    await startResearch([makeActor(2, 1, "conversant"), initiate], multiUi);
    expect(multiUi.warn).toHaveBeenCalledOnce();
    expect(multiUi.posted).toHaveLength(0);

    const branchless = makeActor(0, 0, "conversant");
    branchless.items = branchless.items.filter((i) => i.system.slug?.includes("rank"));
    const noBranchUi = makeResearchUi({ kind: "primary", outcome: "success" });
    await startResearch(branchless, noBranchUi);
    expect(noBranchUi.warn).toHaveBeenCalledWith(
      "Tester needs a branch feat for Practical Research.",
    );

    const emptyUi = makeResearchUi(null);
    await startResearch([], emptyUi);
    expect(emptyUi.warn).toHaveBeenCalledWith(
      "Select a token or assign a character for Practical Research.",
    );
  });

  it("rolls a skill check at the GM-stated DC or records a direct outcome with an optional reward note", async () => {
    for (const rank of ["conversant", "lore-speaker"] as const) {
      const actor = makeActor(2, 1, rank);
      // prettier-ignore
      const rollUi = makeResearchUi({ kind: "primary", skill: "arcana", dc: 24, note: "  Unmistakable Lore  " });
      await startResearch(actor, rollUi);
      expect(actor.skills.arcana?.roll).toHaveBeenCalledWith({
        dc: 24,
        label: "Practical Research: Uzunjati (arcana)",
        traits: ["downtime"],
        extraRollOptions: [
          studyOption("pr-1", "practical-research", "primary"),
          researchNoteOption("Unmistakable Lore"),
          "downtime",
        ],
      });
    }

    const actor = makeActor(2, 1, "conversant");
    // prettier-ignore
    const directUi = makeResearchUi({ kind: "secondary", skill: "crafting", dc: 22, outcome: "criticalSuccess", note: "Granted lore tome" });
    await startResearch(actor, directUi);
    // prettier-ignore
    expect(directUi.posted).toEqual([{ id: "pr-1", kind: "secondary", degree: "criticalSuccess", check: "crafting", dc: 22, note: "Granted lore tome" }]);

    const missingSkillUi = makeResearchUi({ kind: "primary" });
    await startResearch(actor, missingSkillUi);
    expect(missingSkillUi.warn).toHaveBeenCalledWith(
      "Choose a skill to roll or select an outcome to record.",
    );
  });

  it("applies outcomes per degree of success, respects idempotency and star carry-over, and records reward notes without mechanics", async () => {
    // prettier-ignore
    const outcomes: [DegreeOfSuccess, number, boolean, string][] = [
      ["criticalSuccess", 4, false, "Uzunjati 2 → 4; Unique reward."],
      ["success", 3, false, "Uzunjati 2 → 3; Unique reward."],
      ["failure", 2, false, "Uzunjati 2 → 2; Unique reward."],
      ["criticalFailure", 2, true, "Uzunjati 2 → 2; must skip the next Study opportunity; Unique reward."],
    ];
    for (const [degree, expectedLevel, expectedSkip, expectedText] of outcomes) {
      const actor = makeActor(2, 1, "conversant");
      actor.flag = { cramFatigue: true };
      const research = { id: "pr-deg", kind: "primary", degree, note: "Unique reward" };
      const prEntry = entryFromMessage({
        actor,
        flags: { thousands: { research } },
        update: async () => undefined,
      })!;
      // prettier-ignore
      expect(prEntry).toEqual({ id: "pr-deg", activity: "practical-research", kind: "primary", degree, note: "Unique reward" });
      expect(describeEntry(actor, prEntry)).toEqual({ text: expectedText, done: false });
      expect(await applyStudy(actor, prEntry)).toBe(true);
      // prettier-ignore
      expect(readState(actor).branches.primary).toEqual({ id: "uzunjati", level: expectedLevel, starred: false });
      expect(actor.flag).toMatchObject({ skipNext: expectedSkip, cramFatigue: true });
      expect(describeEntry(actor, prEntry)).toEqual({
        text: `applied (+${expectedLevel - 2} branch level; Unique reward).`,
        done: true,
      });
      expect(await applyStudy(actor, prEntry)).toBe(false);
      expect(primaryLevel(actor)).toBe(expectedLevel);
    }

    // Star carry-over: criticalSuccess 1 below cap stars the branch, and level-up resolves the star.
    const capActor = makeActor(5, 2, "lore-speaker");
    const starOptions = [
      studyOption("pr-star", "practical-research", "primary"),
      researchNoteOption("Bonus lore"),
    ];
    const starEntry = entryFromMessage({
      actor: capActor,
      flags: { pf2e: { context: { options: starOptions, outcome: "criticalSuccess" } } },
      update: async () => undefined,
    })!;
    expect(describeEntry(capActor, starEntry)).toEqual({
      text: "Uzunjati 5 → 6; starred for the next level-up; Bonus lore.",
      done: false,
    });
    expect(await applyStudy(capActor, starEntry)).toBe(true);
    // prettier-ignore
    expect(readState(capActor).branches.primary).toEqual({ id: "uzunjati", level: 6, starred: true });
    expect(await applyStudy(capActor, starEntry)).toBe(false);

    // Reroll / outcome change replaces the applied result and removes the star.
    expect(await applyStudy(capActor, { ...starEntry, degree: "failure" })).toBe(true);
    // prettier-ignore
    expect(readState(capActor).branches.primary).toEqual({ id: "uzunjati", level: 5, starred: false });

    // Re-apply criticalSuccess to star again, then resolve on level-up to 7.
    expect(await applyStudy(capActor, starEntry)).toBe(true);
    capActor.level = 7;
    // prettier-ignore
    expect(await applyStudy(capActor, { id: "lvl-7", activity: "study", kind: "primary", degree: "starred", level: 7 })).toBe(true);
    // prettier-ignore
    expect(readState(capActor).branches.primary).toEqual({ id: "uzunjati", level: 7, starred: false });
  });

  it("handles /research and api.research() for the GM and posts the Apply card", async () => {
    const actor = makeActor(2, 1, "conversant");
    const created: { content: string; flags: Record<string, Record<string, unknown>> }[] = [];
    const hooks: Record<string, ((...args: unknown[]) => unknown)[]> = {};
    const CHAT_COMMANDS: Record<string, { rgx: RegExp; fn: () => boolean }> = {};
    const warn = vi.fn();
    const mod: { api?: { study?: typeof study; research?: typeof research } } = {};
    const user = { isGM: false, character: null as typeof actor | null };
    // prettier-ignore
    const fields: Record<string, string> = { actor: "0", kind: "primary", skill: "arcana", dc: "24", outcome: "success", note: "Archive access" };
    // prettier-ignore
    const wait = vi.fn(async (config: { buttons: { action: string; callback: (e: unknown, b: { form: { elements: { namedItem(n: string): { value: string } | null } } }) => unknown }[] }) =>
      config.buttons.find((b) => b.action === "research")!.callback(null, { form: { elements: { namedItem: (name: string) => ({ value: fields[name] ?? "" }) } } }),
    );

    vi.stubGlobal("game", {
      user,
      actors: [actor],
      settings: { register: vi.fn(), get: () => true },
      modules: { get: () => mod },
    });
    vi.stubGlobal("canvas", { tokens: { controlled: [] } });
    vi.stubGlobal("ui", { notifications: { warn } });
    vi.stubGlobal("ChatMessage", {
      create: vi.fn(async (data: (typeof created)[number]) => created.push(data)),
      getSpeaker: () => ({ alias: "Tester" }),
    });
    vi.stubGlobal("foundry", {
      utils: { randomID: () => "res-1", escapeHTML: (s: string) => s },
      applications: {
        api: { DialogV2: { wait } },
        sidebar: { tabs: { ChatLog: { CHAT_COMMANDS } } },
      },
    });
    vi.stubGlobal("Hooks", {
      on: (name: string, fn: (...args: unknown[]) => unknown) => {
        (hooks[name] ??= []).push(fn);
      },
    });

    registerStudy();
    expect(mod.api?.research).toBe(research);
    expect(CHAT_COMMANDS.research?.rgx.test("/research")).toBe(true);

    await research(actor);
    expect(warn).toHaveBeenCalledWith("Only the GM can record Practical Research.");
    expect(wait).not.toHaveBeenCalled();

    user.isGM = true;
    expect(hooks.chatMessage?.[0]?.({}, "<p>/research</p>")).toBe(false);
    await vi.waitFor(() => expect(created).toHaveLength(1));
    // prettier-ignore
    expect(created[0]).toEqual({
      speaker: { alias: "Tester" },
      content: "<p>Tester completes Practical Research for Uzunjati (arcana DC 24): Success — Archive access.</p>",
      flags: { thousands: { research: { id: "res-1", kind: "primary", degree: "success", check: "arcana", dc: 24, note: "Archive access" } } },
    });
  });
});
