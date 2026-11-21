import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BEFRIEND_SETTINGS,
  befriend,
  registerBefriend,
  renderBefriendCard,
  renderStandingsRows,
} from "../src/befriend/foundry.js";
import {
  applyBefriend,
  befriendEntryFromMessage,
  befriendNoteOption,
  befriendOption,
  describeBefriendEntry,
  parseBefriendOption,
  planBefriend,
  readBefriendState,
  startBefriend,
  type BefriendActor,
  type BefriendEntry,
  type BefriendFlags,
  type BefriendPick,
  type BefriendUi,
} from "../src/befriend/tracker.js";
import {
  ATTITUDES,
  applyBefriendChange,
  degreeToSteps,
  isBefriended,
  shiftAttitude,
  type DegreeOfSuccess,
  type StudentId,
} from "../src/rules/index.js";
import { advantageOption, featFor } from "../src/study/academia.js";
import type { MessageLike } from "../src/study/chat.js";
import type { StatisticLike } from "../src/study/roll.js";

afterEach(() => vi.unstubAllGlobals());

function mergeObjects(
  base: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(update)) {
    const cur = out[k];
    const isPlain = (x: unknown): x is Record<string, unknown> =>
      !!x && typeof x === "object" && !Array.isArray(x);
    out[k] = isPlain(cur) && isPlain(v) ? mergeObjects(cur, v) : structuredClone(v);
  }
  return out;
}

function makeActor(id: string, name: string, ownedStudents: StudentId[] = [], type = "character") {
  let next = 0;
  const skill = (slug: string, label = slug): [string, StatisticLike] => [
    slug,
    { slug, label, roll: vi.fn(async () => null) },
  ];
  const actor = {
    id,
    name,
    type,
    level: 2,
    flag: {} as BefriendFlags,
    items: ownedStudents.map((s) => ({
      id: `item-${next++}`,
      system: { slug: featFor(advantageOption(s)).system.slug },
    })),
    skills: Object.fromEntries([skill("diplomacy", "Diplomacy"), skill("society", "Society")]),
    getFlag: (_scope: string, key: string) => (key === "befriend" ? actor.flag : undefined),
    setFlag: async (_scope: string, key: string, value: unknown) => {
      if (key === "befriend") {
        actor.flag = mergeObjects(
          actor.flag as Record<string, unknown>,
          value as Record<string, unknown>,
        ) as BefriendFlags;
      }
    },
    createEmbeddedDocuments: vi.fn(async (_type: "Item", sources: object[]) => {
      for (const s of sources as { system: { slug: string } }[])
        actor.items.push({ id: `item-${next++}`, system: { slug: s.system.slug } });
    }),
    deleteEmbeddedDocuments: vi.fn(async (_type: "Item", ids: string[]) => {
      actor.items = actor.items.filter((i) => !ids.includes(i.id));
    }),
  };
  return actor;
}

const makeMsg = (actor: BefriendActor | null, flags: MessageLike["flags"]): MessageLike => ({
  actor,
  flags,
  update: vi.fn(async () => undefined),
});

