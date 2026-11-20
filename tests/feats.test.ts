import { describe, expect, it, vi } from "vitest";
import {
  ACADEMIA_FEATS,
  BENEFIT_FEATS,
  CLASSROOM_ADVANTAGE_FEATS,
  MAX_DESCRIPTION_LENGTH,
  PACK_ID,
  PF2E_FEAT_UUIDS,
  PF2E_UNLOCK_UUIDS,
  STANDING_FEATS,
  featIdFromSlug,
  sluggify,
} from "../src/feats/index.js";
import { consumeDailyFeatUse } from "../src/module.js";
import {
  BENEFITS,
  BRANCHES,
  BRANCH_IDS,
  MAX_BRANCH_LEVEL,
  RANKS,
  STUDENTS,
  STUDENT_IDS,
  benefitAtLevel,
  benefitsUnlocked,
} from "../src/rules/index.js";

const VALID_RULE_KEYS = new Set([
  "ActiveEffectLike",
  "ChoiceSet",
  "FlatModifier",
  "GrantItem",
  "Note",
  "RollOption",
  "RollTwice",
]);
const VALID_SELECTORS = new Set([
  "skill-check",
  "lore-skill-check",
  "land-speed",
  "saving-throw",
  "spell-attack",
  "spell-dc",
  ...Object.values(BRANCHES)
    .flatMap((b) => b.skills)
    .filter((s) => s !== "lore"),
]);
const VALID_UUIDS = new Set<string>(Object.values(PF2E_FEAT_UUIDS));

describe("benefits rules table", () => {
  it("covers branch levels 1 to 20 and slices unlocked benefits", () => {
    expect(BENEFITS).toHaveLength(MAX_BRANCH_LEVEL);
    BENEFITS.forEach((b, idx) => {
      expect(b.level).toBe(idx + 1);
      expect(benefitAtLevel(idx + 1)).toBe(b);
    });
    expect(benefitsUnlocked(0)).toEqual([]);
    expect(benefitsUnlocked(1).map((b) => b.label)).toEqual(["Additional Lore"]);
    expect(benefitsUnlocked(11).at(-1)?.label).toBe("Steeped in History +2");
    expect(benefitsUnlocked(20)).toHaveLength(20);
    expect(() => benefitAtLevel(0)).toThrow(RangeError);
    expect(() => benefitsUnlocked(21)).toThrow(RangeError);
  });
});

