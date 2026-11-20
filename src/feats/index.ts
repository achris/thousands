import { MODULE_ID } from "../constants.js";
import {
  BENEFITS,
  BRANCHES,
  BRANCH_IDS,
  PROFICIENCY_LABELS,
  RANKS,
  STUDENTS,
  STUDENT_IDS,
  type BenefitInfo,
  type BranchId,
  type BranchKind,
  type ProficiencyRank,
  type Rank,
} from "../rules/index.js";

export const PACK_ID = "academia-feats";
export const MAX_DESCRIPTION_LENGTH = 160;
export const PF2E_SCHEMA_VERSION = 0.961;

const FP = "Compendium.pf2e.feats-srd.Item.";
const EP = "Compendium.pf2e.equipment-srd.Item.";
const SP = "Compendium.pf2e.spells-srd.Item.";
const CP = "Compendium.pf2e.classfeatures.Item.";

/** Verified PF2e 8.7.0 compendium UUIDs in `pf2e.feats-srd`. */
// prettier-ignore
export const PF2E_FEAT_UUIDS = {
  "additional-lore": `${FP}BocFD2KV0qgUC76x`,
  "magaambyan-attendant-dedication": `${FP}ZhToff996PnTESwb`,
  "canny-acumen": `${FP}i4yRvVwvXbGZDsD1`,
  "adopted-ancestry": `${FP}ihN8gkHSdPG9Trte`,
  "fleet": `${FP}Ux73dmoF8KnavyUD`,
  "toughness": `${FP}AmP0qu7c5dlBSath`,
  "incredible-initiative": `${FP}2kwXTUjYYhoAGySr`,
  "cascade-bearers-flexibility": `${FP}YOU5eCD5S4cS6Qeu`,
  "cascade-bearers-spellcasting": `${FP}V5FKAmcYQF4KRELG`,
  "emerald-boughs-accustomation": `${FP}EZ24QwnFteLCrgLg`,
  "emerald-boughs-hideaway": `${FP}cxAvcFiZRT3ZVhie`,
  "rain-scribe-sustenance": `${FP}jRJqKkm6NnHcL8HO`,
  "rain-scribe-mobility": `${FP}nobsCgNmsDX6aKR5`,
  "tempest-sun-redirection": `${FP}FJdcQU6yjDVDBC4r`,
  "tempest-sun-shielding": `${FP}sTUicpQkhiFVtMK1`,
  "uzunjati-storytelling": `${FP}my4uFR8cnDC4mJE2`,
  "uzunjati-recollection": `${FP}UCen3Tq6BJlNI7rx`,
} as const;

/** Verified PF2e 8.7.0 compendium UUIDs unlocked by befriending Spire Dormitory students. */
// prettier-ignore
export const PF2E_UNLOCK_UUIDS = {
  "rhythm-bone": { uuid: `${EP}geAAUwfmOc5U0qOE`, label: "Rhythm Bone" },
  "verminous-lure": { uuid: `${SP}Juk3cD5385Ftybct`, label: "Verminous Lure" },
  "impeccable-flow": { uuid: `${SP}8VzbumNyMEdSzZSz`, label: "Impeccable Flow" },
  "airburst": { uuid: `${SP}fprqWKUc0jnMIyGU`, label: "Airburst" },
  "forgetful-ink": { uuid: `${EP}iCRoLguNunOjIM7L`, label: "Forgetful Ink" },
  "lesson-of-calamity": { uuid: `${CP}PLMmDXJCDdMS0V5C`, label: "Lesson of Calamity" },
  "stumbling-curse": { uuid: `${SP}X8PSYw6WC2ePYSXd`, label: "Stumbling Curse" },
  "grave-impressions": { uuid: `${SP}Xrz6wPXDBUr27izR`, label: "Grave Impressions" },
  "mind-games": { uuid: `${SP}29JyWqqZ0thCFr1C`, label: "Mind Games" },
  "friendfetch": { uuid: `${SP}TjrZGl8z2INgf3vi`, label: "Friendfetch" },
} as const;

