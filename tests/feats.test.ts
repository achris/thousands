import { describe, expect, it } from "vitest";
import {
  ACADEMIA_FEATS,
  BENEFIT_FEATS,
  MAX_DESCRIPTION_LENGTH,
  PACK_ID,
  PF2E_FEAT_UUIDS,
  STANDING_FEATS,
  featIdFromSlug,
  sluggify,
} from "../src/feats/index.js";
import {
  BENEFITS,
  BRANCHES,
  BRANCH_IDS,
  MAX_BRANCH_LEVEL,
  RANKS,
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
    expect(BENEFIT_FEATS).toHaveLength(BRANCH_IDS.length * BENEFITS.length);
    expect(ACADEMIA_FEATS).toHaveLength(119);

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
        } else if (rule.key === "FlatModifier" || rule.key === "Note") {
          const selectors = rule.selector as string[];
          expect(selectors.length).toBeGreaterThan(0);
          selectors.forEach((sel) => expect(VALID_SELECTORS.has(sel), sel).toBe(true));
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
      expect(desc.length, `${item.name}: ${desc}`).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
      expect(desc).toMatch(/^<p>[^<]+\(p\. 6[2-5]\)\.<\/p>$/);
    }
  });
});
