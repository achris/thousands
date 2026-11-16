import { afterEach, describe, expect, it, vi } from "vitest";
import type { DegreeOfSuccess, Rank } from "../src/rules/index.js";
import { describeEntry, entryFromMessage } from "../src/study/chat.js";
import { registerStudy } from "../src/study/foundry.js";
import {
  startStudy,
  studyOption,
  type AllowedActivities,
  type StatisticLike,
  type StudySetting,
  type StudyUi,
} from "../src/study/roll.js";
import {
  applyStudy,
  type ActorLike,
  featFor,
  levelOption,
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
    setting: (key: StudySetting) => settings[key] ?? true,
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
      expect.objectContaining({ dc: 16, extraRollOptions: ["thousands:study:abc:study:primary"] }),
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
    expect(calls.map((c) => c.extraRollOptions[0])).toEqual([
      studyOption("abc-1", "cram", "primary"),
      studyOption("abc-2", "cram", "primary"),
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

  it("registers both world settings as GM-only booleans defaulting to the stricter rules", () => {
    const register = vi.fn();
    vi.stubGlobal("game", {
      user: { isGM: true },
      settings: { register, get: () => true },
      modules: { get: () => ({}) },
    });
    vi.stubGlobal("Hooks", { on: vi.fn() });
    registerStudy();
    expect(register).toHaveBeenCalledTimes(2);
    for (const key of ["cramStrict", "skipAppliesToCram"]) {
      expect(register).toHaveBeenCalledWith(
        "thousands",
        key,
        expect.objectContaining({ scope: "world", config: true, type: Boolean, default: true }),
      );
    }
  });
});

describe("applying a result", () => {
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
});