describe("academia bonus feat items", () => {
  it("validates every item against the PF2e 8.7.0 bonus feat shape", () => {
    expect(STANDING_FEATS).toHaveLength(RANKS.length + BRANCH_IDS.length * 3);
    expect(CLASSROOM_ADVANTAGE_FEATS).toHaveLength(STUDENT_IDS.length);
    expect(BENEFIT_FEATS).toHaveLength(BRANCH_IDS.length * BENEFITS.length);
    expect(ACADEMIA_FEATS).toHaveLength(128);

    const ids = new Set<string>();
    const names = new Set<string>();
    const slugs = new Set<string>();

    for (const item of ACADEMIA_FEATS) {
      expect(item._id).toMatch(/^[A-Za-z0-9]{16}$/);
      expect(item._id).toBe(featIdFromSlug(item.system.slug));
      expect(ids.has(item._id)).toBe(false);
      ids.add(item._id);
      expect(names.has(item.name)).toBe(false);
      names.add(item.name);
      expect(item.system.slug).toBe(sluggify(item.name));
      expect(slugs.has(item.system.slug)).toBe(false);
      slugs.add(item.system.slug);

      expect(item.type).toBe("feat");
      expect(item.system.category).toBe("bonus");
      expect(item.system.actionType.value).toBe("passive");
      expect(item.system.actions.value).toBeNull();
      expect(item.system.level.value).toBeGreaterThanOrEqual(1);
      expect(item.system.level.value).toBeLessThanOrEqual(MAX_BRANCH_LEVEL);
      expect(item._stats.systemId).toBe("pf2e");
      expect(item._stats.compendiumSource).toBe(`Compendium.thousands.${PACK_ID}.Item.${item._id}`);
      expect(item.system.rules.length).toBeGreaterThan(0);
    }
  });

  it("uses only valid PF2e rule element keys, selectors, paths, and UUIDs", () => {
    for (const item of ACADEMIA_FEATS) {
      const choiceFlags = new Set<string>();
      for (const rule of item.system.rules) {
        expect(VALID_RULE_KEYS.has(rule.key), `${item.name}: ${rule.key}`).toBe(true);
        if (rule.key === "ChoiceSet") {
          choiceFlags.add(String(rule.flag));
        } else if (rule.key === "FlatModifier" || rule.key === "Note" || rule.key === "RollTwice") {
          const selectors = rule.selector as string[];
          expect(selectors.length).toBeGreaterThan(0);
          selectors.forEach((sel) => expect(VALID_SELECTORS.has(sel), sel).toBe(true));
          if (rule.key === "RollTwice") {
            expect(["higher", "lower"]).toContain(rule.keep);
            expect(Array.isArray(rule.predicate) && rule.predicate.length > 0).toBe(true);
          }
        } else if (rule.key === "ActiveEffectLike") {
          expect(["add", "upgrade", "override"]).toContain(rule.mode);
          expect(String(rule.path)).toMatch(/^(?:flags\.thousands\.|system\.skills\.)/);
        } else if (rule.key === "GrantItem") {
          const uuid = String(rule.uuid);
          const selMatch = /^\{item\|flags\.system\.rulesSelections\.(\w+)\}$/.exec(uuid);
          if (selMatch) expect(choiceFlags.has(selMatch[1] ?? "")).toBe(true);
          else expect(VALID_UUIDS.has(uuid), uuid).toBe(true);
        } else if (rule.key === "RollOption") {
          expect(rule.domain).toBe("all");
          expect(String(rule.option)).toMatch(/^[a-z0-9:-]+$/);
        }
      }
    }
  });

  it("matches benefit level requirements and numbers from the rules engine", () => {
    for (const branchId of BRANCH_IDS) {
      const branch = BRANCHES[branchId];
      for (const benefit of BENEFITS) {
        const expectedName = `${branch.label} (Level ${benefit.level}): ${benefit.label}`;
        const feat = BENEFIT_FEATS.find((f) => f.name === expectedName);
        expect(feat).toBeDefined();
        if (!feat) continue;

        expect(feat.system.level.value).toBe(benefit.level);
        expect(feat.system.prerequisites.value[0]?.value).toBe(
          `${branch.label} branch level ${benefit.level}`,
        );
        expect(feat.system.rules[0]).toEqual({
          key: "ActiveEffectLike",
          mode: "upgrade",
          path: `flags.thousands.branches.${branchId}.level`,
          value: benefit.level,
        });
        if (benefit.bonus !== undefined) {
          const mod = feat.system.rules.find((r) => r.key === "FlatModifier");
          expect(mod?.value).toBe(benefit.bonus);
        }
      }
    }
  });

  it("keeps every description within the short length limit with a page reference", () => {
    for (const item of ACADEMIA_FEATS) {
      const desc = item.system.description.value;
      const plain = desc.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1");
      expect(plain.length, `${item.name}: ${plain}`).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
      expect(desc).toMatch(/^<p>[^<]+\(p\. (?:6[2-5]|6[7-9]|7[01])\)\.<\/p>$/);
    }
  });

  it("automates fixed Additional Lore skills and keeps open-ended Lore notes", () => {
    const cascadeLore = BENEFIT_FEATS.find(
      (f) => f.name === "Cascade Bearers (Level 1): Additional Lore",
    );
    const tempestLore = BENEFIT_FEATS.find(
      (f) => f.name === "Tempest-Sun Mages (Level 1): Additional Lore",
    );
    const emeraldLore = BENEFIT_FEATS.find(
      (f) => f.name === "Emerald Boughs (Level 1): Additional Lore",
    );

    expect(cascadeLore?.system.description.value).not.toContain("Manual:");
    expect(cascadeLore?.system.rules).toContainEqual({
      key: "ActiveEffectLike",
      mode: "override",
      path: "system.skills.academia-lore",
      value: {
        attribute: "int",
        label: "Academia Lore",
        rank: "match(when(gte(@actor.level, 15), 4), when(gte(@actor.level, 7), 3), when(gte(@actor.level, 3), 2), 1)",
      },
    });
    expect(tempestLore?.system.description.value).not.toContain("Manual:");
    expect(tempestLore?.system.rules).toContainEqual(
      expect.objectContaining({
        key: "ActiveEffectLike",
        mode: "override",
        path: "system.skills.warfare-lore",
      }),
    );
    expect(emeraldLore?.system.description.value).toContain("Manual: set Lore to");
  });

  it("automates Dedicated Attendant rank check and Arcana/Nature skill upgrade", () => {
    const feat = BENEFIT_FEATS.find(
      (f) => f.name === "Cascade Bearers (Level 3): Dedicated Attendant",
    );
    expect(feat?.system.description.value).toBe(
      "<p>Grants Magaambyan Attendant Dedication once. Manual: pick cantrip (p. 64).</p>",
    );
    const choiceSet = feat?.system.rules.find((r) => r.key === "ChoiceSet");
    expect(choiceSet).toMatchObject({
      flag: "skill",
      rollOption: "dedicated-attendant-skill",
      allowNoSelection: true,
      predicate: [
        {
          or: ["academia:rank:attendant", "academia:rank:conversant", "academia:rank:lore-speaker"],
        },
        { not: "feat:magaambyan-attendant-dedication" },
      ],
    });
    const grant = feat?.system.rules.find((r) => r.key === "GrantItem");
    expect(grant).toMatchObject({
      uuid: PF2E_FEAT_UUIDS["magaambyan-attendant-dedication"],
      predicate: [
        {
          or: ["academia:rank:attendant", "academia:rank:conversant", "academia:rank:lore-speaker"],
        },
      ],
      reevaluateOnUpdate: true,
      allowDuplicate: false,
    });
  });

  it("filters granted skill feats by tier max level and branch feats by prerequisites", () => {
    const levelCaps: [number, number][] = [
      [4, 4],
      [9, 6],
      [15, 14],
      [19, 20],
    ];
    for (const [level, maxFeatLevel] of levelCaps) {
      const sf = BENEFIT_FEATS.find((f) => f.name.startsWith(`Rain-Scribes (Level ${level}):`));
      const cs = sf?.system.rules.find((r) => r.key === "ChoiceSet");
      expect(cs?.choices).toEqual({
        itemType: "feat",
        filter: ["item:category:skill", { lte: ["item:level", maxFeatLevel] }],
      });
    }

    const emerald7 = BENEFIT_FEATS.find(
      (f) => f.name === "Emerald Boughs (Level 7): First Branch Feat",
    );
    const tempest12 = BENEFIT_FEATS.find(
      (f) => f.name === "Tempest-Sun Mages (Level 12): Second Branch Feat",
    );
    expect(emerald7?.system.rules).toContainEqual({
      key: "GrantItem",
      uuid: PF2E_FEAT_UUIDS["emerald-boughs-accustomation"],
      predicate: [
        { not: "feat:emerald-boughs-accustomation" },
        "feat:magaambyan-attendant-dedication",
        { gte: ["skill:society:rank", 2] },
      ],
      reevaluateOnUpdate: true,
      allowDuplicate: false,
    });
    expect(tempest12?.system.rules).toContainEqual({
      key: "GrantItem",
      uuid: PF2E_FEAT_UUIDS["tempest-sun-shielding"],
      predicate: [{ not: "feat:tempest-sun-shielding" }, "feat:tempest-sun-redirection"],
      reevaluateOnUpdate: true,
      allowDuplicate: false,
    });
    const fallbackCs = tempest12?.system.rules.find((r) => r.key === "ChoiceSet");
    expect(fallbackCs?.choices).toEqual({
      itemType: "feat",
      filter: [
        "item:category:class",
        { lte: ["item:level", 10] },
        { or: ["item:trait:{actor|system.details.class.trait}", "item:trait:archetype"] },
      ],
    });
  });

  it("automates Make Your Own Luck fortune rerolls and daily use consumption hook", async () => {
    const luck = BENEFIT_FEATS.find((f) => f.name === "Uzunjati (Level 16): Make Your Own Luck");
    expect(luck?.system.description.value).not.toContain("Manual:");
    expect(luck?.system.rules).toContainEqual({
      key: "RollOption",
      domain: "all",
      option: "make-your-own-luck:uzunjati",
      toggleable: true,
    });
    expect(luck?.system.rules).toContainEqual({
      key: "RollTwice",
      selector: ["crafting", "lore-skill-check"],
      keep: "higher",
      predicate: ["make-your-own-luck:uzunjati"],
    });

    const update = vi.fn();
    const item = {
      type: "feat",
      system: {
        frequency: { value: 1, max: 1, per: "day" },
        rules: [
          {
            key: "RollOption",
            domain: "all",
            option: "make-your-own-luck:uzunjati",
            toggleable: true,
            value: true,
          },
        ],
      },
      update,
    };

    expect(
      await consumeDailyFeatUse({
        isAuthor: false,
        actor: { items: [item] },
        flags: { pf2e: { context: { options: ["make-your-own-luck:uzunjati"] } } },
      }),
    ).toBe(0);
    expect(update).not.toHaveBeenCalled();

    expect(
      await consumeDailyFeatUse({
        isAuthor: true,
        actor: { items: [item] },
        flags: { pf2e: { context: { options: ["make-your-own-luck:uzunjati"] } } },
      }),
    ).toBe(1);
    expect(update).toHaveBeenCalledWith({
      "system.frequency.value": 0,
      "system.rules": [
        {
          key: "RollOption",
          domain: "all",
          option: "make-your-own-luck:uzunjati",
          toggleable: true,
          value: false,
        },
      ],
    });

    // Defaults frequency.value from max on Magical Paragon, and skips exhausted or untoggled items.
    const paragonUpdate = vi.fn();
    const paragonRules = [
      {
        key: "RollOption",
        domain: "all",
        option: "magical-paragon:cascade-bearers",
        toggleable: true,
      },
    ];
    const paragonItem = {
      type: "feat",
      system: { frequency: { max: 1, per: "day" }, rules: paragonRules },
      update: paragonUpdate,
    };
    const exhaustedItem = {
      type: "feat",
      system: { frequency: { value: 0, max: 1, per: "day" }, rules: paragonRules },
      update: vi.fn(),
    };
    expect(
      await consumeDailyFeatUse({
        actor: { items: [paragonItem, exhaustedItem, { type: "weapon", update: vi.fn() }] },
        flags: { pf2e: { context: { options: ["magical-paragon:cascade-bearers"] } } },
      }),
    ).toBe(1);
    expect(paragonUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ "system.frequency.value": 0 }),
    );
    expect(exhaustedItem.update).not.toHaveBeenCalled();
    expect(await consumeDailyFeatUse({})).toBe(0);
  });

  it("automates standing feats, skill increases, general feats, toggles, and Magical Paragon", () => {
    const standing = (name: string) => STANDING_FEATS.find((f) => f.name === name)?.system.rules;
    const benefit = (name: string) => BENEFIT_FEATS.find((f) => f.name === name);

    expect(standing("Academic Rank: Conversant")).toEqual([
      { key: "RollOption", domain: "all", option: "academia:rank:conversant" },
      {
        key: "ActiveEffectLike",
        mode: "override",
        path: "flags.thousands.rank",
        value: "conversant",
      },
    ]);
    expect(standing("Primary Branch: Uzunjati")).toContainEqual({
      key: "ActiveEffectLike",
      mode: "override",
      path: "flags.thousands.primary.branch",
      value: "uzunjati",
    });
    expect(standing("Branch Star: Uzunjati")).toContainEqual({
      key: "ActiveEffectLike",
      mode: "override",
      path: "flags.thousands.branches.uzunjati.starred",
      value: true,
    });
    expect(
      benefit("Cascade Bearers (Level 11): Steeped in History +2")?.system.rules,
    ).toContainEqual({
      key: "FlatModifier",
      selector: ["skill-check"],
      type: "circumstance",
      value: 2,
      predicate: ["action:recall-knowledge", "steeped-in-history:cascade-bearers"],
      hideIfDisabled: true,
    });
    expect(benefit("Emerald Boughs (Level 17): Branch Influence +3")?.system.rules).toContainEqual({
      key: "FlatModifier",
      selector: ["deception", "diplomacy", "intimidation", "performance"],
      type: "circumstance",
      value: 3,
      predicate: ["branch-influence:emerald-boughs"],
      hideIfDisabled: true,
    });
    expect(benefit("Uzunjati (Level 6): Skill Increase (Expert)")?.system.rules).toContainEqual({
      key: "GrantItem",
      uuid: PF2E_FEAT_UUIDS["additional-lore"],
      predicate: ["uzunjati-skill-increase-6:lore"],
    });
    expect(benefit("Rain-Scribes (Level 8): General Feat")?.system.rules).toContainEqual({
      key: "GrantItem",
      uuid: PF2E_FEAT_UUIDS.fleet,
      predicate: [{ not: "feat:fleet" }],
    });
    const cascadeParagon = benefit("Cascade Bearers (Level 20): Magical Paragon");
    expect(cascadeParagon?.system.frequency).toEqual({ max: 1, per: "day" });
    expect(cascadeParagon?.system.rules).toContainEqual(
      expect.objectContaining({ key: "Note", selector: ["spell-attack", "spell-dc"] }),
    );
    expect(benefit("Uzunjati (Level 20): Magical Paragon")?.system.rules).toContainEqual(
      expect.objectContaining({
        key: "FlatModifier",
        selector: ["skill-check"],
        value: 2,
        predicate: ["magical-paragon:uzunjati"],
      }),
    );
  });

  it("builds all 9 Classroom Advantage feats with @UUID links and Mariama's 1/day fortune reroll", async () => {
    for (const id of STUDENT_IDS) {
      const s = STUDENTS[id];
      const feat = CLASSROOM_ADVANTAGE_FEATS.find(
        (f) => f.name === `Classroom Advantage: ${s.label}`,
      );
      expect(feat?.system.rules).toContainEqual({
        key: "RollOption",
        domain: "all",
        option: `academia:classroom-advantage:${id}`,
      });
      for (const u of s.unlocks) {
        const { uuid, label } = PF2E_UNLOCK_UUIDS[u as keyof typeof PF2E_UNLOCK_UUIDS];
        expect(feat?.system.description.value).toContain(`@UUID[${uuid}]{${label}}`);
      }
    }

    const mariama = CLASSROOM_ADVANTAGE_FEATS.find(
      (f) => f.name === "Classroom Advantage: Mariama Keitana",
    )!;
    expect(mariama.system.traits.value).toEqual(["fortune"]);
    expect(mariama.system.frequency).toEqual({ max: 1, per: "day" });
    expect(mariama.system.rules).toContainEqual({
      key: "RollTwice",
      selector: ["skill-check"],
      keep: "higher",
      predicate: ["classroom-advantage:mariama-keitana", "study-check:branch:cascade-bearers"],
    });

    const update = vi.fn();
    const rules = mariama.system.rules.map((r) =>
      r.option === "classroom-advantage:mariama-keitana" ? { ...r, value: true } : r,
    );
    const mariamaItem = {
      type: "feat",
      system: { frequency: { value: 1, max: 1, per: "day" }, rules },
      update,
    };
    const msg = (branch: string) => ({
      actor: { items: [mariamaItem] },
      flags: {
        pf2e: {
          context: {
            options: ["classroom-advantage:mariama-keitana", `study-check:branch:${branch}`],
          },
        },
      },
    });
    expect(await consumeDailyFeatUse(msg("uzunjati"))).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(await consumeDailyFeatUse(msg("cascade-bearers"))).toBe(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ "system.frequency.value": 0 }));
  });
});