describe("befriend rules and state", () => {
  it("shifts attitudes, maps check outcomes, grants/removes feats, and rolls back on reroll", async () => {
    expect(ATTITUDES).toEqual(["hostile", "unfriendly", "indifferent", "friendly", "helpful"]);
    expect([
      shiftAttitude("indifferent", 5),
      shiftAttitude("unfriendly", -3),
      applyBefriendChange("indifferent", { kind: "set", attitude: "helpful" }),
    ]).toEqual(["helpful", "hostile", "helpful"]);
    expect(
      (["criticalSuccess", "success", "failure", "criticalFailure"] as DegreeOfSuccess[]).map(
        degreeToSteps,
      ),
    ).toEqual([2, 1, 0, -1]);
    expect([
      isBefriended("friendly", "helpful"),
      isBefriended("helpful", "helpful"),
      isBefriended("friendly", "friendly"),
    ]).toEqual([false, true, true]);

    const actor = makeActor("a1", "Nia", ["esi-djana"]);
    expect(readBefriendState(actor)["anchor-root"]).toMatchObject({
      attitude: "indifferent",
      befriended: false,
      ownsFeat: false,
    });
    expect(readBefriendState(actor)["esi-djana"]).toMatchObject({
      attitude: "helpful",
      befriended: true,
      ownsFeat: true,
    });

    const reach: BefriendEntry = {
      id: "e1",
      student: "anchor-root",
      change: { kind: "delta", steps: 2 },
      key: "criticalSuccess",
      note: "Returned lost chicken",
    };
    expect(planBefriend(actor, reach)).toMatchObject({
      previous: "indifferent",
      next: "helpful",
      grantFeat: true,
      removeFeat: false,
    });
    expect(await applyBefriend(actor, reach)).toBe(true);
    expect(await applyBefriend(actor, reach)).toBe(false);
    expect(readBefriendState(actor)["anchor-root"]).toMatchObject({
      attitude: "helpful",
      ownsFeat: true,
      notes: ["Returned lost chicken"],
    });

    // Dropping below threshold removes the Classroom Advantage feat.
    await applyBefriend(actor, {
      id: "e2",
      student: "anchor-root",
      change: { kind: "delta", steps: -1 },
      key: "delta:-1",
    });
    expect(readBefriendState(actor)["anchor-root"]).toMatchObject({
      attitude: "friendly",
      befriended: false,
      ownsFeat: false,
    });

    // Friendly threshold + reroll replacement restores attitude and removes granted feat.
    await applyBefriend(
      actor,
      {
        id: "r1",
        student: "chizire",
        change: { kind: "delta", steps: 1 },
        key: "success",
        note: "Cricket favor",
      },
      "friendly",
    );
    expect(readBefriendState(actor, "friendly").chizire).toMatchObject({
      attitude: "friendly",
      ownsFeat: true,
    });
    const reroll: BefriendEntry = {
      id: "r1",
      student: "chizire",
      change: { kind: "delta", steps: 0 },
      key: "failure",
      note: "Cricket favor",
    };
    expect(describeBefriendEntry([actor], reroll, "friendly")).toEqual({
      text: "the result changed; Apply replaces the old one.",
      done: false,
    });
    await applyBefriend(actor, reroll, "friendly");
    expect(readBefriendState(actor, "friendly").chizire).toMatchObject({
      attitude: "indifferent",
      ownsFeat: false,
      notes: ["Cricket favor"],
    });

    // Rerolling without a note clears the old note and does not leave a stale note in applied.
    await applyBefriend(
      actor,
      { id: "r1", student: "chizire", change: { kind: "delta", steps: 1 }, key: "success-no-note" },
      "friendly",
    );
    expect(readBefriendState(actor, "friendly").chizire.notes).toEqual([]);
  });

  it("parses rolled checks, party direct records, allowRolls setting, and renders Apply cards", async () => {
    const rollMsg = makeMsg(null, {
      pf2e: {
        context: {
          outcome: "criticalSuccess",
          options: [befriendOption("r1", "okoro-obiyo"), befriendNoteOption("Game night")],
        },
      },
    });
    expect(parseBefriendOption(befriendOption("r1", "okoro-obiyo"))).toEqual({
      id: "r1",
      student: "okoro-obiyo",
    });
    expect(befriendEntryFromMessage(rollMsg)).toEqual({
      id: "r1",
      student: "okoro-obiyo",
      change: { kind: "delta", steps: 2 },
      key: "criticalSuccess",
      note: "Game night",
    });

    const a1 = makeActor("a1", "Nia");
    const a2 = makeActor("a2", "Tarek", ["tzeniwe"]);
    const makeUi = (pick: BefriendPick | null): BefriendUi => ({
      pickBefriend: vi.fn(async () => pick),
      warn: vi.fn(),
      postBefriend: vi.fn(async () => undefined),
      newId: () => "id1",
    });
    const rollPick: BefriendPick = {
      mode: "roll",
      actor: a1,
      student: "haibram-thodja",
      skill: "diplomacy",
      dc: 15,
      note: "Lofty Leap",
    };
    await startBefriend([a1], makeUi(rollPick), {
      isGM: false,
      allowRolls: true,
      threshold: "helpful",
    });
    expect(a1.skills.diplomacy?.roll).toHaveBeenCalledWith(
      expect.objectContaining({
        dc: 15,
        traits: ["downtime"],
        extraRollOptions: [
          befriendOption("id1", "haibram-thodja"),
          befriendNoteOption("Lofty Leap"),
          "downtime",
        ],
      }),
    );

    const blockedUi = makeUi(rollPick);
    await startBefriend([a1], blockedUi, { isGM: false, allowRolls: false, threshold: "helpful" });
    expect(blockedUi.warn).toHaveBeenCalledOnce();

    const partyPick: BefriendPick = {
      mode: "direct",
      party: true,
      student: "ignaci-canterells",
      change: { kind: "set", attitude: "helpful" },
      note: "Cavern rescue",
    };
    const nonGmUi = makeUi(partyPick);
    await startBefriend([a1, a2], nonGmUi, { isGM: false, allowRolls: true, threshold: "helpful" });
    expect(nonGmUi.postBefriend).not.toHaveBeenCalled();

    const gmUi = makeUi(partyPick);
    await startBefriend([a1, a2], gmUi, { isGM: true, allowRolls: false, threshold: "helpful" });
    expect(gmUi.postBefriend).toHaveBeenCalledWith([a1, a2], {
      id: "id1",
      student: "ignaci-canterells",
      change: { kind: "set", attitude: "helpful" },
      note: "Cavern rescue",
      actorIds: ["a1", "a2"],
    });

    // Foundry wiring: settings, /befriend command, rolls-disabled dialog, and party Apply card.
    const register = vi.fn();
    const hooks: Record<string, (...args: unknown[]) => unknown> = {};
    const chatCommands: Record<string, { rgx: RegExp; fn: () => boolean }> = {};
    const mod = { api: { study: vi.fn() } as Record<string, unknown> };
    const wait = vi.fn<
      (config: { content: string; buttons: { label: string }[] }) => Promise<null>
    >(async () => null);
    vi.stubGlobal("game", {
      user: { isGM: false, character: a1 },
      actors: [a1, a2],
      settings: {
        register,
        get: (_s: string, k: string) =>
          k === "befriendAllowRolls" ? false : BEFRIEND_SETTINGS.befriendThreshold.default,
      },
      modules: { get: () => mod },
    });
    vi.stubGlobal("Hooks", {
      on: (n: string, fn: (...args: unknown[]) => unknown) => {
        hooks[n] = fn;
      },
    });
    vi.stubGlobal("canvas", { tokens: { controlled: [] } });
    vi.stubGlobal("foundry", {
      utils: { randomID: () => "id2", escapeHTML: (s: string) => s },
      applications: {
        api: { DialogV2: { wait } },
        sidebar: { tabs: { ChatLog: { CHAT_COMMANDS: chatCommands } } },
      },
    });

    registerBefriend();
    expect(register).toHaveBeenCalledTimes(2);
    expect(mod.api.befriend).toBe(befriend);
    expect(chatCommands.befriend?.rgx.test("/befriend")).toBe(true);
    expect(hooks.chatMessage?.(null, "/befriend")).toBe(false);

    await befriend(a1);
    expect(wait.mock.calls.at(-1)![0].content).not.toContain('name="skill"');
    expect(wait.mock.calls.at(-1)![0].buttons.map((b) => b.label)).toEqual(["Close"]);
    expect(renderStandingsRows([a1, a2], "helpful")).toContain(
      "Nia: Indifferent, Tarek: Helpful ★",
    );

    (globalThis as unknown as { game: { user: { isGM: boolean } } }).game.user.isGM = true;
    await befriend();
    const gmNoRoll = wait.mock.calls.at(-1)![0];
    expect(gmNoRoll.content).toContain('value="party"');
    expect(gmNoRoll.content).not.toContain('value="roll"');
    expect(gmNoRoll.buttons.map((b) => b.label)).toEqual(["Record"]);

    // Controlled non-character tokens are excluded for both GM and player, falling back to character.
    const npc = makeActor("npc1", "Pugwampi", [], "npc");
    vi.stubGlobal("canvas", { tokens: { controlled: [{ actor: npc }] } });
    (globalThis as unknown as { game: { actors: BefriendActor[] } }).game.actors = [a1, a2, npc];
    await befriend();
    const gmNpcSelected = wait.mock.calls.at(-1)![0];
    expect(gmNpcSelected.content).not.toContain("Pugwampi");
    expect(gmNpcSelected.content).toContain("Nia");

    (globalThis as unknown as { game: { user: { isGM: boolean } } }).game.user.isGM = false;
    (
      globalThis as unknown as {
        game: { settings: { get: (_s: string, k: string) => unknown } };
      }
    ).game.settings.get = (_s: string, k: string) =>
      k === "befriendAllowRolls" ? true : BEFRIEND_SETTINGS.befriendThreshold.default;
    await befriend();
    expect(wait.mock.calls.at(-1)![0].content).toContain("Nia");
    expect(wait.mock.calls.at(-1)![0].content).not.toContain("Pugwampi");

    const listeners: Record<string, () => Promise<void>> = {};
    vi.stubGlobal("document", {
      createElement: () => ({
        className: "",
        textContent: "",
        type: "",
        disabled: false,
        append() {},
        addEventListener(e: string, fn: () => Promise<void>) {
          listeners[e] = fn;
        },
      }),
    });
    const html = { querySelector: () => ({ append: vi.fn() }) } as unknown as HTMLElement;
    const msg = makeMsg(null, {
      thousands: {
        befriend: {
          id: "c1",
          student: "noxolo",
          change: { kind: "set", attitude: "helpful" },
          actorIds: ["a1", "a2"],
        },
      },
    });
    renderBefriendCard(msg, html, true);
    await listeners.click?.();
    expect([readBefriendState(a1).noxolo.ownsFeat, readBefriendState(a2).noxolo.ownsFeat]).toEqual([
      true,
      true,
    ]);
    expect(msg.update).toHaveBeenCalledOnce();
  });
});