export type RuleElementKey =
  | "ActiveEffectLike"
  | "ChoiceSet"
  | "FlatModifier"
  | "GrantItem"
  | "Note"
  | "RollOption"
  | "RollTwice";

export interface RuleElementSource {
  key: RuleElementKey;
  [prop: string]: unknown;
}

export interface PF2eFeatSource {
  _id: string;
  name: string;
  type: "feat";
  img: string;
  effects: never[];
  folder: null;
  flags: Record<string, unknown>;
  _stats: {
    compendiumSource: string;
    coreVersion: string;
    systemId: "pf2e";
    systemVersion: string;
  };
  system: {
    slug: string;
    _migration: { version: number; previous: null };
    description: { value: string; gm: string };
    level: { value: number };
    category: "bonus";
    onlyLevel1: boolean;
    maxTakable: number;
    actionType: { value: "passive" };
    actions: { value: null };
    prerequisites: { value: { value: string }[] };
    frequency: { max: number; per: "day" } | null;
    location: null;
    publication: { title: string; authors: string; license: "OGL"; remaster: boolean };
    rules: RuleElementSource[];
    traits: { rarity: "common"; value: string[]; otherTags: string[] };
  };
}

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function sluggify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function featIdFromSlug(slug: string): string {
  let out = "";
  for (let i = 0; i < 16; i++) {
    let h = (0x811c9dc5 ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0;
    for (let j = 0; j < slug.length; j++) h = Math.imul(h ^ slug.charCodeAt(j), 0x01000193) >>> 0;
    out += ID_ALPHABET[h % ID_ALPHABET.length];
  }
  return out;
}

const skillKey = (s: string) => `PF2E.Skill.${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const rollOpt = (option: string, toggleable?: boolean): RuleElementSource =>
  toggleable
    ? { key: "RollOption", domain: "all", option, toggleable: true }
    : { key: "RollOption", domain: "all", option };
const aeLike = (
  mode: "add" | "upgrade" | "override",
  path: string,
  value: unknown,
  predicate?: unknown[],
): RuleElementSource =>
  predicate
    ? { key: "ActiveEffectLike", mode, path, value, predicate }
    : { key: "ActiveEffectLike", mode, path, value };
const flatMod = (selector: string[], value: number, predicate: unknown[]): RuleElementSource => ({
  key: "FlatModifier",
  selector,
  type: "circumstance",
  value,
  predicate,
  hideIfDisabled: true,
});
const rollNote = (selector: string[]): RuleElementSource => ({
  key: "Note",
  selector,
  title: "{item|name}",
  text: "{item|description}",
});

function makeFeat(
  name: string,
  level: number,
  description: string,
  rules: RuleElementSource[],
  prerequisites: string[] = [],
  traits: string[] = [],
  frequency: { max: number; per: "day" } | null = null,
): PF2eFeatSource {
  const slug = sluggify(name);
  const id = featIdFromSlug(slug);
  return {
    _id: id,
    name,
    type: "feat",
    img: "icons/sundries/books/book-red-exclamation.webp",
    effects: [],
    folder: null,
    flags: {},
    _stats: {
      compendiumSource: `Compendium.${MODULE_ID}.${PACK_ID}.Item.${id}`,
      coreVersion: "14",
      systemId: "pf2e",
      systemVersion: "8.7.0",
    },
    system: {
      slug,
      _migration: { version: PF2E_SCHEMA_VERSION, previous: null },
      description: { value: `<p>${description}</p>`, gm: "" },
      level: { value: level },
      category: "bonus",
      onlyLevel1: false,
      maxTakable: 1,
      actionType: { value: "passive" },
      actions: { value: null },
      prerequisites: { value: prerequisites.map((value) => ({ value })) },
      frequency,
      location: null,
      publication: {
        title: "Pathfinder #169: Kindled Magic",
        authors: "",
        license: "OGL",
        remaster: false,
      },
      rules,
      traits: { rarity: "common", value: traits, otherTags: [] },
    },
  };
}

const RANK_LABELS: Record<Rank, string> = {
  initiate: "Initiate",
  attendant: "Attendant",
  conversant: "Conversant",
  "lore-speaker": "Lore-Speaker",
};

function buildStandingFeats(): PF2eFeatSource[] {
  const feats = RANKS.map((r) =>
    makeFeat(
      `Academic Rank: ${RANK_LABELS[r]}`,
      1,
      `Sets academic rank to ${RANK_LABELS[r]} (p. 63).`,
      [rollOpt(`academia:rank:${r}`), aeLike("override", `flags.${MODULE_ID}.rank`, r)],
    ),
  );
  for (const [k, label] of [
    ["primary", "Primary"],
    ["secondary", "Secondary"],
  ] as const satisfies readonly [BranchKind, string][]) {
    for (const id of BRANCH_IDS) {
      const b = BRANCHES[id];
      feats.push(
        makeFeat(
          `${label} Branch: ${b.label}`,
          1,
          `Sets ${k} branch to ${b.label} at branch level 0 (p. 62).`,
          [
            rollOpt(`academia:branch:${k}:${id}`),
            aeLike("override", `flags.${MODULE_ID}.${k}.branch`, id),
            aeLike("override", `flags.${MODULE_ID}.branches.${id}.kind`, k),
            aeLike("upgrade", `flags.${MODULE_ID}.branches.${id}.level`, 0),
          ],
        ),
      );
    }
  }
  for (const id of BRANCH_IDS) {
    const b = BRANCHES[id];
    feats.push(
      makeFeat(
        `Branch Star: ${b.label}`,
        1,
        `Marks ${b.label} as starred; resolves on next level-up (p. 63).`,
        [
          rollOpt(`academia:starred:${id}`),
          aeLike("override", `flags.${MODULE_ID}.branches.${id}.starred`, true),
        ],
        [b.label],
      ),
    );
  }
  return feats;
}

const LORE_RANK_PROGRESSION =
  "match(when(gte(@actor.level, 15), 4), when(gte(@actor.level, 7), 3), when(gte(@actor.level, 3), 2), 1)";

const ATTENDANT_PLUS_PREDICATE = [
  { or: ["academia:rank:attendant", "academia:rank:conversant", "academia:rank:lore-speaker"] },
];

const SKILL_FEAT_MAX_LEVEL: Record<ProficiencyRank, number> = { 1: 4, 2: 6, 3: 14, 4: 20 };

const BRANCH_FEAT_PREREQS: Partial<Record<keyof typeof PF2E_FEAT_UUIDS, unknown[]>> = {
  "emerald-boughs-accustomation": [
    "feat:magaambyan-attendant-dedication",
    { gte: ["skill:society:rank", 2] },
  ],
  "tempest-sun-shielding": ["feat:tempest-sun-redirection"],
  "uzunjati-recollection": ["feat:uzunjati-storytelling"],
};

const fallbackFeatRules = (
  slug: keyof typeof PF2E_FEAT_UUIDS,
  filter: unknown[],
  grantPrereqs: unknown[] = [],
): RuleElementSource[] => [
  {
    key: "ChoiceSet",
    flag: "fallbackFeat",
    adjustName: false,
    predicate: [`feat:${slug}`],
    choices: { itemType: "feat", filter },
  },
  {
    key: "GrantItem",
    uuid: PF2E_FEAT_UUIDS[slug],
    predicate: [{ not: `feat:${slug}` }, ...grantPrereqs],
    ...(grantPrereqs.length > 0 ? { reevaluateOnUpdate: true, allowDuplicate: false } : {}),
  },
  {
    key: "GrantItem",
    uuid: "{item|flags.system.rulesSelections.fallbackFeat}",
    predicate: [`feat:${slug}`],
  },
];

const PARAGON_SPECS: Record<
  BranchId,
  { desc: string; rules: RuleElementSource[]; freq?: { max: number; per: "day" } }
> = {
  "cascade-bearers": {
    desc: "1/day cast any common 7th-rank spell. Manual: cast spell (p. 65).",
    rules: [
      rollOpt("magical-paragon:cascade-bearers", true),
      rollNote(["spell-attack", "spell-dc"]),
    ],
    freq: { max: 1, per: "day" },
  },
  "emerald-boughs": {
    desc: "1-minute activity expanding hideaway into a mansion. Manual: resolve in play (p. 65).",
    rules: [rollOpt("magical-paragon:emerald-boughs")],
  },
  "rain-scribes": {
    desc: "Ignore severe/extreme temperatures and difficult/hazardous terrain. Manual: apply in play (p. 65).",
    rules: [rollOpt("magical-paragon:rain-scribes"), rollNote(["land-speed"])],
  },
  "tempest-sun-mages": {
    desc: "Tempest-Sun Shielding protects all allies within 30 ft. Manual: apply to allies in range (p. 65).",
    rules: [rollOpt("magical-paragon:tempest-sun-mages"), rollNote(["saving-throw"])],
  },
  uzunjati: {
    desc: "+2 circumstance to Uzunjati Recollection/Storytelling. Manual: roll Recall Knowledge 3x (p. 65).",
    rules: [
      rollOpt("magical-paragon:uzunjati", true),
      flatMod(["skill-check"], 2, ["magical-paragon:uzunjati"]),
    ],
  },
};

function buildBenefitFeat(branchId: BranchId, ben: BenefitInfo): PF2eFeatSource {
  const b = BRANCHES[branchId];
  const name = `${b.label} (Level ${ben.level}): ${ben.label}`;
  const prereqs = [`${b.label} branch level ${ben.level}`];
  const rankLabel = ben.rank ? PROFICIENCY_LABELS[ben.rank] : "";
  const base = [
    aeLike("upgrade", `flags.${MODULE_ID}.branches.${branchId}.level`, ben.level),
    rollOpt(`academia:branch:${branchId}:level:${ben.level}`),
  ];

  switch (ben.kind) {
    case "additional-lore": {
      const fixedLore = /\bLore$/.test(b.loreNote);
      return makeFeat(
        name,
        ben.level,
        fixedLore
          ? `Grants Additional Lore for ${b.loreNote} (p. ${ben.page}).`
          : `Grants Additional Lore. Manual: set Lore to ${b.loreNote} (p. ${ben.page}).`,
        [
          ...base,
          { key: "GrantItem", uuid: PF2E_FEAT_UUIDS["additional-lore"] },
          ...(fixedLore
            ? [
                aeLike("override", `system.skills.${sluggify(b.loreNote)}`, {
                  attribute: "int",
                  label: b.loreNote,
                  rank: LORE_RANK_PROGRESSION,
                }),
              ]
            : []),
        ],
        prereqs,
      );
    }
    case "steeped-in-history":
      return makeFeat(
        name,
        ben.level,
        `+${ben.bonus} circumstance to Recall Knowledge on the academy and ${b.label} (p. ${ben.page}).`,
        [
          ...base,
          rollOpt(`steeped-in-history:${branchId}`, true),
          flatMod(["skill-check"], ben.bonus ?? 1, [
            "action:recall-knowledge",
            `steeped-in-history:${branchId}`,
          ]),
        ],
        prereqs,
      );
    case "dedicated-attendant":
      return makeFeat(
        name,
        ben.level,
        `Grants Magaambyan Attendant Dedication once. Manual: pick cantrip (p. ${ben.page}).`,
        [
          ...base,
          {
            key: "ChoiceSet",
            flag: "skill",
            rollOption: "dedicated-attendant-skill",
            adjustName: false,
            allowNoSelection: true,
            prompt: "PF2E.SpecificRule.Prompt.Skill",
            predicate: [
              ...ATTENDANT_PLUS_PREDICATE,
              { not: "feat:magaambyan-attendant-dedication" },
            ],
            choices: (["arcana", "nature"] as const).map((s) => ({
              label: skillKey(s),
              value: s,
              predicate: [{ lt: [`skill:${s}:rank`, 2] }],
            })),
          },
          aeLike("add", "system.skills.{item|flags.system.rulesSelections.skill}.rank", 1, [
            ...ATTENDANT_PLUS_PREDICATE,
            { or: ["dedicated-attendant-skill:arcana", "dedicated-attendant-skill:nature"] },
          ]),
          {
            key: "GrantItem",
            uuid: PF2E_FEAT_UUIDS["magaambyan-attendant-dedication"],
            predicate: ATTENDANT_PLUS_PREDICATE,
            reevaluateOnUpdate: true,
            allowDuplicate: false,
          },
        ],
        [...prereqs, "Perquisite completed"],
      );
    case "skill-feat": {
      const maxLevel = SKILL_FEAT_MAX_LEVEL[ben.rank ?? 1];
      return makeFeat(
        name,
        ben.level,
        `Grants a skill feat. Manual: pick ${rankLabel} in ${b.skills.join("/")} (p. ${ben.page}).`,
        [
          ...base,
          {
            key: "ChoiceSet",
            flag: "skillFeat",
            adjustName: false,
            prompt: "PF2E.SpecificRule.Prompt.SkillFeat",
            choices: {
              itemType: "feat",
              filter: ["item:category:skill", { lte: ["item:level", maxLevel] }],
            },
          },
          { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.skillFeat}" },
        ],
        prereqs,
      );
    }
    case "branch-influence":
      return makeFeat(
        name,
        ben.level,
        `+${ben.bonus} circumstance on social checks with ${b.label} members (p. ${ben.page}).`,
        [
          ...base,
          rollOpt(`branch-influence:${branchId}`, true),
          flatMod(["deception", "diplomacy", "intimidation", "performance"], ben.bonus ?? 1, [
            `branch-influence:${branchId}`,
          ]),
        ],
        prereqs,
      );
    case "skill-increase": {
      if (branchId === "uzunjati") {
        const opt = `uzunjati-skill-increase-${ben.level}`;
        return makeFeat(
          name,
          ben.level,
          `Increases Crafting to ${rankLabel} or grants Additional Lore. Manual: set new Lore name (p. ${ben.page}).`,
          [
            ...base,
            {
              key: "ChoiceSet",
              flag: "skill",
              rollOption: opt,
              adjustName: false,
              choices: [
                {
                  label: skillKey("crafting"),
                  value: "crafting",
                  predicate: [{ lt: ["skill:crafting:rank", ben.rank] }],
                },
                { label: skillKey("lore"), value: "lore" },
              ],
            },
            aeLike("add", "system.skills.crafting.rank", 1, [`${opt}:crafting`]),
            {
              key: "GrantItem",
              uuid: PF2E_FEAT_UUIDS["additional-lore"],
              predicate: [`${opt}:lore`],
            },
          ],
          prereqs,
        );
      }
      return makeFeat(
        name,
        ben.level,
        `Increases ${b.skills.join("/")} proficiency up to ${rankLabel} (p. ${ben.page}).`,
        [
          ...base,
          {
            key: "ChoiceSet",
            flag: "skill",
            adjustName: false,
            choices: b.skills.map((s) => ({
              label: skillKey(s),
              value: s,
              predicate: [{ lt: [`skill:${s}:rank`, ben.rank] }],
            })),
          },
          aeLike("add", "system.skills.{item|flags.system.rulesSelections.skill}.rank", 1),
        ],
        prereqs,
      );
    }
    case "branch-feat": {
      const slug = (
        ben.featLevel === 6 ? b.branchFeat6 : b.branchFeat10
      ) as keyof typeof PF2E_FEAT_UUIDS;
      return makeFeat(
        name,
        ben.level,
        `Grants ${slug} (or level-${ben.featLevel} class feat if owned). Manual: check fallback prereqs (p. ${ben.page}).`,
        [
          ...base,
          ...fallbackFeatRules(
            slug,
            [
              "item:category:class",
              { lte: ["item:level", ben.featLevel] },
              {
                or: ["item:trait:{actor|system.details.class.trait}", "item:trait:archetype"],
              },
            ],
            BRANCH_FEAT_PREREQS[slug] ?? ["feat:magaambyan-attendant-dedication"],
          ),
        ],
        prereqs,
      );
    }
    case "general-feat": {
      const slug = b.generalFeat as keyof typeof PF2E_FEAT_UUIDS;
      return makeFeat(
        name,
        ben.level,
        `Grants ${slug}, or a 1st-level general feat if already owned (p. ${ben.page}).`,
        [...base, ...fallbackFeatRules(slug, ["item:category:general", "item:level:1"])],
        prereqs,
      );
    }
    case "make-your-own-luck": {
      const selectors = b.skills.map((s) => (s === "lore" ? "lore-skill-check" : s));
      const opt = `make-your-own-luck:${branchId}`;
      return makeFeat(
        name,
        ben.level,
        `1/day fortune reroll in ${b.skills.join("/")} (p. ${ben.page}).`,
        [
          ...base,
          rollOpt(opt, true),
          { key: "RollTwice", selector: selectors, keep: "higher", predicate: [opt] },
          rollNote(selectors),
        ],
        prereqs,
        ["fortune"],
        { max: 1, per: "day" },
      );
    }
    case "magical-paragon": {
      const spec = PARAGON_SPECS[branchId];
      return makeFeat(
        name,
        ben.level,
        spec.desc,
        [...base, ...spec.rules],
        prereqs,
        [],
        spec.freq ?? null,
      );
    }
  }
}

function buildClassroomAdvantageFeats(): PF2eFeatSource[] {
  return STUDENT_IDS.map((id) => {
    const s = STUDENTS[id];
    const b = BRANCHES[s.branch].label;
    const act = s.activity === "cram" ? "Cram" : "Study";
    const effectText = {
      "downgrade-crit-failure": `${b} ${act} critical failures become failures`,
      "upgrade-success": `${b} Study successes become critical successes`,
      "no-cram-fatigue": `${b} Cramming causes no Cram fatigue`,
      "extra-cram-check": `${b} Cramming rolls 3 Study checks instead of 2`,
      reroll: `1/day fortune reroll on ${b} Study`,
    }[s.effect];
    const unlocks = s.unlocks
      .map((u) => PF2E_UNLOCK_UUIDS[u as keyof typeof PF2E_UNLOCK_UUIDS])
      .map(({ uuid, label }) => `@UUID[${uuid}]{${label}}`)
      .join(" and ");
    const base: RuleElementSource[] = [
      rollOpt(`academia:classroom-advantage:${id}`),
      aeLike("override", `flags.${MODULE_ID}.classroomAdvantages.${id}`, true),
    ];
    const toggle = `classroom-advantage:${id}`;
    const reroll = s.effect === "reroll";
    // prettier-ignore
    const rules: RuleElementSource[] = reroll
      ? [...base, rollOpt(toggle, true), { key: "RollTwice", selector: ["skill-check"], keep: "higher", predicate: [toggle, `study-check:branch:${s.branch}`] }]
      : base;
    return makeFeat(
      `Classroom Advantage: ${s.label}`,
      1,
      `${effectText}; unlocks ${unlocks} (p. ${s.page}).`,
      rules,
      [`Befriended ${s.label}`],
      reroll ? ["fortune"] : [],
      reroll ? { max: 1, per: "day" } : null,
    );
  });
}

export const STANDING_FEATS: readonly PF2eFeatSource[] = buildStandingFeats();
export const CLASSROOM_ADVANTAGE_FEATS: readonly PF2eFeatSource[] = buildClassroomAdvantageFeats();
export const BENEFIT_FEATS: readonly PF2eFeatSource[] = BRANCH_IDS.flatMap((branchId) =>
  BENEFITS.map((benefit) => buildBenefitFeat(branchId, benefit)),
);
// prettier-ignore
export const ACADEMIA_FEATS: readonly PF2eFeatSource[] = [...STANDING_FEATS, ...CLASSROOM_ADVANTAGE_FEATS, ...BENEFIT_FEATS];
