import { describe, expect, it, vi } from "vitest";
import type { DegreeOfSuccess } from "../src/rules/index.js";
import { describeEntry, entryFromMessage } from "../src/study/chat.js";
import { startStudy, type StatisticLike, type StudyUi } from "../src/study/roll.js";
import {
  applyStudy,
  type ActorLike,
  featFor,
  levelOption,
  readState,
  type StudyEntry,
  type StudyFlags,
} from "../src/study/academia.js";

/** A level 6 Uzunjati primary at the given branch level, with Cascade Bearers secondary at 0. */
function makeActor(top: number) {
  const options = ["academia:branch:primary:uzunjati", "academia:branch:secondary:cascade-bearers"];
  for (let n = 1; n <= top; n++) options.push(levelOption("uzunjati", n));
  let next = 0;
  const skill = (slug: string, lore = false): [string, StatisticLike] => [
    slug,
    { slug, label: slug, lore, roll: vi.fn(async () => null) },
  ];
  const actor = {
    name: "Tester",
    level: 6,
    flag: {} as StudyFlags,
    items: options.map((option) => ({
      id: `i${next++}`,
      system: { slug: featFor(option).system.slug },
    })),
    skills: Object.fromEntries([skill("arcana"), skill("crafting"), skill("herbalism-lore", true)]),
    getFlag: () => actor.flag,
    setFlag: async (_scope: string, _key: string, value: unknown) => {
      const update = value as StudyFlags;
      actor.flag = { ...update, applied: { ...actor.flag.applied, ...update.applied } };
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

function makeUi(slug: string) {
  const ui = {
    seen: [] as string[],
    warn: vi.fn(),
    postSkip: vi.fn(async () => undefined),
    newId: () => "abc",
    pick: (async (choices) => {
      ui.seen = choices.map((c) => `${c.kind}:${c.slug}`);
      return choices.find((c) => c.slug === slug) ?? null;
    }) as StudyUi["pick"],
  };
  return ui;
}

type Degree = StudyEntry["degree"];
const entry = (degree: Degree): StudyEntry => ({ id: "abc", kind: "primary", degree });
const primaryLevel = (actor: ActorLike) => readState(actor).branches.primary?.level;

describe("starting Study", () => {
  it("rolls the chosen skill at the DC for the branch level and tags the roll", async () => {
    const actor = makeActor(2);
    const ui = makeUi("herbalism-lore");
    await startStudy(actor, ui);
    expect(ui.seen).toEqual(["primary:crafting", "primary:herbalism-lore", "secondary:arcana"]);
    expect(actor.skills["herbalism-lore"]?.roll).toHaveBeenCalledWith(
      expect.objectContaining({ dc: 16, extraRollOptions: ["thousands:study:abc:primary"] }),
    );
  });

  it("posts a skipped opportunity instead of rolling while a skip is pending", async () => {
    const actor = makeActor(2);
    actor.flag = { skipNext: true };
    const ui = makeUi("crafting");
    await startStudy(actor, ui);
    expect(ui.postSkip).toHaveBeenCalledWith(actor, "abc");
    expect(actor.skills.crafting?.roll).not.toHaveBeenCalled();
    await applyStudy(actor, { id: "abc", degree: "skipped" });
    expect(actor.flag.skipNext).toBe(false);
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
  });

  it("does nothing when the same result is applied twice", async () => {
    const actor = makeActor(2);
    expect(await applyStudy(actor, entry("success"))).toBe(true);
    expect(describeEntry(actor, entry("success")).done).toBe(true);
    expect(await applyStudy(actor, entry("success"))).toBe(false);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(primaryLevel(actor)).toBe(3);
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
});

describe("reading a result from chat", () => {
  it("takes the entry from the roll option and the outcome a reroll leaves behind", () => {
    const message = (outcome: string | null, options: string[]) => ({
      flags: { pf2e: { context: { options, outcome } } },
      update: async () => undefined,
    });
    const rerolled = message("failure", ["check:reroll", "thousands:study:abc:secondary"]);
    expect(entryFromMessage(rerolled)).toEqual({ id: "abc", kind: "secondary", degree: "failure" });
    expect(entryFromMessage(message("success", ["check:statistic:arcana"]))).toBeNull();
    const skipped = { ...rerolled, flags: { thousands: { skip: "x" } } };
    expect(entryFromMessage(skipped)).toEqual({ id: "x", degree: "skipped" });
  });
});
